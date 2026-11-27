import { crack } from "/dnet/crack.js";

/** @param {NS} ns */
export async function main(ns) {
    await crack(ns, solve);
}

/** @returns {import("/dnet/crack.js").Guesses} */
async function* solve() {
    yield "";
}
