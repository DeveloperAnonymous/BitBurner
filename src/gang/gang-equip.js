import { ascensionGain } from "/gang/ascension.js";

const HACKING_TYPES = new Set(["Rootkit", "Augmentation"]);
const COMBAT_TYPES = new Set(["Weapon", "Armor", "Vehicle", "Augmentation"]);
const PERMANENT_TYPE = "Augmentation";
const ASCEND_SOON_FRACTION = 0.85;

/**
 * @typedef {{ name: string, type: string, cost: number }} Item
 * @typedef {{ name: string, keepsGear: boolean }} Buyer
 */

/**
 * One-shot helper started by gang.js. Buys gear cheapest first within a share of home money.
 * Members close to ascending only get augmentations, since ascending strips every other upgrade.
 * args: [isHacking (1/0), budgetFraction, minAscendGain, runId]
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    const isHacking = Boolean(ns.args[0]);
    const budgetFraction = Number(ns.args[1]);
    const minAscendGain = Number(ns.args[2]);

    const items = listItems(ns, isHacking);
    const buyers = ns.gang.getMemberNames().map(name => ({ name, keepsGear: !ascendsSoon(ns, name, isHacking, minAscendGain) }));
    let budget = ns.getServerMoneyAvailable("home") * budgetFraction;

    for (const item of items) {
        if (item.cost > budget) break;

        budget -= buyForAll(ns, item, buyers, budget);
    }
}

/**
 * @param {NS} ns
 * @param {boolean} isHacking
 * @returns {Item[]}
 */
function listItems(ns, isHacking) {
    const wantedTypes = isHacking ? HACKING_TYPES : COMBAT_TYPES;

    return ns.gang.getEquipmentNames()
        .map(name => ({ name, type: ns.gang.getEquipmentType(name), cost: ns.gang.getEquipmentCost(name) }))
        .filter(item => wantedTypes.has(item.type))
        .sort((a, b) => a.cost - b.cost);
}

/**
 * @param {NS} ns
 * @param {string} name
 * @param {boolean} isHacking
 * @param {number} minAscendGain
 */
function ascendsSoon(ns, name, isHacking, minAscendGain) {
    const result = ns.gang.getAscensionResult(name);

    return Boolean(result) && ascensionGain(result, isHacking) >= minAscendGain * ASCEND_SOON_FRACTION;
}

/**
 * Buys the item for every member who lacks it and should get it. purchaseEquipment returns false for owned items.
 * @param {NS} ns
 * @param {Item} item
 * @param {Buyer[]} buyers
 * @param {number} budget
 * @returns {number} money spent
 */
function buyForAll(ns, item, buyers, budget) {
    let spent = 0;

    const eligible = buyers.filter(buyer => buyer.keepsGear || item.type === PERMANENT_TYPE);
    for (const buyer of eligible) {
        if (spent + item.cost > budget) break;
        if (!ns.gang.purchaseEquipment(buyer.name, item.name)) continue;

        spent += item.cost;
        ns.print(`Bought ${item.name} for ${buyer.name}`);
    }

    return spent;
}
