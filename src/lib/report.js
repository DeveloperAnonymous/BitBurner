/**
 * Records a failure in the script log without crashing the script. No toast: the user does not want pop-ups.
 * @param {NS} ns
 * @param {string} message
 */
export function reportFailure(ns, message) {
    ns.print(`FAILED: ${message}`);
}
