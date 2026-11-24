import { WebSocketServer } from "ws";

const REQUEST_TIMEOUT_MS = 15000;

export class GameLink {
    #socket = null;
    #nextId = 1;
    #pending = new Map();
    #onConnect;

    constructor(port, onConnect) {
        this.#onConnect = onConnect;
        const server = new WebSocketServer({ port });
        server.on("connection", socket => this.#attach(socket));
        server.on("error", error => exitOnServerError(port, error));
    }

    get isConnected() {
        return this.#socket !== null;
    }

    request(method, params) {
        if (this.#socket === null) {
            throw new Error("Bitburner is not connected. In the game: Options > Remote API > Connect.");
        }

        const id = this.#nextId++;
        const socket = this.#socket;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.#pending.delete(id);
                reject(new Error(`${method} got no answer from the game within ${REQUEST_TIMEOUT_MS} ms`));
            }, REQUEST_TIMEOUT_MS);
            this.#pending.set(id, { resolve, reject, timer, method });
            socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
        });
    }

    #attach(socket) {
        if (this.#socket !== null) this.#socket.close();

        this.#socket = socket;
        socket.on("message", data => this.#settle(JSON.parse(data.toString())));
        socket.on("close", () => this.#detach(socket));
        log("Bitburner connected");
        this.#onConnect().catch(error => log(`Sync on connect failed: ${error.message}`));
    }

    #detach(socket) {
        if (this.#socket !== socket) return;

        this.#socket = null;

        for (const [id, pending] of this.#pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error(`${pending.method} failed: Bitburner disconnected`));
            this.#pending.delete(id);
        }

        log("Bitburner disconnected");
    }

    #settle(message) {
        const pending = this.#pending.get(message.id);
        if (pending === undefined) return;

        this.#pending.delete(message.id);
        clearTimeout(pending.timer);

        const hasError = message.error !== undefined && message.error !== null;
        if (hasError) {
            pending.reject(new Error(`${pending.method}: ${message.error}`));
        } else {
            pending.resolve(message.result);
        }
    }
}

export function log(message) {
    process.stderr.write(`[bitburner-mcp] ${message}\n`);
}

function exitOnServerError(port, error) {
    const reason = error.code === "EADDRINUSE"
        ? `port ${port} is in use. Stop the VS Code Bitburner sync server ("Bitburner: Stop Sync Server").`
        : error.message;
    log(`WebSocket server failed: ${reason}`);
    process.exit(1);
}
