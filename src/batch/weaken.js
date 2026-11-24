/** @param {NS} ns */
export async function main(ns) {
    const [target, additionalMsec] = ns.args;
    if (typeof target !== "string" || typeof additionalMsec !== "number") {
        ns.toast(`batch/weaken.js needs (target, delayMs, tag), got ${JSON.stringify(ns.args)}`, "error", 15000);

        return;
    }

    await ns.weaken(target, { additionalMsec });
}
