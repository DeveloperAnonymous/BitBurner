const LEGACY_WORKER = "/worker.js";

/** @param {NS} ns */
export async function main(ns) {
    const hostsWithWorker = scanNetwork(ns).filter(host => ns.fileExists(LEGACY_WORKER, host));
    for (const host of hostsWithWorker) {
        ns.scriptKill(LEGACY_WORKER, host);

        if (!ns.rm(LEGACY_WORKER, host)) {
            throw new Error(`rm ${LEGACY_WORKER} on ${host} failed`);
        }
    }

    ns.tprint(`Removed ${LEGACY_WORKER} from ${hostsWithWorker.length} servers.`);
}

/**
 * @param {NS} ns
 * @returns {string[]}
 */
function scanNetwork(ns) {
    const visited = new Set(["home"]);

    const queue = ["home"];
    while (queue.length > 0) {
        const current = /** @type {string} */ (queue.shift());
        const unvisited = ns.scan(current).filter(neighbor => !visited.has(neighbor));
        for (const neighbor of unvisited) {
            visited.add(neighbor);
            queue.push(neighbor);
        }
    }

    return [...visited];
}
