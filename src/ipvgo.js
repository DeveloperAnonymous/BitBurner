import { holdsAgainstEveryWhiteReply, parseBoard, searchBestMove } from "/lib/go-engine.js";
import { reportFailure } from "/lib/report.js";

/** @typedef {"No AI" | "Netburners" | "Slum Snakes" | "The Black Hand" | "Tetrads" | "Daedalus" | "Illuminati" | "????????????"} Opponent */
/** @typedef {{ lineup: Opponent[], gamesEach: number, index: number, played: number }} Rotation */
/** @typedef {{ type: "move" | "pass" | "gameOver" | "resign", passedFirst?: boolean }} TurnOutcome */
/** @typedef {{ whitePassed: boolean, passedFirst: boolean }} GameMemory what this script saw earlier in the current game */

const OPPONENTS = ["Netburners", "Slum Snakes", "The Black Hand", "Tetrads", "Daedalus", "Illuminati", "????????????", "No AI"];
const ROTATION_LINEUP = /** @type {Opponent[]} */ (OPPONENTS.filter(opponent => opponent !== "No AI" && opponent !== "????????????"));
const GAMES_PER_OPPONENT = 5;
const BOARD_SIZES = [5, 7, 9, 13];
const DEFAULT_SIZE = /** @type {5 | 7 | 9 | 13} */ (7);
const RETRY_MS = 5000;

const SEARCH_MS_PER_POINT = 5;
/** @type {Partial<Record<Opponent, number>>} extra thinking time for the factions the bot loses to most */
const THINKING_MULTIPLIER = { "Illuminati": 10, "Tetrads": 4, "Daedalus": 2 };
const RESIGN_WIN_RATE = 0.03;
const MIN_PLAYOUTS_TO_RESIGN = 2000;

/**
 * Plays IPvGO as black forever, choosing moves with Monte Carlo Tree Search (/lib/go-engine.js).
 * run /ipvgo.js [size] [opponent...]
 * - size: 5, 7, 9 or 13 (default 7).
 * - opponents: every argument after the size, any case; commas also separate names. Quote names with spaces, e.g.
 *   run /ipvgo.js 9 "Slum Snakes" Illuminati. Default: every faction except "No AI" and "????????????".
 * Plays GAMES_PER_OPPONENT games against each opponent in turn, looping. An opponent the game refuses (for example
 * one not unlocked yet) is dropped.
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");

    const plan = planFromArgs(ns);
    if (plan === null) return;

    const { rotation, size } = plan;
    /** @type {Map<string, { wins: number, losses: number }>} */
    const records = new Map();
    ns.print(`Playing ${rotation.lineup.join(", ")} on ${size}x${size}, ${rotation.gamesEach} games each`);

    let resigned = false;
    /** @type {GameMemory} */
    let memory = { whitePassed: false, passedFirst: false };

    while (rotation.lineup.length > 0) {
        const needsGame = resigned || ns.go.getCurrentPlayer() === "None";
        if (needsGame && !startGame(ns, rotation, size)) {
            await ns.sleep(RETRY_MS);
            continue;
        }

        if (needsGame) memory = { whitePassed: false, passedFirst: false };
        resigned = false;
        const outcome = await takeTurn(ns, memory);
        memory = { whitePassed: outcome.type === "pass", passedFirst: memory.passedFirst || outcome.passedFirst === true };
        if (outcome.type === "move" || outcome.type === "pass") continue;

        logResult(ns, records, outcome.type);
        rotation.played++;
        if (rotation.played >= rotation.gamesEach) advance(rotation);
        resigned = outcome.type === "resign";
    }

    reportFailure(ns, "ipvgo.js stopped: no opponent in the lineup accepts a game");
}

/**
 * Bad args are printed to the terminal, since the player is looking there right after typing the command.
 * @param {NS} ns
 * @returns {{ rotation: Rotation, size: 5 | 7 | 9 | 13 } | null} null after reporting bad args
 */
function planFromArgs(ns) {
    const [sizeArg, ...opponentArgs] = ns.args;
    const size = sizeArg === undefined ? DEFAULT_SIZE : sizeArg;
    const names = opponentArgs.flatMap(arg => String(arg).split(",")).map(name => name.trim()).filter(name => name !== "");
    const lineup = names.length === 0 ? [...ROTATION_LINEUP] : names.map(canonicalOpponent);
    const unknown = names.filter((_, index) => lineup[index] === null);

    if (isBoardSize(size) && unknown.length === 0) {
        return { rotation: { lineup: /** @type {Opponent[]} */ (lineup), gamesEach: GAMES_PER_OPPONENT, index: 0, played: 0 }, size };
    }

    const problem = isBoardSize(size) ? `unknown opponent ${unknown.map(name => `"${name}"`).join(", ")}` : `size must be one of ${BOARD_SIZES.join(", ")}, got ${JSON.stringify(sizeArg)}`;
    ns.tprint(`ipvgo.js: ${problem}. Usage: run /ipvgo.js [size] [opponent...]. Opponents: ${OPPONENTS.join(", ")}`);

    return null;
}

/**
 * @param {string} name any case
 * @returns {Opponent | null}
 */
function canonicalOpponent(name) {
    const match = OPPONENTS.find(opponent => opponent.toLowerCase() === name.toLowerCase());

    return match === undefined ? null : /** @type {Opponent} */ (match);
}

/**
 * @param {unknown} value
 * @returns {value is 5 | 7 | 9 | 13}
 */
function isBoardSize(value) {
    return typeof value === "number" && BOARD_SIZES.includes(value);
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
 * @param {GameMemory} memory whitePassed: white's last reply to this script was a pass (previousMove covers a game the
 *   script picked up mid-way, before it saw any reply)
 * @returns {Promise<TurnOutcome>}
 */
async function takeTurn(ns, memory) {
    if (ns.go.getCurrentPlayer() === "White") return ns.go.opponentNextTurn();

    const state = ns.go.getGameState();
    const lead = state.blackScore - state.whiteScore;
    const history = ns.go.getMoveHistory();
    const position = parseBoard(ns.go.getBoardState());
    const whiteJustPassed = memory.whitePassed || (state.previousMove === null && history.length > 0);
    if (whiteJustPassed && lead > 0) return ns.go.passTurn();
    if (isSafeToPassFirst(position, state, memory)) return passFirst(ns, lead);

    const result = await searchBestMove(position, {
        komi: state.komi,
        seenKeys: new Set(history.map(board => board.join(""))),
        timeMs: position.cells.length * SEARCH_MS_PER_POINT * (THINKING_MULTIPLIER[ns.go.getOpponent()] ?? 1),
        pause: () => ns.sleep(0),
    });
    if (result === null) return ns.go.passTurn();
    if (result.winRate < RESIGN_WIN_RATE && result.playouts >= MIN_PLAYOUTS_TO_RESIGN && lead < 0) return { type: "resign" };

    return playMove(ns, result);
}

/**
 * Passing first is safe when black leads on the official score and no single white move can catch up. It is done at
 * most once per game: if white plays on instead, several white moves in a row could add up, so the bot fights on and
 * the game ends whenever white passes.
 * @param {import("/lib/go-engine.js").Position} position
 * @param {{ blackScore: number, whiteScore: number, komi: number }} state
 * @param {GameMemory} memory
 */
function isSafeToPassFirst(position, state, memory) {
    if (memory.passedFirst || state.blackScore <= state.whiteScore) return false;

    return holdsAgainstEveryWhiteReply(position, state.komi);
}

/**
 * Passes before white has, because the game is already won; white's next pass ends it.
 * @param {NS} ns
 * @param {number} lead
 * @returns {Promise<TurnOutcome>}
 */
async function passFirst(ns, lead) {
    ns.print(`  game won, passing to end (ahead by ${lead.toFixed(1)})`);

    return { ...(await ns.go.passTurn()), passedFirst: true };
}

/**
 * @param {NS} ns
 * @param {import("/lib/go-engine.js").SearchResult} result
 */
async function playMove(ns, result) {
    ns.print(`  ${(result.winRate * 100).toFixed(0)}% win chance`);

    try {
        return await ns.go.makeMove(result.x, result.y);
    } catch (error) {
        reportFailure(ns, `move ${result.x},${result.y} was rejected (${error}); passing instead`);

        return ns.go.passTurn();
    }
}

/**
 * Logs the game and the running win/loss tally against that opponent since the script started.
 * @param {NS} ns
 * @param {Map<string, { wins: number, losses: number }>} records by opponent
 * @param {"gameOver" | "resign"} ending
 */
function logResult(ns, records, ending) {
    const state = ns.go.getGameState();
    const opponent = ns.go.getOpponent();
    const won = ending === "gameOver" && state.blackScore > state.whiteScore;
    const record = records.get(opponent) ?? { wins: 0, losses: 0 };
    if (won) record.wins++;
    else record.losses++;

    records.set(opponent, record);
    const verdict = won ? "WON" : ending === "resign" ? "RESIGNED" : "LOST";
    ns.print(`${verdict} ${state.blackScore} to ${state.whiteScore} against ${opponent} | ${record.wins}W ${record.losses}L`);
}
