import { watch } from "node:fs";
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { log } from "./game-link.js";

const SYNCED_EXTENSION = ".js";
const TARGET_SERVER = "home";
const DEBOUNCE_MS = 150;

export class Sync {
    #link;
    #sourceDir;
    #definitionsPath;
    #timers = new Map();

    constructor(link, sourceDir, definitionsPath) {
        this.#link = link;
        this.#sourceDir = sourceDir;
        this.#definitionsPath = definitionsPath;
    }

    watch() {
        watch(this.#sourceDir, { recursive: true }, (_event, relative) => {
            if (relative === null || !relative.endsWith(SYNCED_EXTENSION)) return;

            this.#debounce(relative);
        });
    }

    async pushAll() {
        const files = await listSourceFiles(this.#sourceDir);
        for (const relative of files) {
            await this.#push(relative);
        }

        return files.map(toGamePath);
    }

    async downloadDefinitions() {
        const definitions = await this.#link.request("getDefinitionFile", {});
        await writeFile(this.#definitionsPath, definitions);
    }

    #debounce(relative) {
        clearTimeout(this.#timers.get(relative));
        this.#timers.set(relative, setTimeout(() => {
            this.#timers.delete(relative);
            this.#mirror(relative).catch(error => log(`Sync of ${relative} failed: ${error.message}`));
        }, DEBOUNCE_MS));
    }

    async #mirror(relative) {
        if (!this.#link.isConnected) return;

        const exists = await stat(path.join(this.#sourceDir, relative)).then(() => true, () => false);
        if (exists) {
            await this.#push(relative);
        } else {
            await this.#link.request("deleteFile", { filename: toGamePath(relative), server: TARGET_SERVER });
            log(`Deleted ${toGamePath(relative)}`);
        }
    }

    async #push(relative) {
        const content = await readFile(path.join(this.#sourceDir, relative), "utf8");
        await this.#link.request("pushFile", { filename: toGamePath(relative), content, server: TARGET_SERVER });
        log(`Pushed ${toGamePath(relative)}`);
    }
}

function toGamePath(relative) {
    return relative.split(path.sep).join("/");
}

async function listSourceFiles(sourceDir) {
    const entries = await readdir(sourceDir, { recursive: true, withFileTypes: true });

    return entries
        .filter(entry => entry.isFile() && entry.name.endsWith(SYNCED_EXTENSION))
        .map(entry => path.relative(sourceDir, path.join(entry.parentPath, entry.name)));
}
