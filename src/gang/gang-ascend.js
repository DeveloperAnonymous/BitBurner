import { reportFailure } from "/lib/report.js";
import { ascensionGain } from "/gang/ascension.js";

/**
 * One-shot helper started by gang.js. Ascends every member whose gain reaches the threshold.
 * args: [minGain, isHacking (1/0), runId]
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    const minGain = Number(ns.args[0]);
    const isHacking = Boolean(ns.args[1]);

    for (const name of ns.gang.getMemberNames()) {
        const result = ns.gang.getAscensionResult(name);
        if (!result || ascensionGain(result, isHacking) < minGain) continue;
        if (!ns.gang.ascendMember(name)) reportFailure(ns, `ascendMember ${name} returned nothing`);
    }
}
