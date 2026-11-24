const EVAL_DIR = "mcp/eval";
const EVAL_HOST = "home";
const POLL_MS = 200;

export class NsEvaluator {
    #link;
    #runner;

    constructor(link, runner) {
        this.#link = link;
        this.#runner = runner;
    }

    async evaluate(code, timeoutMs) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const script = `${EVAL_DIR}/${id}.js`;
        const output = `${EVAL_DIR}/${id}.txt`;

        await this.#link.request("pushFile", { filename: script, content: wrap(code, output), server: EVAL_HOST });
        const ram = await this.#link.request("calculateRam", { filename: script, server: EVAL_HOST });
        const pid = await this.#runner.send("run", { host: EVAL_HOST, script, threads: 1, args: [] });
        const answer = await this.#awaitOutput(output, timeoutMs, pid);

        await this.#link.request("deleteFile", { filename: script, server: EVAL_HOST });
        await this.#link.request("deleteFile", { filename: output, server: EVAL_HOST });
        if (answer.error !== undefined) throw new Error(`eval_ns (pid ${pid}, ${ram} GB): ${answer.error}`);

        return { pid, ramGb: ram, result: answer.result };
    }

    async #awaitOutput(output, timeoutMs, pid) {
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            const names = await this.#link.request("getFileNames", { server: EVAL_HOST });
            if (names.includes(output)) return JSON.parse(await this.#link.request("getFile", { filename: output, server: EVAL_HOST }));

            await new Promise(resolve => setTimeout(resolve, POLL_MS));
        }

        throw new Error(`eval_ns pid ${pid} wrote no result within ${timeoutMs} ms; it may still be running (kill_script ${pid})`);
    }
}

function wrap(code, output) {
    return `/** @param {NS} ns */
export async function main(ns) {
    const outputFile = ${JSON.stringify(output)};
    try {
        const value = await (async () => {
${code}
        })();
        ns.write(outputFile, JSON.stringify({ result: value === undefined ? null : value }), "w");
    } catch (error) {
        ns.write(outputFile, JSON.stringify({ error: String(error && error.stack ? error.stack : error) }), "w");
    }
}
`;
}
