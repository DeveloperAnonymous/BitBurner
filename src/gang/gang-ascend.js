/** @param {NS} ns  One-shot helper. args: [minGain, isHacking(1/0)] */
export async function main(ns) {
  const minGain = Number(ns.args[0] ?? 1.5);
  const keys = ns.args[1] ? ["hack", "cha"] : ["str", "def", "dex", "agi"];
  for (const n of ns.gang.getMemberNames()) {
    const r = ns.gang.getAscensionResult(n);
    if (!r) continue;
    const gain = Math.pow(keys.reduce((p, k) => p * r[k], 1), 1 / keys.length);
    if (gain >= minGain) ns.gang.ascendMember(n);
  }
}
