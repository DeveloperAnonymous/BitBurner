/** @param {NS} ns  One-shot helper. args: [isHacking(1/0), budgetFraction] */
export async function main(ns) {
  ns.disableLog("ALL");
  const okType = ns.args[0]
    ? new Set(["Rootkit", "Augmentation"])
    : new Set(["Weapon", "Armor", "Vehicle", "Augmentation"]);
  let budget = ns.getServerMoneyAvailable("home") * Number(ns.args[1] ?? 0.5);
  const items = ns.gang.getEquipmentNames()
    .filter(i => okType.has(ns.gang.getEquipmentType(i)))
    .sort((a, b) => ns.gang.getEquipmentCost(a) - ns.gang.getEquipmentCost(b));
  const names = ns.gang.getMemberNames();
  for (const item of items) {
    const cost = ns.gang.getEquipmentCost(item);
    for (const n of names) {
      if (cost > budget) break;
      // returns false if the member already owns it, so no ownership lookup is needed
      if (ns.gang.purchaseEquipment(n, item)) budget -= cost;
    }
  }
}
