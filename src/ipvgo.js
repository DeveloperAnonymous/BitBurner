import { emptyCount, parseBoard, searchBestMove, weakestBlackLiberties } from "/lib/go-engine.js";
import { reportFailure } from "/lib/report.js";

/** @typedef {"No AI" | "Netburners" | "Slum Snakes" | "The Black Hand" | "Tetrads" | "Daedalus" | "Illuminati" | "????????????"} Opponent */
/** @typedef {{ lineup: Opponent[], gamesEach: number, index: number, played: number }} Rotation */
/** @typedef {{ type: "move" | "pass" | "gameOver" | "resign" }} TurnOutcome */

const OPPONENTS = ["Netburners", "Slum Snakes", "The Black Hand", "Tetrads", "Daedalus", "Illuminati", "????????????", "No AI"];
const ROTATION_LINEUP = /** @type {Opponent[]} */ (OPPONENTS.filter(opponent => opponent !== "No AI" && opponent !== "????????????"));
const GAMES_PER_OPPONENT = 5;
const BOARD_SIZES = [5, 7, 9, 13];
const DEFAULT_SIZE = 7;
const RETRY_MS = 5000;

const SEARCH_MS_PER_POINT = 30;
const RESIGN_WIN_RATE = 0.03;
const MIN_PLAYOUTS_TO_RESIGN = 2000;
const SAFE_LIBERTIES = 3;

/**
 * Plays IPvGO as black forever, choosing moves with Monte Carlo Tree Search (/lib/go-engine.js).
 * - No args: 7x7 games, GAMES_PER_OPPONENT against each faction in turn, looping. A faction that refuses a game
 *   (for example one not unlocked yet) is skipped.
 * - run /ipvgo.js <opponent> [boardSize]: only that opponent, on boardSize (default 7).
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");

    const rotation = rotationFromArgs(ns);
    if (rotation === null) return;

    const size = /** @type {5 | 7 | 9 | 13} */ (Number(ns.args[1] ?? DEFAULT_SIZE));
    const record = { wins: 0, losses: 0 };
    ns.print(`Playing ${rotation.lineup.join(", ")} on ${size}x${size}${rotation.lineup.length > 1 ? `, ${rotation.gamesEach} games each` : ""}`);

    let resigned = false;

    while (rotation.lineup.length > 0) {
        const needsGame = resigned || ns.go.getCurrentPlayer() === "None";
        if (needsGame && !startGame(ns, rotation, size)) {
            await ns.sleep(RETRY_MS);
            continue;
        }

        resigned = false;
        const outcome = await takeTurn(ns);
        if (outcome.type === "move" || outcome.type === "pass") continue;

        logResult(ns, record, outcome.type);
        rotation.played++;
        if (rotation.played >= rotation.gamesEach) advance(rotation);
        resigned = outcome.type === "resign";
    }

    reportFailure(ns, "ipvgo.js stopped: no opponent in the lineup accepts a game");
}

/**
 * @param {NS} ns
 * @returns {Rotation | null} null after reporting bad args
 */
function rotationFromArgs(ns) {
    if (ns.args.length === 0) return { lineup: [...ROTATION_LINEUP], gamesEach: GAMES_PER_OPPONENT, index: 0, played: 0 };

    const opponent = String(ns.args[0]);
    const size = Number(ns.args[1] ?? DEFAULT_SIZE);
    if (OPPONENTS.includes(opponent) && BOARD_SIZES.includes(size)) {
        return { lineup: [/** @type {Opponent} */ (opponent)], gamesEach: Infinity, index: 0, played: 0 };
    }

    reportFailure(ns, `ipvgo.js takes no args, or <opponent> [size]: opponent one of ${OPPONENTS.join(", ")}; size one of ${BOARD_SIZES.join(", ")}. Got ${JSON.stringify(ns.args)}`);

    return null;
}

/** @param {Rotation} rotation */
function advance(rotation) {
    rotation.index = (rotation.index + 1) % rotation.lineup.length;
    rotation.played = 0;
}

/**
 * Starts a game against the rotation's current opponent. An opponent the game refuses (for example "????????????"
 * before it is unlocked) is dropped from the lineup for the rest of the run.
 * @param {NS} ns
 * @param {Rotation} rotation
 * @param {5 | 7 | 9 | 13} size
 * @returns {boolean} whether a new game started
 */
function startGame(ns, rotation, size) {
    const opponent = rotation.lineup[rotation.index];
    const refusal = resetRefusal(ns, opponent, size);
    if (refusal === null) return true;

    reportFailure(ns, `${opponent} refused a ${size}x${size} game (${refusal}); dropping it from the lineup`);
    rotation.lineup.splice(rotation.index, 1);
    rotation.played = 0;
    if (rotation.index >= rotation.lineup.length) rotation.index = 0;

    return false;
}

/**
 * @param {NS} ns
 * @param {Opponent} opponent
 * @param {5 | 7 | 9 | 13} size
 * @returns {string | null} why the game would not start, or null when it started
 */
function resetRefusal(ns, opponent, size) {
    try {
        return ns.go.resetBoardState(opponent, size) === undefined ? "no board returned" : null;
    } catch (error) {
        return String(error);
    }
}

/**
 * Waits for white when it is white's turn (e.g. the script restarted mid-game). Otherwise passes a decided game,
 * resigns a lost one, or plays the searched move.
 * @param {NS} ns
 * @returns {Promise<TurnOutcome>}
 */
async function takeTurn(ns) {
    if (ns.go.getCurrentPlayer() === "White") return ns.go.opponentNextTurn();

    const state = ns.go.getGameState();
    const lead = state.blackScore - state.whiteScore;
    const history = ns.go.getMoveHistory();
    const position = parseBoard(ns.go.getBoardState());
    const whiteJustPassed = state.previousMove === null && history.length > 0;
    if ((whiteJustPassed && lead > 0) || isDecided(position, lead)) return ns.go.passTurn();

    const result = await searchBestMove(position, {
        komi: state.komi,
        seenKeys: new Set(history.map(board => board.join(""))),
        timeMs: position.cells.length * SEARCH_MS_PER_POINT,
        pause: () => ns.sleep(0),
    });
    if (result === null) return ns.go.passTurn();
    if (result.winRate < RESIGN_WIN_RATE && result.playouts >= MIN_PLAYOUTS_TO_RESIGN && lead < 0) return { type: "resign" };

    return playMove(ns, result);
}

/**
 * @param {NS} ns
 * @param {import("/lib/go-engine.js").SearchResult} result
 */
async function playMove(ns, result) {
    ns.print(`  ${result.x},${result.y}: ${(result.winRate * 100).toFixed(0)}% win over ${result.playouts} playouts`);

    try {
        return await ns.go.makeMove(result.x, result.y);
    } catch (error) {
        reportFailure(ns, `move ${result.x},${result.y} was rejected (${error}); passing instead`);

        return ns.go.passTurn();
    }
}

/**
 * Black leads by more than every empty point is worth and no black chain is short of liberties, so passing until
 * white passes too cannot lose.
 * @param {import("/lib/go-engine.js").Position} position
 * @param {number} lead
 */
function isDecided(position, lead) {
    return lead > emptyCount(position) && weakestBlackLiberties(position) >= SAFE_LIBERTIES;
}

/**
 * @param {NS} ns
 * @param {{ wins: number, losses: number }} record
 * @param {"gameOver" | "resign"} ending
 */
function logResult(ns, record, ending) {
    const state = ns.go.getGameState();
    const won = ending === "gameOver" && state.blackScore > state.whiteScore;
    if (won) record.wins++;
    else record.losses++;

    const verdict = won ? "WON" : ending === "resign" ? "RESIGNED" : "LOST";
    ns.print(`${verdict} ${state.blackScore} to ${state.whiteScore} against ${ns.go.getOpponent()} | ${record.wins}W ${record.losses}L`);
}
