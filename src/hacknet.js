const MAX_PAYBACK_SECONDS = 24 * 60 * 60;
const SPEND_FRACTION = 0.5;
const BUY_WAIT_MS = 1000;
const IDLE_WAIT_MS = 30000;
const STARTING_SHAPE = { level: 1, ram: 1, cores: 1 };

/**
 * @typedef {{ level: number, ram: number, cores: number }} NodeShape
 * @typedef {{ label: string, cost: number, gain: number, buy: () => boolean }} Purchase
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");

    if (ns.hacknet.hashCapacity() > 0) {
        throw new Error("hacknet.js handles Hacknet Nodes only; this save has Hacknet Servers, which produce hashes");
    }

    while (true) {
        const best = bestPurchase(ns);
        if (best === null || best.cost / best.gain > MAX_PAYBACK_SECONDS) {
            ns.print(`Nothing pays back within ${ns.format.time(MAX_PAYBACK_SECONDS * 1000)}. Waiting.`);
            await ns.sleep(IDLE_WAIT_MS);
            continue;
        }

        if (best.cost > ns.getServerMoneyAvailable("home") * SPEND_FRACTION) {
            await ns.sleep(BUY_WAIT_MS);
            continue;
        }

        if (!best.buy()) {
            throw new Error(`Buying ${best.label} for $${ns.format.number(best.cost)} failed`);
        }

        ns.print(`Bought ${best.label} for $${ns.format.number(best.cost)}, +$${ns.format.number(best.gain)}/s`);
        await ns.sleep();
    }
}

/**
 * @param {NS} ns
 * @returns {Purchase | null}
 */
function bestPurchase(ns) {
    const nodeCount = ns.hacknet.numNodes();
    const shapes = Array.from({ length: nodeCount }, (_, index) => ns.hacknet.getNodeStats(index));
    const candidates = shapes.flatMap((shape, index) => nodeUpgrades(ns, shape, index));

    if (nodeCount < ns.hacknet.maxNumNodes()) {
        candidates.push(newNode(ns, bestShape(shapes)));
    }

    return candidates
        .filter(candidate => Number.isFinite(candidate.cost))
        .reduce((best, candidate) => (best === null || isBetterValue(candidate, best) ? candidate : best), /** @type {Purchase | null} */ (null));
}

/**
 * Valued as the node plus the upgrades that bring it up to the best node, since a bare node earns almost nothing.
 * @param {NS} ns
 * @param {NodeShape} target
 * @returns {Purchase}
 */
function newNode(ns, target) {
    const formulas = ns.formulas.hacknetNodes;
    const mults = ns.getHacknetMultipliers();
    const upgradeCost =
        formulas.levelUpgradeCost(STARTING_SHAPE.level, target.level - STARTING_SHAPE.level, mults.levelCost) +
        formulas.ramUpgradeCost(STARTING_SHAPE.ram, Math.log2(target.ram), mults.ramCost) +
        formulas.coreUpgradeCost(STARTING_SHAPE.cores, target.cores - STARTING_SHAPE.cores, mults.coreCost);

    return {
        label: `node #${ns.hacknet.numNodes()} (to grow to level ${target.level}, ${target.ram}GB, ${target.cores} cores)`,
        cost: ns.hacknet.getPurchaseNodeCost() + upgradeCost,
        gain: production(ns, target),
        buy: () => ns.hacknet.purchaseNode() !== -1,
    };
}

/**
 * @param {NS} ns
 * @param {NodeShape} shape
 * @param {number} index
 * @returns {Purchase[]}
 */
function nodeUpgrades(ns, shape, index) {
    const current = production(ns, shape);
    const gainFrom = (/** @type {NodeShape} */ next) => production(ns, next) - current;

    return [
        {
            label: `level on node #${index}`,
            cost: ns.hacknet.getLevelUpgradeCost(index, 1),
            gain: gainFrom({ ...shape, level: shape.level + 1 }),
            buy: () => ns.hacknet.upgradeLevel(index, 1),
        },
        {
            label: `RAM on node #${index}`,
            cost: ns.hacknet.getRamUpgradeCost(index, 1),
            gain: gainFrom({ ...shape, ram: shape.ram * 2 }),
            buy: () => ns.hacknet.upgradeRam(index, 1),
        },
        {
            label: `core on node #${index}`,
            cost: ns.hacknet.getCoreUpgradeCost(index, 1),
            gain: gainFrom({ ...shape, cores: shape.cores + 1 }),
            buy: () => ns.hacknet.upgradeCore(index, 1),
        },
    ];
}

/**
 * @param {NodeShape[]} shapes
 * @returns {NodeShape}
 */
function bestShape(shapes) {
    if (shapes.length === 0) return STARTING_SHAPE;

    return {
        level: Math.max(...shapes.map(shape => shape.level)),
        ram: Math.max(...shapes.map(shape => shape.ram)),
        cores: Math.max(...shapes.map(shape => shape.cores)),
    };
}

/**
 * @param {NS} ns
 * @param {NodeShape} shape
 */
function production(ns, shape) {
    return ns.formulas.hacknetNodes.moneyGainRate(shape.level, shape.ram, shape.cores, ns.getHacknetMultipliers().production);
}

/**
 * @param {Purchase} candidate
 * @param {Purchase} best
 */
function isBetterValue(candidate, best) {
    return candidate.gain / candidate.cost > best.gain / best.cost;
}
