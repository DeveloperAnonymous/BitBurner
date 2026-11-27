import { crack } from "/dnet/crack.js";
import { readAttemptData } from "/dnet/log-feedback.js";

const DIGITS = "0123456789";
const LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** @type {Partial<Record<import("/dnet/crack.js").ServerDetails["passwordFormat"], string>>} */
const FORMAT_SYMBOLS = { numeric: DIGITS, alphabetic: LETTERS, alphanumeric: DIGITS + LETTERS };
const POSITION_MATCH = "yes";

/** @param {NS} ns */
export async function main(ns) {
    await crack(ns, solve);
}

/**
 * NIL answers each position with "yes" or "yesn't", so every guess tries the next symbol at each unsolved position.
 * @param {import("/dnet/crack.js").Target} target
 * @returns {import("/dnet/crack.js").Guesses}
 */
async function* solve({ ns, host, details }) {
    const symbols = FORMAT_SYMBOLS[details.passwordFormat];
    if (!symbols) return `no symbol set for ${details.passwordFormat} passwords`;

    /** @type {(string | null)[]} */
    const solved = Array(details.passwordLength).fill(null);

    for (const symbol of symbols) {
        const guess = solved.map(known => known ?? symbol).join("");
        yield guess;

        const logged = await readAttemptData(ns, host, guess);
        if ("failure" in logged) return logged.failure;

        const answers = logged.data.split(",");
        if (answers.length !== guess.length) return `unreadable answer "${logged.data}" for "${guess}"`;

        answers.forEach((answer, index) => {
            if (answer === POSITION_MATCH) solved[index] = guess[index];
        });
    }

    return `positions still unsolved after every symbol: ${solved.map(known => known ?? "?").join("")}`;
}
