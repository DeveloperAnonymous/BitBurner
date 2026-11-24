import { CRAWLER_FILE as CRAWLER, CRAWLER_FILES, CRAWLER_VERSION as VERSION, PHISH_FILE as PHISH, VERSION_PORT, report } from "/dnet/shared.js";
import { crackPassword } from "/dnet/solvers.js";

const LEGACY_WORM = "dnet/worm.js";
const LOOP_MS = 5000;
const reportedFailures = new Set();

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");

    const here = ns.getHostname();
    ns.scriptKill(LEGACY_WORM, here);
    ns.scriptKill(PHISH, here);

    while (!isOutdated(ns)) {
        await freeBlockedRam(ns, here);
        openCaches(ns, here);

        for (const host of ns.dnet.probe()) {
            if (isOutdated(ns)) break;

            await spreadTo(ns, host);
        }

        startPhishing(ns, here);
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
 * Frees RAM the server owner blocks, until none is left or a call frees nothing.
 * @param {NS} ns
 * @param {string} host
 */
async function freeBlockedRam(ns, host) {
    for (let blocked = ns.dnet.getBlockedRam(host); blocked > 0; ) {
        const result = await ns.dnet.memoryReallocation(host);
        const stillBlocked = ns.dnet.getBlockedRam(host);
        if (!result.success || stillBlocked >= blocked) {
            reportOnce(ns, `realloc:${host}`, `${host}: freeing ${blocked} GB blocked RAM stalled (${result.code} ${result.message})`);

            return;
        }

        blocked = stillBlocked;
    }
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
 * Hosts the player unlocked by hand show root access, so they are deployed to without cracking.
 * @param {NS} ns
 * @param {string} host
 */
async function spreadTo(ns, host) {
    const details = ns.dnet.getServerDetails(host);
    if (!details.isOnline || !details.isConnectedToCurrentServer) return;

    const unlockedByHand = !details.hasSession && ns.hasRootAccess(host);
    if (!details.hasSession && !unlockedByHand && !(await crack(ns, host, details))) return;

    ns.scriptKill(LEGACY_WORM, host);
    if (ns.isRunning(CRAWLER, host, VERSION)) return;

    await freeBlockedRam(ns, host);
    deployCrawler(ns, host, unlockedByHand);
}

/**
 * @param {NS} ns
 * @param {string} host
 * @param {boolean} unlockedByHand
 */
function deployCrawler(ns, host, unlockedByHand) {
    const access = unlockedByHand ? "unlocked by hand, no script session" : "script session";
    ns.scriptKill(CRAWLER, host);
    if (!ns.scp(CRAWLER_FILES, host)) {
        reportOnce(ns, `scp:${host}`, `${host}: copying crawler files failed (${access})`);

        return;
    }

    if (ns.exec(CRAWLER, host, 1, VERSION) === 0) {
        reportOnce(ns, `exec:${host}`, `${host}: starting crawler failed (${access}, free RAM ${ns.getServerMaxRam(host) - ns.getServerUsedRam(host)} GB)`);

        return;
    }

    if (unlockedByHand) report(ns, "cracked", `${host}: deployed to hand-unlocked node`);
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
 * @param {NS} ns
 * @param {string} host
 * @param {ReturnType<NS["dnet"]["getServerDetails"]>} details
 */
async function crack(ns, host, details) {
    const outcome = await crackPassword(ns, host, details);
    if ("password" in outcome) {
        report(ns, "cracked", `${host} (${details.modelId}) password "${outcome.password}"`);

        return true;
    }

    const describe = `${host} (${details.modelId}) hint "${details.passwordHint}" data "${details.data}" length ${details.passwordLength} ${details.passwordFormat}`;
    reportOnce(ns, `crack:${host}`, `${describe}: ${outcome.failure}`);

    return false;
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
