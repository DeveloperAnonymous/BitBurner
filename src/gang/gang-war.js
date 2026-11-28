const ENGAGED_MARGIN = 0.1;

/**
 * One-shot helper started by gang.js. Turns territory clashes on when the worst odds against any rival reach
 * the threshold, and keeps them on until the odds fall ENGAGED_MARGIN below it.
 * args: [clashChance, rosterFull (1/0), runId]
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    const clashChance = Number(ns.args[0]);
    const rosterFull = Boolean(ns.args[1]);

    const info = ns.gang.getGangInformation();
    const engage = rosterFull && info.territory < 1 && worstClashChance(ns, info.faction) >= threshold(clashChance, info);
    if (info.territoryWarfareEngaged !== engage) ns.gang.setTerritoryWarfare(engage);
}

/**
 * @param {NS} ns
 * @param {string} ownFaction
 */
function worstClashChance(ns, ownFaction) {
    const gangs = ns.gang.getAllGangInformation();
    const rivals = Object.keys(gangs).filter(gang => gang !== ownFaction && gangs[gang].territory > 0);
    if (rivals.length === 0) return 0;

    return Math.min(...rivals.map(gang => ns.gang.getChanceToWinClash(gang)));
}

/**
 * @param {number} clashChance
 * @param {GangGenInfo} info
 */
function threshold(clashChance, info) {
    return info.territoryWarfareEngaged ? clashChance - ENGAGED_MARGIN : clashChance;
}
