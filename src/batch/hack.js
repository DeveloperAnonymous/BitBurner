/** @param {NS} ns */
export async function main(ns) {
    const [target, additionalMsec] = ns.args;
    if (typeof target !== "string" || typeof additionalMsec !== "number") {
        ns.tprint(`batch/hack.js needs (target, delayMs, tag), got ${JSON.stringify(ns.args)}`);

        return;
    }

    await ns.hack(target, { additionalMsec });
}
