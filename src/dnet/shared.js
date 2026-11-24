export const CRAWLER_VERSION = 3;
export const REPORT_PORT = 7;
export const SHARED_FILE = "dnet/shared.js";

/** @typedef {"cache" | "cracked" | "failed" | "phish"} ReportKind */

/**
 * @param {NS} ns
 * @param {ReportKind} kind
 * @param {string} text
 */
export function report(ns, kind, text) {
    ns.writePort(REPORT_PORT, { host: ns.getHostname(), kind, text });
}
