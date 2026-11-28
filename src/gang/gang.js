import { reportFailure } from "/lib/report.js";

const CONFIG = {
    ascendGain: 1.5,
    minMembersToAscend: 3,
    wantedPenaltyLow: 0.95,
    wantedPenaltyHigh: 0.99,
    cleanWantedLevel: 1.01,
    equipBudget: 0.5,
    clashChance: 0.6,
    warfareFraction: 0.34,
    maxMembers: 12,
    notInGangSleepMs: 5000,
};

const HELPERS = {
    equip: { script: "/gang/gang-equip.js", every: 5, offset: 2 },
    ascend: { script: "/gang/gang-ascend.js", every: 15, offset: 7 },
    war: { script: "/gang/gang-war.js", every: 20, offset: 12 },
};

const VIGILANTE = "Vigilante Justice";
const WARFARE = "Territory Warfare";
const NON_EARNING_TASKS = new Set(["Unassigned", VIGILANTE, WARFARE]);
const DIFFICULTY_PENALTY = 4;

/**
 * @typedef {{ name: string, info: GangMemberInfo, bestTask: string | null, score: number }} Row
 */

/**
 * Main gang loop, one pass per gang update. The costly calls (ascend, equipment, clash odds) live in one-shot
 * helpers under /gang/ so this script stays small. Keep every file on home.
 * run /gang/gang.js
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    let tasks = null;
    let vigilantes = 0;
    let tick = 0;

    while (true) {
        if (!ns.gang.inGang()) {
            await ns.sleep(CONFIG.notInGangSleepMs);
            continue;
        }

        await ns.gang.nextUpdate();
        tick++;

        const gang = ns.gang.getGangInformation();
        tasks ??= loadEarningTasks(ns, gang.isHacking);
        const names = recruitAll(ns);
        const rosterFull = names.length >= CONFIG.maxMembers;
        launchHelpers(ns, tick, gang.isHacking, names.length);
        vigilantes = nextVigilanteCount(vigilantes, gang);
        const warriors = rosterFull && gang.territory < 1 && !gang.territoryWarfareEngaged ? Math.floor(names.length * CONFIG.warfareFraction) : 0;
        vigilantes = assignTasks(ns, { names, tasks, rosterFull, vigilantes, warriors, isHacking: gang.isHacking });

        ns.print(`${names.length}/${CONFIG.maxMembers} | penalty ${gang.wantedPenalty.toFixed(3)} | vigilantes ${vigilantes} | warfare ${warriors} | ${rosterFull ? "money" : "respect"} mode`);
    }
}

/**
 * @param {NS} ns
 * @param {boolean} isHacking
 * @returns {GangTaskStats[]}
 */
function loadEarningTasks(ns, isHacking) {
    return ns.gang.getTaskNames()
        .map(name => ns.gang.getTaskStats(name))
        .filter(task => !NON_EARNING_TASKS.has(task.name) && !task.name.startsWith("Train") && task.baseWanted >= 0 && (isHacking ? task.isHacking : task.isCombat));
}

/**
 * @param {NS} ns
 * @returns {string[]}
 */
function recruitAll(ns) {
    const names = ns.gang.getMemberNames();

    while (names.length < CONFIG.maxMembers) {
        const name = freeMemberName(names);
        if (!ns.gang.recruitMember(name)) break;

        names.push(name);
    }

    return names;
}

/** @param {string[]} names */
function freeMemberName(names) {
    let index = names.length + 1;
    while (names.includes(`g-${index}`)) index++;

    return `g-${index}`;
}

/**
 * @param {NS} ns
 * @param {number} tick
 * @param {boolean} isHacking
 * @param {number} memberCount
 */
function launchHelpers(ns, tick, isHacking, memberCount) {
    const hackingFlag = isHacking ? 1 : 0;
    const rosterFlag = memberCount >= CONFIG.maxMembers ? 1 : 0;

    launchOnTick(ns, tick, HELPERS.equip, [hackingFlag, CONFIG.equipBudget, CONFIG.ascendGain]);
    if (memberCount >= CONFIG.minMembersToAscend) launchOnTick(ns, tick, HELPERS.ascend, [CONFIG.ascendGain, hackingFlag]);
    launchOnTick(ns, tick, HELPERS.war, [CONFIG.clashChance, rosterFlag]);
}

/**
 * @param {NS} ns
 * @param {number} tick
 * @param {{ script: string, every: number, offset: number }} helper
 * @param {(string | number)[]} args
 */
function launchOnTick(ns, tick, helper, args) {
    if (tick % helper.every !== helper.offset) return;

    // The tick is passed as a last arg so a still-running copy never blocks the launch as a duplicate.
    if (ns.run(helper.script, 1, ...args, tick) !== 0) return;

    const needed = ns.getScriptRam(helper.script, "home");
    const free = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
    reportFailure(ns, `could not start ${helper.script}: needs ${needed.toFixed(2)} GB, home has ${free.toFixed(2)} GB free`);
}

/**
 * Adds one vigilante while the wanted penalty is too high and removes one once it recovers.
 * @param {number} current
 * @param {GangGenInfo} gang
 */
function nextVigilanteCount(current, gang) {
    if (gang.wantedLevel <= CONFIG.cleanWantedLevel) return 0;
    if (gang.wantedPenalty < CONFIG.wantedPenaltyLow) return current + 1;
    if (gang.wantedPenalty > CONFIG.wantedPenaltyHigh && current > 0) return current - 1;

    return current;
}

/**
 * Weakest earners go vigilante, strongest build territory power, the rest take their best task.
 * @param {NS} ns
 * @param {{ names: string[], tasks: GangTaskStats[], rosterFull: boolean, vigilantes: number, warriors: number, isHacking: boolean }} plan
 * @returns {number} vigilantes actually assigned
 */
function assignTasks(ns, plan) {
    const rows = plan.names.map(name => scoreMember(ns, name, plan.tasks, plan.rosterFull));
    const earners = rows.filter(row => row.bestTask).sort((a, b) => a.score - b.score);
    const vigilantes = Math.min(plan.vigilantes, earners.length);
    const vigilanteNames = new Set(earners.slice(0, vigilantes).map(row => row.name));
    const warriorNames = new Set(earners.slice(vigilantes).reverse().slice(0, plan.warriors).map(row => row.name));
    const trainTask = plan.isHacking ? "Train Hacking" : "Train Combat";

    for (const row of rows) {
        const task = pickTask(row, vigilanteNames, warriorNames, trainTask);
        if (row.info.task !== task) ns.gang.setMemberTask(row.name, task);
    }

    return vigilantes;
}

/**
 * @param {Row} row
 * @param {Set<string>} vigilanteNames
 * @param {Set<string>} warriorNames
 * @param {string} trainTask
 */
function pickTask(row, vigilanteNames, warriorNames, trainTask) {
    if (!row.bestTask) return trainTask;
    if (vigilanteNames.has(row.name)) return VIGILANTE;
    if (warriorNames.has(row.name)) return WARFARE;

    return row.bestTask;
}

/**
 * Best task by money once the roster is full, by respect before that.
 * @param {NS} ns
 * @param {string} name
 * @param {GangTaskStats[]} tasks
 * @param {boolean} rosterFull
 * @returns {Row}
 */
function scoreMember(ns, name, tasks, rosterFull) {
    const info = ns.gang.getMemberInformation(name);
    let bestTask = null;
    let score = 0;

    for (const task of tasks) {
        const fit = taskFit(task, info);
        const value = fit > 0 ? (rosterFull ? task.baseMoney : task.baseRespect) * fit : 0;
        if (value <= score) continue;

        score = value;
        bestTask = task.name;
    }

    return { name, info, bestTask, score };
}

/**
 * @param {GangTaskStats} task
 * @param {GangMemberInfo} member
 */
function taskFit(task, member) {
    const weighted = task.hackWeight * member.hack + task.strWeight * member.str + task.defWeight * member.def
        + task.dexWeight * member.dex + task.agiWeight * member.agi + task.chaWeight * member.cha;

    return weighted / 100 - DIFFICULTY_PENALTY * task.difficulty;
}
