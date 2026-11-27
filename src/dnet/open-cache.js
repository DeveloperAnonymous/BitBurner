import { report } from "/dnet/shared.js";

/**
 * One-shot: opens the .cache file named in the args on this node. Kept out of the crawler for openCache's 2 GB.
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");

    const [cache] = ns.args;
    if (typeof cache !== "string") {
        report(ns, "failed", `open-cache.js needs a cache file name, got ${JSON.stringify(ns.args)}`);

        return;
    }

    const result = ns.dnet.openCache(cache, true);
    report(ns, "cache", `${cache}: ${result.message}`);
}
