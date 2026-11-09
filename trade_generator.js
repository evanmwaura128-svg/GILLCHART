import { convertPriceToY, convertYToPrice, measureCandleShape } from './lesson1_structure.js';

const WAITING_FOR_DATA = 'WAITING FOR DATA';

function formatPrice(value) {
    return Number.isFinite(value) ? `$${Number.parseFloat(value).toFixed(2)}` : '\u2014';
}

function candleOverlapsPriceZone(candle, lowerPrice, upperPrice) {
    return Boolean(candle)
        && Number.isFinite(candle.lowPrice)
        && Number.isFinite(candle.highPrice)
        && candle.lowPrice <= upperPrice
        && candle.highPrice >= lowerPrice;
}

function updateElement(selector, id, text) {
    if (typeof document === 'undefined') return;
    let element = null;
    try {
        if (typeof document.querySelector === 'function') element = document.querySelector(selector);
    } catch (error) {
        console.warn(`Unable to query ${selector}:`, error);
    }
    try {
        if (!element && typeof document.getElementById === 'function') element = document.getElementById(id);
        if (element) element.innerText = text;
    } catch (error) {
        console.error(`Unable to update ${selector}:`, error);
    }
}

function updateSidebar(decision, entry, tp, sl, livePrice) {
    if (typeof document === 'undefined') return;
    updateElement('.decision-title', 'decision-result', decision);
    updateElement('.entry-value', 'entry-value', formatPrice(entry));
    updateElement('.tp-value', 'tp-value', formatPrice(tp));
    updateElement('.sl-value', 'sl-value', formatPrice(sl));
    updateElement('.waiting-status', 'setup-status', Number.isFinite(livePrice)
        ? `LIVE ${formatPrice(livePrice)}`
        : 'AWAITING LIVE CANDLE');

    try {
        const buyRadio = document.getElementById('buy-now-radio');
        const sellRadio = document.getElementById('sell-now-radio');
        const waitRadio = document.getElementById('wait-radio');
        if (buyRadio) buyRadio.checked = false;
        if (sellRadio) sellRadio.checked = false;
        if (waitRadio) waitRadio.checked = false;

        const activeId = 'decision-wait';
        if (waitRadio) waitRadio.checked = true;

        const optionIds = ['decision-buy', 'decision-sell', 'decision-wait'];
        for (let index = 0; index < optionIds.length; index++) {
            const option = document.getElementById(optionIds[index]);
            if (!option) continue;
            const active = optionIds[index] === activeId;
            if (option.classList && typeof option.classList.toggle === 'function') {
                option.classList.toggle('is-active', active);
            }
            if (typeof option.setAttribute === 'function') option.setAttribute('aria-pressed', String(active));
        }
    } catch (error) {
        console.error('Trade option update failed:', error);
    }
}

function findBearishOrderBlock(candles, currentIndex, breakdownPrice) {
    let breakdownTriggerIndex = currentIndex;
    while (breakdownTriggerIndex > 0) {
        const previousCandle = candles[breakdownTriggerIndex - 1];
        if (!previousCandle || !Number.isFinite(previousCandle.closePrice)
            || previousCandle.closePrice >= breakdownPrice) break;
        breakdownTriggerIndex--;
    }

    for (let index = breakdownTriggerIndex - 1; index >= 0; index--) {
        const candle = candles[index];
        if (candle && Number.isFinite(candle.openPrice) && Number.isFinite(candle.closePrice)
            && candle.closePrice > candle.openPrice
            && Number.isFinite(candle.highPrice) && Number.isFinite(candle.lowPrice)) {
            return candle;
        }
    }
    return null;
}

function findRecentBullishLaunchpad(candles, lastIndex) {
    const firstRecentIndex = Math.max(0, lastIndex - 10);
    let totalRange = 0;
    let rangeCount = 0;
    for (let index = firstRecentIndex; index <= lastIndex; index++) {
        const candle = candles[index];
        if (!candle || !Number.isFinite(candle.highPrice) || !Number.isFinite(candle.lowPrice)) continue;
        const candleRange = candle.highPrice - candle.lowPrice;
        if (candleRange > 0) {
            totalRange += candleRange;
            rangeCount++;
        }
    }
    if (!rangeCount) return null;
    const minimumWallRange = (totalRange / rangeCount) * 1.5;

    for (let wallIndex = lastIndex; wallIndex >= firstRecentIndex; wallIndex--) {
        const wall = candles[wallIndex];
        if (!wall || !Number.isFinite(wall.openPrice) || !Number.isFinite(wall.closePrice)
            || !Number.isFinite(wall.highPrice) || !Number.isFinite(wall.lowPrice)
            || wall.closePrice <= wall.openPrice
            || (wall.highPrice - wall.lowPrice) < minimumWallRange) continue;

        for (let orderBlockIndex = wallIndex - 1; orderBlockIndex >= firstRecentIndex; orderBlockIndex--) {
            const orderBlock = candles[orderBlockIndex];
            if (!orderBlock || !Number.isFinite(orderBlock.openPrice) || !Number.isFinite(orderBlock.closePrice)
                || !Number.isFinite(orderBlock.highPrice) || !Number.isFinite(orderBlock.lowPrice)
                || orderBlock.closePrice >= orderBlock.openPrice) continue;

            const bodyFloor = Math.min(orderBlock.openPrice, orderBlock.closePrice);
            const bodyCeiling = Math.max(orderBlock.openPrice, orderBlock.closePrice);
            for (let checkIndex = wallIndex + 1; checkIndex <= lastIndex; checkIndex++) {
                if (candleOverlapsPriceZone(candles[checkIndex], bodyFloor, bodyCeiling)) return null;
            }
            return { candle: orderBlock, index: orderBlockIndex, wallIndex, bodyFloor, bodyCeiling };
        }
    }
    return null;
}

function findUnmitigatedFairValueGap(candles, currentIndex, direction) {
    for (let thirdIndex = currentIndex; thirdIndex >= 2; thirdIndex--) {
        const firstCandle = candles[thirdIndex - 2];
        const impulseCandle = candles[thirdIndex - 1];
        const thirdCandle = candles[thirdIndex];
        if (!firstCandle || !impulseCandle || !thirdCandle
            || !Number.isFinite(firstCandle.highPrice) || !Number.isFinite(firstCandle.lowPrice)
            || !Number.isFinite(impulseCandle.openPrice) || !Number.isFinite(impulseCandle.closePrice)
            || !Number.isFinite(thirdCandle.highPrice) || !Number.isFinite(thirdCandle.lowPrice)
            || ![firstCandle.highY, firstCandle.lowY, impulseCandle.lowY, impulseCandle.highY,
                thirdCandle.highY, thirdCandle.lowY].every(Number.isFinite)) continue;

        let priorBodyTotal = 0;
        let priorBodyCount = 0;
        const averageStart = Math.max(0, thirdIndex - 7);
        for (let index = averageStart; index < thirdIndex - 1; index++) {
            const candle = candles[index];
            if (!candle || !Number.isFinite(candle.openPrice) || !Number.isFinite(candle.closePrice)) continue;
            const body = Math.abs(candle.closePrice - candle.openPrice);
            if (body > 0) {
                priorBodyTotal += body;
                priorBodyCount++;
            }
        }
        if (!priorBodyCount) continue;
        const averagePriorBody = priorBodyTotal / priorBodyCount;
        const impulseBody = Math.abs(impulseCandle.closePrice - impulseCandle.openPrice);
        if (impulseBody < averagePriorBody * 1.25) continue;

        let gapLowerPrice;
        let gapUpperPrice;
        if (direction === 'bullish') {
            if (impulseCandle.closePrice <= impulseCandle.openPrice
                || firstCandle.highPrice >= thirdCandle.lowPrice) continue;
            gapLowerPrice = firstCandle.highPrice;
            gapUpperPrice = thirdCandle.lowPrice;
        } else {
            if (impulseCandle.closePrice >= impulseCandle.openPrice
                || firstCandle.lowPrice <= thirdCandle.highPrice) continue;
            gapLowerPrice = thirdCandle.highPrice;
            gapUpperPrice = firstCandle.lowPrice;
        }

        let mitigated = false;
        for (let index = thirdIndex + 1; index < currentIndex; index++) {
            const candle = candles[index];
            if (!candle) continue;
            if (direction === 'bullish'
                && Number.isFinite(candle.lowPrice)
                && candle.lowPrice <= gapUpperPrice) {
                mitigated = true;
                break;
            }
            if (direction === 'bearish'
                && Number.isFinite(candle.highPrice)
                && candle.highPrice >= gapLowerPrice) {
                mitigated = true;
                break;
            }
        }

        if (mitigated) return null;
        return {
            thirdIndex,
            gapLowerPrice,
            gapUpperPrice,
            entryY: direction === 'bullish'
                ? (firstCandle.highY + thirdCandle.lowY) / 2
                : (thirdCandle.highY + firstCandle.lowY) / 2,
            stopWickY: direction === 'bullish'
                ? Math.max(firstCandle.lowY, impulseCandle.lowY, thirdCandle.lowY)
                : Math.min(firstCandle.highY, impulseCandle.highY, thirdCandle.highY),
            liveTouchesGap: candleOverlapsPriceZone(candles[currentIndex], gapLowerPrice, gapUpperPrice)
        };
    }

    return null;
}

export function evaluateTradeSignal(
    candles,
    highSwings,
    lowSwings,
    canvas,
    timeframe = ''
) {
    let dailyTrendBias = 'BULLISH';
    let proximityContext = null;
    let decision = WAITING_FOR_DATA;
    let entryTarget = null;
    let takeProfitTarget = null;
    let stopLossTarget = null;
    let livePrice = null;
    let pipSizeMultiplier = 35.00;
    let riskBufferGap = 7.00;
    const finalize = () => {
        if (typeof document !== 'undefined') {
            try {
                const trendControl = document.querySelector?.('#daily-trend-bias, [data-daily-trend-bias]')
                    || document.getElementById?.('daily-trend-bias');
                const trendText = trendControl?.value
                    ?? trendControl?.dataset?.dailyTrendBias
                    ?? trendControl?.textContent
                    ?? trendControl?.innerText
                    ?? '';
                const trendMatch = String(trendText).toUpperCase().match(/\b(BULLISH|BEARISH|RANGE)\b/);
                if (trendMatch) dailyTrendBias = trendMatch[1];
            } catch (error) {
                console.warn('Daily trend bias unavailable:', error);
            }
        }

        const bullishDecision = decision === 'BUY NOW'
            || decision === 'BOS: WAIT TO BUY'
            || decision === 'BOS: WAIT AT ORDER BLOCK'
            || decision === 'WAIT (BUY AT FLOOR)';
        const bearishDecision = decision === 'SELL NOW'
            || decision === 'BOS: WAIT TO SELL'
            || decision === 'BOS: BEARISH ORDER BLOCK'
            || decision === 'WAIT (SELL AT CEILING)';
        if (dailyTrendBias === 'BEARISH' && bullishDecision) {
            decision = proximityContext === 'SUPPORT'
                ? 'SUPPORT RETEST: WAIT (DAILY IS BEARISH)'
                : 'WAIT (DAILY IS BEARISH)';
        } else if (dailyTrendBias === 'BULLISH' && bearishDecision) {
            decision = proximityContext === 'CEILING'
                ? 'CEILING RETEST: WAIT (DAILY IS BULLISH)'
                : 'WAIT (DAILY IS BULLISH)';
        }
        if (typeof document !== 'undefined') {
            updateSidebar(decision, entryTarget, takeProfitTarget, stopLossTarget, livePrice);
        }
        return { decision, livePrice, entryTarget, takeProfitTarget, stopLossTarget };
    };

    try {
        const timeframeText = typeof timeframe === 'string' ? timeframe.toUpperCase() : '';
        if (timeframeText.includes('M5') || timeframeText.includes('M15')) {
            pipSizeMultiplier = 5.00;
            riskBufferGap = 2.00;
        } else if (timeframeText.includes('H1') || timeframeText.includes('1H')) {
            pipSizeMultiplier = 35.00;
            riskBufferGap = 7.00;
        } else if (timeframeText.includes('H4') || timeframeText.includes('D1')) {
            pipSizeMultiplier = 75.00;
            riskBufferGap = 15.00;
        }

        if (!Array.isArray(candles) || candles.length === 0
            || !Array.isArray(highSwings) || highSwings.length === 0
            || !Array.isArray(lowSwings) || lowSwings.length === 0
            || !canvas || !Number.isFinite(canvas.height)) {
            return finalize();
        }

        const liveCandleIndex = candles.length - 1;
        const liveCandle = candles[liveCandleIndex];
        if (!liveCandle) return finalize();

        const liveClose = Number.isFinite(liveCandle.closePrice)
            ? liveCandle.closePrice
            : Number.isFinite(liveCandle.highY)
                ? convertYToPrice(canvas, liveCandle.highY)
                : NaN;
        livePrice = liveClose;
        const PROXIMITY_ZONE = 3.00;
        let latestPeak = highSwings[highSwings.length - 1];
        let latestValley = lowSwings[lowSwings.length - 1];
        if (!latestPeak || !latestValley) return finalize();

        const peakGoldPrice = Number.parseFloat(latestPeak.goldPrice);
        const valleyGoldPrice = Number.parseFloat(latestValley.goldPrice);
        const peakPrice = Number.isFinite(peakGoldPrice)
            ? peakGoldPrice
            : Number.isFinite(latestPeak.highY)
                ? convertYToPrice(canvas, latestPeak.highY)
                : NaN;
        const valleyPrice = Number.isFinite(valleyGoldPrice)
            ? valleyGoldPrice
            : Number.isFinite(latestValley.lowY)
                ? convertYToPrice(canvas, latestValley.lowY)
                : NaN;
        const rangeHeight = parseFloat(peakPrice) - parseFloat(valleyPrice);
        if (!Number.isFinite(livePrice) || !Number.isFinite(peakPrice)
            || !Number.isFinite(valleyPrice) || !Number.isFinite(rangeHeight) || rangeHeight <= 0) {
            livePrice = null;
            return finalize();
        }

        const dynamicRisk = rangeHeight * 0.20;
        const dynamicReward = dynamicRisk * 1.5;
        const liveShape = liveCandle.shape || measureCandleShape(liveCandle);
        const ceilingRetest = Math.abs(liveClose - peakPrice) <= PROXIMITY_ZONE;
        const floorRetest = Math.abs(liveClose - valleyPrice) <= PROXIMITY_ZONE;

        const highSweep = liveCandle.highPrice > peakPrice && liveClose <= peakPrice;
        const lowSweep = liveCandle.lowPrice < valleyPrice && liveClose >= valleyPrice;
            const bullishFvg = findUnmitigatedFairValueGap(candles, liveCandleIndex, 'bullish');
            const bearishFvg = findUnmitigatedFairValueGap(candles, liveCandleIndex, 'bearish');
            let activeFvg = null;
            if (bullishFvg && bearishFvg) {
                activeFvg = bullishFvg.thirdIndex >= bearishFvg.thirdIndex
                    ? { ...bullishFvg, direction: 'bullish' }
                    : { ...bearishFvg, direction: 'bearish' };
            } else if (bullishFvg) {
                activeFvg = { ...bullishFvg, direction: 'bullish' };
            } else if (bearishFvg) {
                activeFvg = { ...bearishFvg, direction: 'bearish' };
            }
        const bullishOrderBlock = findRecentBullishLaunchpad(candles, liveCandleIndex - 1);

        if (ceilingRetest) {
            proximityContext = 'CEILING';
            if (liveShape && (liveShape.isDoji
                || (liveShape.isBearish && (liveShape.isPinBar || liveShape.isMarubozu)))) {
                decision = 'SELL NOW';
            } else {
                decision = 'CEILING RETEST: WAIT FOR CONFIRMATION';
            }
            entryTarget = liveClose;
            stopLossTarget = peakPrice + 3.00;
            takeProfitTarget = valleyPrice;
        } else if (floorRetest) {
            proximityContext = 'SUPPORT';
            if (liveShape && liveShape.isBullish
                && (liveShape.isPinBar || liveShape.isHammer || liveShape.isMarubozu)) {
                decision = 'BUY NOW';
            } else {
                decision = 'SUPPORT RETEST: WAIT FOR CONFIRMATION';
            }
            entryTarget = liveClose;
            stopLossTarget = valleyPrice - 3.00;
            takeProfitTarget = peakPrice;
        } else if (highSweep && liveShape && liveShape.isPinBar && liveShape.isInvertedHammer) {
            decision = 'SELL NOW';
            entryTarget = peakPrice;
            stopLossTarget = liveCandle.highPrice + riskBufferGap;
            takeProfitTarget = valleyPrice;
        } else if (lowSweep && liveShape && liveShape.isPinBar && liveShape.isHammer) {
            decision = 'BUY NOW';
            entryTarget = valleyPrice;
            stopLossTarget = liveCandle.lowPrice - riskBufferGap;
            takeProfitTarget = peakPrice;
        } else if (activeFvg && (activeFvg.liveTouchesGap
            || liveClose > peakPrice || liveClose < valleyPrice)) {
            const refillConfirmed = activeFvg.liveTouchesGap && liveShape
                    && (liveShape.isDoji || (activeFvg.direction === 'bullish'
                        ? liveShape.isBearish && liveShape.isHammer
                        : liveShape.isBullish && liveShape.isInvertedHammer));
            decision = refillConfirmed ? 'FVG: REFILL CONFIRMED - READY' : 'FVG: WAIT FOR REFILL';
            const fvgStopBuffer = Math.min(riskBufferGap, Math.max(1, rangeHeight * 0.1));

            entryTarget = convertYToPrice(canvas, activeFvg.entryY);
            const wickPrice = convertYToPrice(canvas, activeFvg.stopWickY);
            if (activeFvg.direction === 'bullish') {
                stopLossTarget = Math.min(wickPrice, activeFvg.gapLowerPrice) - fvgStopBuffer;
                const ceilingPrice = Number.isFinite(latestPeak.highY)
                    ? convertYToPrice(canvas, latestPeak.highY)
                    : peakPrice;
                takeProfitTarget = ceilingPrice > entryTarget
                    ? ceilingPrice
                    : entryTarget + ((entryTarget - stopLossTarget) * 1.5);
            } else {
                stopLossTarget = Math.max(wickPrice, activeFvg.gapUpperPrice) + fvgStopBuffer;
                const floorPrice = Number.isFinite(latestValley.lowY)
                    ? convertYToPrice(canvas, latestValley.lowY)
                    : valleyPrice;
                takeProfitTarget = floorPrice < entryTarget
                    ? floorPrice
                    : entryTarget - ((stopLossTarget - entryTarget) * 1.5);
            }
        } else if (bullishOrderBlock && candleOverlapsPriceZone(liveCandle,
            bullishOrderBlock.bodyFloor, bullishOrderBlock.bodyCeiling)) {
            if (liveShape && liveShape.isMarubozu && liveShape.isBullish) {
                decision = 'BUY NOW';
                entryTarget = liveClose;
                stopLossTarget = bullishOrderBlock.candle.lowPrice - riskBufferGap;
                takeProfitTarget = entryTarget + ((entryTarget - stopLossTarget) * 2.0);
            } else if (liveShape && liveShape.isMarubozu && liveShape.isBearish) {
                decision = 'WAIT: EXHAUSTION';
            } else {
                decision = 'BOS: WAIT AT ORDER BLOCK';
                entryTarget = bullishOrderBlock.candle.openPrice;
                stopLossTarget = bullishOrderBlock.candle.lowPrice - riskBufferGap;
                takeProfitTarget = entryTarget + ((entryTarget - stopLossTarget) * 2.0);
            }
        } else if (liveClose > peakPrice) {
                let recentRangeTotal = 0;
                let recentRangeCount = 0;
                const recentRangeStart = Math.max(0, liveCandleIndex - 10);
                for (let rangeIndex = recentRangeStart; rangeIndex <= liveCandleIndex; rangeIndex++) {
                    const sampleCandle = candles[rangeIndex];
                    if (!sampleCandle || !Number.isFinite(sampleCandle.highPrice)
                        || !Number.isFinite(sampleCandle.lowPrice)) continue;
                    const candleRange = sampleCandle.highPrice - sampleCandle.lowPrice;
                    if (candleRange > 0) {
                        recentRangeTotal += candleRange;
                        recentRangeCount++;
                    }
                }
                const averageRecentRange = recentRangeCount > 0 ? recentRangeTotal / recentRangeCount : 0;
                const tallWallMinimumRange = averageRecentRange * 1.5;
                let tallGreenWallIndex = -1;

                for (let i = liveCandleIndex; i >= recentRangeStart; i--) {
                    const candle = candles[i];
                    if (!candle || !Number.isFinite(candle.openPrice)
                        || !Number.isFinite(candle.closePrice)
                        || !Number.isFinite(candle.highPrice)
                        || !Number.isFinite(candle.lowPrice)) continue;
                    const candleRange = candle.highPrice - candle.lowPrice;
                    if (candle.closePrice > candle.openPrice
                        && averageRecentRange > 0
                        && candleRange >= tallWallMinimumRange) {
                        tallGreenWallIndex = i;
                        break;
                    }
                }

                let launchPadCandle = null;
                for (let i = tallGreenWallIndex - 1; i >= 0; i--) {
                    const candle = candles[i];
                    if (candle && Number.isFinite(candle.openPrice)
                        && Number.isFinite(candle.closePrice)
                        && candle.closePrice < candle.openPrice
                        && Number.isFinite(candle.highPrice)
                        && Number.isFinite(candle.lowPrice)) {
                        launchPadCandle = candles[i];
                        break;
                    }
                }

                if (launchPadCandle) {
                    const bodyFloor = Math.min(launchPadCandle.openPrice, launchPadCandle.closePrice);
                    const bodyCeiling = Math.max(launchPadCandle.openPrice, launchPadCandle.closePrice);
                    let launchPadMitigated = false;
                    for (let index = tallGreenWallIndex + 1; index < liveCandleIndex; index++) {
                        if (candleOverlapsPriceZone(candles[index], bodyFloor, bodyCeiling)) {
                            launchPadMitigated = true;
                            break;
                        }
                    }

                    if (launchPadMitigated) {
                        decision = WAITING_FOR_DATA;
                    } else if (candleOverlapsPriceZone(liveCandle, bodyFloor, bodyCeiling)
                        && liveShape && liveShape.isMarubozu && liveShape.isBullish) {
                        decision = 'BUY NOW';
                        entryTarget = liveClose;
                        stopLossTarget = launchPadCandle.lowPrice - riskBufferGap;
                        takeProfitTarget = entryTarget + ((entryTarget - stopLossTarget) * 2.0);
                    } else if (candleOverlapsPriceZone(liveCandle, bodyFloor, bodyCeiling)
                        && liveShape && liveShape.isMarubozu && liveShape.isBearish) {
                        decision = 'WAIT: EXHAUSTION';
                    } else {
                        decision = 'BOS: WAIT AT ORDER BLOCK';
                        entryTarget = launchPadCandle.openPrice;
                        stopLossTarget = launchPadCandle.lowPrice - 3.00;
                        takeProfitTarget = entryTarget + ((entryTarget - stopLossTarget) * 2.0);
                    }
                } else {
                    decision = WAITING_FOR_DATA;
                }
        } else if (liveClose < valleyPrice) {
                const bearishOB = findBearishOrderBlock(candles, liveCandleIndex, valleyPrice);
                if (bearishOB) {
                    let bearishOBIndex = -1;
                    for (let index = 0; index < liveCandleIndex; index++) {
                        if (candles[index] === bearishOB) {
                            bearishOBIndex = index;
                            break;
                        }
                    }
                    const bodyFloor = Math.min(bearishOB.openPrice, bearishOB.closePrice);
                    const bodyCeiling = Math.max(bearishOB.openPrice, bearishOB.closePrice);
                    let blockMitigated = false;
                    for (let index = bearishOBIndex + 1; index < liveCandleIndex; index++) {
                        if (candleOverlapsPriceZone(candles[index], bodyFloor, bodyCeiling)) {
                            blockMitigated = true;
                            break;
                        }
                    }

                    if (blockMitigated) {
                        decision = WAITING_FOR_DATA;
                    } else if (candleOverlapsPriceZone(liveCandle, bodyFloor, bodyCeiling)
                        && liveShape && liveShape.isMarubozu && liveShape.isBearish) {
                        decision = 'SELL NOW';
                        entryTarget = liveClose;
                        stopLossTarget = bearishOB.highPrice + riskBufferGap;
                        takeProfitTarget = entryTarget - ((stopLossTarget - entryTarget) * 2.0);
                    } else if (candleOverlapsPriceZone(liveCandle, bodyFloor, bodyCeiling)
                        && liveShape && liveShape.isMarubozu && liveShape.isBullish) {
                        decision = 'WAIT: EXHAUSTION';
                    } else {
                        decision = 'BOS: BEARISH ORDER BLOCK';
                        entryTarget = bearishOB.lowPrice;
                        stopLossTarget = bearishOB.highPrice + 3.00;
                        takeProfitTarget = entryTarget - ((stopLossTarget - entryTarget) * 2.0);
                    }
                } else {
                    decision = 'BOS: WAIT TO SELL';
                    entryTarget = valleyPrice;
                    stopLossTarget = entryTarget + dynamicRisk;
                    takeProfitTarget = entryTarget - dynamicReward;
                }
        } else {
            const midpoint = (peakPrice + valleyPrice) / 2;
            if (livePrice < midpoint) {
                decision = 'WAIT (BUY AT FLOOR)';
                entryTarget = valleyPrice;
                stopLossTarget = entryTarget - 5.00;
                takeProfitTarget = peakPrice;
                if (Math.abs(takeProfitTarget - entryTarget) < Math.abs(entryTarget - stopLossTarget)) {
                    takeProfitTarget = peakPrice + pipSizeMultiplier;
                }
                const floorTolerance = rangeHeight * 0.02;
                const touchesFloor = Number.isFinite(liveCandle.lowPrice)
                    && Number.isFinite(liveCandle.highPrice)
                    && liveCandle.lowPrice <= valleyPrice + floorTolerance
                    && liveCandle.highPrice >= valleyPrice - floorTolerance;
                if (touchesFloor && liveShape && liveShape.isBullish
                    && (liveShape.isHammer || liveShape.isMarubozu)) {
                    decision = 'BUY NOW';
                }
            } else {
                decision = 'WAIT (SELL AT CEILING)';
                entryTarget = peakPrice;
                stopLossTarget = entryTarget + 5.00;
                takeProfitTarget = valleyPrice;
                if (Math.abs(entryTarget - takeProfitTarget) < Math.abs(stopLossTarget - entryTarget)) {
                    takeProfitTarget = valleyPrice - pipSizeMultiplier;
                }
                const ceilingTolerance = rangeHeight * 0.02;
                const touchesCeiling = Number.isFinite(liveCandle.lowPrice)
                    && Number.isFinite(liveCandle.highPrice)
                    && liveCandle.lowPrice <= peakPrice + ceilingTolerance
                    && liveCandle.highPrice >= peakPrice - ceilingTolerance;
                if (touchesCeiling && liveShape && liveShape.isBearish
                    && (liveShape.isInvertedHammer || liveShape.isMarubozu)) {
                    decision = 'SELL NOW';
                }
            }
        }
    } catch (error) {
        console.error('Trade signal evaluation failed:', error);
        decision = WAITING_FOR_DATA;
        livePrice = null;
        entryTarget = null;
        takeProfitTarget = null;
        stopLossTarget = null;
        return finalize();
    }

    return finalize();
}

export function renderDashboardSignals(
    decision,
    entryTarget,
    takeProfitTarget,
    stopLossTarget,
    canvas,
    ctx,
    livePrice = null
) {
    updateSidebar(decision, entryTarget, takeProfitTarget, stopLossTarget, livePrice);
    if (!canvas || !ctx) return;

    try {
        const bands = [
            { price: entryTarget, color: 'blue' },
            { price: takeProfitTarget, color: 'green' },
            { price: stopLossTarget, color: 'red' }
        ];
        const startX = Math.floor(canvas.width * 0.04);
        const endX = Math.floor(canvas.width * 0.85);
        ctx.save();
        try {
            ctx.setLineDash([5, 5]);
            ctx.lineWidth = 2;
            for (let index = 0; index < bands.length; index++) {
                const band = bands[index];
                if (!Number.isFinite(band.price)) continue;
                const y = convertPriceToY(canvas, band.price);
                if (!Number.isFinite(y)) continue;

                ctx.beginPath();
                ctx.strokeStyle = band.color;
                ctx.moveTo(startX, y);
                ctx.lineTo(endX, y);
                ctx.stroke();

                const priceText = formatPrice(band.price);
                ctx.font = 'bold 12px Arial';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                const badgeWidth = Math.ceil(ctx.measureText(priceText).width) + 12;
                const badgeHeight = 20;
                const badgeY = Math.max(0, Math.min(canvas.height - badgeHeight, y - (badgeHeight / 2)));
                ctx.fillStyle = band.color;
                ctx.fillRect(0, badgeY, badgeWidth, badgeHeight);
                ctx.fillStyle = '#ffffff';
                ctx.fillText(priceText, 6, badgeY + (badgeHeight / 2));
            }
        } finally {
            ctx.restore();
        }
    } catch (error) {
        console.error('Trade line rendering failed:', error);
    }
}

export function generateTradeSetup(marketData, canvas, ctx) {
    let result;
    try {
        const candles = marketData && marketData.candles;
        const highSwings = marketData && marketData.highSwings;
        const lowSwings = marketData && marketData.lowSwings;
        result = evaluateTradeSignal(
            candles,
            highSwings,
            lowSwings,
            canvas,
            marketData && marketData.timeframe
        );
    } catch (error) {
        console.error('Trade setup generation failed:', error);
        result = {
            decision: WAITING_FOR_DATA,
            livePrice: null,
            entryTarget: null,
            takeProfitTarget: null,
            stopLossTarget: null
        };
    }

    renderDashboardSignals(
        result.decision,
        result.entryTarget,
        result.takeProfitTarget,
        result.stopLossTarget,
        canvas,
        ctx,
        result.livePrice
    );
    return {
        decision: result.decision,
        currentPrice: result.livePrice,
        livePrice: result.livePrice,
        entry: result.entryTarget,
        takeProfit: result.takeProfitTarget,
        stopLoss: result.stopLossTarget
    };
}
