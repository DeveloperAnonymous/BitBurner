import { CRACKED_FILE, report } from "/dnet/shared.js";

/**
 * @typedef {ReturnType<NS["dnet"]["getServerDetails"]>} ServerDetails
 * @typedef {Awaited<ReturnType<NS["dnet"]["authenticate"]>>} AuthResult
 * @typedef {{ ns: NS, host: string, details: ServerDetails }} Target
 * @typedef {AsyncGenerator<string, string | void, AuthResult>} Guesses A solver may return why it stopped early.
 * @typedef {(target: Target) => Guesses} Solve
 */

/**
 * Body of every solver script: cracks the neighbor in the args with the given solve, then hands the password to this
 * node's crawler through CRACKED_FILE, which deploys. Only the first try reports a failure, so retries stay quiet.
 * Args: host, goal ("crawl" | "stasis"), try number. The arg is called tryNumber because an identifier named after an
 * NS function adds that function's RAM cost.
 * @param {NS} ns
 * @param {Solve} solve
 */
export async function crack(ns, solve) {
    ns.disableLog("ALL");

    const [host, goal, tryNumber] = ns.args;
    if (typeof host !== "string" || (goal !== "crawl" && goal !== "stasis") || typeof tryNumber !== "number") {
        report(ns, "failed", `solver needs (host, "crawl" | "stasis", tryNumber), got ${JSON.stringify(ns.args)}`);

        return;
    }

    const details = ns.dnet.getServerDetails(host);
    if (!details.isOnline || !details.isConnectedToCurrentServer) return;

    const outcome = await crackPassword(ns, host, details, solve);
    if ("failure" in outcome) {
        if (tryNumber === 1) report(ns, "failed", `${host} (${details.modelId}) hint "${details.passwordHint}" data "${details.data}" length ${details.passwordLength} ${details.passwordFormat}: ${outcome.failure}`);

        return;
    }

    report(ns, "cracked", `${host} (${details.modelId}) password "${outcome.password}"`);
    ns.write(CRACKED_FILE, `${JSON.stringify({ host, goal, password: outcome.password })}\n`, "a");
}

/**
 * @param {NS} ns
 * @param {string} host
 * @param {ServerDetails} details
 * @param {Solve} solve
 * @returns {Promise<{ password: string } | { failure: string }>}
 */
async function crackPassword(ns, host, details, solve) {
    const guesses = solve({ ns, host, details });
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

        lastResponse = `${result.code} ${result.message}${result.data === undefined ? "" : ` data ${JSON.stringify(result.data)}`} (guess "${password}")`;
        step = await guesses.next(result);
    }

    const stopReason = step.value ? `; stopped: ${step.value}` : "";

    return { failure: `solver tried ${tried.size} passwords; last response ${lastResponse}${stopReason}` };
}
