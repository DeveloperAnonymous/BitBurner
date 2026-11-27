import { crack } from "/dnet/crack.js";
import { fitsFormat } from "/dnet/password-format.js";

const SNIFFED_PASSCODE = /Logging in with passcode: (\S+) \.\.\./;
const MAX_SNIFF_TRIES = 10;
const SNIFF_LOG_LINES = 20;

/** @param {NS} ns */
export async function main(ns) {
    await crack(ns, solve);
}

/**
 * OpenWebAccessPoint now and then logs its own passcode as noise, so the log is read until that line turns up.
 * @param {import("/dnet/crack.js").Target} target
 * @returns {import("/dnet/crack.js").Guesses}
 */
async function* solve({ ns, host, details }) {
    if (details.logTrafficInterval <= 0) return `server writes no log traffic (interval ${details.logTrafficInterval})`;

    for (let tryNumber = 1; tryNumber <= MAX_SNIFF_TRIES; tryNumber++) {
        const leak = await ns.dnet.heartbleed(host, { peek: true, logsToCapture: SNIFF_LOG_LINES });
        if (!leak.success) return `heartbleed failed: ${leak.code} ${leak.message}`;

        const passcodes = leak.logs.map(line => line.match(SNIFFED_PASSCODE)?.[1]).filter(passcode => passcode !== undefined);
        yield* passcodes.filter(passcode => fitsFormat(passcode, details));

        await ns.sleep(details.logTrafficInterval * 1000);
    }

    return `no passcode line in the log after ${MAX_SNIFF_TRIES} heartbleeds`;
}
