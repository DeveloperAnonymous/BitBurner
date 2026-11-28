const HACKING_STATS = ["hack", "cha"];
const COMBAT_STATS = ["str", "def", "dex", "agi"];

/**
 * Geometric mean of the ascension multipliers for the stats this gang type uses.
 * @param {GangMemberAscension} result
 * @param {boolean} isHacking
 */
export function ascensionGain(result, isHacking) {
    const stats = isHacking ? HACKING_STATS : COMBAT_STATS;
    const product = stats.reduce((total, stat) => total * result[stat], 1);

    return Math.pow(product, 1 / stats.length);
}
