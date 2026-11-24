const REQUEST_FILE = "/mcp/request.txt";
const RESPONSE_FILE = "/mcp/response.txt";
const POLL_MS = 100;

/** @type {Record<string, (ns: NS, request: any) => unknown>} */
const COMMANDS = {
    run: (ns, request) => startScript(ns, request),
    logs: (ns, { pid }) => ns.getScriptLogs(pid),
    ps: (ns, { host }) => ns.ps(host),
    kill: (ns, { pid }) => ns.kill(pid),
};

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");

    let lastId = readRequest(ns)?.id;

    while (true) {
        const request = readRequest(ns);
        if (request !== null && request.id !== lastId) {
            lastId = request.id;
            ns.write(RESPONSE_FILE, JSON.stringify(answer(ns, request)), "w");
        }

        await ns.sleep(POLL_MS);
    }
}

/**
 * @param {NS} ns
 * @returns {any}
 */
function readRequest(ns) {
    const raw = ns.read(REQUEST_FILE);

    return raw === "" ? null : JSON.parse(raw);
}

/**
 * Errors go back to the MCP caller as the answer, so one bad command does not stop the runner.
 * @param {NS} ns
 * @param {any} request
 */
function answer(ns, request) {
    const command = COMMANDS[request.command];
    if (command === undefined) return { id: request.id, error: `Unknown command ${request.command}` };

    try {
        return { id: request.id, result: command(ns, request) };
    } catch (error) {
        return { id: request.id, error: String(error) };
    }
}

/**
 * @param {NS} ns
 * @param {{ host: string, script: string, threads: number, args: (string | number | boolean)[] }} request
 */
function startScript(ns, { host, script, threads, args }) {
    const pid = ns.exec(script, host, threads, ...args);
    if (pid === 0) throw new Error(`exec ${script} on ${host} with ${threads} threads failed (missing file or not enough RAM)`);

    return pid;
}
