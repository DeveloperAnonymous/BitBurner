import { crack } from "/dnet/crack.js";
import { statedPasswords } from "/dnet/password-format.js";

const BASE_HINT = /base\s+(\d+)\s+number\s+([0-9a-z]+)/i;

/** @param {NS} ns */
export async function main(ns) {
    await crack(ns, solve);
}

/**
 * @param {import("/dnet/crack.js").Target} target
 * @returns {import("/dnet/crack.js").Guesses}
 */
async function* solve({ details }) {
    yield* statedPasswords(details);

    const [base, digits] = details.data.includes(",") ? details.data.split(",").map(part => part.trim()) : (details.passwordHint.match(BASE_HINT) ?? []).slice(1);
    const radix = Number(base);
    if (!digits || radix < 2 || radix > 36) return `no base and digits in data "${details.data}" or hint`;

    const value = Number.parseInt(digits, radix);
    if (Number.isNaN(value)) return `"${digits}" is not a base ${radix} number`;

    yield String(value);
}
