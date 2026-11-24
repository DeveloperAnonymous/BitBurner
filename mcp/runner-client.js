const REQUEST_FILE = "mcp/request.txt";
const RESPONSE_FILE = "mcp/response.txt";
const RUNNER_SERVER = "home";
const POLL_MS = 150;
const RESPONSE_TIMEOUT_MS = 10000;

export class RunnerClient {
    #link;
    #queue = Promise.resolve();

    constructor(link) {
        this.#link = link;
    }

    send(command, params) {
        const result = this.#queue.then(() => this.#exchange(command, params));
        this.#queue = result.catch(() => undefined);

        return result;
    }

    async #exchange(command, params) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await this.#link.request("pushFile", { filename: REQUEST_FILE, content: JSON.stringify({ id, command, ...params }), server: RUNNER_SERVER });

        const response = await this.#awaitResponse(id);
        if (response.error !== undefined) throw new Error(`Runner ${command}: ${response.error}`);

        return response.result;
    }

    async #awaitResponse(id) {
        const deadline = Date.now() + RESPONSE_TIMEOUT_MS;

        while (Date.now() < deadline) {
            const response = await this.#readResponse();
            if (response?.id === id) return response;

            await new Promise(resolve => setTimeout(resolve, POLL_MS));
        }

        throw new Error(`The in-game runner did not answer within ${RESPONSE_TIMEOUT_MS} ms. Start it with: run /mcp-runner.js`);
    }

    async #readResponse() {
        const names = await this.#link.request("getFileNames", { server: RUNNER_SERVER });
        if (!names.includes(RESPONSE_FILE)) return null;

        return JSON.parse(await this.#link.request("getFile", { filename: RESPONSE_FILE, server: RUNNER_SERVER }));
    }
}
