import { SOLVERS } from "/contracts/solvers.js";

const SCAN_INTERVAL_MS = 60000;
const DARKNET_HOSTS_FILE = "dnet/hosts.txt";

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");

    const attempted = new Set();
    const unsupported = new Set();

    while (true) {
        for (const { host, file } of findContracts(ns)) {
            const key = `${host}/${file}`;
            if (attempted.has(key)) continue;

            const type = ns.codingcontract.getContractType(file, host);
            const solve = SOLVERS[type];
            if (solve === undefined) {
                reportUnsupported(ns, unsupported, type);
                continue;
            }

            attempted.add(key);
            solveContract(ns, { host, file, type, solve });
        }

        await ns.sleep(SCAN_INTERVAL_MS);
    }
}

/**
 * Scans the regular network from home, plus the darknet nodes dnet/start.js has recorded, since scan cannot reach them.
 * @param {NS} ns
 * @returns {{ host: string, file: string }[]}
 */
function findContracts(ns) {
    const seen = new Set(["home"]);
    const queue = ["home"];
    while (queue.length > 0) {
        const unvisited = ns.scan(/** @type {string} */ (queue.shift())).filter(host => !seen.has(host));
        for (const host of unvisited) {
            seen.add(host);
            queue.push(host);
        }
    }

    const darknet = ns.read(DARKNET_HOSTS_FILE).split("\n").filter(host => host !== "" && ns.serverExists(host));

    return [...new Set([...seen, ...darknet])].flatMap(host => ns.ls(host, ".cct").map(file => ({ host, file })));
}

/**
 * @param {NS} ns
 * @param {Set<string>} unsupported
 * @param {string} type
 */
function reportUnsupported(ns, unsupported, type) {
    if (unsupported.has(type)) return;

    unsupported.add(type);
    ns.print(`No solver for "${type}"`);
}

/**
 * @param {NS} ns
 * @param {{ host: string, file: string, type: string, solve: (data: any) => any }} contract
 */
function solveContract(ns, { host, file, type, solve }) {
    const data = ns.codingcontract.getData(file, host);
    const answer = solve(data);
    const reward = ns.codingcontract.attempt(answer, file, host);
    if (reward === "") {
        ns.print(`FAILED ${type} on ${host}: data ${JSON.stringify(data)} answer ${JSON.stringify(answer)}`);

        return;
    }

    ns.print(`${type} on ${host}: ${reward}`);
}
