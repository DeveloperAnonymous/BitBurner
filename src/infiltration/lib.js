import { reportFailure } from "/lib/report.js";

export const STOP_KEY = "p";
export const REWARD_TYPES = ["money", "rep", "manual"];

const MAX_STARTING_DIFFICULTY = 3.5;
const PAGE_SETTLE_MS = 300;
const STAGE_SETTLE_MS = 50;
const POLL_MS = 15;
const PLAYER_POLL_MS = 200;
const RUN_TIMEOUT_MS = 60000;

/**
 * @typedef {{ pressed: boolean }} StopRequest
 * @typedef {{ type: "money" | "rep" | "manual", faction: string }} Reward faction empty keeps the game's preselected one
 * @typedef {{ location: string, runs: number, pauseMs: number, reward: Reward }} RunPlan
 * @typedef {{ sales: string[], ended: "done" | "stopped" | "skipped" | "failed" }} RunReport
 * @typedef {{ sale?: string, skipped?: string, failure?: string, stopped?: boolean }} Outcome
 */

/**
 * Listens on window in the capture phase and stops the key there, so the game's own keydown handler never sees it
 * and cannot count it as a wrong minigame answer.
 * @param {NS} ns
 * @returns {StopRequest}
 */
export function watchStopKey(ns) {
    const win = globalThis["window"];
    const stopRequest = { pressed: false };
    const onKeyDown = (/** @type {KeyboardEvent} */ event) => {
        if (event.key !== STOP_KEY || event.ctrlKey || event.altKey || event.metaKey) return;

        event.stopImmediatePropagation();
        event.preventDefault();
        stopRequest.pressed = true;
    };
    win.addEventListener("keydown", onKeyDown, true);
    ns.atExit(() => win.removeEventListener("keydown", onKeyDown, true));

    return stopRequest;
}

/**
 * Opens the City page and reads which city is shown and the names of the locations on its map.
 * @param {NS} ns
 * @param {Document} doc
 * @returns {Promise<{ name: string, locations: string[] } | null>}
 */
export async function readCityMap(ns, doc) {
    findLeafWithText(doc, "City")?.click();
    await ns.sleep(PAGE_SETTLE_MS);

    const marker = [...doc.querySelectorAll("[aria-label]")].find(element => String(element.className).includes("location"));
    const city = marker && findPropUpwards(marker, props => Array.isArray(props.city?.locations))?.city;
    if (!city) return null;

    return { name: String(city.name), locations: city.locations.map(String) };
}

/**
 * Runs one location up to plan.runs times, pausing between runs.
 * @param {NS} ns
 * @param {Document} doc
 * @param {RunPlan} plan
 * @param {StopRequest} stopRequest
 * @returns {Promise<RunReport>}
 */
export async function runLocation(ns, doc, plan, stopRequest) {
    const sales = [];

    for (let i = 0; i < plan.runs; i++) {
        if (stopRequest.pressed) return { sales, ended: "stopped" };

        const outcome = await infiltrateOnce(ns, doc, plan.location, plan.reward, stopRequest);
        const ended = endOf(ns, plan, i, outcome);
        if (ended) return { sales, ended };

        sales.push(String(outcome.sale));
        ns.print(`${plan.location} ${i + 1}/${plan.runs}: ${outcome.sale}`);
        if (i + 1 < plan.runs) await ns.sleep(plan.pauseMs);
    }

    return { sales, ended: "done" };
}

/**
 * @param {NS} ns
 * @param {RunPlan} plan
 * @param {number} index
 * @param {Outcome} outcome
 * @returns {RunReport["ended"] | null} null when the run sold or traded and the loop should continue
 */
function endOf(ns, plan, index, outcome) {
    if (outcome.stopped) {
        ns.print(`Stopped by "${STOP_KEY}" during ${plan.location} run ${index + 1}/${plan.runs}`);

        return "stopped";
    }

    if (outcome.skipped) {
        ns.print(`Skipped ${plan.location}: ${outcome.skipped}`);

        return "skipped";
    }

    if (outcome.failure) {
        reportFailure(ns, `${plan.location} run ${index + 1}/${plan.runs}: ${outcome.failure}`);

        return "failed";
    }

    return null;
}

/**
 * @param {NS} ns
 * @param {Document} doc
 * @param {string} location
 * @param {Reward} reward
 * @param {StopRequest} stopRequest
 * @returns {Promise<Outcome>}
 */
async function infiltrateOnce(ns, doc, location, reward, stopRequest) {
    const opened = await openIntro(ns, doc, location);
    if (!opened.state) return opened;

    const state = opened.state;
    pressButton(opened.start);
    const outcome = await clearAllStages(ns, state, stopRequest);
    if (outcome === "stopped") {
        state.cancel();

        return { stopped: true };
    }

    if (outcome === "failed") return { failure: `stopped at level ${state.level}/${state.maxLevel}, results "${state.results}"` };

    await ns.sleep(PAGE_SETTLE_MS);
    if (reward.type === "manual") return await waitForPlayerChoice(ns, doc, stopRequest);

    return reward.type === "rep" ? await tradeForReputation(ns, doc, reward.faction) : await sellForMoney(ns, doc);
}

/**
 * Starting at difficulty MAX_STARTING_DIFFICULTY or more hospitalises the player on Start, so those are cancelled.
 * @param {NS} ns
 * @param {Document} doc
 * @param {string} location
 * @returns {Promise<{ state?: any, start?: HTMLButtonElement, skipped?: string, failure?: string }>}
 */
async function openIntro(ns, doc, location) {
    findLeafWithText(doc, "City")?.click();
    await ns.sleep(PAGE_SETTLE_MS);

    const marker = [...doc.querySelectorAll("[aria-label]")].find(element => element.getAttribute("aria-label") === location);
    if (!marker) return { failure: `${location} is not on this city's map` };

    marker.click();
    await ns.sleep(PAGE_SETTLE_MS);

    const infiltrateButton = findButton(doc, /^Infiltrate Company$/);
    if (!infiltrateButton) return { skipped: "no Infiltrate Company button" };

    pressButton(infiltrateButton);
    await ns.sleep(PAGE_SETTLE_MS);

    const start = findButton(doc, /^Start$/);
    if (!start) return { failure: "no Start button on the intro screen" };

    const state = findInfiltrationState(start);
    if (!state) {
        pressButton(findButton(doc, /^Cancel$/));

        return { failure: "infiltration state not found" };
    }

    if (state.startingDifficulty >= MAX_STARTING_DIFFICULTY) {
        pressButton(findButton(doc, /^Cancel$/));

        return { skipped: `starting difficulty ${state.startingDifficulty.toFixed(2)} is ${MAX_STARTING_DIFFICULTY} or more` };
    }

    return { state, start };
}

/**
 * @param {NS} ns
 * @param {any} state
 * @param {StopRequest} stopRequest
 * @returns {Promise<"cleared" | "failed" | "stopped">}
 */
async function clearAllStages(ns, state, stopRequest) {
    let lastStage = null;
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (stopRequest.pressed) return "stopped";
        if (state.results.includes("✗")) return "failed";
        if (state.results.length >= state.maxLevel) return "cleared";

        const stage = state.stage;
        if (stage !== lastStage && isMinigame(stage)) {
            lastStage = stage;
            await ns.sleep(STAGE_SETTLE_MS);
            if (state.stage === stage) state.onSuccess();
        }

        await ns.sleep(POLL_MS);
    }

    return "failed";
}

/** Countdown stages carry a count; intro and victory stages have no fields. */
function isMinigame(stage) {
    return !("count" in stage) && Object.keys(stage).length > 0;
}

/**
 * Holds on the victory screen until the player picks Sell, Trade or Quit themselves.
 * @param {NS} ns
 * @param {Document} doc
 * @param {StopRequest} stopRequest
 * @returns {Promise<Outcome>}
 */
async function waitForPlayerChoice(ns, doc, stopRequest) {
    ns.print("Waiting for you to pick a reward");

    while (findButton(doc, /^Sell/i)) {
        if (stopRequest.pressed) return { stopped: true };

        await ns.sleep(PLAYER_POLL_MS);
    }

    return { sale: "reward picked by you" };
}

/**
 * @param {NS} ns
 * @param {Document} doc
 * @returns {Promise<Outcome>}
 */
async function sellForMoney(ns, doc) {
    const sell = findButton(doc, /^Sell/i);
    if (!sell) return { failure: "no Sell button on the victory screen" };

    const sale = sell.textContent.trim();
    pressButton(sell);
    await ns.sleep(PAGE_SETTLE_MS);

    return { sale };
}

/**
 * @param {NS} ns
 * @param {Document} doc
 * @param {string} faction empty keeps the faction the game preselected
 * @returns {Promise<Outcome>}
 */
async function tradeForReputation(ns, doc, faction) {
    const select = doc.querySelector(".MuiSelect-select");
    const selectProps = select && findPropUpwards(select, props => typeof props.onChange === "function" && "value" in props);
    if (!selectProps) return { failure: "no faction dropdown on the victory screen" };

    if (faction) {
        selectProps.onChange({ target: { value: faction } });
        await ns.sleep(PAGE_SETTLE_MS);
    }

    const chosen = faction || String(selectProps.value);
    const trade = findButton(doc, /^Trade for/i);
    if (!trade || trade.disabled) return { failure: `cannot trade for "${chosen}" reputation (no faction picked, not a member, or it offers no work)` };

    const sale = `${trade.textContent.trim()} with ${chosen}`;
    pressButton(trade);
    await ns.sleep(PAGE_SETTLE_MS);

    return { sale };
}

/**
 * @param {Element} element
 * @param {(props: any) => boolean} matches
 */
function findPropUpwards(element, matches) {
    let fiber = element[Object.keys(element).find(key => key.startsWith("__reactFiber"))];
    while (fiber && !(fiber.memoizedProps && matches(fiber.memoizedProps))) fiber = fiber.return;

    return fiber?.memoizedProps ?? null;
}

/**
 * Walks React fibers up from an element inside the infiltration page to the game's Infiltration object.
 * @param {Element} element
 */
function findInfiltrationState(element) {
    let fiber = element[Object.keys(element).find(key => key.startsWith("__reactFiber"))];
    while (fiber) {
        if (isInfiltrationState(fiber.memoizedProps?.state)) return fiber.memoizedProps.state;

        const fromHooks = findStateInHooks(fiber.memoizedState);
        if (fromHooks) return fromHooks;

        fiber = fiber.return;
    }

    return null;
}

function findStateInHooks(hook) {
    while (hook && typeof hook === "object" && "next" in hook) {
        const values = Array.isArray(hook.memoizedState) ? hook.memoizedState.flat() : [hook.memoizedState];
        const state = values.find(isInfiltrationState);
        if (state) return state;

        hook = hook.next;
    }

    return null;
}

function isInfiltrationState(value) {
    return Boolean(value) && typeof value === "object" && typeof value.onSuccess === "function" && "stage" in value;
}

/**
 * Calls the button's React click handler with a trusted-looking event, since the game ignores untrusted DOM clicks.
 * @param {Element} button
 */
function pressButton(button) {
    button[Object.keys(button).find(key => key.startsWith("__reactProps"))].onClick({ isTrusted: true });
}

/**
 * @param {Document} doc
 * @param {RegExp} pattern
 * @returns {HTMLButtonElement | undefined}
 */
function findButton(doc, pattern) {
    return [...doc.querySelectorAll("button")].find(button => pattern.test(button.textContent.trim()));
}

/**
 * @param {Document} doc
 * @param {string} text
 * @returns {HTMLElement | undefined}
 */
function findLeafWithText(doc, text) {
    return [...doc.querySelectorAll("p,span,div")].find(element => element.children.length === 0 && element.textContent.trim() === text);
}
