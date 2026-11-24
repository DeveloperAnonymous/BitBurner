import { report } from "/dnet/shared.js";

/**
 * One-shot: stasis-links the node it runs on, then exits so neighboring crawlers can redeploy the crawler here.
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");

    const result = await ns.dnet.setStasisLink(true);
    report(ns, result.success ? "stasis" : "failed", `stasis link: ${result.code} ${result.message}`);
}
