export const SHARE_SCRIPT = "/share.js";
export const SHARE_MANAGER_SCRIPT = "/share-manager.js";
export const CLOUD_SHARE_FRACTION = 0.5;
export const WORLD_SHARE_FRACTION = 0.5;
const CLOUD_PREFIX = "cloud-";

/**
 * RAM set aside for share.js on a host. Home carries no reserve.
 * @param {string} host
 * @param {number} maxRam
 */
export function shareReserve(host, maxRam) {
    if (host === "home") return 0;

    return maxRam * (host.startsWith(CLOUD_PREFIX) ? CLOUD_SHARE_FRACTION : WORLD_SHARE_FRACTION);
}

/**
 * @param {NS} ns
 * @param {string} host
 */
export function shareThreads(ns, host) {
    return ns.ps(host).filter(process => `/${process.filename}` === SHARE_SCRIPT).reduce((total, process) => total + process.threads, 0);
}
