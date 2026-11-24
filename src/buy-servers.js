import { reportFailure } from "/lib/report.js";

const SPEND_FRACTION = 0.5;
const MIN_RAM = 8;
const NAME_PREFIX = "cloud-";
const WAIT_MS = 15000;

/**
 * @typedef {{ label: string, ram: number, cost: number, buy: () => boolean }} Purchase
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");

    while (!isFullyUpgraded(ns)) {
        const purchase = nextPurchase(ns, ns.getServerMoneyAvailable("home") * SPEND_FRACTION);
        if (purchase === null) {
            ns.print(`Nothing affordable with half the cash. Next step: ${describeNextStep(ns)}`);
            await ns.sleep(WAIT_MS);
            continue;
        }

        if (!purchase.buy()) {
            reportFailure(ns, `${purchase.label} at ${ns.format.ram(purchase.ram)} for $${ns.format.number(purchase.cost)} failed; retrying`);
            await ns.sleep(WAIT_MS);
            continue;
        }

        ns.print(`${purchase.label} at ${ns.format.ram(purchase.ram)} for $${ns.format.number(purchase.cost)}`);
        await ns.sleep();
    }

    ns.tprint(`buy-servers.js: all ${ns.cloud.getServerLimit()} cloud servers are at the ${ns.format.ram(ns.cloud.getRamLimit())} RAM limit; exiting`);
}

/**
 * True when the server count is at the limit and even the smallest server cannot double.
 * @param {NS} ns
 */
function isFullyUpgraded(ns) {
    const names = ns.cloud.getServerNames();
    if (names.length < ns.cloud.getServerLimit()) return false;

    return ns.getServerMaxRam(smallestServer(ns, names)) * 2 > ns.cloud.getRamLimit();
}

/**
 * @param {NS} ns
 * @param {number} budget
 * @returns {Purchase | null}
 */
function nextPurchase(ns, budget) {
    const names = ns.cloud.getServerNames();
    if (names.length < ns.cloud.getServerLimit()) return newServerPurchase(ns, names, budget);

    return upgradePurchase(ns, smallestServer(ns, names), budget);
}

/**
 * @param {NS} ns
 * @param {string[]} names
 * @param {number} budget
 * @returns {Purchase | null}
 */
function newServerPurchase(ns, names, budget) {
    const ram = largestRam(ns, MIN_RAM, size => ns.cloud.getServerCost(size) <= budget);
    if (ram === null) return null;

    const hostname = unusedName(names);

    return {
        label: `Bought ${hostname}`,
        ram,
        cost: ns.cloud.getServerCost(ram),
        buy: () => ns.cloud.purchaseServer(hostname, ram) === hostname,
    };
}

/**
 * @param {NS} ns
 * @param {string} host
 * @param {number} budget
 * @returns {Purchase | null}
 */
function upgradePurchase(ns, host, budget) {
    const ram = largestRam(ns, ns.getServerMaxRam(host) * 2, size => ns.cloud.getServerUpgradeCost(host, size) <= budget);
    if (ram === null) return null;

    return {
        label: `Upgraded ${host}`,
        ram,
        cost: ns.cloud.getServerUpgradeCost(host, ram),
        buy: () => ns.cloud.upgradeServer(host, ram),
    };
}

/**
 * Cloud server RAM must be a power of two.
 * @param {NS} ns
 * @param {number} smallest
 * @param {(ram: number) => boolean} isAffordable
 * @returns {number | null}
 */
function largestRam(ns, smallest, isAffordable) {
    const ramLimit = ns.cloud.getRamLimit();
    let best = null;

    for (let ram = smallest; ram <= ramLimit && isAffordable(ram); ram *= 2) {
        best = ram;
    }

    return best;
}

/**
 * @param {NS} ns
 * @param {string[]} names
 * @returns {string}
 */
function smallestServer(ns, names) {
    return names.reduce((smallest, name) => (ns.getServerMaxRam(name) < ns.getServerMaxRam(smallest) ? name : smallest));
}

/**
 * @param {string[]} names
 * @returns {string}
 */
function unusedName(names) {
    const taken = new Set(names);
    let index = 0;

    while (taken.has(`${NAME_PREFIX}${index}`)) {
        index++;
    }

    return `${NAME_PREFIX}${index}`;
}

/**
 * @param {NS} ns
 * @returns {string}
 */
function describeNextStep(ns) {
    const names = ns.cloud.getServerNames();
    if (names.length < ns.cloud.getServerLimit()) {
        return `new ${ns.format.ram(MIN_RAM)} server for $${ns.format.number(ns.cloud.getServerCost(MIN_RAM))}`;
    }

    const host = smallestServer(ns, names);
    const ram = ns.getServerMaxRam(host) * 2;

    return `${host} to ${ns.format.ram(ram)} for $${ns.format.number(ns.cloud.getServerUpgradeCost(host, ram))}`;
}
