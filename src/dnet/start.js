import { CRAWLER_FILE as CRAWLER, CRAWLER_FILES as FILES, CRAWLER_VERSION, REPORT_PORT } from "/dnet/shared.js";
import { reportFailure } from "/lib/report.js";

const ENTRY = "darkweb";
const EMPTY_PORT = "NULL PORT DATA";
/** @type {Record<string, number>} */
const MONEY_SUFFIXES = { "": 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12, q: 1e15 };

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    if (!launchCrawler(ns)) return;

    /** @type {Record<import("/dnet/shared.js").ReportKind, number>} */
    const counts = { cache: 0, cracked: 0, failed: 0, phish: 0 };
    const startedAt = Date.now();
    let moneyMentioned = 0;
    ns.ui.setTailTitle(incomeTitle(ns, moneyMentioned, startedAt));

    while (true) {
        for (let entry = ns.readPort(REPORT_PORT); entry !== EMPTY_PORT; entry = ns.readPort(REPORT_PORT)) {
            /** @type {{ host: string, kind: import("/dnet/shared.js").ReportKind, text: string }} */
            const report = entry;
            counts[report.kind]++;
            moneyMentioned += moneyIn(report.text);
            ns.print(`[${report.kind} #${counts[report.kind]}] ${report.host}: ${report.text}`);
            ns.print(`  totals: ${counts.cache} caches, ${counts.phish} phishes, ${counts.cracked} cracked, ${counts.failed} unsolved | ${incomeTitle(ns, moneyMentioned, startedAt)}`);
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

    ns.scriptKill(CRAWLER, ENTRY);
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
