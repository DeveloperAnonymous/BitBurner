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
 * Random game to the end: each side plays a random sensible move, or passes when it has none; two passes end it.
 * @param {Int8Array} cells mutated
 * @param {number[][]} neighbors
 * @param {number} toMove
 * @param {number} komi
 * @returns {number} winning color
 */
function playout(cells, neighbors, toMove, komi) {
    const candidates = [];
    const moveLimit = cells.length * PLAYOUT_LENGTH_PER_POINT;
    let color = toMove;
    let passes = 0;

    for (let moveCount = 0; moveCount < moveLimit && passes < 2; moveCount++) {
        candidates.length = 0;
        for (let point = 0; point < cells.length; point++) if (cells[point] === EMPTY) candidates.push(point);

        const chosen = randomSensibleMove(cells, neighbors, candidates, color);
        if (chosen === -1) passes++;
        else {
            placeStone(cells, neighbors, chosen, color);
            passes = 0;
        }

        color = 3 - color;
    }

    const score = areaScore(cells, neighbors);

    return score.black > score.white + komi ? BLACK : WHITE;
}

/**
 * Draws candidates in random order until one is sensible.
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
        if (isLegal(cells, neighbors, point, color) && !isOwnEye(cells, neighbors, point, color)) return point;
    }

    return -1;
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
        const winner = playout(scratch, neighbors, leaf.toMove, komi);

        for (let node = /** @type {TreeNode | null} */ (leaf); node !== null; node = node.parent) {
            node.visits++;
            if (winner === 3 - node.toMove) node.wins++;
        }

        if (Date.now() - pausedAt < PAUSE_EVERY_MS) continue;

        await pause();
        pausedAt = Date.now();
    }

    const best = root.children.reduce((most, child) => (child.visits > most.visits ? child : most));

    return { x: Math.floor(best.move / height), y: best.move % height, winRate: best.wins / best.visits, playouts: root.visits };
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
 * The fewest liberties any black chain has, or Infinity when black has no stones.
 * @param {Position} position
 */
export function weakestBlackLiberties(position) {
    const { cells, neighbors } = position;
    let weakest = Infinity;

    for (let point = 0; point < cells.length; point++) {
        if (cells[point] !== BLACK) continue;

        weakest = Math.min(weakest, libertyCount(cells, neighbors, point));
    }

    return weakest;
}

/**
 * @param {Int8Array} cells
 * @param {number[][]} neighbors
 * @param {number} start
 */
function libertyCount(cells, neighbors, start) {
    let count = 0;
    while (hasLiberties(cells, neighbors, start, count + 1, -1)) count++;

    return count;
}

/** @param {Position} position */
export function emptyCount(position) {
    return position.cells.reduce((count, cell) => count + (cell === EMPTY ? 1 : 0), 0);
}
