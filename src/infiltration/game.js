/**
 * Reads infiltration data straight from the game's own webpack modules. Exports are minified and module ids change
 * between game builds, so every module and function is found by a signature in its source, not by name.
 */

const MAX_STARTING_DIFFICULTY = 3.5;

const SIGNATURES = {
    locations: "infiltrationData",
    gameFormulas: "lastChangeTimestamp",
    victoryFormulas: "WKSharmonizer",
    demand: "-.001*",
    difficulty: "skills.strength+",
    reward: "465",
    cash: "3e3",
    reputation: "1.005",
};

/**
 * @typedef {{ name: string, city: string, infiltrationData?: { maxClearanceLevel: number, startingSecurityLevel: number } }} GameLocation
 * @typedef {{
 *   locations: GameLocation[],
 *   demand: (timestamp: number) => number,
 *   difficulty: (startingSecurityLevel: number) => number,
 *   reward: (startingSecurityLevel: number) => number,
 *   cash: (reward: number, maxLevel: number, startingSecurityLevel: number, timestamp: number) => number,
 *   reputation: (reward: number, maxLevel: number, startingSecurityLevel: number, timestamp: number) => number,
 * }} GameModel
 * @typedef {{ location: string, money: number, reputation: number, levels: number, difficulty: number }} Quote
 */

/**
 * @returns {{ model?: GameModel, failure?: string }}
 */
export function loadGameModel() {
    const require = webpackRequire();
    if (!require) return { failure: "webpack module registry not found on window" };

    const locationTable = findExport(require, SIGNATURES.locations, value => isLocationTable(value));
    const gameFormulas = exportsWith(require, SIGNATURES.gameFormulas, SIGNATURES.demand, SIGNATURES.reward);
    const victoryFormulas = exportsWith(require, SIGNATURES.victoryFormulas, SIGNATURES.cash, SIGNATURES.reputation);
    const model = {
        locations: locationTable ? Object.values(locationTable) : null,
        demand: functionWith(gameFormulas, SIGNATURES.demand),
        difficulty: functionWith(gameFormulas, SIGNATURES.difficulty),
        reward: functionWith(gameFormulas, SIGNATURES.reward),
        cash: functionWith(victoryFormulas, SIGNATURES.cash),
        reputation: functionWith(victoryFormulas, SIGNATURES.reputation),
    };
    const missing = Object.entries(model).filter(([, value]) => !value).map(([key]) => key);
    if (missing.length) return { failure: `game internals not found: ${missing.join(", ")}` };

    return { model: /** @type {GameModel} */ (model) };
}

/**
 * Rewards right now for every location in the city that can be infiltrated without being hospitalised on start.
 * @param {GameModel} model
 * @param {string} city
 * @returns {Quote[]}
 */
export function quoteCity(model, city) {
    const now = Date.now();

    return model.locations
        .filter(location => location.city === city && location.infiltrationData)
        .map(location => quote(model, location, now))
        .filter(entry => entry.difficulty < MAX_STARTING_DIFFICULTY);
}

/**
 * @param {GameModel} model
 * @returns {number}
 */
export function marketDemandPercent(model) {
    return model.demand(Date.now()) * 100;
}

/**
 * @param {GameModel} model
 * @param {GameLocation} location
 * @param {number} now
 * @returns {Quote}
 */
function quote(model, location, now) {
    const { maxClearanceLevel, startingSecurityLevel } = /** @type {NonNullable<GameLocation["infiltrationData"]>} */ (location.infiltrationData);
    const reward = model.reward(startingSecurityLevel);

    return {
        location: location.name,
        money: model.cash(reward, maxClearanceLevel, startingSecurityLevel, now),
        reputation: model.reputation(reward, maxClearanceLevel, startingSecurityLevel, now),
        levels: maxClearanceLevel,
        difficulty: model.difficulty(startingSecurityLevel),
    };
}

/** @returns {((id: string) => any) & { m: Record<string, Function> } | null} */
function webpackRequire() {
    const chunks = globalThis["window"].webpackChunkbitburner;
    if (!chunks) return null;

    let require = null;
    chunks.push([[Symbol("infiltration")], {}, found => { require = found; }]);

    return require;
}

/**
 * Exports of the first loaded module whose source contains every signature. Only modules matching the source text
 * are required, so no unrelated module gets executed.
 * @param {any} require
 * @param {...string} signatures
 */
function exportsWith(require, ...signatures) {
    const id = Object.keys(require.m).find(key => signatures.every(signature => String(require.m[key]).includes(signature)));

    return id === undefined ? null : require(id);
}

/**
 * @param {any} require
 * @param {string} signature
 * @param {(value: any) => boolean} matches
 */
function findExport(require, signature, matches) {
    const ids = Object.keys(require.m).filter(key => String(require.m[key]).includes(signature));

    for (const id of ids) {
        const found = Object.values(require(id) ?? {}).find(value => matches(value));
        if (found) return found;
    }

    return null;
}

/** @param {any} value */
function isLocationTable(value) {
    return Boolean(value) && typeof value === "object" && Object.values(value).some(location => location?.infiltrationData?.startingSecurityLevel);
}

/**
 * @param {Record<string, any> | null} moduleExports
 * @param {string} signature
 * @returns {Function | null}
 */
function functionWith(moduleExports, signature) {
    return Object.values(moduleExports ?? {}).find(value => typeof value === "function" && String(value).includes(signature)) ?? null;
}
