import { crack } from "/dnet/crack.js";
import { COMMON_DEFAULTS, fitsFormat } from "/dnet/password-format.js";

/** @param {NS} ns */
export async function main(ns) {
    await crack(ns, solve);
}

/**
 * @param {import("/dnet/crack.js").Target} target
 * @returns {import("/dnet/crack.js").Guesses}
 */
async function* solve({ details }) {
    yield* COMMON_DEFAULTS.filter(password => fitsFormat(password, details));
}
