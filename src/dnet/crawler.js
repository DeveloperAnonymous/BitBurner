import { CRACKER_FILE as CRACKER, CRAWLER_FILE as CRAWLER, CRAWLER_VERSION as VERSION, LEGACY_WORM_FILE as LEGACY_WORM, PHISH_FILE as PHISH, VERSION_PORT, report } from "/dnet/shared.js";

const LOOP_MS = 2000;
const RETRY_MS = 5 * 60 * 1000;
const REWARD_FILE = /\.(exe|cct|lit)$/;
const reportedFailures = new Set();
const reportedRewards = new Set();

/**
 * @typedef {{ attempts: number, retryAt: number }} CrackRecord
 */

/**
 * Coordinates one darknet node: hands each neighbor without a current crawler to its own cracker.js, so a slow crack
 * never holds up spreading. Phishing only gets RAM that crackers do not need.
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");

    const here = ns.getHostname();
    ns.scriptKill(LEGACY_WORM, here);
    ns.scriptKill(PHISH, here);
    /** @type {Map<string, CrackRecord>} */
    const crackRecords = new Map();

    while (!isOutdated(ns)) {
        openCaches(ns, here);
        reportRewards(ns, here);

        const cracking = crackersRunning(ns, here);
        const uncrawled = ns.dnet.probe().filter(host => needsCrawler(ns, host) && !cracking.has(host));
        for (const host of uncrawled) startCracker(ns, here, host, crackRecords);

        startPhishing(ns, here);
        await freeOwnBlockedRam(ns, here);
        await ns.sleep(LOOP_MS);
    }

    ns.scriptKill(PHISH, here);
}

/**
 * True once dnet/start.js has announced a different crawler version. An empty port (game just loaded) is not a newer version.
 * @param {NS} ns
 */
function isOutdated(ns) {
    const announced = ns.peek(VERSION_PORT);

    return typeof announced === "number" && announced !== VERSION;
}

/**
 * @param {NS} ns
 * @param {string} here
 */
function openCaches(ns, here) {
    for (const cache of ns.ls(here, ".cache")) {
        const result = ns.dnet.openCache(cache, true);
        report(ns, "cache", `${cache}: ${result.message}`);
    }
}

/**
 * Reports each program, contract and literature file on this node once. dnet/start.js copies the literature home and
 * contracts.js solves the contracts; programs cannot be copied by scripts.
 * @param {NS} ns
 * @param {string} here
 */
function reportRewards(ns, here) {
    const newRewards = ns.ls(here).filter(file => REWARD_FILE.test(file) && !reportedRewards.has(file));

    for (const file of newRewards) {
        reportedRewards.add(file);
        report(ns, "loot", file);
    }
}

/**
 * @param {NS} ns
 * @param {string} here
 * @returns {Set<string>} hosts a cracker on this node is working on
 */
function crackersRunning(ns, here) {
    return new Set(ns.ps(here).filter(process => process.filename === CRACKER).map(process => String(process.args[0])));
}

/**
 * @param {NS} ns
 * @param {string} host
 */
function needsCrawler(ns, host) {
    const details = ns.dnet.getServerDetails(host);

    return details.isOnline && details.isConnectedToCurrentServer && !ns.isRunning(CRAWLER, host, VERSION);
}

/**
 * Starts a cracker for the host unless its last failed try is still cooling down.
 * @param {NS} ns
 * @param {string} here
 * @param {string} host
 * @param {Map<string, CrackRecord>} crackRecords
 */
function startCracker(ns, here, host, crackRecords) {
    const record = crackRecords.get(host) ?? { attempts: 0, retryAt: 0 };
    if (Date.now() < record.retryAt) return;

    const tryNumber = record.attempts + 1;
    if (!execCracker(ns, here, host, tryNumber)) return;

    crackRecords.set(host, { attempts: tryNumber, retryAt: Date.now() + RETRY_MS });
}

/**
 * Stops phishing when that is what keeps the cracker from fitting.
 * @param {NS} ns
 * @param {string} here
 * @param {string} host
 * @param {number} tryNumber
 * @returns {boolean} whether the cracker started
 */
function execCracker(ns, here, host, tryNumber) {
    if (ns.exec(CRACKER, here, 1, host, tryNumber) !== 0) return true;

    if (ns.isRunning(PHISH, here)) {
        ns.scriptKill(PHISH, here);
        if (ns.exec(CRACKER, here, 1, host, tryNumber) !== 0) return true;
    }

    reportOnce(ns, `cracker:${host}`, `no RAM to crack ${host} (free ${ns.getServerMaxRam(here) - ns.getServerUsedRam(here)} GB, cracker needs ${ns.getScriptRam(CRACKER)} GB)`);

    return false;
}

/**
 * @param {NS} ns
 * @param {string} here
 */
function startPhishing(ns, here) {
    if (ns.isRunning(PHISH, here)) return;

    const threads = Math.floor((ns.getServerMaxRam(here) - ns.getServerUsedRam(here)) / ns.getScriptRam(PHISH));
    if (threads > 0) ns.exec(PHISH, here, threads);
}

/**
 * One reallocation per pass, so the crawler is never stuck freeing RAM.
 * @param {NS} ns
 * @param {string} here
 */
async function freeOwnBlockedRam(ns, here) {
    if (ns.dnet.getBlockedRam(here) <= 0) return;

    const result = await ns.dnet.memoryReallocation();
    if (!result.success) reportOnce(ns, `realloc:${here}`, `freeing blocked RAM failed (${result.code} ${result.message})`);
}

/**
 * @param {NS} ns
 * @param {string} key
 * @param {string} text
 */
function reportOnce(ns, key, text) {
    if (reportedFailures.has(key)) return;

    reportedFailures.add(key);
    report(ns, "failed", text);
}
