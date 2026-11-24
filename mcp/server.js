import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GameLink, log } from "./game-link.js";
import { Sync } from "./sync.js";
import { RunnerClient } from "./runner-client.js";
import { readSave, playerSummary, serverSummary } from "./save.js";
import { NsEvaluator } from "./eval-ns.js";
import { callInPage, evaluateInPage, screenshot } from "./devtools.js";
import { clickByText, readScreenText, runTerminalCommand } from "./ui-actions.js";

const PORT = 12525;
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = path.join(PROJECT_ROOT, "src");
const DEFINITIONS_PATH = path.join(PROJECT_ROOT, "NetscriptDefinitions.d.ts");
const EVAL_TIMEOUT_MS = 60000;
const SCREEN_TEXT_LIMIT = 20000;

const link = new GameLink(PORT, syncOnConnect);
const sync = new Sync(link, SOURCE_DIR, DEFINITIONS_PATH);
const runner = new RunnerClient(link);
const evaluator = new NsEvaluator(link, runner);
const mcp = new McpServer({ name: "bitburner", version: "0.1.0" });

const server = z.string().describe("Hostname in the game, e.g. home or n00dles");
const filename = z.string().describe("Game path, e.g. lib/x.js or mcp/notes.txt");
const pid = z.number().int().describe("Process id from run_script or list_processes");

async function syncOnConnect() {
    await sync.downloadDefinitions();
    const pushed = await sync.pushAll();
    log(`Pushed ${pushed.length} files from src on connect`);
}

function reply(value) {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);

    return { content: [{ type: "text", text }] };
}

function tool(name, description, inputSchema, handler) {
    mcp.registerTool(name, { description, inputSchema }, async args => reply(await handler(args)));
}

tool("game_status", "Whether Bitburner is connected to this MCP server.", {}, () => ({ connected: link.isConnected, port: PORT }));

tool("player_info", "Money, skills, BitNode, factions, augmentations, programs on home, home RAM and cores, from a fresh save.", {}, async () =>
    playerSummary(await readSave(link)));

tool("list_servers", "Every server with root and purchased flags.", {}, () => link.request("getAllServers", {}));

tool("server_info", "Money, security, RAM, ports and required level of one server, from a fresh save.", { hostname: server }, async ({ hostname }) =>
    serverSummary(await readSave(link), hostname));

tool("list_files", "File names on a server.", { server }, args => link.request("getFileNames", args));

tool("read_file", "Content of a file on a server.", { server, filename }, args => link.request("getFile", args));

tool("write_file", "Write a file on a server. Files under src are synced automatically; use this for other servers or data files.", { server, filename, content: z.string() }, args =>
    link.request("pushFile", args));

tool("delete_file", "Delete a file on a server.", { server, filename }, args => link.request("deleteFile", args));

tool("calculate_ram", "RAM cost in GB the game computes for a script on a server.", { server, filename }, args => link.request("calculateRam", args));

tool("sync_all", "Push every .js file under src to home and refresh NetscriptDefinitions.d.ts.", {}, async () => {
    await sync.downloadDefinitions();

    return { pushed: await sync.pushAll() };
});

tool("run_script", "Start a script through the in-game runner (run /mcp-runner.js first). Returns the pid.", {
    host: server,
    script: filename,
    threads: z.number().int().positive(),
    args: z.array(z.union([z.string(), z.number(), z.boolean()])),
}, args => runner.send("run", args));

tool("script_logs", "Log lines of a running script, through the in-game runner.", { pid }, args => runner.send("logs", args));

tool("list_processes", "Running scripts on a server, through the in-game runner.", { host: server }, args => runner.send("ps", args));

tool("kill_script", "Kill a script by pid, through the in-game runner.", { pid }, args => runner.send("kill", args));

tool("eval_ns", "Run NS code on home as a one-shot script and return its result. The code is the body of an async function with `ns` in scope; `return` a JSON-serializable value. RAM is computed by the game for this code. Needs the runner.", {
    code: z.string(),
    timeoutMs: z.number().int().positive().describe(`How long to wait for the result; use ${EVAL_TIMEOUT_MS} unless the code sleeps longer`),
}, ({ code, timeoutMs }) => evaluator.evaluate(code, timeoutMs));

tool("ui_screen_text", "Visible text of the game window, through DevTools.", {}, () => callInPage(readScreenText, SCREEN_TEXT_LIMIT));

tool("ui_click", "Click the visible button, link or menu item whose text matches exactly, through DevTools.", { text: z.string() }, ({ text }) =>
    callInPage(clickByText, text));

tool("ui_terminal", "Type a command into the game terminal and press Enter, through DevTools. Returns the last 30 terminal lines. The Terminal tab must be open.", { command: z.string() }, ({ command }) =>
    callInPage(runTerminalCommand, command));

tool("ui_eval", "Evaluate a JavaScript expression in the game page, through DevTools. Promises are awaited; the value must be JSON-serializable.", { expression: z.string() }, ({ expression }) =>
    evaluateInPage(expression));

mcp.registerTool("ui_screenshot", { description: "PNG screenshot of the game window, through DevTools." }, async () => ({
    content: [{ type: "image", data: await screenshot(), mimeType: "image/png" }],
}));

sync.watch();
await mcp.connect(new StdioServerTransport());
log(`Listening for Bitburner on port ${PORT}`);
