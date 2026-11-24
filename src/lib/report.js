const TOAST_MS = 15000;

/**
 * Shows a failure in the script log and as a toast, without crashing the script.
 * @param {NS} ns
 * @param {string} message
 */
export function reportFailure(ns, message) {
    ns.print(`FAILED: ${message}`);
    ns.toast(`${ns.getScriptName()}: ${message}`, "error", TOAST_MS);
}
