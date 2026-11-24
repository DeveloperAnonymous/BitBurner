export const CRAWLER_VERSION = 9;
export const REPORT_PORT = 7;
export const VERSION_PORT = 8;
export const CRAWLER_FILE = "dnet/crawler.js";
export const CRACKER_FILE = "dnet/cracker.js";
export const PHISH_FILE = "dnet/phish.js";
export const LEGACY_WORM_FILE = "dnet/worm.js";
export const CRAWLER_FILES = [CRAWLER_FILE, CRACKER_FILE, PHISH_FILE, "dnet/shared.js", "dnet/solvers.js"];

/** @typedef {"cache" | "cracked" | "failed" | "phish" | "loot"} ReportKind */

/**
 * @param {NS} ns
 * @param {ReportKind} kind
 * @param {string} text
 */
export function report(ns, kind, text) {
    ns.writePort(REPORT_PORT, { host: ns.getHostname(), kind, text });
}
