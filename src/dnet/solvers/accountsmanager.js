import { crack } from "/dnet/crack.js";
import { readAttemptData } from "/dnet/log-feedback.js";

const TOO_HIGH = "Lower";
const TOO_LOW = "Higher";

/** @param {NS} ns */
export async function main(ns) {
    await crack(ns, solve);
}

/**
 * AccountsManager logs "Higher" or "Lower" for each wrong number, so a binary search over the password's digit count.
 * @param {import("/dnet/crack.js").Target} target
 * @returns {import("/dnet/crack.js").Guesses}
 */
async function* solve({ ns, host, details }) {
    let low = details.passwordLength === 1 ? 0 : 10 ** (details.passwordLength - 1);
    let high = 10 ** details.passwordLength - 1;

    while (low <= high) {
        const guess = String(Math.floor((low + high) / 2));
        yield guess;

        const logged = await readAttemptData(ns, host, guess);
        if ("failure" in logged) return logged.failure;

        if (logged.data === TOO_HIGH) high = Number(guess) - 1;
        else if (logged.data === TOO_LOW) low = Number(guess) + 1;
        else return `unreadable answer "${logged.data}" for "${guess}"`;
    }

    return `range ${low}-${high} empty without a match`;
}
