/** @typedef {import("/dnet/crack.js").ServerDetails} ServerDetails */

const WORD_SEPARATORS = /[^a-z0-9]+/i;

export const COMMON_DEFAULTS = ["0000", "12345", "admin", "password"];

/**
 * @param {string} password
 * @param {ServerDetails} details
 */
export function fitsFormat(password, details) {
    if (password.length !== details.passwordLength) return false;

    return details.passwordFormat !== "numeric" || /^\d*$/.test(password);
}

/**
 * Every word in the hint and data that fits the password's length and format, e.g. "576" in "The secret is 576".
 * @param {ServerDetails} details
 */
export function statedPasswords(details) {
    return `${details.passwordHint} ${details.data}`.split(WORD_SEPARATORS).filter(word => fitsFormat(word, details));
}
