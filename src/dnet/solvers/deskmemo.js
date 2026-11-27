import { crack } from "/dnet/crack.js";
import { leakedPasswords } from "/dnet/log-feedback.js";
import { statedPasswords } from "/dnet/password-format.js";

/** @param {NS} ns */
export async function main(ns) {
    await crack(ns, solve);
}

/**
 * @param {import("/dnet/crack.js").Target} target
 * @returns {import("/dnet/crack.js").Guesses}
 */
async function* solve(target) {
    yield* statedPasswords(target.details);
    yield* leakedPasswords(target);
}
