const CRAWLER = "dnet/crawler.js";
const LEGACY_WORM = "dnet/worm.js";
const PHISH = "dnet/phish.js";
const VERSION = 1;
const LOOP_MS = 5000;

/** @type {Record<string, (details: { data: string, passwordHint: string, passwordLength: number }) => string[]>} */
const PASSWORD_GUESSES = {
    "ZeroLogon": () => [""],
    "CloudBlare(tm)": ({ data }) => [data.replace(/\D/g, "")],
    "PHP 5.4": ({ data }) => [...new Set(permutations(data.split("")).map(digits => digits.join("")))],
};

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");

    const here = ns.getHostname();
    ns.scriptKill(LEGACY_WORM, here);

    while (true) {
        openCaches(ns, here);

        for (const host of ns.dnet.probe()) {
            await spreadTo(ns, host);
        }

        startPhishing(ns, here);
        await ns.sleep(LOOP_MS);
    }
}

/**
 * @param {NS} ns
 * @param {string} here
 */
function openCaches(ns, here) {
    for (const cache of ns.ls(here, ".cache")) {
        const result = ns.dnet.openCache(cache, true);
        record(ns, `cache ${here}/${cache}: ${result.message}`);
    }
}

/**
 * @param {NS} ns
 * @param {string} host
 */
async function spreadTo(ns, host) {
    const details = ns.dnet.getServerDetails(host);
    if (!details.isOnline || !details.isConnectedToCurrentServer) return;
    if (!details.hasSession && !(await crack(ns, host, details))) return;
    ns.scriptKill(LEGACY_WORM, host);
    if (ns.isRunning(CRAWLER, host, VERSION)) return;

    ns.scriptKill(CRAWLER, host);
    ns.scp([CRAWLER, PHISH], host);
    ns.exec(CRAWLER, host, 1, VERSION);
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
 * @param {any} details
 */
async function crack(ns, host, details) {
    const guess = PASSWORD_GUESSES[details.modelId];
    if (guess === undefined) return false;
    if (ns.getPlayer().skills.charisma < details.requiredCharismaSkill) return false;

    for (const password of guess(details)) {
        const result = await ns.dnet.authenticate(host, password);
        if (!result.success) continue;

        record(ns, `cracked ${host} (${details.modelId}) password "${password}"`);

        return true;
    }

    record(ns, `failed ${host} (${details.modelId}) hint "${details.passwordHint}" data "${details.data}"`);

    return false;
}

/**
 * @param {NS} ns
 * @param {string} line
 */
function record(ns, line) {
    const logFile = `dnet/log-${ns.getHostname().replace(/[^A-Za-z0-9_-]/g, "_")}.txt`;
    ns.write(logFile, `${line}\n`, "a");
    ns.scp(logFile, "home");
}

/**
 * @template T
 * @param {T[]} items
 * @returns {T[][]}
 */
function permutations(items) {
    if (items.length <= 1) return [items];

    return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(rest => [item, ...rest]));
}
