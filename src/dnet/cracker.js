import { CRACKER_FILE as CRACKER, CRAWLER_FILE as CRAWLER, CRAWLER_FILES, CRAWLER_VERSION, PHISH_FILE as PHISH, STASIS_FILE, report } from "/dnet/shared.js";
import { crackPassword } from "/dnet/solvers.js";

/** @type {Record<import("/dnet/shared.js").CrackGoal, (ns: NS, host: string) => void>} */
const DEPLOYERS = {
    crawl: deployCrawler,
    stasis: deployStasis,
};

/**
 * One-shot: cracks a neighboring node, then starts the crawler there or stasis-links it, and exits.
 * Args: host, goal ("crawl" | "stasis"), try number. Only the first try reports a failed crack, so retries stay quiet.
 * The arg is called tryNumber because an identifier named after an NS function adds that function's RAM cost.
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");

    const [host, goal, tryNumber] = ns.args;
    if (typeof host !== "string" || (goal !== "crawl" && goal !== "stasis") || typeof tryNumber !== "number") {
        report(ns, "failed", `cracker.js needs (host, "crawl" | "stasis", tryNumber), got ${JSON.stringify(ns.args)}`);

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
    DEPLOYERS[goal](ns, host);
}

/**
 * @param {NS} ns
 * @param {string} host
 */
function deployCrawler(ns, host) {
    clearNode(ns, host);
    if (!ns.scp(CRAWLER_FILES, host)) {
        report(ns, "failed", `${host}: copying crawler files failed after cracking`);

        return;
    }

    if (ns.exec(CRAWLER, host, 1, CRAWLER_VERSION) === 0) {
        report(ns, "failed", `${host}: starting crawler failed (free RAM ${ns.getServerMaxRam(host) - ns.getServerUsedRam(host)} GB)`);
    }
}

/**
 * Clears the node so setStasisLink's 12 GB fits; neighboring crawlers redeploy the crawler once stasis.js exits.
 * @param {NS} ns
 * @param {string} host
 */
function deployStasis(ns, host) {
    clearNode(ns, host);
    if (!ns.scp([STASIS_FILE, "dnet/shared.js"], host)) {
        report(ns, "failed", `${host}: copying ${STASIS_FILE} failed after cracking`);

        return;
    }

    if (ns.exec(STASIS_FILE, host) === 0) {
        report(ns, "failed", `${host}: starting ${STASIS_FILE} failed (free RAM ${ns.getServerMaxRam(host) - ns.getServerUsedRam(host)} GB)`);
    }
}

/**
 * @param {NS} ns
 * @param {string} host
 */
function clearNode(ns, host) {
    for (const script of [CRAWLER, CRACKER, PHISH]) ns.scriptKill(script, host);
}
