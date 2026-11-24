/**
 * IPvGO engine: rules plus Monte Carlo Tree Search (UCT). No ns calls, so importing it adds no RAM.
 * Points are indexed x * height + y, matching getBoardState() where each string is one column.
 */

export const BLACK = 1;
export const WHITE = 2;
const EMPTY = 0;
const DEAD = 3;
const CELL_OF_CHAR = /** @type {Record<string, number>} */ ({ X: BLACK, O: WHITE, "#": DEAD, ".": EMPTY });
const CHAR_OF_CELL = [".", "X", "O", "#"];

const EXPLORATION = 0.7;
const EARLY_STOP_PLAYOUTS_PER_MOVE = 30;
const EARLY_STOP_VISIT_SHARE = 0.6;
const PLAYOUT_LENGTH_PER_POINT = 3;
const PAUSE_EVERY_MS = 40;

/**
 * @typedef {{ width: number, height: number, cells: Int8Array, neighbors: number[][] }} Position
 * @typedef {{ move: number, toMove: number, parent: TreeNode | null, children: TreeNode[], untried: number[], wins: number, visits: number }} TreeNode
 * @typedef {{ x: number, y: number, winRate: number, playouts: number }} SearchResult
 */

/**
 * @param {string[]} board columns from ns.go.getBoardState()
 * @returns {Position}
 */
export function parseBoard(board) {
    const width = board.length;
    const height = board[0].length;
    const cells = new Int8Array(width * height);

    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) cells[x * height + y] = CELL_OF_CHAR[board[x][y]];
    }

    const neighbors = Array.from({ length: cells.length }, (_, index) => neighborIndexes(index, width, height, cells));

    return { width, height, cells, neighbors };
}

/**
 * @param {number} index
 * @param {number} width
 * @param {number} height
 * @param {Int8Array} cells
 * @returns {number[]} on-board, non-dead orthogonal neighbors; none for a dead point
 */
function neighborIndexes(index, width, height, cells) {
    if (cells[index] === DEAD) return [];

    const x = Math.floor(index / height);
    const y = index % height;
    const around = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];

    return around
        .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < width && ny < height)
        .map(([nx, ny]) => nx * height + ny)
        .filter(neighbor => cells[neighbor] !== DEAD);
}

/**
 * The same text getBoardState() would return for these cells, joined, for comparing with the move history.
 * @param {Int8Array} cells
 */
export function boardKey(cells) {
    let text = "";
    for (let index = 0; index < cells.length; index++) text += CHAR_OF_CELL[cells[index]];

    return text;
}

const STAMP_LIMIT = 2 ** 30;
let marks = new Int32Array(0);
let stamp = 0;

/**
 * A fresh visit marker. Markers live in an Int32Array, so they restart before overflowing: a wrapped value would
 * never match and flood fills would loop forever.
 * @param {number} size
 */
function nextStamp(size) {
    if (marks.length < size) marks = new Int32Array(size);

    if (stamp >= STAMP_LIMIT) {
        marks.fill(0);
        stamp = 0;
    }

    stamp++;

    return stamp;
}

/**
 * Whether the chain at start has at least `needed` liberties, not counting the point `ignored`.
 * @param {Int8Array} cells
 * @param {number[][]} neighbors
 * @param {number} start
 * @param {number} needed
 * @param {number} ignored
 */
function hasLiberties(cells, neighbors, start, needed, ignored) {
    const color = cells[start];
    const current = nextStamp(cells.length);
    const stack = [start];
    marks[start] = current;
    let found = 0;

    while (stack.length > 0) {
        const point = /** @type {number} */ (stack.pop());

        for (const next of neighbors[point]) {
            if (marks[next] === current) continue;

            const cell = cells[next];
            if (cell === EMPTY && next !== ignored) {
                marks[next] = current;
                if (++found >= needed) return true;
            } else if (cell === color) {
                marks[next] = current;
                stack.push(next);
            }
        }
    }

    return false;
}

/**
 * @param {Int8Array} cells
 * @param {number[][]} neighbors
 * @param {number} start
 * @returns {number} stones removed
 */
function removeChain(cells, neighbors, start) {
    const color = cells[start];
    const stack = [start];
    cells[start] = EMPTY;
    let removed = 1;

    while (stack.length > 0) {
        const point = /** @type {number} */ (stack.pop());

        for (const next of neighbors[point]) {
            if (cells[next] !== color) continue;

            cells[next] = EMPTY;
            removed++;
            stack.push(next);
        }
    }

    return removed;
}

/**
 * Legal under the no-suicide rule. Superko is checked separately, against the game's move history.
 * @param {Int8Array} cells
 * @param {number[][]} neighbors
 * @param {number} point
 * @param {number} color
 */
function isLegal(cells, neighbors, point, color) {
    if (cells[point] !== EMPTY) return false;

    const enemy = 3 - color;

    for (const next of neighbors[point]) {
        const cell = cells[next];
        if (cell === EMPTY) return true;
        if (cell === color && hasLiberties(cells, neighbors, next, 1, point)) return true;
        if (cell === enemy && !hasLiberties(cells, neighbors, next, 1, point)) return true;
    }

    return false;
}

/**
 * Places a legal stone and removes the enemy chains left without liberties.
 * @param {Int8Array} cells
 * @param {number[][]} neighbors
 * @param {number} point
 * @param {number} color
 */
function placeStone(cells, neighbors, point, color) {
    const enemy = 3 - color;
    cells[point] = color;

    for (const next of neighbors[point]) {
        if (cells[next] === enemy && !hasLiberties(cells, neighbors, next, 1, -1)) removeChain(cells, neighbors, next);
    }
}

/**
 * An empty point surrounded only by the color's stones. Filling it only takes away a liberty that color needs.
 * @param {Int8Array} cells
 * @param {number[][]} neighbors
 * @param {number} point
 * @param {number} color
 */
function isOwnEye(cells, neighbors, point, color) {
    const around = neighbors[point];

    return around.length > 0 && around.every(next => cells[next] === color);
}

/**
 * @param {Int8Array} cells
 * @param {number[][]} neighbors
 * @param {number} color
 * @returns {number[]} legal points that do not fill the color's own eye
 */
function sensibleMoves(cells, neighbors, color) {
    const moves = [];

    for (let point = 0; point < cells.length; point++) {
        if (isLegal(cells, neighbors, point, color) && !isOwnEye(cells, neighbors, point, color)) moves.push(point);
    }

    return moves;
}

/**
 * Area score: stones plus empty regions bordered by one color only. Komi is added by the caller.
 * @param {Int8Array} cells
 * @param {number[][]} neighbors
 * @returns {{ black: number, white: number }}
 */
export function areaScore(cells, neighbors) {
    const current = nextStamp(cells.length);
    const total = { black: 0, white: 0 };

    for (let point = 0; point < cells.length; point++) {
        const cell = cells[point];
        if (cell === BLACK) total.black++;
        if (cell === WHITE) total.white++;
        if (cell !== EMPTY || marks[point] === current) continue;

        const region = emptyRegion(cells, neighbors, point, current);
        if (region.bordersBlack && !region.bordersWhite) total.black += region.size;
        if (region.bordersWhite && !region.bordersBlack) total.white += region.size;
    }

    return total;
}

/**
 * @param {Int8Array} cells
 * @param {number[][]} neighbors
 * @param {number} start
 * @param {number} current stamp marking visited points
 */
function emptyRegion(cells, neighbors, start, current) {
    const stack = [start];
    marks[start] = current;
    const region = { size: 0, bordersBlack: false, bordersWhite: false };

    while (stack.length > 0) {
        const point = /** @type {number} */ (stack.pop());
        region.size++;

        for (const next of neighbors[point]) {
            const cell = cells[next];
            if (cell === BLACK) region.bordersBlack = true;
            if (cell === WHITE) region.bordersWhite = true;
            if (cell !== EMPTY || marks[next] === current) continue;

            marks[next] = current;
            stack.push(next);
        }
    }

    return region;
}

/**
 * Heavy playout to the end of the game. Each side first answers the previous move tactically (capture it if it is in
 * atari, rescue its own chain the move put in atari), otherwise plays a random sensible move that is not self-atari,
 * otherwise passes; two passes end it. Pure random play misjudges life and death, which made win rates swing wildly.
 * @param {Int8Array} cells mutated
 * @param {number[][]} neighbors
 * @param {TreeNode} leaf the position's node: who moves next, and the move that led here (-1 at the root)
 * @param {number} komi
 * @returns {number} winning color
 */
function playout(cells, neighbors, leaf, komi) {
    const candidates = [];
    const moveLimit = cells.length * PLAYOUT_LENGTH_PER_POINT;
    let color = leaf.toMove;
    let lastMove = leaf.move;
    let passes = 0;

    for (let moveCount = 0; moveCount < moveLimit && passes < 2; moveCount++) {
        let chosen = tacticalReply(cells, neighbors, lastMove, color);

        if (chosen === -1) {
            candidates.length = 0;
            for (let point = 0; point < cells.length; point++) if (cells[point] === EMPTY) candidates.push(point);
            chosen = randomSensibleMove(cells, neighbors, candidates, color);
        }

        if (chosen === -1) passes++;
        else {
            placeStone(cells, neighbors, chosen, color);
            passes = 0;
        }

        lastMove = chosen;
        color = 3 - color;
    }

    const score = areaScore(cells, neighbors);

    return score.black > score.white + komi ? BLACK : WHITE;
}

/**
 * Captures the stone just played when it is left in atari, else saves a chain of the color's that it put in atari.
 * @param {Int8Array} cells
 * @param {number[][]} neighbors
 * @param {number} lastMove the opponent's last stone, or -1 after a pass
 * @param {number} color the side to move
 * @returns {number} the point, or -1 when there is no urgent reply
 */
function tacticalReply(cells, neighbors, lastMove, color) {
    if (lastMove < 0 || cells[lastMove] !== 3 - color) return -1;

    const capturePoint = soleLiberty(cells, neighbors, lastMove);
    if (capturePoint !== -1 && isLegal(cells, neighbors, capturePoint, color)) return capturePoint;

    for (const next of neighbors[lastMove]) {
        if (cells[next] !== color) continue;

        const escapePoint = soleLiberty(cells, neighbors, next);
        if (escapePoint !== -1 && isLegal(cells, neighbors, escapePoint, color) && !isSelfAtari(cells, neighbors, escapePoint, color)) return escapePoint;
    }

    return -1;
}

/**
 * Draws candidates in random order until one is sensible and not self-atari.
 * @param {Int8Array} cells
 * @param {number[][]} neighbors
 * @param {number[]} candidates emptied as it draws
 * @param {number} color
 * @returns {number} the point, or -1 to pass
 */
function randomSensibleMove(cells, neighbors, candidates, color) {
    while (candidates.length > 0) {
        const pick = Math.floor(Math.random() * candidates.length);
        const point = candidates[pick];
        candidates[pick] = candidates[candidates.length - 1];
        candidates.pop();
        if (!isLegal(cells, neighbors, point, color) || isOwnEye(cells, neighbors, point, color)) continue;
        if (!isSelfAtari(cells, neighbors, point, color)) return point;
    }

    return -1;
}

/**
 * @param {Int8Array} cells
 * @param {number[][]} neighbors
 * @param {number} start a stone
 * @returns {number} the chain's only liberty, or -1 when it has none or more than one
 */
function soleLiberty(cells, neighbors, start) {
    const color = cells[start];
    const current = nextStamp(cells.length);
    const stack = [start];
    marks[start] = current;
    let liberty = -1;

    while (stack.length > 0) {
        const point = /** @type {number} */ (stack.pop());

        for (const next of neighbors[point]) {
            if (marks[next] === current) continue;

            const cell = cells[next];
            marks[next] = current;
            if (cell === color) stack.push(next);
            if (cell !== EMPTY) continue;
            if (liberty !== -1) return -1;

            liberty = next;
        }
    }

    return liberty;
}

/**
 * A legal move that captures nothing and leaves the new chain with a single liberty.
 * @param {Int8Array} cells
 * @param {number[][]} neighbors
 * @param {number} point
 * @param {number} color
 */
function isSelfAtari(cells, neighbors, point, color) {
    const enemy = 3 - color;

    for (const next of neighbors[point]) {
        if (cells[next] === enemy && !hasLiberties(cells, neighbors, next, 1, point)) return false;
    }

    cells[point] = color;
    const inAtari = !hasLiberties(cells, neighbors, point, 2, -1);
    cells[point] = EMPTY;

    return inAtari;
}

/**
 * @param {number} move
 * @param {number} toMove
 * @param {TreeNode | null} parent
 * @param {number[]} untried
 * @returns {TreeNode}
 */
function treeNode(move, toMove, parent, untried) {
    return { move, toMove, parent, children: [], untried, wins: 0, visits: 0 };
}

/**
 * UCB1 over the children; every child has at least one visit, since it is created with a playout.
 * @param {TreeNode} node
 */
function mostPromisingChild(node) {
    const logVisits = Math.log(node.visits);
    let best = node.children[0];
    let bestValue = -Infinity;

    for (const child of node.children) {
        const value = child.wins / child.visits + EXPLORATION * Math.sqrt(logVisits / child.visits);
        if (value <= bestValue) continue;

        best = child;
        bestValue = value;
    }

    return best;
}

/**
 * Black's root moves: sensible, and not recreating any earlier board (superko).
 * @param {Position} position
 * @param {Set<string>} seenKeys
 */
function rootMoves(position, seenKeys) {
    const scratch = new Int8Array(position.cells.length);

    return sensibleMoves(position.cells, position.neighbors, BLACK).filter(point => {
        scratch.set(position.cells);
        placeStone(scratch, position.neighbors, point, BLACK);

        return !seenKeys.has(boardKey(scratch));
    });
}

/**
 * Searches black's best move for about timeMs, pausing every PAUSE_EVERY_MS so the game stays responsive.
 * @param {Position} position
 * @param {{ komi: number, seenKeys: Set<string>, timeMs: number, pause: () => Promise<unknown> }} options
 * @returns {Promise<SearchResult | null>} null when black has no sensible legal move
 */
export async function searchBestMove(position, { komi, seenKeys, timeMs, pause }) {
    const moves = rootMoves(position, seenKeys);
    if (moves.length === 0) return null;

    const { cells, neighbors, height } = position;
    const root = treeNode(-1, BLACK, null, moves);
    const scratch = new Int8Array(cells.length);
    const deadline = Date.now() + timeMs;
    let pausedAt = Date.now();

    while (Date.now() < deadline || root.children.length === 0) {
        scratch.set(cells);
        const leaf = descend(root, scratch, neighbors);
        const winner = playout(scratch, neighbors, leaf, komi);

        for (let node = /** @type {TreeNode | null} */ (leaf); node !== null; node = node.parent) {
            node.visits++;
            if (winner === 3 - node.toMove) node.wins++;
        }

        if (Date.now() - pausedAt < PAUSE_EVERY_MS) continue;
        if (hasClearFavorite(root)) break;

        await pause();
        pausedAt = Date.now();
    }

    const best = root.children.reduce((most, child) => (child.visits > most.visits ? child : most));

    return { x: Math.floor(best.move / height), y: best.move % height, winRate: best.wins / best.visits, playouts: root.visits };
}

/**
 * After enough playouts for every root move to be looked at properly, one move holding most of the visits will not be
 * overtaken in the time left.
 * @param {TreeNode} root
 */
function hasClearFavorite(root) {
    const rootMoveCount = root.children.length + root.untried.length;
    if (root.visits < rootMoveCount * EARLY_STOP_PLAYOUTS_PER_MOVE) return false;

    return root.children.some(child => child.visits >= root.visits * EARLY_STOP_VISIT_SHARE);
}

/**
 * Follows UCB1 down the tree, playing each move on scratch, then expands one untried move.
 * @param {TreeNode} root
 * @param {Int8Array} scratch
 * @param {number[][]} neighbors
 * @returns {TreeNode} the node to play out from
 */
function descend(root, scratch, neighbors) {
    let node = root;

    while (node.untried.length === 0 && node.children.length > 0) {
        node = mostPromisingChild(node);
        placeStone(scratch, neighbors, node.move, 3 - node.toMove);
    }

    if (node.untried.length === 0) return node;

    const pick = Math.floor(Math.random() * node.untried.length);
    const move = node.untried[pick];
    node.untried[pick] = node.untried[node.untried.length - 1];
    node.untried.pop();
    placeStone(scratch, neighbors, move, node.toMove);

    const child = treeNode(move, 3 - node.toMove, node, sensibleMoves(scratch, neighbors, 3 - node.toMove));
    node.children.push(child);

    return child;
}

/**
 * Whether black wins if white passes now, and no legal white move captures black stones. A white move that only
 * invades black's territory is not counted: the game goes on after it, and black answers by capturing the invader.
 * Captures are what white could not be made to undo. Moves that superko would forbid are tested too, which only makes
 * the answer more cautious.
 * @param {Position} position
 * @param {number} komi
 */
export function holdsAgainstEveryWhiteReply(position, komi) {
    const { cells, neighbors } = position;
    const score = areaScore(cells, neighbors);
    if (score.black <= score.white + komi) return false;

    const blackStones = stoneCount(cells, BLACK);
    const scratch = new Int8Array(cells.length);

    for (let point = 0; point < cells.length; point++) {
        if (!isLegal(cells, neighbors, point, WHITE)) continue;

        scratch.set(cells);
        placeStone(scratch, neighbors, point, WHITE);
        if (stoneCount(scratch, BLACK) < blackStones) return false;
    }

    return true;
}

/**
 * @param {Int8Array} cells
 * @param {number} color
 */
function stoneCount(cells, color) {
    let count = 0;
    for (let point = 0; point < cells.length; point++) if (cells[point] === color) count++;

    return count;
}
