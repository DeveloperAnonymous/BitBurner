import { reportFailure } from "/lib/report.js";

const STOCK_SCRIPT = "/stock.js";

/**
 * Turns every stock position into cash before an augmentation install, which wipes both.
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");

    if (!ns.stock.hasTixApiAccess()) {
        ns.tprint(`pre-install.js: no TIX API access, nothing to sell. Cash $${ns.format.number(ns.getServerMoneyAvailable("home"))}`);

        return;
    }

    ns.scriptKill(STOCK_SCRIPT, "home");

    const proceeds = ns.stock.getSymbols().reduce((total, sym) => total + sellPosition(ns, sym), 0);
    ns.tprint(`pre-install.js: stopped ${STOCK_SCRIPT}, sold stocks for $${ns.format.number(proceeds)}. Cash $${ns.format.number(ns.getServerMoneyAvailable("home"))}`);
}

/**
 * @param {NS} ns
 * @param {string} sym
 * @returns {number} sale proceeds, 0 when nothing was held or the sale failed
 */
function sellPosition(ns, sym) {
    const [shares] = ns.stock.getPosition(sym);
    if (shares === 0) return 0;

    const price = ns.stock.sellStock(sym, shares);
    if (price === 0) {
        reportFailure(ns, `selling ${ns.format.number(shares, 0)} ${sym} failed`);
        ns.tprint(`pre-install.js: selling ${sym} failed; sell it by hand on the Stock Market page`);

        return 0;
    }

    return price * shares;
}
