import { reportFailure } from "/lib/report.js";

const BUY_FORECAST = 0.55;
const SELL_FORECAST = 0.5;
const INVEST_FRACTION = 0.95;
const CONCENTRATION_POWER = 2;
const CASH_FLOOR = 10e9;
const REBALANCE_BAND = 0.25;
const MIN_TRADE_COMMISSIONS = 1000;
const SUMMARY_EVERY_TICKS = 10;
const ACCESS_RECHECK_MS = 60000;

/**
 * @typedef {{ sym: string, forecast: number, volatility: number, ask: number, bid: number, owned: number, avgPrice: number, maxShares: number }} Quote
 * @typedef {{ commission: number, minTrade: number }} Fees
 * @typedef {{ stock: Quote, targetValue: number }} Target
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");

    for (let missing = missingAccess(ns); missing.length > 0; missing = missingAccess(ns)) {
        reportFailure(ns, `stock.js needs ${missing.join(", ")} (buy at the World Stock Exchange); checking again in a minute`);
        await ns.sleep(ACCESS_RECHECK_MS);
    }

    const commission = ns.stock.getConstants().StockMarketCommission;
    const fees = { commission, minTrade: commission * MIN_TRADE_COMMISSIONS };
    let realizedProfit = 0;
    let tick = 0;

    while (true) {
        const quotes = ns.stock.getSymbols().map(sym => quote(ns, sym));
        realizedProfit += sellWeakPositions(ns, quotes, fees);

        const targets = allocationTargets(ns, quotes);
        realizedProfit += trimOverweight(ns, targets, fees);
        buyUnderweight(ns, quotes, targets, fees);

        if (++tick % SUMMARY_EVERY_TICKS === 0) printSummary(ns, realizedProfit);

        await ns.stock.nextUpdate();
    }
}

/**
 * @param {NS} ns
 * @returns {string[]}
 */
function missingAccess(ns) {
    return [
        [ns.stock.hasWseAccount(), "WSE account"],
        [ns.stock.hasTixApiAccess(), "TIX API"],
        [ns.stock.has4SDataTixApi(), "4S Market Data TIX API"],
    ].filter(([owned]) => !owned).map(([, name]) => String(name));
}

/**
 * @param {NS} ns
 * @param {string} sym
 * @returns {Quote}
 */
function quote(ns, sym) {
    const [owned, avgPrice] = ns.stock.getPosition(sym);

    return {
        sym,
        forecast: ns.stock.getForecast(sym),
        volatility: ns.stock.getVolatility(sym),
        ask: ns.stock.getAskPrice(sym),
        bid: ns.stock.getBidPrice(sym),
        owned,
        avgPrice,
        maxShares: ns.stock.getMaxShares(sym),
    };
}

/**
 * Average fractional price change per tick.
 * @param {Quote} stock
 */
function expectedReturn(stock) {
    return stock.volatility * (stock.forecast - 0.5);
}

/**
 * Raising the expected return to CONCENTRATION_POWER moves money from marginal picks to the strongest ones.
 * @param {Quote} stock
 */
function allocationWeight(stock) {
    return expectedReturn(stock) ** CONCENTRATION_POWER;
}

/**
 * Splits the stock budget over every stock at or above BUY_FORECAST in proportion to its allocation weight, so a stronger
 * forecast gets more money. A stock whose share falls past its share limit is capped there and the rest of the budget is
 * split again over the others. Holdings between SELL_FORECAST and BUY_FORECAST keep their current value.
 * @param {NS} ns
 * @param {Quote[]} quotes
 * @returns {Target[]}
 */
function allocationTargets(ns, quotes) {
    const picks = quotes.filter(stock => stock.forecast >= BUY_FORECAST).sort((a, b) => expectedReturn(b) - expectedReturn(a));
    const held = quotes.filter(stock => stock.owned > 0 && !picks.includes(stock));
    let budget = Math.max(0, stockBudget(ns, quotes) - value(held));
    /** @type {Map<Quote, number>} */
    const targetValues = new Map();
    let uncapped = picks;

    while (uncapped.length > 0) {
        const totalWeight = uncapped.reduce((total, stock) => total + allocationWeight(stock), 0);
        const share = (/** @type {Quote} */ stock) => budget * (allocationWeight(stock) / totalWeight);
        const capped = uncapped.filter(stock => share(stock) >= maxPositionValue(stock));
        if (capped.length === 0) {
            for (const stock of uncapped) targetValues.set(stock, share(stock));
            break;
        }

        for (const stock of capped) {
            targetValues.set(stock, maxPositionValue(stock));
            budget -= maxPositionValue(stock);
        }

        uncapped = uncapped.filter(stock => !capped.includes(stock));
    }

    return picks.map(stock => ({ stock, targetValue: Number(targetValues.get(stock)) }));
}

/** @param {Quote} stock */
function maxPositionValue(stock) {
    return stock.maxShares * stock.ask;
}

/**
 * @param {NS} ns
 * @param {Quote[]} quotes
 * @param {Fees} fees
 * @returns {number} realized profit
 */
function sellWeakPositions(ns, quotes, fees) {
    const weak = quotes.filter(stock => stock.owned > 0 && stock.forecast < SELL_FORECAST);

    return weak.reduce((profit, stock) => profit + sell(ns, stock, stock.owned, fees, `forecast ${pct(stock.forecast)}`), 0);
}

/**
 * @param {NS} ns
 * @param {Target[]} targets
 * @param {Fees} fees
 * @returns {number} realized profit
 */
function trimOverweight(ns, targets, fees) {
    let profit = 0;

    for (const { stock, targetValue } of targets) {
        const excess = stock.owned * stock.bid - targetValue;
        if (excess < Math.max(fees.minTrade, targetValue * REBALANCE_BAND)) continue;

        profit += sell(ns, stock, Math.floor(excess / stock.bid), fees, `over target ${ns.format.number(targetValue)}`);
    }

    return profit;
}

/**
 * @param {NS} ns
 * @param {Quote[]} quotes
 * @param {Target[]} targets
 * @param {Fees} fees
 */
function buyUnderweight(ns, quotes, targets, fees) {
    let budget = Math.min(ns.getServerMoneyAvailable("home") - CASH_FLOOR, stockBudget(ns, quotes) - value(quotes));

    for (const { stock, targetValue } of targets) {
        const shortfall = targetValue - stock.owned * stock.ask;
        if (shortfall < Math.max(fees.minTrade, targetValue * REBALANCE_BAND)) continue;

        const shares = Math.min(stock.maxShares - stock.owned, Math.floor(Math.min(shortfall, budget) / stock.ask));
        if (shares * stock.ask < fees.minTrade) continue;

        const price = ns.stock.buyStock(stock.sym, shares);
        if (price === 0) {
            reportFailure(ns, `buying ${ns.format.number(shares, 0)} ${stock.sym} failed: cash is ${ns.format.number(ns.getServerMoneyAvailable("home"))}, another script likely spent it`);
            continue;
        }

        budget -= shares * price;
        stock.owned += shares;
        ns.print(`BOUGHT ${ns.format.number(shares, 0)} ${stock.sym} @ ${ns.format.number(price)} (forecast ${pct(stock.forecast)}, target ${ns.format.number(targetValue)})`);
    }
}

/**
 * @param {NS} ns
 * @param {Quote} stock
 * @param {number} shares
 * @param {Fees} fees
 * @param {string} reason
 * @returns {number} realized profit
 */
function sell(ns, stock, shares, fees, reason) {
    const price = ns.stock.sellStock(stock.sym, shares);
    if (price === 0) {
        reportFailure(ns, `selling ${ns.format.number(shares, 0)} ${stock.sym} failed (${reason}); retrying next tick`);

        return 0;
    }

    const gain = (price - stock.avgPrice) * shares - 2 * fees.commission;
    ns.print(`SOLD ${ns.format.number(shares, 0)} ${stock.sym} @ ${ns.format.number(price)} (${reason}, P/L ${ns.format.number(gain)})`);
    stock.owned -= shares;

    return gain;
}

/**
 * The most the portfolio may hold: INVEST_FRACTION of net worth, never leaving less than CASH_FLOOR in cash.
 * @param {NS} ns
 * @param {Quote[]} quotes
 */
function stockBudget(ns, quotes) {
    const netWorth = ns.getServerMoneyAvailable("home") + value(quotes);

    return Math.max(0, Math.min(netWorth * INVEST_FRACTION, netWorth - CASH_FLOOR));
}

/** @param {Quote[]} quotes */
function value(quotes) {
    return quotes.reduce((total, stock) => total + stock.owned * stock.bid, 0);
}

/**
 * @param {NS} ns
 * @param {number} realizedProfit
 */
function printSummary(ns, realizedProfit) {
    const quotes = ns.stock.getSymbols().map(sym => quote(ns, sym));
    const held = quotes.filter(stock => stock.owned > 0).sort((a, b) => b.owned * b.bid - a.owned * a.bid);
    const unrealized = held.reduce((total, stock) => total + (stock.bid - stock.avgPrice) * stock.owned, 0);
    const positions = held.map(stock => `${stock.sym} ${ns.format.number(stock.owned * stock.bid)} (${pct(stock.forecast)})`).join(", ");
    ns.print(`Portfolio ${ns.format.number(value(quotes))}: ${positions || "nothing"} | realized ${ns.format.number(realizedProfit)}, unrealized ${ns.format.number(unrealized)}`);
}

/** @param {number} fraction */
function pct(fraction) {
    return `${(fraction * 100).toFixed(1)}%`;
}
