import { crack } from "/dnet/crack.js";

const FILLER = "A";

/** @param {NS} ns */
export async function main(ns) {
    await crack(ns, solve);
}

/**
 * Pr0verFl0 compares the first half of the buffer to the second, so any password twice its length with equal halves passes.
 * @param {import("/dnet/crack.js").Target} target
 * @returns {import("/dnet/crack.js").Guesses}
 */
async function* solve({ details }) {
    yield FILLER.repeat(details.passwordLength * 2);
}
