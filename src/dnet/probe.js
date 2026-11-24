/** @param {NS} ns */
export async function main(ns) {
    const here = ns.getHostname();
    const neighbours = ns.dnet.probe().map(host => ({ host, ...ns.dnet.getServerDetails(host) }));
    const files = ns.ls(here);

    ns.write("dnet-probe.txt", JSON.stringify({ here, ram: ns.getServerMaxRam(here), files, neighbours }, null, 1), "w");
}
