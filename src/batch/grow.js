/** @param {NS} ns */
export async function main(ns) {
    const [target, additionalMsec] = ns.args;
    if (typeof target !== "string" || typeof additionalMsec !== "number") {
        throw new Error(`grow.js needs (target, delayMs, tag), got ${JSON.stringify(ns.args)}`);
    }

    await ns.grow(target, { additionalMsec });
}
