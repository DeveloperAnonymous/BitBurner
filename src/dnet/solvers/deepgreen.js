import { crack } from "/dnet/crack.js";
import { readAttemptData } from "/dnet/log-feedback.js";

/** @typedef {{ exact: number, misplaced: number }} Score */

const MAX_CANDIDATES = 100000;
const MAX_GUESSES = 25;

/** @param {NS} ns */
export async function main(ns) {
    await crack(ns, solve);
}

/**
 * Mastermind: each wrong guess reports exact and misplaced symbols, which narrows the candidates.
 * @param {import("/dnet/crack.js").Target} target
 * @returns {import("/dnet/crack.js").Guesses}
 */
async function* solve({ ns, host, details }) {
    if (details.passwordFormat !== "numeric" || 10 ** details.passwordLength > MAX_CANDIDATES) {
        return `no mastermind search for ${details.passwordLength} ${details.passwordFormat} passwords`;
    }

    let candidates = Array.from({ length: 10 ** details.passwordLength }, (_, value) => String(value).padStart(details.passwordLength, "0"));

    for (let guessCount = 0; guessCount < MAX_GUESSES && candidates.length > 0; guessCount++) {
        const guess = candidates[Math.floor(candidates.length / 2)];
        yield guess;

        const logged = await readAttemptData(ns, host, guess);
        if ("failure" in logged) return logged.failure;

        const [exact, misplaced] = logged.data.split(",").map(Number);
        if (!Number.isInteger(exact) || !Number.isInteger(misplaced)) return `unreadable score "${logged.data}" for "${guess}"`;

        const feedback = { exact, misplaced };
        candidates = candidates.filter(candidate => candidate !== guess && sameScore(mastermindScore(guess, candidate), feedback));
    }

    return `${candidates.length} candidates left after ${MAX_GUESSES} guesses`;
}

/**
 * @param {string} guess
 * @param {string} secret
 * @returns {Score}
 */
function mastermindScore(guess, secret) {
    const unmatched = [...guess].map((_, index) => index).filter(index => guess[index] !== secret[index]);
    /** @type {Map<string, number>} */
    const secretCounts = new Map();

    for (const index of unmatched) {
        secretCounts.set(secret[index], (secretCounts.get(secret[index]) ?? 0) + 1);
    }

    let misplaced = 0;

    for (const index of unmatched) {
        const available = secretCounts.get(guess[index]) ?? 0;
        if (available === 0) continue;

        misplaced++;
        secretCounts.set(guess[index], available - 1);
    }

    return { exact: guess.length - unmatched.length, misplaced };
}

/**
 * @param {Score} a
 * @param {Score} b
 */
function sameScore(a, b) {
    return a.exact === b.exact && a.misplaced === b.misplaced;
}
