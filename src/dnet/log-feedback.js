/** @typedef {import("/dnet/crack.js").Target} Target */

const STATED_PASSWORD = /(?:password|passcode|pin|code|key|secret|pw)\s*(?:is|:|=)\s*["']?([^\s"'.!,;]+)/i;
const ATTEMPT_LOG_LINES = 30;

/**
 * Feedback models leave authenticate's result bare; the hint is only in the data of the server log entry for the guess.
 * Peeks instead of removing lines, since solvers on other nodes may be reading the same server's log at the same time.
 * @param {NS} ns
 * @param {string} host
 * @param {string} guess
 * @returns {Promise<{ data: string } | { failure: string }>}
 */
export async function readAttemptData(ns, host, guess) {
    const leak = await ns.dnet.heartbleed(host, { peek: true, logsToCapture: ATTEMPT_LOG_LINES });
    if (!leak.success) return { failure: `heartbleed failed: ${leak.code} ${leak.message}` };

    const entry = leak.logs.map(parseLogEntry).find(logEntry => logEntry?.passwordAttempted === guess);
    if (typeof entry?.data !== "string") return { failure: `no data for "${guess}" in logs ${JSON.stringify(leak.logs)}` };

    return { data: entry.data };
}

/** @param {Target} target */
export async function* leakedPasswords({ ns, host }) {
    const leak = await ns.dnet.heartbleed(host, { peek: true, logsToCapture: ATTEMPT_LOG_LINES });
    if (!leak.success) return;

    const match = leak.logs.join("\n").match(STATED_PASSWORD);
    if (match) yield match[1];
}

/**
 * Password attempts are logged as JSON objects; the server's own noise lines are plain text.
 * @param {string} line
 * @returns {{ passwordAttempted?: string, data?: unknown } | null}
 */
function parseLogEntry(line) {
    if (!line.startsWith("{")) return null;

    try {
        return JSON.parse(line);
    } catch {
        return null;
    }
}
