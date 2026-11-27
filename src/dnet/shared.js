export const CRAWLER_VERSION = 21;
export const REPORT_PORT = 7;
export const VERSION_PORT = 8;
export const STASIS_PORT = 9;
export const CRAWLER_FILE = "dnet/crawler.js";
export const PHISH_FILE = "dnet/phish.js";
export const STASIS_FILE = "dnet/stasis.js";
export const OPEN_CACHE_FILE = "dnet/open-cache.js";
export const REALLOC_FILE = "dnet/realloc.js";
export const CRACKED_FILE = "dnet/cracked.txt";
export const LEGACY_FILES = ["dnet/worm.js", "dnet/cracker.js"];

const SOLVER_DIR = "dnet/solvers/";
/** @type {Record<string, string>} the solver script for each model id */
export const SOLVER_FILES = {
    "ZeroLogon": `${SOLVER_DIR}zerologon.js`,
    "FreshInstall_1.0": `${SOLVER_DIR}freshinstall.js`,
    "DeskMemo_3.1": `${SOLVER_DIR}deskmemo.js`,
    "CloudBlare(tm)": `${SOLVER_DIR}cloudblare.js`,
    "PHP 5.4": `${SOLVER_DIR}php.js`,
    "AccountsManager_4.2": `${SOLVER_DIR}accountsmanager.js`,
    "Pr0verFl0": `${SOLVER_DIR}overflow.js`,
    "DeepGreen": `${SOLVER_DIR}deepgreen.js`,
    "NIL": `${SOLVER_DIR}nil.js`,
    "Factori-Os": `${SOLVER_DIR}factorios.js`,
    "Laika4": `${SOLVER_DIR}laika.js`,
    "OpenWebAccessPoint": `${SOLVER_DIR}openwebaccesspoint.js`,
    "BellaCuore": `${SOLVER_DIR}bellacuore.js`,
    "OctantVoxel": `${SOLVER_DIR}octantvoxel.js`,
};
export const GENERIC_SOLVER_FILE = `${SOLVER_DIR}generic.js`;
export const ALL_SOLVER_FILES = [...Object.values(SOLVER_FILES), GENERIC_SOLVER_FILE];

export const CRAWLER_FILES = [
    CRAWLER_FILE, PHISH_FILE, STASIS_FILE, OPEN_CACHE_FILE, REALLOC_FILE, "dnet/shared.js", "dnet/crack.js", "dnet/log-feedback.js", "dnet/password-format.js",
    ...ALL_SOLVER_FILES,
];

/**
 * @typedef {"cache" | "cracked" | "failed" | "phish" | "loot" | "stasis"} ReportKind
 * @typedef {"crawl" | "stasis"} CrackGoal what the crawler does once a solver is in: start the crawler, or set a stasis link
 */

/**
 * @param {NS} ns
 * @param {ReportKind} kind
 * @param {string} text
 */
export function report(ns, kind, text) {
    ns.writePort(REPORT_PORT, { host: ns.getHostname(), kind, text });
}

/**
 * @param {string} modelId
 */
export function solverFileFor(modelId) {
    return SOLVER_FILES[modelId] ?? GENERIC_SOLVER_FILE;
}
