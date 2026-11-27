import { ALL_SOLVER_FILES, CRACKED_FILE, CRAWLER_FILE as CRAWLER, CRAWLER_FILES, CRAWLER_VERSION as VERSION, LEGACY_FILES, OPEN_CACHE_FILE, PHISH_FILE as PHISH, REALLOC_FILE, STASIS_FILE, STASIS_PORT, VERSION_PORT, report, solverFileFor } from "/dnet/shared.js";

const LOOP_MS = 2000;
const RETRY_MS = 5 * 60 * 1000;
const REWARD_FILE = /\.(exe|cct|lit)$/;
const reportedFailures = new Set();
const reportedRewards = new Set();

/**
 * @typedef {import("/dnet/shared.js").CrackGoal} CrackGoal
 * @typedef {{ attempts: number, retryAt: number }} CrackRecord
 * @typedef {{ host: string, goal: CrackGoal, solver: string }} CrackJob
 * @typedef {{ host: string, goal: CrackGoal, password: string }} Handoff
 */

/** @type {Record<CrackGoal, (ns: NS, host: string) => void>} */
const DEPLOYERS = {
    crawl: deployCrawler,
    stasis: deployStasis,
};

/**
 * Coordinates one darknet node: hands each neighbor without a current crawler to the solver script for its model, so a
 * slow crack never holds up spreading, then deploys on the nodes the solvers cracked. Opening caches and freeing
 * blocked RAM run as one-shot scripts, which keeps their RAM out of this long-running one. Phishing only gets RAM that
 * nothing else needs.
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");

    const here = ns.getHostname();
    killScripts(ns, here, [...LEGACY_FILES, PHISH]);
    /** @type {Map<string, CrackRecord>} */
    const crackRecords = new Map();

    while (!isOutdated(ns)) {
        openCaches(ns, here);
        reportRewards(ns, here);
        deployCracked(ns);

        const cracking = crackersRunning(ns, here);
        const neighbors = ns.dnet.probe().filter(host => !cracking.has(host));
        const jobs = neighbors.filter(host => needsCrawler(ns, host)).map(host => crackJob(ns, host, "crawl"));
        const stasisTarget = ns.peek(STASIS_PORT);
        if (awaitsStasis(ns, neighbors, stasisTarget)) jobs.push(crackJob(ns, stasisTarget, "stasis"));

        for (const job of jobs) startCracker(ns, here, job, crackRecords);

        freeOwnBlockedRam(ns, here);
        startPhishing(ns, here);
        await ns.sleep(LOOP_MS);
    }

    killScripts(ns, here, [PHISH]);
}

/**
 * True once dnet/start.js has announced a different crawler version. An empty port (game just loaded) is not a newer version.
 * @param {NS} ns
 */
function isOutdated(ns) {
    const announced = ns.peek(VERSION_PORT);

    return typeof announced === "number" && announced !== VERSION;
}

/**
 * @param {NS} ns
 * @param {string} here
 */
function openCaches(ns, here) {
    const opening = new Set(processesOf(ns, here, OPEN_CACHE_FILE).map(process => process.args[0]));
    const caches = ns.ls(here, ".cache").filter(cache => !opening.has(cache));

    for (const cache of caches) {
        if (!execWithRoom(ns, here, OPEN_CACHE_FILE, cache)) reportOnce(ns, `cache:${cache}`, `no RAM to open ${cache} (free ${freeRam(ns, here)} GB)`);
    }
}

/**
 * Reports each program, contract and literature file on this node once. dnet/start.js copies the literature home and
 * contracts.js solves the contracts; programs cannot be copied by scripts.
 * @param {NS} ns
 * @param {string} here
 */
function reportRewards(ns, here) {
    const newRewards = ns.ls(here).filter(file => REWARD_FILE.test(file) && !reportedRewards.has(file));

    for (const file of newRewards) {
        reportedRewards.add(file);
        report(ns, "loot", file);
    }
}

/**
 * Solvers append a line to CRACKED_FILE for each node they get into; the session is theirs only, so the crawler opens
 * its own with the password before deploying. Reading and clearing the file has no await between them, so no line
 * written meanwhile is lost.
 * @param {NS} ns
 */
function deployCracked(ns) {
    const lines = ns.read(CRACKED_FILE).split("\n").filter(Boolean);
    if (lines.length === 0) return;

    ns.write(CRACKED_FILE, "", "w");

    for (const line of lines) {
        /** @type {Handoff} */
        const handoff = JSON.parse(line);
        deployHandoff(ns, handoff);
    }
}

/**
 * @param {NS} ns
 * @param {Handoff} handoff
 */
function deployHandoff(ns, { host, goal, password }) {
    const session = ns.dnet.connectToSession(host, password);
    if (!session.success) {
        report(ns, "failed", `${host}: opening a session after cracking failed (${session.code} ${session.message})`);

        return;
    }

    DEPLOYERS[goal](ns, host);
}

/**
 * @param {NS} ns
 * @param {string} host
 */
function deployCrawler(ns, host) {
    clearNode(ns, host);
    if (!ns.scp(CRAWLER_FILES, host)) {
        report(ns, "failed", `${host}: copying crawler files failed after cracking`);

        return;
    }

    if (ns.exec(CRAWLER, host, 1, VERSION) === 0) {
        report(ns, "failed", `${host}: starting crawler failed (free RAM ${freeRam(ns, host)} GB)`);
    }
}

/**
 * Clears the node so setStasisLink's 12 GB fits; neighboring crawlers redeploy the crawler once stasis.js exits.
 * @param {NS} ns
 * @param {string} host
 */
function deployStasis(ns, host) {
    clearNode(ns, host);
    if (!ns.scp([STASIS_FILE, "dnet/shared.js"], host)) {
        report(ns, "failed", `${host}: copying ${STASIS_FILE} failed after cracking`);

        return;
    }

    if (ns.exec(STASIS_FILE, host) === 0) {
        report(ns, "failed", `${host}: starting ${STASIS_FILE} failed (free RAM ${freeRam(ns, host)} GB)`);
    }
}

/**
 * @param {NS} ns
 * @param {string} host
 */
function clearNode(ns, host) {
    killScripts(ns, host, [CRAWLER, PHISH, OPEN_CACHE_FILE, REALLOC_FILE, ...ALL_SOLVER_FILES]);
}

/**
 * @param {NS} ns
 * @param {string} here
 * @returns {Set<string>} hosts a solver on this node is working on
 */
function crackersRunning(ns, here) {
    return new Set(ns.ps(here).filter(process => ALL_SOLVER_FILES.includes(process.filename)).map(process => String(process.args[0])));
}

/**
 * @param {NS} ns
 * @param {string} host
 * @param {CrackGoal} goal
 * @returns {CrackJob}
 */
function crackJob(ns, host, goal) {
    return { host, goal, solver: solverFileFor(ns.dnet.getServerDetails(host).modelId) };
}

/**
 * @param {NS} ns
 * @param {string} host
 */
function needsCrawler(ns, host) {
    const details = ns.dnet.getServerDetails(host);

    return details.isOnline && details.isConnectedToCurrentServer && !runsCurrentCrawler(ns, host);
}

/**
 * The node dnet/start.js picked for a stasis link, once it is a neighbor that already runs the current crawler (so the
 * crawl job and the stasis job never race) and is not linked yet.
 * @param {NS} ns
 * @param {string[]} neighbors
 * @param {unknown} stasisTarget
 * @returns {stasisTarget is string}
 */
function awaitsStasis(ns, neighbors, stasisTarget) {
    if (typeof stasisTarget !== "string" || !neighbors.includes(stasisTarget)) return false;

    return runsCurrentCrawler(ns, stasisTarget) && !ns.dnet.getStasisLinkedServers().includes(stasisTarget);
}

/**
 * @param {NS} ns
 * @param {string} host
 */
function runsCurrentCrawler(ns, host) {
    return processesOf(ns, host, CRAWLER).some(process => process.args[0] === VERSION);
}

/**
 * Starts a solver for the job unless its last failed try is still cooling down.
 * @param {NS} ns
 * @param {string} here
 * @param {CrackJob} job
 * @param {Map<string, CrackRecord>} crackRecords
 */
function startCracker(ns, here, job, crackRecords) {
    const key = `${job.goal}:${job.host}`;
    const record = crackRecords.get(key) ?? { attempts: 0, retryAt: 0 };
    if (Date.now() < record.retryAt) return;

    const tryNumber = record.attempts + 1;
    if (!execWithRoom(ns, here, job.solver, job.host, job.goal, tryNumber)) {
        reportOnce(ns, `cracker:${job.host}`, `no RAM to crack ${job.host} (free ${freeRam(ns, here)} GB, ${job.solver} needs ${ns.getScriptRam(job.solver)} GB)`);

        return;
    }

    crackRecords.set(key, { attempts: tryNumber, retryAt: Date.now() + RETRY_MS });
}

/**
 * Runs one thread of the script here, stopping phishing when that is what keeps it from fitting.
 * @param {NS} ns
 * @param {string} here
 * @param {string} script
 * @param {...(string | number)} args
 * @returns {boolean} whether it started
 */
function execWithRoom(ns, here, script, ...args) {
    if (ns.exec(script, here, 1, ...args) !== 0) return true;
    if (processesOf(ns, here, PHISH).length === 0) return false;

    killScripts(ns, here, [PHISH]);

    return ns.exec(script, here, 1, ...args) !== 0;
}

/**
 * While the owner blocks RAM here, keeps one realloc.js running with every thread that fits, ahead of phishing.
 * @param {NS} ns
 * @param {string} here
 */
function freeOwnBlockedRam(ns, here) {
    if (ns.dnet.getBlockedRam(here) <= 0 || processesOf(ns, here, REALLOC_FILE).length > 0) return;

    killScripts(ns, here, [PHISH]);
    const threads = Math.floor(freeRam(ns, here) / ns.getScriptRam(REALLOC_FILE));
    if (threads < 1 || ns.exec(REALLOC_FILE, here, threads) === 0) reportOnce(ns, `realloc:${here}`, `no RAM to free blocked RAM (free ${freeRam(ns, here)} GB)`);
}

/**
 * Fills whatever RAM is free with another phishing instance, so RAM freed by finished solvers is not left idle.
 * @param {NS} ns
 * @param {string} here
 */
function startPhishing(ns, here) {
    const threads = Math.floor(freeRam(ns, here) / ns.getScriptRam(PHISH));
    if (threads > 0) ns.exec(PHISH, here, threads);
}

/**
 * @param {NS} ns
 * @param {string} host
 * @param {string} script
 */
function processesOf(ns, host, script) {
    return ns.ps(host).filter(process => process.filename === script);
}

/**
 * Kills by pid, which costs half of scriptKill's RAM.
 * @param {NS} ns
 * @param {string} host
 * @param {string[]} scripts
 */
function killScripts(ns, host, scripts) {
    for (const process of ns.ps(host)) {
        if (scripts.includes(process.filename)) ns.kill(process.pid);
    }
}

/**
 * @param {NS} ns
 * @param {string} host
 */
function freeRam(ns, host) {
    return ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
}

/**
 * @param {NS} ns
 * @param {string} key
 * @param {string} text
 */
function reportOnce(ns, key, text) {
    if (reportedFailures.has(key)) return;

    reportedFailures.add(key);
    report(ns, "failed", text);
}
