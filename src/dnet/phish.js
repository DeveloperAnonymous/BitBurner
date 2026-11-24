import { report } from "/dnet/shared.js";

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");

    while (true) {
        const result = await ns.dnet.phishingAttack();
        if (result.success) report(ns, "phish", result.message);
    }
}
