/** @param {NS} ns
 *  Infiltration autoplayer. BEST EFFORT: written from memory of the game's UI
 *  and not yet tested against the live game, so the page selectors may need tuning.
 *
 *  Usage:  run infiltrate.js [--reward money|rep] [--delay 25] [--repeat] [--debug]
 *   --reward  what to pick on the success screen (default money)
 *   --delay   ms between simulated key presses (raise it if inputs get dropped)
 *   --repeat  also click "Infiltrate Company" again when you're back on the location page
 *   --debug   write what the script sees to the script log (use `tail infiltrate.js`)
 *
 *  Start it, then open the company's location page (or the intro screen) yourself.
 */
export async function main(ns) {
  ns.disableLog("ALL");
  const f = ns.flags([["reward", "money"], ["delay", 25], ["repeat", false], ["debug", false]]);
  const delay = Number(f.delay);
  // Looked up by string so the script isn't charged the big static RAM cost for `document`.
  const doc = globalThis["document"];
  const log = (...a) => { if (f.debug) ns.print(...a); };

  // ---------- helpers ----------
  const txt = (e) => (e.textContent || "").trim();
  const leaves = (root) => [...root.querySelectorAll("*")].filter((e) => e.children.length === 0 && txt(e));
  // the game's root = nearest ancestor of the title that also holds the countdown bar
  const rootOf = (title) => {
    let a = title;
    while (a && !a.querySelector('[role="progressbar"]')) a = a.parentElement;
    return a || doc.body;
  };
  // true if element e comes after element t in the page and isn't inside it
  const follows = (t, e) => !t.contains(e) && !!(t.compareDocumentPosition(e) & 4);
  const titleOf = (re) => [...doc.querySelectorAll("h4")].find((h) => re.test(txt(h)));

  // Some versions ignore synthetic key events (isTrusted === false). Wrap key listeners
  // registered from now on so they see the event as trusted. Applied once per page load.
  if (!doc.__bbTrustPatched) {
    doc.__bbTrustPatched = true;
    const add = doc.addEventListener.bind(doc);
    const rem = doc.removeEventListener.bind(doc);
    const map = new WeakMap();
    const trust = (e) => new Proxy(e, {
      get(t, k) {
        if (k === "isTrusted") return true;
        const v = t[k];
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    doc.addEventListener = (type, fn, opts) => {
      if (typeof fn === "function" && /^key/.test(type)) {
        const w = function (e) { return fn.call(this, trust(e)); };
        map.set(fn, w);
        return add(type, w, opts);
      }
      return add(type, fn, opts);
    };
    doc.removeEventListener = (type, fn, opts) => rem(type, map.get(fn) || fn, opts);
  }

  const CODES = { " ": "Space", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight" };
  const send = (key) => {
    const code = CODES[key] || (/^[0-9]$/.test(key) ? "Digit" + key : /^[a-z]$/i.test(key) ? "Key" + key.toUpperCase() : "");
    doc.dispatchEvent(new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true }));
  };
  const press = async (key, extra = 0) => { send(key); await ns.sleep(delay + extra); };

  const colorName = (css) => {
    const m = (css || "").match(/\d+(\.\d+)?/g);
    if (!m) return null;
    const [r, g, b] = m.map(Number);
    if (r > 200 && g > 200 && b > 200) return "white";
    if (r > 200 && g < 90 && b < 90) return "red";
    if (r > 200 && g > 140 && b < 100) return "yellow";
    if (b > 150 && r < 120) return "blue";
    return null;
  };

  // Every text node under root, with its on-screen position. Works no matter how the
  // game nests its elements (mixed text + spans etc).
  // If `after` is given, only text that comes after that element in the page (and isn't
  // inside it) is returned, which cuts out the page header and anything above the game.
  const textItems = (root, after) => {
    const w = doc.createTreeWalker(root, 4); // 4 = NodeFilter.SHOW_TEXT
    const items = [];
    for (let n; (n = w.nextNode()); ) {
      const s = (n.nodeValue || "").trim();
      if (!s) continue;
      if (after) {
        const pe = n.parentElement;
        if (!pe || after.contains(pe) || !(after.compareDocumentPosition(pe) & 4)) continue;
      }
      const rg = doc.createRange();
      rg.selectNodeContents(n);
      const r = rg.getBoundingClientRect();
      items.push({ s, top: r.top, left: r.left, el: n.parentElement });
    }
    return items;
  };
  // group those text nodes into rows of whitespace-separated tokens (top to bottom, left to right)
  const textRows = (root, after) => {
    const items = textItems(root, after).sort((a, b) => a.top - b.top || a.left - b.left);
    const rows = [];
    for (const it of items) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(last.top - it.top) < 4) last.items.push(it);
      else rows.push({ top: it.top, items: [it] });
    }
    return rows
      .map((row) => row.items.sort((a, b) => a.left - b.left)
        .flatMap((i) => i.s.split(/\s+/)).filter((tok) => !/^[✓✗]$/.test(tok)))
      .filter((r) => r.length);
  };
  // debug aid: print what the game screen contains (paste this to get selectors fixed)
  const dump = (root) => {
    for (const it of textItems(root).slice(0, 150)) {
      const c = it.el ? getComputedStyle(it.el).color : "";
      ns.print(`  <${it.el ? it.el.tagName.toLowerCase() : "?"}> "${it.s}" top=${Math.round(it.top)} left=${Math.round(it.left)} color=${c}`);
    }
  };

  // debug aid: print the element structure after the game title (tags, icons, positions)
  const dumpTree = (t) => {
    let n = 0;
    for (const e of rootOf(t).querySelectorAll("*")) {
      if (!follows(t, e)) continue;
      if (++n > 90) { ns.print("  ... (truncated)"); break; }
      const r = e.getBoundingClientRect();
      const own = [...e.childNodes].filter((c) => c.nodeType === 3).map((c) => c.nodeValue.trim()).filter(Boolean).join(" ");
      const tid = e.getAttribute("data-testid");
      ns.print(`  <${e.tagName.toLowerCase()}${tid ? " testid=" + tid : ""}> "${own}" kids=${e.children.length} top=${Math.round(r.top)} left=${Math.round(r.left)} w=${Math.round(r.width)}`);
    }
  };

  // Minesweeper cells are empty <p> elements; a mine shows as one containing an icon <svg>.
  const mineGrid = (t) => {
    const cells = [...rootOf(t).querySelectorAll("p")]
      .filter((e) => follows(t, e) && !txt(e))
      .map((e) => ({ r: e.getBoundingClientRect(), mine: !!e.querySelector("svg") }))
      .filter((c) => c.r.width >= 20 && c.r.width <= 60)
      .sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
    const rows = [];
    for (const c of cells) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(last.top - c.r.top) < 4) last.cells.push(c);
      else rows.push({ top: c.r.top, cells: [c] });
    }
    return rows.map((row) => row.cells.sort((a, b) => a.r.left - b.r.left).map((c) => c.mine));
  };

  // cursor moves use a longer pause: the game seems to need a moment between keys
  const moveTo = async (cur, x, y) => {
    while (cur.y < y) { await press("ArrowDown", 35); cur.y++; }
    while (cur.y > y) { await press("ArrowUp", 35); cur.y--; }
    while (cur.x < x) { await press("ArrowRight", 35); cur.x++; }
    while (cur.x > x) { await press("ArrowLeft", 35); cur.x--; }
  };

  const POSITIVE = new Set(["affectionate", "agreeable", "bright", "charming", "creative", "determined",
    "energetic", "friendly", "funny", "generous", "polite", "likable", "diplomatic", "helpful", "giving",
    "kind", "hardworking", "patient", "dynamic", "loyal", "straightforward"]);
  const ARROWS = { "↑": "ArrowUp", "↓": "ArrowDown", "←": "ArrowLeft", "→": "ArrowRight" };
  const CLOSE = { "<": ">", "(": ")", "[": "]", "{": "}" };

  // ---------- minigames (each plays until its title disappears or time runs out) ----------
  const GAMES = [
    { name: "bribe", re: /something nice/i, async play(t) {
      const start = Date.now();
      const end = start + 20000;
      let dumped = false;
      while (t.isConnected && Date.now() < end) {
        const words = textItems(rootOf(t), t).filter((i) => /^[a-z]+$/i.test(i.s));
        let cur = words[0];
        if (words.length > 1) {
          const colors = words.map((i) => getComputedStyle(i.el).color);
          cur = words.find((i, k) => colors.filter((c) => c === colors[k]).length === 1) || words[0];
        }
        if (!cur) {
          if (!dumped && f.debug && Date.now() - start > 300) { dumped = true; log("bribe: no word found, structure:"); dumpTree(t); }
          await ns.sleep(10);
          continue;
        }
        const w = cur.s.toLowerCase();
        log("bribe: showing", w, "(" + words.length + " words visible)");
        if (POSITIVE.has(w)) { await press(" "); break; }
        await press("ArrowDown", 20);
      }
    } },
    { name: "backward", re: /backward/i, async play(t) {
      const it = textItems(rootOf(t), t)[0];
      if (!it) { log("backward: no text found after title"); return; }
      log("backward: typing", it.s);
      // the word is drawn mirrored on screen but is typed in the order it appears in the page
      for (const ch of it.s) await press(ch);
    } },
    { name: "brackets", re: /bracket/i, async play(t) {
      const it = textItems(rootOf(t), t)[0];
      if (!it) { log("brackets: no text found after title"); return; }
      const open = [...it.s].filter((c) => CLOSE[c]);
      log("brackets: saw", it.s, "-> closing", open.slice().reverse().map((c) => CLOSE[c]).join(""));
      for (const c of open.reverse()) await press(CLOSE[c]);
    } },
    // the slash game has no heading we can match; its status line is an h4 that cycles
    // "Guarding ..." -> "Distracted!" (attack now) -> "Alerted!" (too late)
    { name: "slash", re: /^(preparing|guarding|distracted|alerted)/i, async play(t) {
      const end = Date.now() + 25000;
      while (t.isConnected && Date.now() < end) {
        const s = txt(t);
        if (/^!?(distracted|attack(ing)?)!?$/i.test(s)) { log("slash: attacking on", s); send(" "); await ns.sleep(300); break; }
        if (/^alerted/i.test(s)) break;
        await ns.sleep(3);
      }
    } },
    // The code is a row of slots: the first shows its arrow, the rest show "?". Each correct
    // press reveals the next slot while earlier slots keep their arrow, so the arrow to
    // press is always the rightmost revealed one.
    { name: "cheat code", re: /enter the code/i, async play(t) {
      await ns.sleep(60);
      const root = rootOf(t);
      const arrowItems = () => textItems(root, t).filter((i) => ARROWS[i.s]).sort((a, b) => a.left - b.left);
      log("cheat code: start", arrowItems().map((i) => i.s).join(" ") || "(none)");
      const sent = [];
      const end = Date.now() + 25000;
      while (t.isConnected && Date.now() < end) {
        const items = arrowItems();
        const cur = items[items.length - 1];
        if (!cur) { await ns.sleep(5); continue; }
        sent.push(cur.s);
        send(ARROWS[cur.s]);
        // wait until the game moves on (a new slot is revealed or the symbol changes);
        // give up after 300ms and press again
        const until = Date.now() + 300;
        while (t.isConnected && Date.now() < until) {
          await ns.sleep(6);
          const now = arrowItems();
          const last = now[now.length - 1];
          if (!last || Math.abs(last.left - cur.left) > 2 || last.s !== cur.s) break;
        }
        await ns.sleep(delay + 15);
      }
      log("cheat code: sent", sent.join(" ") || "(nothing)");
    } },
    { name: "wires", re: /cut the wires/i, async play(t) {
      await ns.sleep(50);
      const root = rootOf(t);
      const ls = leaves(root).filter((e) => follows(t, e));
      const instr = ls.map(txt).filter((s) => /^cut\b/i.test(s));
      const digits = ls.filter((e) => /^[1-9]$/.test(txt(e)))
        .map((e) => ({ n: txt(e), x: e.getBoundingClientRect().left + e.getBoundingClientRect().width / 2 }));
      if (!digits.length) { log("wires: no number row found, screen contains:"); if (f.debug) dump(root); return; }
      const spacing = digits.length > 1 ? Math.abs(digits[1].x - digits[0].x) : 20;
      const colors = {};
      for (const e of ls) {
        if (/^[1-9]$/.test(txt(e)) || /^cut\b/i.test(txt(e))) continue;
        const c = colorName(getComputedStyle(e).color);
        if (!c) continue;
        const r = e.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const col = digits.reduce((b, d) => (Math.abs(d.x - cx) < Math.abs(b.x - cx) ? d : b));
        if (Math.abs(col.x - cx) < spacing * 0.6) (colors[col.n] ||= new Set()).add(c);
      }
      const cut = new Set();
      for (const s of instr) {
        const num = s.match(/number\s*(\d)/i);
        if (num) cut.add(num[1]);
        const col = s.match(/colou?red\s+(\w+)/i);
        if (col) for (const d of digits) if (colors[d.n]?.has(col[1].toLowerCase())) cut.add(d.n);
      }
      log("wires: instructions", JSON.stringify(instr), "colors", JSON.stringify(Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, [...v]]))), "cut", [...cut]);
      for (const n of cut) await press(n);
    } },
    { name: "match symbols", re: /match the symbols/i, async play(t) {
      await ns.sleep(50);
      const root = rootOf(t);
      const rows = textRows(root, t);
      const ti = rows.findIndex((r) => /^targets/i.test(r[0] || ""));
      if (ti < 0) { log("symbols: no Targets row found, screen contains:"); if (f.debug) dump(root); return; }
      const targets = rows[ti].join(" ").replace(/^targets:?/i, "").trim().split(/\s+/).filter(Boolean);
      const grid = rows.filter((r, i) => i !== ti);
      log("symbols: targets", targets.join(","), "grid", JSON.stringify(grid));
      const cur = { x: 0, y: 0 };
      for (const target of targets) {
        let best = null;
        grid.forEach((row, y) => row.forEach((c, x) => {
          if (c !== target) return;
          const d = Math.abs(x - cur.x) + Math.abs(y - cur.y);
          if (!best || d < best.d) best = { x, y, d };
        }));
        if (!best) { log("symbols: target not found", target); continue; }
        await moveTo(cur, best.x, best.y);
        await press(" ", 35);
      }
    } },
    { name: "minesweeper", re: /(mark|remember) all the mines/i, async play() {
      let mines = null;
      const start = Date.now();
      const end = start + 60000;
      let dumped = false;
      let warned = false;
      while (Date.now() < end) {
        const t = titleOf(/mines/i);
        if (!t) break;
        const root = rootOf(t);
        if (/remember/i.test(txt(t))) {
          const g = mineGrid(t);
          if (g.length && g.flat().some(Boolean)) mines = g;
          else if (!dumped && f.debug && Date.now() - start > 500) {
            dumped = true;
            log("minesweeper: no mines visible yet, structure:");
            dumpTree(t);
          }
        } else if (!mines) {
          if (!warned) { warned = true; log("minesweeper: marking phase started but no mines were recorded"); }
        } else if (mines) {
          log("minesweeper: mines", JSON.stringify(mines));
          const cur = { x: 0, y: 0 };
          for (let y = 0; y < mines.length; y++)
            for (let x = 0; x < mines[y].length; x++)
              if (mines[y][x]) { await moveTo(cur, x, y); await press(" ", 35); }
          break;
        }
        await ns.sleep(20);
      }
    } },
  ];

  // ---------- main loop ----------
  const done = new WeakSet();
  let lastUnknown = "";
  ns.print("Infiltration autoplayer running. Open a company's infiltration screen.");

  while (true) {
    await ns.sleep(40);

    // minigame on screen?
    let handled = false;
    const h4s = [...doc.querySelectorAll("h4")];
    for (const h of h4s) {
      if (done.has(h)) continue;
      const g = GAMES.find((x) => x.re.test(txt(h)));
      if (!g) continue;
      done.add(h);
      log("game:", g.name, "|", txt(h));
      try { await g.play(h); } catch (e) { ns.print("ERROR in " + g.name + ": " + e); }
      handled = true;
      break;
    }
    if (handled) continue;

    const body = doc.body.textContent || "";
    const buttons = [...doc.querySelectorAll("button")];
    const click = (re) => {
      const b = buttons.find((x) => re.test(txt(x)));
      if (b) b.click();
      return !!b;
    };

    if (/Infiltration successful/i.test(body)) {
      click(f.reward === "rep" ? /trade|reputation/i : /sell|money|\$/i);
      await ns.sleep(600);
    } else if (/Infiltrating/i.test(body) && click(/^Start$/i)) {
      await ns.sleep(300);
    } else if (f.repeat && click(/^Infiltrate Company$/i)) {
      await ns.sleep(600);
    } else if (f.debug && doc.querySelector('[role="progressbar"]')) {
      // something is on screen that we don't recognise: log the headings so selectors can be fixed
      const heads = h4s.map(txt).join(" | ");
      if (heads && heads !== lastUnknown) { lastUnknown = heads; ns.print("unrecognised screen, h4s: " + heads); }
    }
  }
}
