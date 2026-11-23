# Bitburner scripts

Scripts for the game Bitburner (bitburner-official/bitburner-src). Target version: 3.0.1 (stable as of 2026-05-17). The only local save is from 2.8.1, so confirm the user's installed version before using 3.x-only names such as `ns.cloud.*`. Plain JavaScript (NS2), synced to the game's `home` server.

## Hard limits

- Claude cannot run the game. The user runs scripts in the game terminal and pastes the output back. Never claim a script works.
- With every new or changed script, give the exact terminal command (`run /path/script.js -t N arg1 arg2`) and the expected RAM cost.
- Never guess an `ns` function signature or RAM cost. Read the docs first (see Docs).

## Version and API changes

- Game 3.0.0 (2026-05-01) removed NS1 `.script` support, the API server, and many old API names. 3.0.1 changed `getServer`'s return type and renamed `getServerAuthDetails`.
- Renames seen in the changelog: `setAutoJobAssignment` to `setJobAssignment`, `gang.getOtherGangInformation` to `getAllGangInformation`, purchased-server functions moved to `ns.cloud.*`, stock API names standardized. Check exact names in the docs before use.
- The game writes `APIBreakInfo-3.0.0.txt` listing what affected the user's scripts. Read it if the user provides it.
- Nuke and port-cracking functions return `false` instead of throwing. Some functions now throw on an invalid server.
- Most online examples and the legacy code in `..\old\` target 2.x or older. Verify every function against the 3.x docs.

## Script format

- Files are `.js`, one `export async function main(ns)` per entry point. Start with `/** @param {NS} ns */`.
- The game also runs `.ts`, `.jsx` and `.tsx`, but `bitburnerSync.fileExtensions` is `[".js"]`, so other files are never pushed. Use plain `.js` unless the user adds extensions there.
- Arguments come from `ns.args`. `kill`, `tail` and `check` by filename match a running script only when the args are identical in order and type.

## Rules that freeze or break the game

- Every loop that can run indefinitely, not only `while (true)`, must reach an `await` (normally `await ns.sleep(ms)`) or a `break` on every iteration path. An `await` hidden behind an `if` is not enough. Otherwise the game freezes. The in-game editor flags this. `// @ignore-infinite` above the loop suppresses the warning and is only for loops that await something else.
- Await every async `ns` function (`hack`, `grow`, `weaken`, `sleep`, and so on). Two un-awaited ns calls running at once in the same script throw an error.
- `ns.asleep` is the sleep that does not block concurrent calls.

## RAM

- Cost is static: the game scans the source and sums every `ns.*` function referenced anywhere in the file and its imports, whether or not the code path runs. Base cost is 1.6 GB per script, multiplied by thread count.
- The scanner matches identifier names. Keep names that equal ns functions (`hack`, `scan`, `exec`, and so on) off your own variables and properties.
- Do not access `ns` dynamically (`ns[name]`). The cost is not tracked reliably. Use `ns.ramOverride(ram)` as the first statement of `main` only when it is truly needed.
- `window` and `document` cost 25 GB each. Avoid them. `ns.dynamicImport` does not add the imported file's cost, so pair it with `ramOverride`.
- Importing a module adds the cost of the functions it uses. Whole-module imports (`import *`, default imports) depend on everything in the module. Keep shared helpers small, split by concern, and use named imports.
- Keep hack/grow/weaken worker scripts tiny: one ns call, one file, no helper imports.
- Singularity needs Source-File 4 outside BitNode 4. Its RAM cost is x16 / x4 / x1 at SF4 level 1 / 2 / 3. Say so when proposing it.
- Check cost with `mem /path/script.js` in the terminal or `ns.getScriptRam()`.

## Files and imports

- Use root-absolute paths with a leading slash everywhere: `import { x } from "/lib/x.js"`, `ns.exec("/workers/hack.js", ...)`. Always include the `.js` extension.
- All game scripts live in `src\`. The plugin's `bitburnerSync.syncDirectory` is `src`, so `src\lib\x.js` here is `/lib/x.js` on `home`, and files pulled from the game land in `src\`. Keep the layout shallow.
- Nothing outside `src\` reaches the game. Project files (`CLAUDE.md`, `tsconfig.json`, the `.d.ts` files) stay in the root.
- `..\old\` (a copy of alainbryden's bitburner-scripts, plus a `magic/` folder) is read-only reference code. Do not edit it and do not copy it blindly: it may use removed APIs and uses imports without a leading slash.

## Sync workflow

- Sync uses the VS Code extension `FicocelliGuy.bitburner-file-sync-plugin` (listed in the dev-branch Remote API docs, not yet in stable) over the game's Remote API (the old API server and `bitburner.authToken` were removed in game 3.0.0). Settings are `bitburnerSync.*` in `.vscode/settings.json` (port 12525, target `home`, sync directory `src`, only `.js` files, auto sync on save, server starts with VS Code).
- In the game the user connects by hand: Options, Remote API, hostname `localhost`, port `12525`, Connect. The connection drops when the machine sleeps and needs a reconnect.
- Remote API methods include `pushFile`, `getFile`, `deleteFile`, `getAllFiles`, `calculateRam` and `getDefinitionFile`.
- `.vscode/settings.json` is gitignored. Do not add secrets to it.

## Types

- `tsconfig.json` is the single editor config (the plugin also manages it, merging only missing keys). It turns on `checkJs` and `strict`, and its `paths` resolve root-absolute imports like `/lib/x.js` to `src\lib\x.js`. It checks only `src\`. Keep it strict JSON (no comments or trailing commas) or the plugin refuses to merge.
- `NetscriptDefinitions.d.ts` and `NetscriptGlobals.d.ts` (global `NS` type) sit in the root. On connect, or with "Bitburner: Download Type Definitions", the plugin downloads the definitions from the running game and regenerates the globals, so they are gitignored. Do not edit them. The current copy is only the `stable`-branch seed until the first connect.
- After the first connect, `NetscriptDefinitions.d.ts` is the authority on which API names exist in the user's installed game version.
- Editor type errors do not prove the game accepts the script, and a clean check does not prove the RAM cost.

## Docs

Consult before writing any ns call:

- NS API (per-function pages with signatures and RAM): https://github.com/bitburner-official/bitburner-src/blob/stable/markdown/bitburner.ns.md
- Guides: https://github.com/bitburner-official/bitburner-src/tree/stable/src/Documentation/doc/en (basic, programming, advanced, migrations)
- Remote API: https://github.com/bitburner-official/bitburner-src/blob/stable/src/Documentation/doc/en/programming/remote_api.md
- Changelog: https://github.com/bitburner-official/bitburner-src/blob/stable/src/Documentation/doc/en/changelog.md
- Namespaces with spoiler functions (`singularity`, `corporation`, `gang`, `bladeburner`, `sleeve`, `stanek`, `grafting`, `hacknet`) require the matching unlock in the user's save. Ask what is unlocked if unsure.

## Code rules

- No silent fallbacks. Let errors throw. No default values for required data, no catch-and-continue, no "use X if missing".
- Log with `ns.print` (script log window) and `ns.tprint` (terminal). Call `ns.disableLog("ALL")` or specific functions to cut noise, and keep logs short and specific.
- Blank line before `return` (except a guard `return` directly under its `if`, or a function whose whole body is a single `return`). Blank line above and below loops and multi-line `if` blocks, unless the iterated or tested value is defined on the line directly above.
- Clear names, small functions, no comments that restate code.
