/** @param {NS} ns */
export async function main(ns) {
    let maxNodes = ns.hacknet.maxNumNodes();

    ns.print("Starting automated Hacknet manager...");

    while (true) {
        let numNodes = ns.hacknet.numNodes();

        // 1. Buy a new node if we haven't hit the cap and can afford it
        if (numNodes < maxNodes) {
            let cost = ns.hacknet.getPurchaseNodeCost();
            if (ns.getServerMoneyAvailable("home") >= cost) {
                let newNodeIndex = ns.hacknet.purchaseNode();
                if (newNodeIndex !== -1) {
                    ns.tprint(`SUCCESS: Purchased new Hacknet node #${newNodeIndex}`);
                }
            }
        }

        // 2. Iterate through existing nodes to find the cheapest available upgrade
        let cheapestCost = Infinity;
        let cheapestType = "";
        let cheapestIndex = -1;

        for (let i = 0; i < numNodes; i++) {
            let levelCost = ns.hacknet.getLevelUpgradeCost(i, 1);
            let ramCost = ns.hacknet.getRamUpgradeCost(i, 1);
            let coreCost = ns.hacknet.getCoreUpgradeCost(i, 1);

            if (levelCost < cheapestCost) {
                cheapestCost = levelCost;
                cheapestType = "level";
                cheapestIndex = i;
            }
            if (ramCost < cheapestCost) {
                cheapestCost = ramCost;
                cheapestType = "ram";
                cheapestIndex = i;
            }
            if (coreCost < cheapestCost) {
                cheapestCost = coreCost;
                cheapestType = "core";
                cheapestIndex = i;
            }
        }

        // Also check if buying a brand new node is cheaper than the cheapest upgrade
        let newNodeCost = numNodes < maxNodes ? ns.hacknet.getPurchaseNodeCost() : Infinity;
        if (newNodeCost < cheapestCost && ns.getServerMoneyAvailable("home") >= newNodeCost) {
            ns.hacknet.purchaseNode();
            ns.tprint(`SUCCESS: Purchased new Hacknet node (cheaper than individual upgrades).`);
        } 
        // Otherwise, execute the cheapest upgrade if we can afford it
        else if (cheapestIndex !== -1 && ns.getServerMoneyAvailable("home") >= cheapestCost) {
            if (cheapestType === "level") {
                ns.hacknet.upgradeLevel(cheapestIndex, 1);
                ns.print(`Upgraded level for node ${cheapestIndex}`);
            } else if (cheapestType === "ram") {
                ns.hacknet.upgradeRam(cheapestIndex, 1);
                ns.print(`Upgraded RAM for node ${cheapestIndex}`);
            } else if (cheapestType === "core") {
                ns.hacknet.upgradeCore(cheapestIndex, 1);
                ns.print(`Upgraded cores for node ${cheapestIndex}`);
            }
        }

        // Sleep for 1 second before evaluating costs again
        await ns.sleep(1000);
    }
}