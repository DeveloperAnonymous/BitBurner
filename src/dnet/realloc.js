import { report } from "/dnet/shared.js";

/**
 * One-shot: frees some of this node's blocked RAM, more per run with more threads. Kept out of the crawler for
 * memoryReallocation's 1 GB.
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");

    const result = await ns.dnet.memoryReallocation();
    if (!result.success) report(ns, "failed", `freeing blocked RAM failed (${result.code} ${result.message})`);
}
