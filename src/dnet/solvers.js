/**
 * @typedef {ReturnType<NS["dnet"]["getServerDetails"]>} ServerDetails
 * @typedef {Awaited<ReturnType<NS["dnet"]["authenticate"]>>} AuthResult
 * @typedef {{ ns: NS, host: string, details: ServerDetails }} Target
 * @typedef {AsyncGenerator<string, void, AuthResult>} Guesses
 * @typedef {{ exact: number, misplaced: number }} Score
 */

const STATED_PASSWORD = /(?:password|passcode|pin|code|key|secret|pw)\s*(?:is|:|=)\s*["']?([^\s"'.!,;]+)/i;
const WORD_SEPARATORS = /[^a-z0-9]+/i;
const RANGE_HINT = /between\s+(-?\d+)\s+and\s+(-?\d+)/i;
const BASE_HINT = /base\s+(\d+)\s+number\s+([0-9a-z]+)/i;
const ROMAN_HINT = /['"]([IVXLCDM]+)['"]/i;
const LETTER_CLUE = /(?:see\s+an?\s+|letter\s+|char(?:acter)?\s+)([a-z0-9])\b/gi;
const MASTERMIND_FEEDBACK = /(\d+)\s+symbols?\s+are\s+match(?:ed)?\s+exactly,\s*(?:and\s*)?(\d+)\s+symbols?\s+match/i;
const DEFAULT_PASSWORD_HINT = /default\s+password/i;

const COMMON_DEFAULTS = ["0000", "1111", "1234", "4321", "9999", "2580", "1337", "7777", "8888", "00000", "11111", "12345", "54321", "99999", "admin", "password"];
const OVERFLOW_EXTRA_CHARS = [1, 4];
const OVERFLOW_FILLERS = ["A", "a", "1", "0"];
const MAX_BRUTE_FORCE = 1000;
const MAX_MASTERMIND_GUESSES = 25;
const MAX_PERMUTATIONS = 200;
/** @type {Record<string, number>} */
const ROMAN_VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

/** @type {Record<string, (target: Target) => Guesses>} */
const SOLVERS = {
    "ZeroLogon": async function* () {
        yield "";
    },
    "FreshInstall_1.0": async function* ({ details }) {
        yield* COMMON_DEFAULTS.filter(password => fitsFormat(password, details));
    },
    "DeskMemo_3.1": async function* (target) {
        yield* statedPasswords(target.details);
        yield* leakedPasswords(target);
    },
    "CloudBlare(tm)": async function* ({ details }) {
        yield details.data.replace(/\D/g, "");
    },
    "PHP 5.4": async function* ({ details }) {
        yield* permutations(details.data.replace(/[^a-z0-9]/gi, ""), MAX_PERMUTATIONS);
    },
    "AccountsManager_4.2": async function* (target) {
        yield* statedPasswords(target.details);
        yield* rangePasswords(target.details);
    },
    "Pr0verFl0": async function* (target) {
        yield* statedPasswords(target.details);
        yield* overflowPasswords(target.details);
    },
    "DeepGreen": mastermindPasswords,
    "Laika4": async function* (target) {
        yield* statedPasswords(target.details);
        yield* letterCluePasswords(target);
    },
    "BellaCuore": async function* (target) {
        yield* statedPasswords(target.details);
        yield* romanPasswords(target.details);
    },
    "OctantVoxel": async function* (target) {
        yield* statedPasswords(target.details);
        yield* baseConversionPasswords(target.details);
    },
};

/**
 * Tries the model's solver, or generic hint reading for unknown models, until one password works.
 * @param {NS} ns
 * @param {string} host
 * @param {ServerDetails} details
 * @returns {Promise<{ password: string } | { failure: string }>}
 */
export async function crackPassword(ns, host, details) {
    const solver = SOLVERS[details.modelId] ?? genericPasswords;
    const guesses = solver({ ns, host, details });
    const tried = new Set();
    let lastResponse = "no guesses";
    let step = await guesses.next();

    while (!step.done) {
        const password = step.value;
        if (tried.has(password)) {
            step = await guesses.next();
            continue;
        }

        tried.add(password);
        const result = await ns.dnet.authenticate(host, password);
        if (result.success) return { password };

        lastResponse = `${result.code} ${result.message}`;
        step = await guesses.next(result);
    }

    const solverName = details.modelId in SOLVERS ? details.modelId : "generic (unknown model)";

    return { failure: `${solverName} solver tried ${tried.size} passwords; last response ${lastResponse}` };
}

/**
 * Ends with one plain guess so the failure report shows how the unknown model answers a wrong password.
 * @param {Target} target
 */
async function* genericPasswords(target) {
    const { details } = target;
    yield* statedPasswords(details);
    if (DEFAULT_PASSWORD_HINT.test(details.passwordHint)) yield* COMMON_DEFAULTS.filter(password => fitsFormat(password, details));
    yield* leakedPasswords(target);
    yield (details.passwordFormat === "numeric" ? "0" : "a").repeat(details.passwordLength);
}

/**
 * @param {string} password
 * @param {ServerDetails} details
 */
function fitsFormat(password, details) {
    if (password.length !== details.passwordLength) return false;

    return details.passwordFormat !== "numeric" || /^\d*$/.test(password);
}

/**
 * Every word in the hint and data that fits the password's length and format, e.g. "576" in "The secret is 576".
 * @param {ServerDetails} details
 */
function statedPasswords(details) {
    return `${details.passwordHint} ${details.data}`.split(WORD_SEPARATORS).filter(word => fitsFormat(word, details));
}

/** @param {Target} target */
async function* leakedPasswords({ ns, host }) {
    const leak = await ns.dnet.heartbleed(host);
    if (!leak.success) return;

    const match = leak.logs.join("\n").match(STATED_PASSWORD);
    if (match) yield match[1];
}

/** @param {ServerDetails} details */
function* rangePasswords(details) {
    const range = details.passwordHint.match(RANGE_HINT);
    const low = range ? Number(range[1]) : 0;
    const high = range ? Number(range[2]) : 10 ** details.passwordLength - 1;
    if (high - low > MAX_BRUTE_FORCE) return;

    for (let value = Math.max(0, Math.min(low, high)); value <= Math.max(low, high); value++) {
        yield String(value).padStart(details.passwordLength, "0");
    }
}

/** @param {ServerDetails} details */
function* overflowPasswords(details) {
    for (const extra of OVERFLOW_EXTRA_CHARS) {
        for (const filler of OVERFLOW_FILLERS) yield filler.repeat(details.passwordLength + extra);
    }
}

/**
 * Mastermind: each wrong guess reports exact and misplaced symbols, which narrows the candidates.
 * @param {Target} target
 * @returns {Guesses}
 */
async function* mastermindPasswords({ details }) {
    if (details.passwordFormat !== "numeric" || 10 ** details.passwordLength > MAX_BRUTE_FORCE * 100) return;

    let candidates = Array.from({ length: 10 ** details.passwordLength }, (_, value) => String(value).padStart(details.passwordLength, "0"));

    for (let guessCount = 0; guessCount < MAX_MASTERMIND_GUESSES && candidates.length > 0; guessCount++) {
        const guess = candidates[Math.floor(candidates.length / 2)];
        const feedback = mastermindFeedback(yield guess);
        if (feedback === null) return;

        candidates = candidates.filter(candidate => candidate !== guess && sameScore(mastermindScore(guess, candidate), feedback));
    }
}

/**
 * @param {AuthResult | undefined} result
 * @returns {Score | null}
 */
function mastermindFeedback(result) {
    if (result === undefined) return null;

    if (typeof result.data === "string") {
        const [exact, misplaced] = result.data.split(",").map(Number);
        if (Number.isInteger(exact) && Number.isInteger(misplaced)) return { exact, misplaced };
    }

    const match = result.message.match(MASTERMIND_FEEDBACK);

    return match ? { exact: Number(match[1]), misplaced: Number(match[2]) } : null;
}

/**
 * @param {string} guess
 * @param {string} secret
 * @returns {Score}
 */
function mastermindScore(guess, secret) {
    const unmatched = [...guess].map((_, index) => index).filter(index => guess[index] !== secret[index]);
    /** @type {Map<string, number>} */
    const secretCounts = new Map();

    for (const index of unmatched) {
        secretCounts.set(secret[index], (secretCounts.get(secret[index]) ?? 0) + 1);
    }

    let misplaced = 0;

    for (const index of unmatched) {
        const available = secretCounts.get(guess[index]) ?? 0;
        if (available === 0) continue;

        misplaced++;
        secretCounts.set(guess[index], available - 1);
    }

    return { exact: guess.length - unmatched.length, misplaced };
}

/**
 * @param {Score} a
 * @param {Score} b
 */
function sameScore(a, b) {
    return a.exact === b.exact && a.misplaced === b.misplaced;
}

/** @param {Target} target */
async function* letterCluePasswords({ ns, host, details }) {
    const leak = await ns.dnet.heartbleed(host);
    if (!leak.success) return;

    const letters = [...new Set([...leak.logs.join("\n").matchAll(LETTER_CLUE)].map(match => match[1].toLowerCase()))];
    if (letters.length === details.passwordLength) yield* permutations(letters.join(""), MAX_PERMUTATIONS);
}

/** @param {ServerDetails} details */
function* romanPasswords(details) {
    const numeral = details.data.trim() || details.passwordHint.match(ROMAN_HINT)?.[1];
    if (!numeral || !/^[IVXLCDM]+$/i.test(numeral)) return;

    const values = [...numeral.toUpperCase()].map(symbol => ROMAN_VALUES[symbol]);

    yield String(values.reduce((total, value, index) => total + (value < (values[index + 1] ?? 0) ? -value : value), 0));
}

/** @param {ServerDetails} details */
function* baseConversionPasswords(details) {
    const [base, digits] = details.data.includes(",") ? details.data.split(",").map(part => part.trim()) : (details.passwordHint.match(BASE_HINT) ?? []).slice(1);
    const radix = Number(base);
    if (!digits || radix < 2 || radix > 36) return;

    const value = Number.parseInt(digits, radix);
    if (!Number.isNaN(value)) yield String(value);
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
