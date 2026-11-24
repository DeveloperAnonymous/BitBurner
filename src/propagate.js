const HACK_SCRIPT = "/batch/hack.js";
const GROW_SCRIPT = "/batch/grow.js";
const WEAKEN_SCRIPT = "/batch/weaken.js";
const BATCH_SCRIPTS = [HACK_SCRIPT, GROW_SCRIPT, WEAKEN_SCRIPT];

const HACK_FRACTION = 0.1;
const BATCH_SHRINK_FACTOR = 0.75;
const GROW_SAFETY = 1.1;
const SPACER_MS = 100;
const BATCH_STRIDE_MS = 4 * SPACER_MS;
const MAX_BATCHES_PER_WAVE = 250;
const LANDING_BUFFER_MS = 500;
const EXIT_POLL_MS = 200;
const IDLE_WAIT_MS = 30000;
const SECURITY_TOLERANCE = 0.05;
const MONEY_TOLERANCE = 0.99;
const TARGET_SWITCH_RATIO = 2.5;
const MIN_MONEY_FOR_GROWTH = 1;

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
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");

    const scriptRam = readScriptRam(ns);
    /** @type {string | null} */
    let target = null;

    while (true) {
        const servers = scanNetwork(ns);
        rootAll(ns, servers);
        const hosts = workerHosts(ns, servers);
        copyBatchScripts(ns, hosts);
        target = chooseTarget(ns, servers, target);

        if (target === null) {
            ns.print("No rooted target with money yet. Waiting.");
            await ns.sleep(IDLE_WAIT_MS);
            continue;
        }

        if (isPrepped(ns, target)) {
            await runWave(ns, target, hosts, scriptRam);
        } else {
            await prepTarget(ns, target, hosts, scriptRam);
        }
    }
}

/**
 * @param {NS} ns
 * @returns {ScriptRam}
 */
function readScriptRam(ns) {
    const ramByScript = new Map(BATCH_SCRIPTS.map(script => [script, ns.getScriptRam(script, "home")]));
    const missing = BATCH_SCRIPTS.filter(script => ramByScript.get(script) === 0);
    if (missing.length > 0) {
        throw new Error(`Batch scripts missing on home: ${missing.join(", ")}. Run "Bitburner: Sync All Files".`);
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
            throw new Error(`nuke ${server} failed with ${ownedCrackers.length} port crackers owned`);
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
        server !== "home" &&
        !server.startsWith("hacknet-") &&
        ns.hasRootAccess(server) &&
        ns.getServerMaxRam(server) > 0
    );
}

/**
 * @param {NS} ns
 * @param {string[]} hosts
 */
function copyBatchScripts(ns, hosts) {
    for (const host of hosts) {
        if (!ns.scp(BATCH_SCRIPTS, host, "home")) {
            throw new Error(`scp of batch scripts to ${host} failed`);
        }
    }
}

/**
 * @param {NS} ns
 * @param {string[]} servers
 * @param {string | null} current
 * @returns {string | null}
 */
function chooseTarget(ns, servers, current) {
    const best = pickBestTarget(ns, servers);
    if (best === null) return null;
    if (current === null) return best.server;

    const currentScore = scoreTarget(ns, current, ns.getHackingLevel());
    if (currentScore === null) return best.server;

    const isClearlyBetter = best.score > currentScore * TARGET_SWITCH_RATIO;

    return isClearlyBetter ? best.server : current;
}

/**
 * @param {NS} ns
 * @param {string[]} servers
 * @returns {{ server: string, score: number } | null}
 */
function pickBestTarget(ns, servers) {
    const hackLevel = ns.getHackingLevel();
    const comfortableLevel = Math.max(1, Math.floor(hackLevel / 2));

    return bestScoring(ns, servers, comfortableLevel) ?? bestScoring(ns, servers, hackLevel);
}

/**
 * @param {NS} ns
 * @param {string[]} servers
 * @param {number} maxRequiredLevel
 * @returns {{ server: string, score: number } | null}
 */
function bestScoring(ns, servers, maxRequiredLevel) {
    /** @type {{ server: string, score: number } | null} */
    let best = null;

    for (const server of servers) {
        const score = scoreTarget(ns, server, maxRequiredLevel);
        if (score === null || (best !== null && score <= best.score)) continue;

        best = { server, score };
    }

    return best;
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
 * @param {string[]} hosts
 * @param {ScriptRam} scriptRam
 */
async function runWave(ns, target, hosts, scriptRam) {
    let pool = freeRamByHost(ns, hosts);
    const capacity = threadCapacity(pool, Math.max(scriptRam.hackRam, scriptRam.growRam, scriptRam.weakenRam));
    const threads = batchThreadsThatFit(ns, target, capacity);
    const timing = readTiming(ns, target);
    const waveId = Date.now();
    /** @type {number[]} */
    const pids = [];
    let batchCount = 0;

    while (batchCount < MAX_BATCHES_PER_WAVE) {
        const plan = placeJobs(pool, batchJobs(threads, timing, scriptRam, batchCount));
        if (plan === null) break;

        pool = plan.remaining;
        pids.push(...plan.placements.map(placement => launch(ns, placement, target, `${waveId}-${batchCount}`)));
        batchCount++;
    }

    if (batchCount === 0) {
        ns.print(`No room for one batch on ${target}: the smallest needs ${totalThreads(threads)} threads, ${capacity} free. Waiting.`);
        await ns.sleep(IDLE_WAIT_MS);

        return;
    }

    const lastLandingMs = timing.weakenMs + 3 * SPACER_MS + (batchCount - 1) * BATCH_STRIDE_MS;
    ns.print(`Wave on ${target}: ${batchCount} batches, ${threads.hackThreads} hack threads each, lands in ${ns.format.time(lastLandingMs)}`);
    await ns.sleep(lastLandingMs + LANDING_BUFFER_MS);
    await waitForExit(ns, pids);
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
 * @returns {number}
 */
function totalThreads(threads) {
    return threads.hackThreads + threads.hackWeakenThreads + threads.growThreads + threads.growWeakenThreads;
}

/**
 * @param {NS} ns
 * @param {string} target
 * @param {number} capacity
 * @returns {BatchThreads}
 */
function batchThreadsThatFit(ns, target, capacity) {
    let hackThreads = Math.max(1, Math.floor(HACK_FRACTION / stolenPerHackThread(ns, target)));
    let threads = batchThreads(ns, target, hackThreads);

    while (hackThreads > 1 && totalThreads(threads) > capacity) {
        hackThreads = Math.floor(hackThreads * BATCH_SHRINK_FACTOR);
        threads = batchThreads(ns, target, hackThreads);
    }

    return threads;
}

/**
 * @param {NS} ns
 * @param {string} target
 * @returns {number}
 */
function stolenPerHackThread(ns, target) {
    const stolenPerThread = ns.hackAnalyze(target);
    if (stolenPerThread <= 0) {
        throw new Error(`hackAnalyze(${target}) is ${stolenPerThread}: the target cannot be hacked at this level`);
    }

    return stolenPerThread;
}

/**
 * @param {NS} ns
 * @param {string} target
 * @param {number} hackThreads
 * @returns {BatchThreads}
 */
function batchThreads(ns, target, hackThreads) {
    const stolenFraction = stolenPerHackThread(ns, target) * hackThreads;
    if (stolenFraction >= 1) {
        throw new Error(`One hack thread steals all money on ${target}; pick a richer target`);
    }

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
 * @param {string[]} hosts
 * @param {ScriptRam} scriptRam
 */
async function prepTarget(ns, target, hosts, scriptRam) {
    const pool = freeRamByHost(ns, hosts);
    const prepRam = Math.max(scriptRam.growRam, scriptRam.weakenRam);
    const capacity = [...pool.values()].reduce((total, free) => total + Math.floor(free / prepRam), 0);
    const timing = readTiming(ns, target);
    const jobs = prepJobs(ns, target, capacity, timing, prepRam);
    const plan = placeJobs(pool, jobs);

    if (plan === null) {
        throw new Error(`Prep jobs for ${target} did not fit in the ${capacity} threads counted as free`);
    }

    if (plan.placements.length === 0) {
        ns.print(`No free RAM to prep ${target}. Waiting.`);
        await ns.sleep(IDLE_WAIT_MS);

        return;
    }

    const waveId = Date.now();
    const pids = plan.placements.map((placement, index) => launch(ns, placement, target, `prep-${waveId}-${index}`));
    const landingMs = timing.weakenMs + 2 * SPACER_MS;
    ns.print(`Prepping ${target}, lands in ${ns.format.time(landingMs)}`);
    await ns.sleep(landingMs + LANDING_BUFFER_MS);
    await waitForExit(ns, pids);
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
 * @param {NS} ns
 * @param {string[]} hosts
 * @returns {Map<string, number>}
 */
function freeRamByHost(ns, hosts) {
    return new Map(hosts.map(host => [host, ns.getServerMaxRam(host) - ns.getServerUsedRam(host)]));
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
 * @param {Placement} placement
 * @param {string} target
 * @param {string} tag
 * @returns {number}
 */
function launch(ns, placement, target, tag) {
    const pid = ns.exec(placement.script, placement.host, placement.threads, target, placement.delay, tag);
    if (pid === 0) {
        throw new Error(`exec ${placement.script} on ${placement.host} with ${placement.threads} threads failed`);
    }

    return pid;
}

/**
 * @param {NS} ns
 * @param {number[]} pids
 */
async function waitForExit(ns, pids) {
    while (pids.some(pid => ns.isRunning(pid))) {
        await ns.sleep(EXIT_POLL_MS);
    }
}
