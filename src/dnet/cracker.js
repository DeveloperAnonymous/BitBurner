import { CRAWLER_FILE as CRAWLER, CRAWLER_FILES, CRAWLER_VERSION, PHISH_FILE as PHISH, report } from "/dnet/shared.js";
import { crackPassword } from "/dnet/solvers.js";

/**
 * One-shot: cracks a neighboring node, starts the crawler there, then exits. Args: host, try number.
 * Only the first try reports a failed crack, so retries stay quiet.
 * The arg is called tryNumber because an identifier named after an NS function adds that function's RAM cost.
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");

    const [host, tryNumber] = ns.args;
    if (typeof host !== "string" || typeof tryNumber !== "number") {
        report(ns, "failed", `cracker.js needs (host, tryNumber), got ${JSON.stringify(ns.args)}`);

        return;
    }

    const details = ns.dnet.getServerDetails(host);
    if (!details.isOnline || !details.isConnectedToCurrentServer) return;

    const outcome = await crackPassword(ns, host, details);
    if ("failure" in outcome) {
        if (tryNumber === 1) report(ns, "failed", `${host} (${details.modelId}) hint "${details.passwordHint}" data "${details.data}" length ${details.passwordLength} ${details.passwordFormat}: ${outcome.failure}`);

        return;
    }

    report(ns, "cracked", `${host} (${details.modelId}) password "${outcome.password}"`);
    deployCrawler(ns, host);
}

/**
 * @param {NS} ns
 * @param {string} host
 */
function deployCrawler(ns, host) {
    ns.scriptKill(CRAWLER, host);
    ns.scriptKill(PHISH, host);
    if (!ns.scp(CRAWLER_FILES, host)) {
        report(ns, "failed", `${host}: copying crawler files failed after cracking`);

        return;
    }

    if (ns.exec(CRAWLER, host, 1, CRAWLER_VERSION) === 0) {
        report(ns, "failed", `${host}: starting crawler failed (free RAM ${ns.getServerMaxRam(host) - ns.getServerUsedRam(host)} GB)`);
    }
}
