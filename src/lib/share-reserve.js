export const SHARE_SCRIPT = "/share.js";
export const SHARE_RAM_FRACTION = 0.5;
const CLOUD_PREFIX = "cloud-";

/**
 * RAM set aside for share.js on a host. Only cloud servers carry a reserve.
 * @param {string} host
 * @param {number} maxRam
 */
export function shareReserve(host, maxRam) {
    return host.startsWith(CLOUD_PREFIX) ? maxRam * SHARE_RAM_FRACTION : 0;
}

/**
 * @param {NS} ns
 * @param {string} host
 */
export function shareThreads(ns, host) {
    return ns.ps(host).filter(process => `/${process.filename}` === SHARE_SCRIPT).reduce((total, process) => total + process.threads, 0);
}
