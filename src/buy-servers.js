/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("sleep");
    ns.disableLog("getServerMaxRam");

    const keepRatio = 0.5; // Keep 50% of cash untouched in your account
    const startingRam = 8; // Starting RAM size in GB for new cloud servers
    const sleepMs = 15000;

    while (true) {
        const money = ns.getServerMoneyAvailable("home");
        const spendable = Math.max(0, money * (1 - keepRatio));

        const serverLimit = ns.cloud.getServerLimit();
        const purchasedServers = ns.cloud.getServerNames();
        const maxPossibleRam = ns.cloud.getRamLimit();

        // Determine target RAM for next purchase or upgrade
        let targetRam = startingRam;
        if (purchasedServers.length > 0) {
            const minRam = purchasedServers.reduce((min, srv) => {
                const ram = ns.getServerMaxRam(srv);
                return ram < min ? ram : min;
            }, ns.getServerMaxRam(purchasedServers[0]));
            targetRam = purchasedServers.length < serverLimit ? startingRam : minRam * 2;
        }

        if (targetRam > maxPossibleRam) {
            targetRam = maxPossibleRam;
        }

        const newServerCost = ns.cloud.getServerCost(targetRam);
        const shortfall = Math.max(0, newServerCost - spendable);

        // Printed right after getServerMoneyAvailable logs the player's money
        ns.print(
            `🖥️ Need $${ns.format.number(newServerCost)} (spendable 50%: $${ns.format.number(spendable)}) ` +
            `for a ${ns.format.ram(targetRam)} cloud server` +
            (shortfall > 0 ? ` ($${ns.format.number(shortfall)} more needed)` : " (Affordable within budget!)")
        );

        // Buy a new cloud server if below limit and affordable within spendable budget
        if (purchasedServers.length < serverLimit) {
            if (spendable >= newServerCost && newServerCost > 0) {
                const hostname = ns.cloud.purchaseServer(`cloud-${purchasedServers.length}`, targetRam);
                if (hostname) {
                    ns.print(`✅ Purchased new cloud server ${hostname} (${ns.format.ram(targetRam)})`);
                }
            }
        } else if (purchasedServers.length > 0) {
            // Upgrade the smallest cloud server when at server limit
            const weakest = purchasedServers.reduce((best, srv) =>
                ns.getServerMaxRam(srv) < ns.getServerMaxRam(best) ? srv : best
            );
            const currentWeakestRam = ns.getServerMaxRam(weakest);
            const nextRam = Math.min(maxPossibleRam, currentWeakestRam * 2);

            if (nextRam > currentWeakestRam) {
                const upgradeCost = ns.cloud.getServerUpgradeCost(weakest, nextRam);
                if (spendable >= upgradeCost && upgradeCost > 0) {
                    if (ns.cloud.upgradeServer(weakest, nextRam)) {
                        ns.print(`⬆️ Upgraded ${weakest} to ${ns.format.ram(nextRam)}`);
                    }
                }
            }
        }

        await ns.sleep(sleepMs);
    }
}