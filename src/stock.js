const BUY_FORECAST = 0.55;
const SELL_FORECAST = 0.5;
const INVEST_FRACTION = 0.8;
const CASH_FLOOR = 20e9;
const REBALANCE_BAND = 0.25;
const MIN_TRADE_COMMISSIONS = 1000;
const SUMMARY_EVERY_TICKS = 10;

/**
 * @typedef {{ sym: string, forecast: number, volatility: number, ask: number, bid: number, owned: number, avgPrice: number, maxShares: number }} Quote
 * @typedef {{ commission: number, minTrade: number }} Fees
 * @typedef {{ stock: Quote, targetValue: number }} Target
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    requireMarketAccess(ns);

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

/** @param {NS} ns */
function requireMarketAccess(ns) {
    const missing = [
        [ns.stock.hasWseAccount(), "WSE account"],
        [ns.stock.hasTixApiAccess(), "TIX API"],
        [ns.stock.has4SDataTixApi(), "4S Market Data TIX API"],
    ].filter(([owned]) => !owned).map(([, name]) => name);
    if (missing.length > 0) throw new Error(`stock.js needs ${missing.join(", ")} (buy them at the World Stock Exchange)`);
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
 * Splits the stock budget over every stock at or above BUY_FORECAST in proportion to its expected return, so a stronger
 * forecast gets more money. Holdings between SELL_FORECAST and BUY_FORECAST keep their current value.
 * @param {NS} ns
 * @param {Quote[]} quotes
 * @returns {Target[]}
 */
function allocationTargets(ns, quotes) {
    const picks = quotes.filter(stock => stock.forecast >= BUY_FORECAST).sort((a, b) => expectedReturn(b) - expectedReturn(a));
    const held = quotes.filter(stock => stock.owned > 0 && !picks.includes(stock));
    const budget = stockBudget(ns, quotes) - value(held);
    const totalWeight = picks.reduce((total, stock) => total + expectedReturn(stock), 0);

    return picks.map(stock => ({ stock, targetValue: Math.min(budget * (expectedReturn(stock) / totalWeight), stock.maxShares * stock.ask) }));
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
        if (price === 0) throw new Error(`Buying ${shares} ${stock.sym} failed`);

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
    if (price === 0) throw new Error(`Selling ${shares} ${stock.sym} failed`);

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

    return Math.min(netWorth * INVEST_FRACTION, netWorth - CASH_FLOOR);
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
