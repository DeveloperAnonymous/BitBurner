import { reportFailure } from "/lib/report.js";

const DEFAULT_LOCATION = "Omega Software";
const DEFAULT_RUNS = 1;
const PAGE_SETTLE_MS = 300;
const STAGE_SETTLE_MS = 50;
const POLL_MS = 15;
const RUN_TIMEOUT_MS = 60000;
const STOP_KEY = "p";

/**
 * Speedruns an infiltration by calling the game's own success handler on every minigame, then sells for money.
 * Stand in the location's city first. Locations at starting difficulty 3.5 or more cannot be started.
 * Press "p" to cancel the current infiltration and stop.
 * run /infiltrate.js ["Location Name"] [runs]
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    const location = String(ns.args[0] ?? DEFAULT_LOCATION);
    const runs = Number(ns.args[1] ?? DEFAULT_RUNS);
    if (!Number.isInteger(runs) || runs <= 0) {
        reportFailure(ns, `usage run /infiltrate.js ["Location Name"] [runs], got ${JSON.stringify(ns.args)}`);

        return;
    }

    const doc = globalThis["document"];
    const stopRequest = watchStopKey(ns);
    const sales = [];

    for (let i = 0; i < runs && !stopRequest.pressed; i++) {
        const outcome = await infiltrateOnce(ns, doc, location, stopRequest);
        if (outcome.stopped) {
            ns.print(`Stopped by "${STOP_KEY}" during run ${i + 1}/${runs}`);
            break;
        }

        if (outcome.failure) {
            reportFailure(ns, `run ${i + 1}/${runs} at ${location}: ${outcome.failure}`);
            break;
        }

        sales.push(outcome.sale);
        ns.print(`${location} ${i + 1}/${runs}: ${outcome.sale}`);
    }

    ns.tprint(`infiltrate.js: ${sales.length}/${runs} runs at ${location}. ${sales.join(", ")}`);
}

/**
 * Listens on window in the capture phase and stops the key there, so the game's own keydown handler never sees it
 * and cannot count it as a wrong minigame answer.
 * @param {NS} ns
 * @returns {{ pressed: boolean }}
 */
function watchStopKey(ns) {
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
 * @param {NS} ns
 * @param {Document} doc
 * @param {string} location
 * @param {{ pressed: boolean }} stopRequest
 * @returns {Promise<{ sale?: string, failure?: string, stopped?: boolean }>}
 */
async function infiltrateOnce(ns, doc, location, stopRequest) {
    const opened = await openIntro(ns, doc, location);
    if (opened.failure) return opened;

    const state = opened.state;
    pressButton(opened.start);
    const outcome = await clearAllStages(ns, state, stopRequest);
    if (outcome === "stopped") {
        state.cancel();

        return { stopped: true };
    }

    if (outcome === "failed") return { failure: `stopped at level ${state.level}/${state.maxLevel}, results "${state.results}"` };

    await ns.sleep(PAGE_SETTLE_MS);
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
 * @param {string} location
 * @returns {Promise<{ state?: any, start?: HTMLButtonElement, failure?: string }>}
 */
async function openIntro(ns, doc, location) {
    findLeafWithText(doc, "City")?.click();
    await ns.sleep(PAGE_SETTLE_MS);

    const marker = [...doc.querySelectorAll("[aria-label]")].find(element => element.getAttribute("aria-label") === location);
    if (!marker) return { failure: `${location} is not on this city's map` };

    marker.click();
    await ns.sleep(PAGE_SETTLE_MS);

    const infiltrateButton = findButton(doc, /^Infiltrate Company$/);
    if (!infiltrateButton) return { failure: "no Infiltrate Company button" };

    pressButton(infiltrateButton);
    await ns.sleep(PAGE_SETTLE_MS);

    const start = findButton(doc, /^Start$/);
    if (!start) return { failure: "no Start button on the intro screen" };

    const state = findInfiltrationState(start);
    if (start.disabled || !state) {
        pressButton(findButton(doc, /^Cancel$/));

        return { failure: start.disabled ? "Start is disabled, location too heavily guarded" : "infiltration state not found" };
    }

    return { state, start };
}

/**
 * @param {NS} ns
 * @param {any} state
 * @param {{ pressed: boolean }} stopRequest
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
