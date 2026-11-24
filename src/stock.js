/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");

    const commission = 100000; // $100k per buy/sell transaction
    const profitKeepRatio = 0.5; // Keep 50% of cash/gains in your account
    const budgetFile = "stock-budget.txt";

    // 4S thresholds (used once 4S Market Data TIX API is owned)
    const buyThreshold4S = 0.62;
    const sellThreshold4S = 0.50;
    const minTradeValue4S = commission * 50; // $5m minimum trade size with 4S

    // Pre-4S thresholds (longer window + concentrated positions to beat spread & fees)
    const buyThresholdFallback = 0.72;
    const sellThresholdFallback = 0.28;
    const minTradeValueFallback = commission * 250; // $25m minimum trade size pre-4S
    const maxPositionsPre4S = 2; // Concentrate capital into top 2 trends before 4S
    const minHoldTicksPre4S = 6; // Hold at least ~36s before reacting to minor noise

    const priceHistory = new Map();
    const holdTicks = new Map();
    const historyLength = 20;

    let lastRecordedCash = ns.getServerMoneyAvailable("home");
    let currentBudget = Math.max(0, lastRecordedCash * (1 - profitKeepRatio));
    await writeBudget(ns, budgetFile, currentBudget);

    ns.print(`📈 Starting v3.0.1 Stock Trader (Budget file: ${budgetFile})...`);

    while (true) {
        const cash = ns.getServerMoneyAvailable("home");

        // Respect manual budget reductions in stock-budget.txt
        const fileBudget = readBudget(ns, budgetFile);
        if (fileBudget !== null && fileBudget < currentBudget) {
            currentBudget = Math.max(0, fileBudget);
        }

        // Allocate 50% of new cash inflows to budget; keep 50% free in account
        if (cash > lastRecordedCash) {
            const gain = cash - lastRecordedCash;
            currentBudget += gain * (1 - profitKeepRatio);
        }

        currentBudget = Math.floor(Math.min(currentBudget, Math.max(0, cash * (1 - profitKeepRatio))));
        await writeBudget(ns, budgetFile, currentBudget);
        lastRecordedCash = cash;

        // 1. Automatically buy WSE Account, TIX API, and 4S Market + TIX API when affordable
        const spentOnApi = buyMarketAccess(ns, currentBudget);
        if (spentOnApi > 0) {
            currentBudget = Math.max(0, currentBudget - spentOnApi);
            await writeBudget(ns, budgetFile, currentBudget);
        }

        const hasWse = safeBool(() => ns.stock.hasWseAccount());
        const hasTix = safeBool(() => ns.stock.hasTixApiAccess());

        if (hasWse && hasTix) {
            const has4STix = safeBool(() => ns.stock.has4SDataTixApi());
            const symbols = ns.stock.getSymbols();

            for (const sym of symbols) {
                // Track mid-price to avoid bid/ask distortion
                const midPrice = (ns.stock.getAskPrice(sym) + ns.stock.getBidPrice(sym)) / 2;
                if (!priceHistory.has(sym)) {
                    priceHistory.set(sym, []);
                }
                const history = priceHistory.get(sym);
                history.push(midPrice);
                if (history.length > historyLength) {
                    history.shift();
                }
            }

            const sellThreshold = has4STix ? sellThreshold4S : sellThresholdFallback;
            const buyThreshold = has4STix ? buyThreshold4S : buyThresholdFallback;
            const minTradeValue = has4STix ? minTradeValue4S : minTradeValueFallback;

            // 2. Sell positions once forecast or sustained momentum turns bearish
            let openPositions = 0;
            for (const sym of symbols) {
                const pos = ns.stock.getPosition(sym);
                const shares = pos[0] ?? 0;
                const avgPrice = pos[1] ?? 0;

                if (shares > 0) {
                    const ticksHeld = (holdTicks.get(sym) ?? 0) + 1;
                    holdTicks.set(sym, ticksHeld);

                    const forecast = getEffectiveForecast(ns, sym, has4STix, priceHistory.get(sym));
                    const canSellPre4S = ticksHeld >= minHoldTicksPre4S || forecast <= 0.15;

                    if (forecast < sellThreshold && (has4STix || canSellPre4S)) {
                        const soldPrice = ns.stock.sellStock(sym, shares);
                        if (soldPrice > 0) {
                            holdTicks.delete(sym);
                            const netProfit = (soldPrice - avgPrice) * shares - commission * 2;
                            if (netProfit > 0) {
                                currentBudget += netProfit * (1 - profitKeepRatio);
                            }

                            const latestCash = ns.getServerMoneyAvailable("home");
                            currentBudget = Math.floor(
                                Math.min(currentBudget, Math.max(0, latestCash * (1 - profitKeepRatio)))
                            );
                            await writeBudget(ns, budgetFile, currentBudget);
                            lastRecordedCash = latestCash;

                            ns.print(
                                `💰 SOLD ${shares} ${sym} @ ${ns.format.number(soldPrice)} ` +
                                `(Net P/L: ${ns.format.number(netProfit)} | Budget: ${ns.format.number(currentBudget)})`
                            );
                            continue;
                        }
                    }

                    openPositions++;
                } else {
                    holdTicks.delete(sym);
                }
            }

            // 3. Rank strong buy candidates and open concentrated positions above minTradeValue
            const candidates = [];
            for (const sym of symbols) {
                const history = priceHistory.get(sym);
                if (!has4STix && (!history || history.length < historyLength)) {
                    continue;
                }

                const forecast = getEffectiveForecast(ns, sym, has4STix, history);
                if (forecast >= buyThreshold) {
                    // Require recent 5-tick confirmation before 4S to avoid buying into a stalling top
                    if (!has4STix && !hasRecentConfirmation(history, 5, 0.75)) {
                        continue;
                    }

                    const maxShares = ns.stock.getMaxShares(sym);
                    const pos = ns.stock.getPosition(sym);
                    const currentShares = pos[0] ?? 0;
                    const buyableShares = maxShares - currentShares;
                    if (buyableShares > 0) {
                        candidates.push({ sym, forecast, buyableShares, isExisting: currentShares > 0 });
                    }
                }
            }

            candidates.sort((a, b) => b.forecast - a.forecast);

            for (const item of candidates) {
                if (currentBudget < minTradeValue + commission) break;
                if (!has4STix && !item.isExisting && openPositions >= maxPositionsPre4S) continue;

                const askPrice = ns.stock.getAskPrice(item.sym);
                const maxAffordable = Math.floor((currentBudget - commission) / askPrice);
                const sharesToBuy = Math.min(item.buyableShares, maxAffordable);
                const totalCost = sharesToBuy * askPrice + commission;

                if (sharesToBuy > 0 && totalCost >= minTradeValue) {
                    const boughtAt = ns.stock.buyStock(item.sym, sharesToBuy);
                    if (boughtAt > 0) {
                        if (!item.isExisting) {
                            openPositions++;
                            holdTicks.set(item.sym, 0);
                        }
                        const spent = boughtAt * sharesToBuy + commission;
                        currentBudget = Math.max(0, currentBudget - spent);
                        await writeBudget(ns, budgetFile, currentBudget);
                        lastRecordedCash = ns.getServerMoneyAvailable("home");

                        ns.print(
                            `🛒 BOUGHT ${sharesToBuy} ${item.sym} @ ${ns.format.number(boughtAt)} ` +
                            `(Signal: ${(item.forecast * 100).toFixed(1)}% | Budget left: ${ns.format.number(currentBudget)})`
                        );
                    }
                }
            }
        } else {
            ns.print(
                `⏳ Waiting for WSE & TIX API access ` +
                `(Cash: ${ns.format.number(cash)} | Budget in ${budgetFile}: ${ns.format.number(currentBudget)})...`
            );
        }

        if (typeof ns.stock.nextUpdate === "function") {
            await ns.stock.nextUpdate();
        } else {
            await ns.sleep(6000);
        }
    }
}

async function writeBudget(ns, file, amount) {
    await ns.write(file, String(Math.max(0, Math.floor(amount))), "w");
}

function readBudget(ns, file) {
    if (!ns.fileExists(file, "home")) return null;
    const raw = ns.read(file).trim();
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
}

function buyMarketAccess(ns, budget) {
    if (budget <= 0) return 0;

    const constants = safeCall(() => ns.stock.getConstants(), {});

    const wseCost = constants.WseAccountCost ?? 200_000_000;
    const tixCost = constants.TixApiCost ?? 5_000_000_000;
    const fourSCost = constants.FourSigmaMarketDataCost ?? 1_000_000_000;
    const fourSApiCost = constants.FourSigmaMarketDataApiCost ?? 25_000_000_000;

    let spent = 0;

    if (!safeBool(() => ns.stock.hasWseAccount())) {
        if (budget >= wseCost && safeBool(() => ns.stock.purchaseWseAccount())) {
            spent += wseCost;
            ns.tprint(`✅ Purchased WSE Account (${ns.format.number(wseCost)})`);
        }
        return spent;
    }

    if (!safeBool(() => ns.stock.hasTixApiAccess())) {
        if (budget >= tixCost && safeBool(() => ns.stock.purchaseTixApi())) {
            spent += tixCost;
            ns.tprint(`✅ Purchased TIX API Access (${ns.format.number(tixCost)})`);
        }
        return spent;
    }

    if (!safeBool(() => ns.stock.has4SData())) {
        if (budget - spent >= fourSCost && safeBool(() => ns.stock.purchase4SMarketData())) {
            spent += fourSCost;
            ns.tprint(`✅ Purchased 4S Market Data (${ns.format.number(fourSCost)})`);
        }
    }

    if (!safeBool(() => ns.stock.has4SDataTixApi())) {
        if (budget - spent >= fourSApiCost && safeBool(() => ns.stock.purchase4SMarketDataTixApi())) {
            spent += fourSApiCost;
            ns.tprint(`✅ Purchased 4S Market Data TIX API (${ns.format.number(fourSApiCost)})`);
        }
    }

    return spent;
}

function getEffectiveForecast(ns, sym, has4SApi, history) {
    if (has4SApi) {
        const forecast = safeCall(() => ns.stock.getForecast(sym), null);
        if (typeof forecast === "number" && !Number.isNaN(forecast)) {
            return forecast;
        }
    }

    if (!history || history.length < 2) {
        return 0.5;
    }

    let upticks = 0;
    let comparisons = 0;
    for (let i = 1; i < history.length; i++) {
        comparisons++;
        if (history[i] > history[i - 1]) {
            upticks++;
        }
    }

    return comparisons > 0 ? upticks / comparisons : 0.5;
}

function hasRecentConfirmation(history, windowTicks, minRatio) {
    if (!history || history.length < windowTicks + 1) return false;
    let upticks = 0;
    const start = history.length - windowTicks;
    for (let i = start; i < history.length; i++) {
        if (history[i] > history[i - 1]) upticks++;
    }
    return upticks / windowTicks >= minRatio;
}

function safeCall(fn, fallback) {
    try {
        return fn();
    } catch {
        return fallback;
    }
}

function safeBool(fn) {
    try {
        return Boolean(fn());
    } catch {
        return false;
    }
}
