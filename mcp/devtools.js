import WebSocket from "ws";

const DEVTOOLS_PORT = 9222;
const CALL_TIMEOUT_MS = 30000;

export async function evaluateInPage(expression) {
    const { result, exceptionDetails } = await withPage(page => page.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }));
    if (exceptionDetails !== undefined) {
        throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    }

    return result.value;
}

export function callInPage(fn, argument) {
    return evaluateInPage(`(${fn.toString()})(${JSON.stringify(argument)})`);
}

export async function screenshot() {
    const { data } = await withPage(page => page.call("Page.captureScreenshot", { format: "png" }));

    return data;
}

async function withPage(action) {
    const page = await PageConnection.open(await pageSocketUrl());

    try {
        return await action(page);
    } finally {
        page.close();
    }
}

async function pageSocketUrl() {
    const response = await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json/list`).catch(() => {
        throw new Error(`Game DevTools not reachable on port ${DEVTOOLS_PORT}. Add --remote-debugging-port=${DEVTOOLS_PORT} to Bitburner's Steam launch options and restart the game.`);
    });
    const targets = await response.json();
    const page = targets.find(target => target.type === "page");
    if (page === undefined) throw new Error(`DevTools on port ${DEVTOOLS_PORT} lists no page: ${JSON.stringify(targets)}`);

    return page.webSocketDebuggerUrl;
}

class PageConnection {
    #socket;
    #nextId = 1;
    #pending = new Map();

    static open(url) {
        const socket = new WebSocket(url);

        return new Promise((resolve, reject) => {
            socket.once("open", () => resolve(new PageConnection(socket)));
            socket.once("error", reject);
        });
    }

    constructor(socket) {
        this.#socket = socket;
        socket.on("message", data => this.#settle(JSON.parse(data.toString())));
    }

    call(method, params) {
        const id = this.#nextId++;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`${method} timed out after ${CALL_TIMEOUT_MS} ms`)), CALL_TIMEOUT_MS);
            this.#pending.set(id, { resolve, reject, timer, method });
            this.#socket.send(JSON.stringify({ id, method, params }));
        });
    }

    close() {
        this.#socket.close();
    }

    #settle(message) {
        const pending = this.#pending.get(message.id);
        if (pending === undefined) return;

        this.#pending.delete(message.id);
        clearTimeout(pending.timer);

        if (message.error !== undefined) {
            pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        } else {
            pending.resolve(message.result);
        }
    }
}
