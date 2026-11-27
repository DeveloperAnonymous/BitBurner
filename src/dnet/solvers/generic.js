import { crack } from "/dnet/crack.js";
import { leakedPasswords } from "/dnet/log-feedback.js";
import { COMMON_DEFAULTS, fitsFormat, statedPasswords } from "/dnet/password-format.js";

const DIVISOR_HINT = /divisible\s+by\s+(\d+)/i;
const DEFAULT_PASSWORD_HINT = /default\s+password/i;
const MAX_BRUTE_FORCE = 1000;

/** @param {NS} ns */
export async function main(ns) {
    await crack(ns, solve);
}

/**
 * For models without their own solver: reads the hint, then ends with one plain guess so the failure report shows how
 * the model answers a wrong password.
 * @param {import("/dnet/crack.js").Target} target
 * @returns {import("/dnet/crack.js").Guesses}
 */
async function* solve(target) {
    const { details } = target;
    yield* statedPasswords(details);
    if (DEFAULT_PASSWORD_HINT.test(details.passwordHint)) yield* COMMON_DEFAULTS.filter(password => fitsFormat(password, details));
    yield* multiplePasswords(details);
    yield* leakedPasswords(target);
    yield (details.passwordFormat === "numeric" ? "0" : "a").repeat(details.passwordLength);

    return "no solver for this model yet (generic hint reading)";
}

/**
 * Every number with the password's digit count that the hint's divisor ("divisible by 7") divides, without a leading
 * zero first, then the zero-padded ones. Gives up when there are more than MAX_BRUTE_FORCE.
 * @param {import("/dnet/crack.js").ServerDetails} details
 */
function* multiplePasswords(details) {
    const divisor = Number(details.passwordHint.match(DIVISOR_HINT)?.[1]);
    const length = details.passwordLength;
    if (!(divisor > 0) || details.passwordFormat !== "numeric" || 10 ** length / divisor > MAX_BRUTE_FORCE) return;

    const smallestFull = length === 1 ? 0 : 10 ** (length - 1);
    const firstMultiple = Math.ceil(smallestFull / divisor) * divisor;

    for (let value = firstMultiple; value < 10 ** length; value += divisor) {
        yield String(value);
    }

    for (let value = 0; value < smallestFull; value += divisor) {
        yield String(value).padStart(length, "0");
    }
}
