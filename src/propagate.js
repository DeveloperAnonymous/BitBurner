/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");

    const programs = {
        "BruteSSH.exe": ns.brutessh,
        "FTPCrack.exe": ns.ftpcrack,
        "relaySMTP.exe": ns.relaysmtp,
        "HTTPWorm.exe": ns.httpworm,
        "SQLInject.exe": ns.sqlinject,
    };

    const workerScript = "worker.js";
    const refreshInterval = 30000; // 30 seconds
    const workerRam = ns.getScriptRam(workerScript, "home");

    if (workerRam === 0) {
        ns.tprint(`❌ Error: ${workerScript} not found on home.`);
        return;
    }

    ns.print("🚀 Starting continuous auto-nuke and deploy loop...");

    while (true) {
        const allServers = scanNetwork(ns);

        // 1. Gain root access on all reachable servers first
        for (const server of allServers) {
            if (server === "home") continue;
            if (!ns.hasRootAccess(server)) {
                crackAndNuke(ns, server, programs);
            }
        }

        // 2. Pick top 3 targets among rooted servers
        const topTargets = pickTopTargets(ns, allServers, 3);
        if (topTargets.length === 0) {
            ns.print("⚠️ No valid rooted targets found yet. Waiting...");
            await ns.sleep(refreshInterval);
            continue;
        }

        // 3. Sort rooted hosts by RAM descending so cloud/big servers hit the #1 target first
        const rootedHosts = allServers
            .filter(s => s !== "home" && !s.startsWith("hacknet-") && ns.hasRootAccess(s))
            .sort((a, b) => ns.getServerMaxRam(b) - ns.getServerMaxRam(a));

        let hostIndex = 0;
        for (const server of rootedHosts) {
            const maxRam = ns.getServerMaxRam(server);
            const targetThreads = Math.floor(maxRam / workerRam);
            if (targetThreads <= 0) continue;

            const assignedTarget = topTargets[hostIndex % topTargets.length];
            const staggerDelayMs = (hostIndex % 10) * 500; // Stagger starts by 0.5s to avoid security spikes
            hostIndex++;

            const runningScripts = ns.ps(server);
            const workerInstance = runningScripts.find(s => s.filename === workerScript);

            const needsRestart =
                !workerInstance ||
                workerInstance.threads !== targetThreads ||
                workerInstance.args[0] !== assignedTarget;

            if (needsRestart) {
                await ns.scriptKill(workerScript, server);
                await ns.scp(workerScript, server, "home");
                ns.exec(workerScript, server, targetThreads, assignedTarget, staggerDelayMs);
                ns.print(
                    `⚡ Deployed ${workerScript} on ${server} (${targetThreads}t / ${ns.format.ram(maxRam)}) -> ${assignedTarget}`
                );
            }
        }

        await ns.sleep(refreshInterval);
    }
}

/**
 * Ranks rooted, hackable servers and returns up to `limit` best target hostnames
 * @param {NS} ns
 * @param {string[]} servers
 * @param {number} limit
 * @returns {string[]}
 */
function pickTopTargets(ns, servers, limit = 3) {
    const hackLevel = ns.getHackingLevel();
    const halfLevelCap = Math.max(1, Math.floor(hackLevel / 2));

    const scoreServer = (server, maxReqHack) => {
        if (server === "home" || server.startsWith("hacknet-")) return null;
        if (!ns.hasRootAccess(server)) return null;

        const maxMoney = ns.getServerMaxMoney(server);
        if (maxMoney <= 0) return null;

        const reqHack = ns.getServerRequiredHackingLevel(server);
        if (reqHack > maxReqHack) return null;

        const minSec = Math.max(1, ns.getServerMinSecurityLevel(server));
        const growth = Math.max(1, ns.getServerGrowth(server));
        const weakenTime = Math.max(1, ns.getWeakenTime(server));
        const hackChance = Math.max(0.01, ns.hackAnalyzeChance(server));

        const score = (maxMoney * Math.sqrt(growth) * hackChance) / (weakenTime * minSec);
        return { server, score };
    };

    let scored = servers
        .map(s => scoreServer(s, halfLevelCap))
        .filter(Boolean);

    if (scored.length === 0) {
        scored = servers
            .map(s => scoreServer(s, hackLevel))
            .filter(Boolean);
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(item => item.server);
}

/**
 * Crawls the entire network and returns a list of all server hostnames
 * @param {NS} ns
 * @returns {string[]}
 */
function scanNetwork(ns) {
    const visited = new Set(["home"]);
    const queue = ["home"];

    while (queue.length > 0) {
        const current = queue.shift();
        for (const neighbor of ns.scan(current)) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }
    }

    return Array.from(visited);
}

/**
 * Opens all available ports and runs NUKE.exe if requirements are met
 * @param {NS} ns
 * @param {string} server
 * @param {Object} programs
 */
function crackAndNuke(ns, server, programs) {
    let portsOpened = 0;

    for (const [prog, func] of Object.entries(programs)) {
        if (ns.fileExists(prog, "home")) {
            func(server);
            portsOpened++;
        }
    }

    const requiredPorts = ns.getServerNumPortsRequired(server);
    if (portsOpened >= requiredPorts && ns.fileExists("NUKE.exe", "home")) {
        ns.nuke(server);
        ns.print(`🔓 Root access gained on ${server}!`);
    }
}
