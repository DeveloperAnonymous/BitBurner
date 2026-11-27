import { crack } from "/dnet/crack.js";

/** @param {NS} ns */
export async function main(ns) {
    await crack(ns, solve);
}

/**
 * @param {import("/dnet/crack.js").Target} target
 * @returns {import("/dnet/crack.js").Guesses}
 */
async function* solve({ details }) {
    yield details.data.replace(/\D/g, "");
}
