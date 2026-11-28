import { reportFailure } from "/lib/report.js";
import { REWARD_TYPES, STOP_KEY, readCityMap, runLocation, watchStopKey } from "/infiltration/lib.js";
import { loadGameModel, marketDemandPercent, quoteCity } from "/infiltration/game.js";

const DEFAULT_RUNS = 3;
const DEFAULT_MIN_DEMAND_PERCENT = 90;
const DEMAND_ROUNDING_PERCENT = 0.05;
const DEMAND_CHECK_MS = 2000;
const NOTHING_TO_DO_MS = 30000;
const FAILURE_RETRY_MS = 5000;
const USAGE = `run /infiltration/start.js [money | rep | manual] ["Faction Name"] [--runs ${DEFAULT_RUNS}] [--demand ${DEFAULT_MIN_DEMAND_PERCENT}]`;

/**
 * @typedef {import("/infiltration/game.js").GameModel} GameModel
 * @typedef {import("/infiltration/game.js").Quote} Quote
 * @typedef {import("/infiltration/lib.js").Reward} Reward
 * @typedef {import("/infiltration/lib.js").StopRequest} StopRequest
 */

/**
 * Infiltration loop for the city you stand in, until you press "p": picks the location with the best reward from
 * the game's own data, waits until market demand is back to --demand percent, runs it --runs times, then repeats.
 * money ranks by money and sells; rep ranks by reputation and trades with the named faction, or the one the game
 * preselects (the faction you work for or last traded with); manual ranks by money and waits for you to pick.
 * Locations starting at difficulty 3.5 or more are left out, since starting them hospitalises you.
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    const flags = ns.flags([["runs", DEFAULT_RUNS], ["demand", DEFAULT_MIN_DEMAND_PERCENT]]);
    const positional = /** @type {string[]} */ (flags._).map(String);
    const type = positional[0] ?? "money";
    const reward = /** @type {Reward} */ ({ type, faction: positional[1] ?? "" });
    const runs = Number(flags.runs);
    const minDemandPercent = Number(flags.demand);
    if (!REWARD_TYPES.includes(type) || !Number.isInteger(runs) || runs <= 0 || !Number.isFinite(minDemandPercent)) {
        reportFailure(ns, `bad arguments ${JSON.stringify(ns.args)}. Usage: ${USAGE}`);
        ns.tprint(`infiltration: bad arguments. Usage: ${USAGE}`);

        return;
    }

    const loaded = loadGameModel();
    if (!loaded.model) {
        reportFailure(ns, String(loaded.failure));
        ns.tprint(`infiltration: ${loaded.failure}`);

        return;
    }

    const model = loaded.model;
    const doc = globalThis["document"];
    const stopRequest = watchStopKey(ns);
    ns.print(`Infiltrating for ${type}${reward.faction ? ` (${reward.faction})` : ""}. Press "${STOP_KEY}" to stop.`);

    while (!stopRequest.pressed) {
        const map = await readCityMap(ns, doc);
        const best = map && bestLocation(model, map, type);
        if (!best) {
            reportFailure(ns, map ? `no location on the ${map.name} map can be infiltrated below difficulty 3.5; retrying` : "could not read the city map; retrying");
            await ns.sleep(NOTHING_TO_DO_MS);
            continue;
        }

        if (!await waitForDemand(ns, model, minDemandPercent, stopRequest)) break;

        ns.print(`Best: ${best.location} (${best.levels} levels, difficulty ${best.difficulty.toFixed(2)})`);
        const report = await runLocation(ns, doc, { location: best.location, runs, pauseMs: 0, reward }, stopRequest);
        if (report.ended === "failed") await ns.sleep(FAILURE_RETRY_MS);
    }

    ns.tprint("infiltration: stopped");
}

/**
 * Best location among those whose marker is on the city map.
 * @param {GameModel} model
 * @param {{ name: string, locations: string[] }} map
 * @param {string} type
 * @returns {Quote | null}
 */
function bestLocation(model, map, type) {
    const value = (/** @type {Quote} */ quote) => (type === "rep" ? quote.reputation : quote.money);
    const onMap = quoteCity(model, map.name).filter(quote => map.locations.includes(quote.location));

    return onMap.reduce((/** @type {Quote | null} */ best, quote) => (!best || value(quote) > value(best) ? quote : best), null);
}

/**
 * @param {NS} ns
 * @param {GameModel} model
 * @param {number} minDemandPercent
 * @param {StopRequest} stopRequest
 * @returns {Promise<boolean>} true once demand is high enough, false when stopped
 */
async function waitForDemand(ns, model, minDemandPercent, stopRequest) {
    let reported = false;

    while (!stopRequest.pressed) {
        const demand = marketDemandPercent(model);
        if (demand >= minDemandPercent - DEMAND_ROUNDING_PERCENT) return true;

        if (!reported) ns.print(`Market demand ${demand.toFixed(1)}%, waiting for ${minDemandPercent}%`);
        reported = true;
        await ns.sleep(DEMAND_CHECK_MS);
    }

    return false;
}
