/**
 * @typedef {{ script: string, why: string, missing: (ns: NS) => string | null }} Service
 */

/** @type {Service[]} */
const SERVICES = [
    { script: "mcp-runner.js", why: "lets Claude run scripts", missing: () => null },
    { script: "propagate.js", why: "roots servers and runs the HWGW batcher", missing: ns => missingFiles(ns, ["batch/hack.js", "batch/grow.js", "batch/weaken.js"]) },
    { script: "contracts.js", why: "solves coding contracts", missing: () => null },
    { script: "hacknet.js", why: "buys hacknet nodes and upgrades", missing: () => null },
    { script: "buy-servers.js", why: "buys and upgrades cloud servers", missing: () => null },
    { script: "share-manager.js", why: "fills half of each cloud server with share.js", missing: ns => missingFiles(ns, ["share.js"]) },
    { script: "stock.js", why: "trades stocks on 4S forecasts", missing: missingStockAccess },
    { script: "ipvgo.js", why: "plays IPvGO against the faction rotation", missing: () => null },
    { script: "dnet/start.js", why: "runs the darknet crawler and logs its loot", missing: ns => missingFiles(ns, ["DarkscapeNavigator.exe"]) },
];

/** @param {NS} ns */
export async function main(ns) {
    const lines = SERVICES.map(service => start(ns, service));
    ns.tprint(`\n${lines.join("\n")}`);
}

/**
 * @param {NS} ns
 * @param {Service} service
 * @returns {string}
 */
function start(ns, { script, why, missing }) {
    if (ns.isRunning(script, "home")) return `  running  ${script}`;

    const reason = missing(ns);
    if (reason !== null) return `  skipped  ${script} (needs ${reason})`;

    const pid = ns.run(script);
    if (pid === 0) return `  FAILED   ${script}: needs ${ns.getScriptRam(script)} GB, home has ${ns.getServerMaxRam("home") - ns.getServerUsedRam("home")} GB free`;

    return `  started  ${script} (pid ${pid}) - ${why}`;
}

/**
 * @param {NS} ns
 * @param {string[]} files
 * @returns {string | null}
 */
function missingFiles(ns, files) {
    const absent = files.filter(file => !ns.fileExists(file, "home"));

    return absent.length > 0 ? absent.join(", ") : null;
}

/**
 * @param {NS} ns
 * @returns {string | null}
 */
function missingStockAccess(ns) {
    const absent = [
        [ns.stock.hasWseAccount(), "WSE account"],
        [ns.stock.hasTixApiAccess(), "TIX API"],
        [ns.stock.has4SDataTixApi(), "4S TIX API"],
    ].filter(([owned]) => !owned).map(([, name]) => name);

    return absent.length > 0 ? absent.join(", ") : null;
}
