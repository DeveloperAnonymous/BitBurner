/** @param {NS} ns */
export async function main(ns) {
    const [target] = ns.args;
    if (typeof target !== "string") {
        ns.toast(`xp-farm.js needs (target), got ${JSON.stringify(ns.args)}`, "error", 15000);

        return;
    }

    while (true) {
        await ns.weaken(target);
    }
}
