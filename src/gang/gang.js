/** @param {NS} ns
 *  Main gang loop. Kept small on purpose: the expensive API calls (ascend,
 *  equipment, territory clash odds) live in the one-shot helper scripts
 *  gang-ascend.js, gang-equip.js and gang-war.js, which this script launches
 *  every so often. Keep all four files on "home".
 */
export async function main(ns) {
  ns.disableLog("ALL");

  const CFG = {
    ascendGain: 1.5,        // ascend when avg multiplier gain >= this
    minMembersToAscend: 3,
    wantedLow: 0.95,        // wanted penalty multiplier below this -> add a vigilante
    wantedHigh: 0.99,       // above this -> release a vigilante
    equipBudget: 0.5,       // fraction of home money gear may use per run
    clashChance: 0.6,       // turn territory clashes on at this min win chance (off at -0.1)
    warfareFraction: 0.34,  // fraction of members building power while clashes are off
    maxMembers: 12,
    // helper cadence, in loop ticks (~2s each)
    equipEvery: 5,  equipOffset: 2,
    ascendEvery: 15, ascendOffset: 7,
    warEvery: 20,   warOffset: 12,
  };

  const SKIP = new Set(["Unassigned", "Vigilante Justice", "Territory Warfare"]);
  let vigCount = 0;
  let tasks = null;
  let tick = 0;

  // launch a helper on this server; silently skips if there isn't enough free RAM yet
  const launch = (every, offset, script, ...args) => {
    if (tick % every === offset) ns.run(script, 1, ...args, tick);
  };

  while (true) {
    tick++;

    let info;
    try { info = ns.gang.getGangInformation(); }   // throws if not in a gang yet
    catch { await ns.sleep(5000); continue; }
    const hacking = info.isHacking;
    const h = hacking ? 1 : 0;

    // task table (cached)
    if (!tasks) {
      tasks = ns.gang.getTaskNames()
        .map(n => ns.gang.getTaskStats(n))
        .filter(t => !SKIP.has(t.name) && !t.name.startsWith("Train")
          && t.baseWanted >= 0 && (hacking ? t.isHacking : t.isCombat));
    }
    const weight = (t, m) =>
      (t.hackWeight * m.hack + t.strWeight * m.str + t.defWeight * m.def +
       t.dexWeight * m.dex + t.agiWeight * m.agi + t.chaWeight * m.cha) / 100
      - 4 * t.difficulty;

    // 1. recruit
    const names = ns.gang.getMemberNames();
    while (names.length < CFG.maxMembers) {
      let i = names.length + 1;
      while (names.includes(`g-${i}`)) i++;
      if (!ns.gang.recruitMember(`g-${i}`)) break;
      names.push(`g-${i}`);
    }

    // 2. helpers (each is a short one-shot script)
    launch(CFG.equipEvery, CFG.equipOffset, "gang-equip.js", h, CFG.equipBudget);
    if (names.length >= CFG.minMembersToAscend)
      launch(CFG.ascendEvery, CFG.ascendOffset, "gang-ascend.js", CFG.ascendGain, h);
    launch(CFG.warEvery, CFG.warOffset, "gang-war.js", CFG.clashChance, names.length);

    // 3. wanted-level controller (hysteresis, one step per cycle)
    if (info.wantedLevel <= 1.01) vigCount = 0;
    else if (info.wantedPenalty < CFG.wantedLow) vigCount++;
    else if (info.wantedPenalty > CFG.wantedHigh && vigCount > 0) vigCount--;

    // 4. territory power building: only while clashes are off and land remains
    const full = names.length >= CFG.maxMembers;
    const warfareCount = (full && info.territory < 1 && !info.territoryWarfareEngaged)
      ? Math.floor(names.length * CFG.warfareFraction) : 0;

    // 5. assign tasks: respect until the roster is full, then money
    const rows = names.map(n => {
      const m = ns.gang.getMemberInformation(n);
      let best = null, bestScore = 0;
      for (const t of tasks) {
        const w = weight(t, m);
        if (w <= 0) continue;
        const s = (full ? t.baseMoney : t.baseRespect) * w;
        if (s > bestScore) { bestScore = s; best = t.name; }
      }
      return { n, m, best, score: bestScore };
    });

    const trainTask = hacking ? "Train Hacking" : "Train Combat";
    const workers = rows.filter(r => r.best).sort((a, b) => a.score - b.score);
    vigCount = Math.min(vigCount, workers.length);
    const vigSet = new Set(workers.slice(0, vigCount).map(r => r.n));
    const warSet = new Set(workers.slice(vigCount).reverse().slice(0, warfareCount).map(r => r.n));

    for (const r of rows) {
      let task;
      if (!r.best) task = trainTask;
      else if (vigSet.has(r.n)) task = "Vigilante Justice";
      else if (warSet.has(r.n)) task = "Territory Warfare";
      else task = r.best;
      if (r.m.task !== task) ns.gang.setMemberTask(r.n, task);
    }

    ns.print(`${names.length}/${CFG.maxMembers} | penalty ${info.wantedPenalty.toFixed(3)} | ` +
             `vig ${vigCount} | war ${warfareCount} | ${full ? "money" : "respect"} mode`);

    await ns.sleep(2000);
  }
}
