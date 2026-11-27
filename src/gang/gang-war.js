/** @param {NS} ns  One-shot helper. args: [clashChance, memberCount] */
export async function main(ns) {
  const chance = Number(ns.args[0] ?? 0.6);
  const members = Number(ns.args[1] ?? 0);
  const info = ns.gang.getGangInformation();
  let want = false;
  if (members >= 12 && info.territory < 1) {
    const all = ns.gang.getAllGangInformation();   // v3 name; includes your own gang
    const rivals = Object.keys(all).filter(g => g !== info.faction && all[g].territory > 0);
    if (rivals.length) {
      const min = Math.min(...rivals.map(g => ns.gang.getChanceToWinClash(g)));
      // hysteresis: stay engaged until odds drop 0.1 below the turn-on threshold
      want = min >= (info.territoryWarfareEngaged ? chance - 0.1 : chance);
    }
  }
  if (info.territoryWarfareEngaged !== want) ns.gang.setTerritoryWarfare(want);
}
