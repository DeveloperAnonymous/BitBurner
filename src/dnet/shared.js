export const CRAWLER_VERSION = 5;
export const REPORT_PORT = 7;
export const CRAWLER_FILE = "dnet/crawler.js";
export const PHISH_FILE = "dnet/phish.js";
export const CRAWLER_FILES = [CRAWLER_FILE, PHISH_FILE, "dnet/shared.js", "dnet/solvers.js"];

/** @typedef {"cache" | "cracked" | "failed" | "phish"} ReportKind */

/**
 * @param {NS} ns
 * @param {ReportKind} kind
 * @param {string} text
 */
export function report(ns, kind, text) {
    ns.writePort(REPORT_PORT, { host: ns.getHostname(), kind, text });
}
