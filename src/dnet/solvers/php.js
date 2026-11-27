import { crack } from "/dnet/crack.js";

const MAX_PERMUTATIONS = 200;

/** @param {NS} ns */
export async function main(ns) {
    await crack(ns, solve);
}

/**
 * PHP 5.4 shows the password's characters sorted, so their orderings are tried.
 * @param {import("/dnet/crack.js").Target} target
 * @returns {import("/dnet/crack.js").Guesses}
 */
async function* solve({ details }) {
    yield* permutations(details.data.replace(/[^a-z0-9]/gi, ""), MAX_PERMUTATIONS);
}

/**
 * Distinct orderings of the characters, at most limit of them.
 * @param {string} characters
 * @param {number} limit
 * @returns {string[]}
 */
function permutations(characters, limit) {
    /** @type {Set<string>} */
    const found = new Set();

    /**
     * @param {string} prefix
     * @param {string} rest
     */
    const extend = (prefix, rest) => {
        if (found.size >= limit) return;

        if (rest.length === 0) {
            found.add(prefix);

            return;
        }

        [...rest].forEach((character, index) => extend(prefix + character, rest.slice(0, index) + rest.slice(index + 1)));
    };

    extend("", characters);

    return [...found];
}
