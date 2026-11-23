/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");

    const argTarget = typeof ns.args[0] === "string" && ns.args[0].length > 0 ? ns.args[0] : null;
    const initialDelay = typeof ns.args[1] === "number" && ns.args[1] > 0 ? ns.args[1] : 0;

    if (initialDelay > 0) {
        await ns.sleep(initialDelay);
    }

    const target = argTarget ?? findBestTarget(ns);

    if (!target) {
        ns.print("⚠️ No valid target found. Exiting worker.");
        return;
    }

    ns.print(`🎯 Worker locked onto target: ${target}`);

    while (true) {
        if (!ns.hasRootAccess(target)) {
            ns.print(`⚠️ Missing root access on ${target}. Waiting 10 seconds...`);
            await ns.sleep(10000);
            continue;
        }

        const maxMoney = ns.getServerMaxMoney(target);
        const minSecurity = ns.getServerMinSecurityLevel(target);

        if (maxMoney <= 0) {
            ns.print(`⚠️ Target ${target} has no money. Waiting 10 seconds...`);
            await ns.sleep(10000);
            continue;
        }

        // Tighter security threshold keeps hack/grow/weaken times fast
        const securityThresh = minSecurity + 1;
        const moneyThresh = maxMoney * 0.80;

        const currentSecurity = ns.getServerSecurityLevel(target);
        const currentMoney = ns.getServerMoneyAvailable(target);

        if (currentSecurity > securityThresh) {
            ns.print(
                `🛡️ [${target}] Weakening (Sec: ${currentSecurity.toFixed(2)} / ${securityThresh.toFixed(2)})`
            );
            await ns.weaken(target);
        } else if (currentMoney < moneyThresh) {
            ns.print(
                `🌱 [${target}] Growing ($${ns.format.number(currentMoney)} / $${ns.format.number(moneyThresh)})`
            );
            await ns.grow(target);
        } else {
            ns.print(`💰 [${target}] Hacking ($${ns.format.number(currentMoney)})`);
            await ns.hack(target);
        }
    }
}

/**
 * Fallback target selector when worker.js is launched without arguments
 * @param {NS} ns
 * @returns {string|null}
 */
function findBestTarget(ns) {
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

    const playerHackLevel = ns.getHackingLevel();
    const maxAllowedHack = Math.max(1, Math.floor(playerHackLevel / 2));

    let bestServer = null;
    let highestScore = 0;

    for (const server of visited) {
        if (server === "home" || server.startsWith("hacknet-")) continue;

        const maxMoney = ns.getServerMaxMoney(server);
        if (maxMoney <= 0) continue;

        const reqHack = ns.getServerRequiredHackingLevel(server);
        if (!ns.hasRootAccess(server) || reqHack > maxAllowedHack) continue;

        const minSecurity = Math.max(1, ns.getServerMinSecurityLevel(server));
        const growth = Math.max(1, ns.getServerGrowth(server));
        const weakenTime = Math.max(1, ns.getWeakenTime(server));
        const hackChance = Math.max(0.01, ns.hackAnalyzeChance(server));

        const score = (maxMoney * Math.sqrt(growth) * hackChance) / (weakenTime * minSecurity);

        if (score > highestScore) {
            highestScore = score;
            bestServer = server;
        }
    }

    return bestServer;
}
