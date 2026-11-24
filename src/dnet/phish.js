/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");

    while (true) {
        await ns.dnet.phishingAttack();
    }
}
