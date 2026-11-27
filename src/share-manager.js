import { reportFailure } from "/lib/report.js";
import { CLOUD_SHARE_FRACTION, SHARE_SCRIPT, WORLD_SHARE_FRACTION, shareReserve, shareThreads } from "/lib/share-reserve.js";

const LOOP_MS = 10000;

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");

    const threadRam = ns.getScriptRam(SHARE_SCRIPT, "home");
    if (threadRam === 0) {
        reportFailure(ns, `${SHARE_SCRIPT} is missing on home; share-manager.js stopped`);

        return;
    }

    ns.print(`Keeping ${CLOUD_SHARE_FRACTION * 100}% of cloud server RAM and ${WORLD_SHARE_FRACTION * 100}% of other rooted server RAM sharing`);

    while (true) {
        const added = shareHosts(ns).reduce((total, host) => total + topUpShare(ns, host, threadRam), 0);
        if (added > 0) ns.print(`Started ${added} share threads; share power ${ns.getSharePower().toFixed(3)}`);

        await ns.sleep(LOOP_MS);
    }
}

/**
 * Every rooted server with RAM except home and hacknet servers.
 * @param {NS} ns
 * @returns {string[]}
 */
function shareHosts(ns) {
    const visited = new Set(["home"]);
    const queue = ["home"];
    while (queue.length > 0) {
        const unvisited = ns.scan(/** @type {string} */ (queue.shift())).filter(neighbor => !visited.has(neighbor));
        for (const neighbor of unvisited) {
            visited.add(neighbor);
            queue.push(neighbor);
        }
    }

    return [...visited].filter(host =>
        host !== "home" &&
        !host.startsWith("hacknet-") &&
        ns.hasRootAccess(host) &&
        ns.getServerMaxRam(host) > 0
    );
}

/**
 * Starts share threads on the host until its reserve is full, as far as free RAM allows.
 * @param {NS} ns
 * @param {string} host
 * @param {number} threadRam
 * @returns {number} threads started
 */
function topUpShare(ns, host, threadRam) {
    const maxRam = ns.getServerMaxRam(host);
    const missing = Math.floor(shareReserve(host, maxRam) / threadRam) - shareThreads(ns, host);
    const threads = Math.min(missing, Math.floor((maxRam - ns.getServerUsedRam(host)) / threadRam));
    if (threads <= 0) return 0;

    if (!ns.scp(SHARE_SCRIPT, host, "home")) {
        reportFailure(ns, `copying ${SHARE_SCRIPT} to ${host} failed; retrying`);

        return 0;
    }

    if (ns.exec(SHARE_SCRIPT, host, threads, Date.now()) === 0) {
        reportFailure(ns, `starting ${threads} share threads on ${host} failed; retrying`);

        return 0;
    }

    return threads;
}
