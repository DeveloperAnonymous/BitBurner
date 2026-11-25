import { reportFailure } from "/lib/report.js";
import { SHARE_SCRIPT, shareReserve, shareThreads } from "/lib/share-reserve.js";

const HACK_SCRIPT = "/batch/hack.js";
const GROW_SCRIPT = "/batch/grow.js";
const WEAKEN_SCRIPT = "/batch/weaken.js";
const BATCH_SCRIPTS = [HACK_SCRIPT, GROW_SCRIPT, WEAKEN_SCRIPT];

const GROW_SAFETY = 1.1;
const SPACER_MS = 100;
const BATCH_STRIDE_MS = 4 * SPACER_MS;
const MAX_BATCHES_PER_WAVE = 1000;
const LOOP_MS = 1000;
const IDLE_WAIT_MS = 30000;
const STATUS_EVERY_LOOPS = 30;
const SECURITY_TOLERANCE = 0.05;
const MONEY_TOLERANCE = 0.99;
const MIN_MONEY_FOR_GROWTH = 1;
const MAX_STOLEN_FRACTION = 0.9;
const HOME_RESERVE_FRACTION = 0.25;
const HOME_MIN_RESERVE_GB = 64;

// Fixed game values, hardcoded because the analyze functions that return them cost 1 GB each.
const HACK_SECURITY_PER_THREAD = 0.002;
const GROW_SECURITY_PER_THREAD = 0.004;
const WEAKEN_PER_THREAD = 0.05;
const GROW_WEAKEN_RATIO = GROW_SECURITY_PER_THREAD / WEAKEN_PER_THREAD;

/** @type {[string, (ns: NS, host: string) => boolean][]} */
const CRACKERS = [
    ["BruteSSH.exe", (ns, host) => ns.brutessh(host)],
    ["FTPCrack.exe", (ns, host) => ns.ftpcrack(host)],
    ["relaySMTP.exe", (ns, host) => ns.relaysmtp(host)],
    ["HTTPWorm.exe", (ns, host) => ns.httpworm(host)],
    ["SQLInject.exe", (ns, host) => ns.sqlinject(host)],
];

/**
 * @typedef {{ script: string, ramPerThread: number, threads: number, delay: number }} Job
 * @typedef {{ script: string, host: string, threads: number, delay: number }} Placement
 * @typedef {{ hackThreads: number, hackWeakenThreads: number, growThreads: number, growWeakenThreads: number }} BatchThreads
 * @typedef {{ hackMs: number, growMs: number, weakenMs: number }} Timing
 * @typedef {{ hackRam: number, growRam: number, weakenRam: number }} ScriptRam
 * @typedef {{ pids: number[], remaining: Map<string, number> }} Launch
 * @typedef {{ pool: Map<string, number>, ramShare: number }} Allotment
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");

    let scriptRam = readScriptRam(ns);
    while (scriptRam === null) {
        await ns.sleep(IDLE_WAIT_MS);
        scriptRam = readScriptRam(ns);
    }

    const shareThreadRam = ns.getScriptRam(SHARE_SCRIPT, "home");
    /** @type {Map<string, number[]>} */
    const busyTargets = new Map();
    let loop = 0;

    while (true) {
        const servers = scanNetwork(ns);
        rootAll(ns, servers);
        const hosts = copyBatchScripts(ns, workerHosts(ns, servers));
        releaseFinishedTargets(ns, busyTargets);

        let pool = freeRamByHost(ns, hosts, shareThreadRam);
        const freeTargets = rankedTargets(ns, servers).filter(target => !busyTargets.has(target));
        for (const [index, target] of freeTargets.entries()) {
            const allotment = { pool, ramShare: totalFreeRam(pool) / (freeTargets.length - index) };
            const launch = isPrepped(ns, target) ? launchWave(ns, target, allotment, scriptRam) : launchPrep(ns, target, allotment, scriptRam);
            if (launch === null) continue;

            busyTargets.set(target, launch.pids);
            pool = launch.remaining;
        }

        if (++loop % STATUS_EVERY_LOOPS === 0) printStatus(ns, busyTargets, hosts, pool);

        await ns.sleep(LOOP_MS);
    }
}

/**
 * @param {NS} ns
 * @param {Map<string, number[]>} busyTargets
 */
function releaseFinishedTargets(ns, busyTargets) {
    for (const [target, pids] of [...busyTargets]) {
        if (!pids.some(pid => ns.isRunning(pid))) busyTargets.delete(target);
    }
}

/**
 * @param {NS} ns
 * @param {Map<string, number[]>} busyTargets
 * @param {string[]} hosts
 * @param {Map<string, number>} pool
 */
function printStatus(ns, busyTargets, hosts, pool) {
    const totalRam = hosts.reduce((total, host) => total + usableRam(ns, host), 0);
    ns.print(`Working ${busyTargets.size} targets (${[...busyTargets.keys()].join(", ")}) | RAM ${ns.format.ram(totalRam - totalFreeRam(pool))} of ${ns.format.ram(totalRam)} used`);
}

/** @param {Map<string, number>} pool */
function totalFreeRam(pool) {
    return [...pool.values()].reduce((total, free) => total + free, 0);
}

/**
 * @param {NS} ns
 * @returns {ScriptRam | null} null while batch scripts are missing on home
 */
function readScriptRam(ns) {
    const ramByScript = new Map(BATCH_SCRIPTS.map(script => [script, ns.getScriptRam(script, "home")]));
    const missing = BATCH_SCRIPTS.filter(script => ramByScript.get(script) === 0);
    if (missing.length > 0) {
        reportFailure(ns, `Batch scripts missing on home: ${missing.join(", ")}. Sync them; retrying.`);

        return null;
    }

    return {
        hackRam: /** @type {number} */ (ramByScript.get(HACK_SCRIPT)),
        growRam: /** @type {number} */ (ramByScript.get(GROW_SCRIPT)),
        weakenRam: /** @type {number} */ (ramByScript.get(WEAKEN_SCRIPT)),
    };
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

/**
 * @param {NS} ns
 * @param {string[]} servers
 */
function rootAll(ns, servers) {
    const ownedCrackers = CRACKERS.filter(([program]) => ns.fileExists(program, "home"));
    const unrooted = servers.filter(server => server !== "home" && !ns.hasRootAccess(server));
    const crackable = unrooted.filter(server => ns.getServerNumPortsRequired(server) <= ownedCrackers.length);

    for (const server of crackable) {
        for (const [, crack] of ownedCrackers) crack(ns, server);

        if (!ns.nuke(server)) {
            reportFailure(ns, `nuke ${server} failed with ${ownedCrackers.length} port crackers owned`);
            continue;
        }

        ns.print(`Rooted ${server}`);
    }

    const blockedCount = unrooted.length - crackable.length;
    if (blockedCount > 0) {
        ns.print(`${blockedCount} servers need more than ${ownedCrackers.length} open ports`);
    }
}

/**
 * @param {NS} ns
 * @param {string[]} servers
 * @returns {string[]}
 */
function workerHosts(ns, servers) {
    return servers.filter(server =>
        !server.startsWith("hacknet-") &&
        ns.hasRootAccess(server) &&
        ns.getServerMaxRam(server) > 0
    );
}

/**
 * @param {NS} ns
 * @param {string[]} hosts
 * @returns {string[]} the hosts that received the batch scripts
 */
function copyBatchScripts(ns, hosts) {
    return hosts.filter(host => {
        if (host === "home") return true;
        if (ns.scp(BATCH_SCRIPTS, host, "home")) return true;

        reportFailure(ns, `scp of batch scripts to ${host} failed; skipping it this pass`);

        return false;
    });
}

/**
 * Every hackable server with money, best money per second of weaken time first.
 * @param {NS} ns
 * @param {string[]} servers
 * @returns {string[]}
 */
function rankedTargets(ns, servers) {
    const hackLevel = ns.getHackingLevel();
    const scored = servers.map(server => ({ server, score: scoreTarget(ns, server, hackLevel) }));

    return scored
        .filter(entry => entry.score !== null)
        .sort((a, b) => Number(b.score) - Number(a.score))
        .map(entry => entry.server);
}

/**
 * @param {NS} ns
 * @param {string} server
 * @param {number} maxRequiredLevel
 * @returns {number | null}
 */
function scoreTarget(ns, server, maxRequiredLevel) {
    if (server === "home" || server.startsWith("hacknet-")) return null;
    if (!ns.hasRootAccess(server)) return null;
    const requiredLevel = ns.getServerRequiredHackingLevel(server);
    if (requiredLevel > maxRequiredLevel) return null;

    const maxMoney = ns.getServerMaxMoney(server);
    if (maxMoney <= 0) return null;

    return maxMoney / weakenTimeAtMinSecurity(ns, server, requiredLevel);
}

/**
 * Hack, grow and weaken times scale with (2.5 * requiredLevel * security + 500).
 * @param {NS} ns
 * @param {string} server
 * @param {number} requiredLevel
 */
function weakenTimeAtMinSecurity(ns, server, requiredLevel) {
    const difficulty = (/** @type {number} */ security) => 2.5 * requiredLevel * security + 500;

    return ns.getWeakenTime(server) * difficulty(ns.getServerMinSecurityLevel(server)) / difficulty(ns.getServerSecurityLevel(server));
}

/**
 * @param {NS} ns
 * @param {string} target
 */
function isPrepped(ns, target) {
    const isAtMinSecurity = ns.getServerSecurityLevel(target) <= ns.getServerMinSecurityLevel(target) + SECURITY_TOLERANCE;
    const isAtMaxMoney = ns.getServerMoneyAvailable(target) >= ns.getServerMaxMoney(target) * MONEY_TOLERANCE;

    return isAtMinSecurity && isAtMaxMoney;
}

/**
 * @param {NS} ns
 * @param {string} target
 * @param {Allotment} allotment
 * @param {ScriptRam} scriptRam
 * @returns {Launch | null} null when nothing could start
 */
function launchWave(ns, target, allotment, scriptRam) {
    const stolenPerThread = stolenPerHackThread(ns, target);
    if (stolenPerThread <= 0 || stolenPerThread >= 1) return null;

    let pool = allotment.pool;
    const timing = readTiming(ns, target);
    const overlappingBatches = Math.max(1, Math.min(MAX_BATCHES_PER_WAVE, Math.floor(timing.weakenMs / BATCH_STRIDE_MS)));
    const threads = largestBatchWithin(ns, target, allotment.ramShare / overlappingBatches, scriptRam);
    const batchLimit = Math.min(overlappingBatches, Math.floor(allotment.ramShare / batchRam(threads, scriptRam)));
    const waveId = Date.now();
    /** @type {number[]} */
    const pids = [];
    let batchCount = 0;

    while (batchCount < batchLimit) {
        const plan = placeJobs(pool, batchJobs(threads, timing, scriptRam, batchCount));
        if (plan === null) break;

        pool = plan.remaining;
        pids.push(...launchAll(ns, plan.placements, target, `${waveId}-${batchCount}`));
        batchCount++;
    }

    if (batchCount === 0) return null;

    const lastLandingMs = timing.weakenMs + 3 * SPACER_MS + (batchCount - 1) * BATCH_STRIDE_MS;
    const stolenPercent = Math.min(stolenPerThread * threads.hackThreads, MAX_STOLEN_FRACTION) * 100;
    ns.print(`Wave on ${target}: ${batchCount} batches stealing ${stolenPercent.toFixed(1)}% each (${threads.hackThreads} hack threads), lands in ${ns.format.time(lastLandingMs)}`);

    return { pids, remaining: pool };
}

/**
 * @param {Map<string, number>} pool
 * @param {number} ramPerThread
 * @returns {number}
 */
function threadCapacity(pool, ramPerThread) {
    return [...pool.values()].reduce((total, free) => total + Math.floor(free / ramPerThread), 0);
}

/**
 * @param {BatchThreads} threads
 * @param {ScriptRam} scriptRam
 * @returns {number}
 */
function batchRam(threads, scriptRam) {
    const weakenThreads = threads.hackWeakenThreads + threads.growWeakenThreads;

    return threads.hackThreads * scriptRam.hackRam + threads.growThreads * scriptRam.growRam + weakenThreads * scriptRam.weakenRam;
}

/**
 * The biggest batch that fits in ramPerBatch, stealing at most MAX_STOLEN_FRACTION. Falls back to one hack thread.
 * @param {NS} ns
 * @param {string} target
 * @param {number} ramPerBatch
 * @param {ScriptRam} scriptRam
 * @returns {BatchThreads}
 */
function largestBatchWithin(ns, target, ramPerBatch, scriptRam) {
    let fits = 1;
    let tooBig = Math.floor(MAX_STOLEN_FRACTION / stolenPerHackThread(ns, target)) + 1;

    while (tooBig - fits > 1) {
        const middle = Math.floor((fits + tooBig) / 2);
        if (batchRam(batchThreads(ns, target, middle), scriptRam) <= ramPerBatch) fits = middle;
        else tooBig = middle;
    }

    return batchThreads(ns, target, fits);
}

/**
 * @param {NS} ns
 * @param {string} target
 * @returns {number}
 */
function stolenPerHackThread(ns, target) {
    return ns.hackAnalyze(target);
}

/**
 * @param {NS} ns
 * @param {string} target
 * @param {number} hackThreads
 * @returns {BatchThreads}
 */
function batchThreads(ns, target, hackThreads) {
    const stolenFraction = Math.min(stolenPerHackThread(ns, target) * hackThreads, MAX_STOLEN_FRACTION);
    const growThreads = Math.ceil(ns.growthAnalyze(target, 1 / (1 - stolenFraction)) * GROW_SAFETY);

    return {
        hackThreads,
        hackWeakenThreads: Math.ceil((hackThreads * HACK_SECURITY_PER_THREAD) / WEAKEN_PER_THREAD),
        growThreads,
        growWeakenThreads: Math.ceil(growThreads * GROW_WEAKEN_RATIO),
    };
}

/**
 * @param {NS} ns
 * @param {string} target
 * @returns {Timing}
 */
function readTiming(ns, target) {
    return {
        hackMs: ns.getHackTime(target),
        growMs: ns.getGrowTime(target),
        weakenMs: ns.getWeakenTime(target),
    };
}

/**
 * Lands hack, weaken, grow, weaken in that order, SPACER_MS apart, one stride after the previous batch.
 * @param {BatchThreads} threads
 * @param {Timing} timing
 * @param {ScriptRam} scriptRam
 * @param {number} batchIndex
 * @returns {Job[]}
 */
function batchJobs(threads, timing, scriptRam, batchIndex) {
    const offset = batchIndex * BATCH_STRIDE_MS;

    return [
        { script: HACK_SCRIPT, ramPerThread: scriptRam.hackRam, threads: threads.hackThreads, delay: offset + timing.weakenMs - timing.hackMs },
        { script: WEAKEN_SCRIPT, ramPerThread: scriptRam.weakenRam, threads: threads.hackWeakenThreads, delay: offset + SPACER_MS },
        { script: GROW_SCRIPT, ramPerThread: scriptRam.growRam, threads: threads.growThreads, delay: offset + timing.weakenMs + 2 * SPACER_MS - timing.growMs },
        { script: WEAKEN_SCRIPT, ramPerThread: scriptRam.weakenRam, threads: threads.growWeakenThreads, delay: offset + 3 * SPACER_MS },
    ];
}

/**
 * @param {NS} ns
 * @param {string} target
 * @param {Allotment} allotment
 * @param {ScriptRam} scriptRam
 * @returns {Launch | null} null when nothing could start
 */
function launchPrep(ns, target, allotment, scriptRam) {
    const prepRam = Math.max(scriptRam.growRam, scriptRam.weakenRam);
    const capacity = Math.min(threadCapacity(allotment.pool, prepRam), Math.floor(allotment.ramShare / prepRam));
    const timing = readTiming(ns, target);
    const jobs = prepJobs(ns, target, capacity, timing, prepRam);
    const plan = placeJobs(allotment.pool, jobs);

    if (plan === null) {
        reportFailure(ns, `Prep jobs for ${target} did not fit in the ${capacity} threads counted as free; retrying`);

        return null;
    }

    if (plan.placements.length === 0) return null;

    const pids = launchAll(ns, plan.placements, target, `prep-${Date.now()}`);
    ns.print(`Prepping ${target}, lands in ${ns.format.time(timing.weakenMs + 2 * SPACER_MS)}`);

    return { pids, remaining: plan.remaining };
}

/**
 * @param {NS} ns
 * @param {string} target
 * @param {number} capacity
 * @param {Timing} timing
 * @param {number} prepRam
 * @returns {Job[]}
 */
function prepJobs(ns, target, capacity, timing, prepRam) {
    const excessSecurity = ns.getServerSecurityLevel(target) - ns.getServerMinSecurityLevel(target);
    const securityThreads = Math.min(capacity, Math.max(0, Math.ceil(excessSecurity / WEAKEN_PER_THREAD)));

    const money = Math.max(ns.getServerMoneyAvailable(target), MIN_MONEY_FOR_GROWTH);
    const growMultiplier = ns.getServerMaxMoney(target) / money;
    const growNeeded = growMultiplier > 1 ? Math.ceil(ns.growthAnalyze(target, growMultiplier) * GROW_SAFETY) : 0;
    const spareThreads = Math.max(0, capacity - securityThreads - 1);
    const growThreads = Math.min(growNeeded, Math.floor(spareThreads / (1 + GROW_WEAKEN_RATIO)));
    const growWeakenThreads = Math.ceil(growThreads * GROW_WEAKEN_RATIO);

    return [
        { script: WEAKEN_SCRIPT, ramPerThread: prepRam, threads: securityThreads, delay: 0 },
        { script: GROW_SCRIPT, ramPerThread: prepRam, threads: growThreads, delay: timing.weakenMs + SPACER_MS - timing.growMs },
        { script: WEAKEN_SCRIPT, ramPerThread: prepRam, threads: growWeakenThreads, delay: 2 * SPACER_MS },
    ];
}

/**
 * Free RAM minus the home reserve and the part of each host's share reserve that share threads have not claimed yet.
 * @param {NS} ns
 * @param {string[]} hosts
 * @param {number} shareThreadRam
 * @returns {Map<string, number>}
 */
function freeRamByHost(ns, hosts, shareThreadRam) {
    return new Map(hosts.map(host => {
        const maxRam = ns.getServerMaxRam(host);
        const unclaimedReserve = Math.max(0, shareReserve(host, maxRam) - shareThreads(ns, host) * shareThreadRam);

        return [host, Math.max(0, usableRam(ns, host) - ns.getServerUsedRam(host) - unclaimedReserve)];
    }));
}

/**
 * Max RAM minus the space kept free on home for other scripts.
 * @param {NS} ns
 * @param {string} host
 */
function usableRam(ns, host) {
    const maxRam = ns.getServerMaxRam(host);
    if (host !== "home") return maxRam;

    return Math.max(0, maxRam - Math.max(HOME_MIN_RESERVE_GB, maxRam * HOME_RESERVE_FRACTION));
}

/**
 * @param {Map<string, number>} pool
 * @param {Job[]} jobs
 * @returns {{ placements: Placement[], remaining: Map<string, number> } | null}
 */
function placeJobs(pool, jobs) {
    const remaining = new Map(pool);
    /** @type {Placement[]} */
    const placements = [];

    for (const job of jobs) {
        if (job.threads === 0) continue;

        const parts = splitAcrossHosts(remaining, job);
        if (parts === null) return null;

        placements.push(...parts);
    }

    return { placements, remaining };
}

/**
 * @param {Map<string, number>} remaining
 * @param {Job} job
 * @returns {Placement[] | null}
 */
function splitAcrossHosts(remaining, job) {
    /** @type {Placement[]} */
    const parts = [];
    let unplaced = job.threads;

    for (const [host, free] of remaining.entries()) {
        const threads = Math.min(unplaced, Math.floor(free / job.ramPerThread));
        if (threads === 0) continue;

        remaining.set(host, free - threads * job.ramPerThread);
        parts.push({ script: job.script, host, threads, delay: job.delay });
        unplaced -= threads;
        if (unplaced === 0) return parts;
    }

    return null;
}

/**
 * @param {NS} ns
 * @param {Placement[]} placements
 * @param {string} target
 * @param {string} tag
 * @returns {number[]} pids of the jobs that started
 */
function launchAll(ns, placements, target, tag) {
    const pids = placements.map((placement, index) => ns.exec(placement.script, placement.host, placement.threads, target, placement.delay, `${tag}-${index}`));
    const failed = placements.filter((_, index) => pids[index] === 0);
    if (failed.length > 0) {
        reportFailure(ns, `${failed.length} of ${placements.length} jobs did not start (first: ${failed[0].script} x${failed[0].threads} on ${failed[0].host})`);
    }

    return pids.filter(pid => pid !== 0);
}
