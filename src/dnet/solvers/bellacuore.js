import { crack } from "/dnet/crack.js";
import { statedPasswords } from "/dnet/password-format.js";

const ROMAN_HINT = /['"]([IVXLCDM]+)['"]/i;
/** @type {Record<string, number>} */
const ROMAN_VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

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

    const numeral = details.data.trim() || details.passwordHint.match(ROMAN_HINT)?.[1];
    if (!numeral || !/^[IVXLCDM]+$/i.test(numeral)) return `no roman numeral in data "${details.data}" or hint`;

    const values = [...numeral.toUpperCase()].map(symbol => ROMAN_VALUES[symbol]);

    yield String(values.reduce((total, value, index) => total + (value < (values[index + 1] ?? 0) ? -value : value), 0));
}
