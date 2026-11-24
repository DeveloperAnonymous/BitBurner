import { CRACKER_FILE, CRAWLER_FILE as CRAWLER, CRAWLER_FILES as FILES, CRAWLER_VERSION, LEGACY_WORM_FILE, PHISH_FILE as PHISH, REPORT_PORT, VERSION_PORT } from "/dnet/shared.js";
import { reportFailure } from "/lib/report.js";

const ENTRY = "darkweb";
const HOSTS_FILE = "dnet/hosts.txt";
const EMPTY_PORT = "NULL PORT DATA";
/** @type {Record<string, number>} */
const MONEY_SUFFIXES = { "": 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12, q: 1e15 };

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    announceVersion(ns);
    const knownHosts = cleanupDarknet(ns);
    if (!launchCrawler(ns)) return;

    /** @type {Record<import("/dnet/shared.js").ReportKind, number>} */
    const counts = { cache: 0, cracked: 0, failed: 0, phish: 0, loot: 0 };
    const startedAt = Date.now();
    let moneyMentioned = 0;
    ns.ui.setTailTitle(incomeTitle(ns, moneyMentioned, startedAt));

    while (true) {
        for (let entry = ns.readPort(REPORT_PORT); entry !== EMPTY_PORT; entry = ns.readPort(REPORT_PORT)) {
            /** @type {{ host: string, kind: import("/dnet/shared.js").ReportKind, text: string }} */
            const report = entry;
            rememberHost(ns, knownHosts, report.host);
            counts[report.kind]++;
            moneyMentioned += moneyIn(report.text);
            const text = report.kind === "loot" ? claimReward(ns, report.host, report.text) : report.text;
            ns.print(`[${report.kind} #${counts[report.kind]}] ${report.host}: ${text}`);
            ns.print(`  totals: ${counts.cache} caches, ${counts.loot} rewards, ${counts.phish} phishes, ${counts.cracked} cracked, ${counts.failed} unsolved | ${incomeTitle(ns, moneyMentioned, startedAt)}`);
        }

        ns.ui.setTailTitle(incomeTitle(ns, moneyMentioned, startedAt));
        await ns.nextPortWrite(REPORT_PORT);
    }
}

/**
 * @param {NS} ns
 * @param {number} money
 * @param {number} startedAt
 */
function incomeTitle(ns, money, startedAt) {
    const seconds = Math.max(1, (Date.now() - startedAt) / 1000);

    return `dnet $${ns.format.number(money)} · $${ns.format.number(money / seconds)}/s`;
}

/**
 * Crawlers anywhere in the darknet watch this port and shut down with their phish script when the version differs,
 * so the new crawler can take their node.
 * @param {NS} ns
 */
function announceVersion(ns) {
    ns.clearPort(VERSION_PORT);
    ns.writePort(VERSION_PORT, CRAWLER_VERSION);
    ns.print(`Announced crawler v${CRAWLER_VERSION}; older crawlers will shut down`);
}

/**
 * Kills every darknet script on each node that ever reported, so no old crawler survives to redeploy itself.
 * Nodes that no longer exist are dropped from HOSTS_FILE.
 * @param {NS} ns
 * @returns {Set<string>} the nodes still present
 */
function cleanupDarknet(ns) {
    const listed = ns.read(HOSTS_FILE).split("\n").filter(Boolean);
    const present = [...new Set([ENTRY, ...listed])].filter(host => ns.serverExists(host));

    for (const host of present) {
        for (const script of [CRAWLER, CRACKER_FILE, PHISH, LEGACY_WORM_FILE]) ns.scriptKill(script, host);
    }

    ns.write(HOSTS_FILE, present.map(host => `${host}\n`).join(""), "w");
    ns.print(`Cleared darknet scripts on ${present.length} nodes`);

    return new Set(present);
}

/**
 * Copies literature home (scp from a darknet node needs no session), leaves contracts to contracts.js, and flags
 * programs, which scripts cannot copy, for the player to fetch.
 * @param {NS} ns
 * @param {string} host
 * @param {string} file
 * @returns {string} what happened, for the log
 */
function claimReward(ns, host, file) {
    if (file.endsWith(".cct")) {
        ns.toast(`Darknet contract ${file} on ${host}`, "info");

        return `contract ${file} (contracts.js solves it)`;
    }

    if (file.endsWith(".exe")) {
        ns.toast(`Darknet program ${file} on ${host}: fetch it by hand`, "warning", 30000);

        return `PROGRAM ${file}: scripts cannot copy programs, fetch it by hand`;
    }

    if (ns.fileExists(file, "home")) return `${file} (already on home)`;

    if (!ns.scp(file, "home", host)) {
        reportFailure(ns, `copying ${file} from ${host} to home failed`);

        return `${file}: copy to home failed`;
    }

    return `${file} copied to home`;
}

/**
 * @param {NS} ns
 * @param {Set<string>} knownHosts
 * @param {string} host
 */
function rememberHost(ns, knownHosts, host) {
    if (knownHosts.has(host)) return;

    knownHosts.add(host);
    ns.write(HOSTS_FILE, `${host}\n`, "a");
}

/**
 * @param {NS} ns
 * @returns {boolean} whether the crawler is running
 */
function launchCrawler(ns) {
    if (!ns.fileExists("DarkscapeNavigator.exe", "home")) {
        reportFailure(ns, "Buy DarkscapeNavigator.exe first (terminal: buy DarkscapeNavigator.exe)");

        return false;
    }

    if (!ns.scp(FILES, ENTRY, "home")) {
        reportFailure(ns, `Copying darknet scripts to ${ENTRY} failed`);

        return false;
    }

    const pid = ns.exec(CRAWLER, ENTRY, 1, CRAWLER_VERSION);
    if (pid === 0) {
        reportFailure(ns, `Starting ${CRAWLER} on ${ENTRY} failed (free RAM ${ns.getServerMaxRam(ENTRY) - ns.getServerUsedRam(ENTRY)} GB)`);

        return false;
    }

    ns.print(`Crawler v${CRAWLER_VERSION} started on ${ENTRY} (pid ${pid}). Reports from port ${REPORT_PORT} follow.`);

    return true;
}

/**
 * Sum of every dollar amount in a game message, e.g. "$1.234m".
 * @param {string} text
 */
function moneyIn(text) {
    return [...text.matchAll(/\$([\d.,]+)([kmbtq]?)/gi)].reduce((total, [, digits, suffix]) => total + Number(digits.replace(/,/g, "")) * MONEY_SUFFIXES[suffix.toLowerCase()], 0);
}
