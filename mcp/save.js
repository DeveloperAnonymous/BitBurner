import { gunzipSync } from "node:zlib";

export async function readSave(link) {
    const { save, binary } = await link.request("getSaveFile", {});
    const text = binary ? gunzipSync(Buffer.from(save, "latin1")).toString("utf8") : Buffer.from(save, "base64").toString("utf8");
    const root = JSON.parse(text);

    return {
        player: JSON.parse(root.data.PlayerSave).data,
        servers: JSON.parse(root.data.AllServersSave),
    };
}

export function playerSummary({ player, servers }) {
    return {
        bitNode: player.bitNodeN,
        sourceFiles: Object.fromEntries(player.sourceFiles.data),
        money: player.money,
        skills: player.skills,
        city: player.city,
        factions: player.factions,
        augmentations: player.augmentations.map(augmentation => augmentation.name),
        purchasedServers: player.purchasedServers,
        hacknetNodes: player.hacknetNodes.length,
        homePrograms: servers.home.data.programs,
        homeRam: servers.home.data.maxRam,
        homeCores: servers.home.data.cpuCores,
    };
}

export function serverSummary({ servers }, hostname) {
    const server = servers[hostname];
    if (server === undefined) throw new Error(`No server named ${hostname} in the save`);

    const data = server.data;

    return {
        hostname: data.hostname,
        hasAdminRights: data.hasAdminRights,
        purchasedByPlayer: data.purchasedByPlayer,
        backdoorInstalled: data.backdoorInstalled,
        maxRam: data.maxRam,
        cpuCores: data.cpuCores,
        requiredHackingSkill: data.requiredHackingSkill,
        numOpenPortsRequired: data.numOpenPortsRequired,
        openPortCount: data.openPortCount,
        moneyAvailable: data.moneyAvailable,
        moneyMax: data.moneyMax,
        hackDifficulty: data.hackDifficulty,
        minDifficulty: data.minDifficulty,
        serverGrowth: data.serverGrowth,
        serversOnNetwork: data.serversOnNetwork,
    };
}
