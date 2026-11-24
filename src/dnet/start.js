import { CRAWLER_VERSION, REPORT_PORT, SHARED_FILE } from "/dnet/shared.js";

const ENTRY = "darkweb";
const CRAWLER = "dnet/crawler.js";
const FILES = [CRAWLER, "dnet/phish.js", SHARED_FILE];
const EMPTY_PORT = "NULL PORT DATA";
/** @type {Record<string, number>} */
const MONEY_SUFFIXES = { "": 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12, q: 1e15 };

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    launchCrawler(ns);

    /** @type {Record<import("/dnet/shared.js").ReportKind, number>} */
    const counts = { cache: 0, cracked: 0, failed: 0, phish: 0 };
    let moneyMentioned = 0;

    while (true) {
        for (let entry = ns.readPort(REPORT_PORT); entry !== EMPTY_PORT; entry = ns.readPort(REPORT_PORT)) {
            /** @type {{ host: string, kind: import("/dnet/shared.js").ReportKind, text: string }} */
            const report = entry;
            counts[report.kind]++;
            moneyMentioned += moneyIn(report.text);
            ns.print(`[${report.kind} #${counts[report.kind]}] ${report.host}: ${report.text}`);
            ns.print(`  totals: ${counts.cache} caches, ${counts.phish} phishes, ${counts.cracked} cracked, ${counts.failed} unsolved | $${ns.format.number(moneyMentioned)} reported`);
        }

        await ns.nextPortWrite(REPORT_PORT);
    }
}

/** @param {NS} ns */
function launchCrawler(ns) {
    if (!ns.fileExists("DarkscapeNavigator.exe", "home")) {
        throw new Error("Buy DarkscapeNavigator.exe first (terminal: buy DarkscapeNavigator.exe)");
    }

    if (!ns.scp(FILES, ENTRY, "home")) throw new Error(`Copying darknet scripts to ${ENTRY} failed`);

    ns.scriptKill(CRAWLER, ENTRY);
    const pid = ns.exec(CRAWLER, ENTRY, 1, CRAWLER_VERSION);
    if (pid === 0) throw new Error(`Starting ${CRAWLER} on ${ENTRY} failed (free RAM ${ns.getServerMaxRam(ENTRY) - ns.getServerUsedRam(ENTRY)} GB)`);

    ns.print(`Crawler v${CRAWLER_VERSION} started on ${ENTRY} (pid ${pid}). Reports from port ${REPORT_PORT} follow.`);
}

/**
 * Sum of every dollar amount in a game message, e.g. "$1.234m".
 * @param {string} text
 */
function moneyIn(text) {
    return [...text.matchAll(/\$([\d.,]+)([kmbtq]?)/gi)].reduce((total, [, digits, suffix]) => total + Number(digits.replace(/,/g, "")) * MONEY_SUFFIXES[suffix.toLowerCase()], 0);
}
