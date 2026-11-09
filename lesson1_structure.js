const MIN_CANDLE_RUN = 3;
const HIGH_PRICE_BOUNDARY = 4076.00;
const LOW_PRICE_BOUNDARY = 4056.00;
const TESSERACT_MODULE_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js';

function classifyCandleColor(red, green, blue) {
    if (red > 140 && green < 100 && blue < 100) return 'bearish';
    if (red < 130 && green > 110 && blue > 110) return 'bullish';
    return null;
}

export function measureCandleShape(candle) {
    if (!candle || !Number.isFinite(candle.openPrice) || !Number.isFinite(candle.closePrice)
        || !Number.isFinite(candle.highPrice) || !Number.isFinite(candle.lowPrice)) return null;

    const bodyLength = Math.abs(candle.closePrice - candle.openPrice);
    const totalLength = candle.highPrice - candle.lowPrice;
    if (totalLength <= 0) return null;

    const precisionTolerance = Number.EPSILON * Math.max(
        1,
        Math.abs(candle.openPrice),
        Math.abs(candle.closePrice),
        Math.abs(candle.highPrice),
        Math.abs(candle.lowPrice)
    ) * 4;
    const upperWick = candle.highPrice - Math.max(candle.openPrice, candle.closePrice);
    const lowerWick = Math.min(candle.openPrice, candle.closePrice) - candle.lowPrice;
    const isDoji = bodyLength <= (totalLength * 0.05) + precisionTolerance;
    const isPinBar = !isDoji
        && bodyLength <= (totalLength * 0.3) + precisionTolerance
        && Math.max(upperWick, lowerWick) >= (totalLength * 0.5);

    return {
        bodyLength,
        totalLength,
        upperWick,
        lowerWick,
        isDoji,
        isPinBar,
        isHammer: isPinBar && lowerWick > upperWick,
        isInvertedHammer: isPinBar && upperWick > lowerWick,
        isMarubozu: bodyLength >= (totalLength * 0.85) - precisionTolerance,
        isBullish: candle.closePrice > candle.openPrice,
        isBearish: candle.closePrice < candle.openPrice
    };
}

function findVerticalSegment(yCoordinates) {
    if (yCoordinates.length < MIN_CANDLE_RUN) return null;

    let runStart = 0;
    let highY = Infinity;
    let lowY = -Infinity;
    for (let index = 1; index <= yCoordinates.length; index++) {
        if (index < yCoordinates.length && yCoordinates[index] <= yCoordinates[index - 1] + 1) continue;
        if (index - runStart >= MIN_CANDLE_RUN) {
            highY = Math.min(highY, yCoordinates[runStart]);
            lowY = Math.max(lowY, yCoordinates[index - 1]);
        }
        runStart = index;
    }

    return Number.isFinite(highY) && Number.isFinite(lowY) ? { highY, lowY } : null;
}

function appendChronologically(items, item) {
    let insertIndex = items.length;
    while (insertIndex > 0 && items[insertIndex - 1].x > item.x) {
        items[insertIndex] = items[insertIndex - 1];
        insertIndex--;
    }
    items[insertIndex] = item;
}

async function loadTesseract() {
    if (globalThis.Tesseract && typeof globalThis.Tesseract.createWorker === 'function') {
        return globalThis.Tesseract;
    }
    const module = await import(TESSERACT_MODULE_URL);
    return module.default ?? module;
}

export async function extractChartTimeframe(canvas) {
    const providedTimeframe = canvas?.dataset?.timeframe ?? canvas?.timeframe;
    if (typeof providedTimeframe === 'string') {
        const providedMatch = providedTimeframe.toUpperCase().match(/\b(M15|M5|M1|H1|1H|H4|D1)\b/);
        if (providedMatch) return providedMatch[0];
    }

    let worker;
    try {
        const crop = document.createElement('canvas');
        const sourceY = Math.floor(canvas.height * 0.88);
        const sourceHeight = Math.max(1, canvas.height - sourceY);
        const scale = 4;
        crop.width = canvas.width * scale;
        crop.height = sourceHeight * scale;
        const cropContext = crop.getContext('2d');
        cropContext.imageSmoothingEnabled = false;
        cropContext.drawImage(canvas, 0, sourceY, canvas.width, sourceHeight, 0, 0, crop.width, crop.height);

        const imageData = cropContext.getImageData(0, 0, crop.width, crop.height);
        for (let index = 0; index < imageData.data.length; index += 4) {
            const luminance = (imageData.data[index] * 0.299)
                + (imageData.data[index + 1] * 0.587)
                + (imageData.data[index + 2] * 0.114);
            const pixel = luminance < 180 ? 0 : 255;
            imageData.data[index] = pixel;
            imageData.data[index + 1] = pixel;
            imageData.data[index + 2] = pixel;
            imageData.data[index + 3] = 255;
        }
        cropContext.putImageData(imageData, 0, 0);

        const tesseract = await loadTesseract();
        worker = await tesseract.createWorker('eng');
        const result = await worker.recognize(crop);
        const text = String(result.data?.text ?? result.text ?? '').toUpperCase().replace(/\s+/g, ' ');
        if (/\b\d{1,2}:\d{2}\b/.test(text)) return 'M15';

        const monthPattern = 'JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?';
        const datePattern = new RegExp(`\\b(\\d{1,2})\\s*(${monthPattern})\\b`, 'g');
        const dates = [];
        let dateMatch;
        while ((dateMatch = datePattern.exec(text)) !== null) {
            const day = Number(dateMatch[1]);
            const month = dateMatch[2].slice(0, 3);
            const monthIndex = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].indexOf(month);
            if (day >= 1 && day <= 31 && monthIndex >= 0) dates.push((monthIndex * 31) + day);
        }

        if (dates.length > 1) {
            for (let index = 1; index < dates.length; index++) {
                let dayGap = Math.abs(dates[index] - dates[index - 1]);
                if (dayGap > 186) dayGap = 372 - dayGap;
                if (dayGap >= 5) return 'H4';
            }
            return 'H1';
        }
        if (dates.length === 1 || /\b\d{1,2}\b/.test(text)) return 'H1';
        if (new RegExp(`\\b(?:${monthPattern})\\b`).test(text)
            || /\b(?:WEEKLY|MONTHLY|W1|MN1|1W|1MN)\b/.test(text)) return 'H4';
        return null;
    } catch (error) {
        console.warn('Timeframe OCR unavailable for this image:', error);
        return null;
    } finally {
        if (worker) await worker.terminate();
    }
}

export async function extractChartPriceScale(canvas) {
    const fallback = {
        topPrice: HIGH_PRICE_BOUNDARY,
        bottomPrice: LOW_PRICE_BOUNDARY,
        topY: canvas.height * 0.12,
        bottomY: canvas.height * 0.85
    };
    if (typeof document === 'undefined' || !Number.isFinite(canvas?.width)
        || !Number.isFinite(canvas?.height)) return fallback;

    let worker;
    try {
        const sourceX = Math.floor(canvas.width * 0.80);
        const sourceY = Math.floor(canvas.height * 0.08);
        const sourceWidth = Math.max(1, canvas.width - sourceX);
        const sourceHeight = Math.max(1, Math.floor(canvas.height * 0.84));
        const scale = 4;
        const crop = document.createElement('canvas');
        crop.width = sourceWidth * scale;
        crop.height = sourceHeight * scale;
        const cropContext = crop.getContext('2d');
        cropContext.imageSmoothingEnabled = false;
        cropContext.drawImage(canvas, sourceX, sourceY, sourceWidth, sourceHeight,
            0, 0, crop.width, crop.height);

        const tesseract = await loadTesseract();
        worker = await tesseract.createWorker('eng');
        const result = await worker.recognize(crop);
        let topY = null;
        let bottomY = null;
        const words = result.data?.words ?? [];
        for (let index = 0; index < words.length; index++) {
            const word = words[index];
            const numericText = String(word.text ?? '').replace(/,/g, '');
            const priceMatch = numericText.match(/(?:^|[^0-9])(4076(?:\.0{1,2})?|4056(?:\.0{1,2})?)(?:$|[^0-9])/);
            if (!priceMatch || !word.bbox) continue;

            const price = Number.parseFloat(priceMatch[1]);
            const wordY = sourceY + ((word.bbox.y0 + word.bbox.y1) / (2 * scale));
            if (price === HIGH_PRICE_BOUNDARY) topY = wordY;
            if (price === LOW_PRICE_BOUNDARY) bottomY = wordY;
        }

        if (Number.isFinite(topY) && Number.isFinite(bottomY) && topY < bottomY) {
            return {
                topPrice: HIGH_PRICE_BOUNDARY,
                bottomPrice: LOW_PRICE_BOUNDARY,
                topY,
                bottomY
            };
        }
    } catch (error) {
        console.warn('Price-axis OCR unavailable for this image:', error);
    } finally {
        if (worker) await worker.terminate();
    }

    return fallback;
}

function getPriceAxisScale(canvas) {
    const scale = canvas?.priceAxisScale;
    const topPrice = Number.isFinite(scale?.topPrice) ? scale.topPrice : HIGH_PRICE_BOUNDARY;
    const bottomPrice = Number.isFinite(scale?.bottomPrice) ? scale.bottomPrice : LOW_PRICE_BOUNDARY;
    const topY = Number.isFinite(scale?.topY) ? scale.topY : canvas.height * 0.12;
    const bottomY = Number.isFinite(scale?.bottomY) ? scale.bottomY : canvas.height * 0.85;
    return { topPrice, bottomPrice, topY, bottomY };
}

export function convertYToPrice(canvas, targetY) {
    if (!canvas || !Number.isFinite(canvas.height) || !Number.isFinite(targetY)) return NaN;
    const { topPrice, bottomPrice, topY, bottomY } = getPriceAxisScale(canvas);
    const pricePerPixel = (topPrice - bottomPrice) / (bottomY - topY);
    const convertedPrice = topPrice - ((targetY - topY) * pricePerPixel);
    return Number.isFinite(convertedPrice) ? Number.parseFloat(convertedPrice.toFixed(2)) : NaN;
}

export function convertPriceToY(canvas, targetPrice) {
    if (!canvas || !Number.isFinite(canvas.height) || !Number.isFinite(targetPrice)) return NaN;
    const { topPrice, bottomPrice, topY, bottomY } = getPriceAxisScale(canvas);
    const pricePerPixel = (topPrice - bottomPrice) / (bottomY - topY);
    return topY + ((topPrice - targetPrice) / pricePerPixel);
}

export function calculateMarketStructure(candles, canvas, ctx) {
    const highSwings = [];
    const lowSwings = [];
    const chronologicalCandles = [];

    for (let candleIndex = 0; candleIndex < candles.length; candleIndex++) {
        const candle = candles[candleIndex];
        if (candle && Number.isFinite(candle.x)) appendChronologically(chronologicalCandles, candle);
    }

    for (let index = 4; index < chronologicalCandles.length - 4; index++) {
        const currentCandle = chronologicalCandles[index];
        let isSwingHigh = true;
        let isSwingLow = true;

        for (let offset = 1; offset <= 4; offset++) {
            if (currentCandle.highY >= chronologicalCandles[index - offset].highY
                || currentCandle.highY >= chronologicalCandles[index + offset].highY) isSwingHigh = false;
            if (currentCandle.lowY <= chronologicalCandles[index - offset].lowY
                || currentCandle.lowY <= chronologicalCandles[index + offset].lowY) isSwingLow = false;
        }

        if (isSwingHigh) {
            const previousPeak = highSwings[highSwings.length - 1];
            appendChronologically(highSwings, {
                ...currentCandle,
                type: 'high',
                label: previousPeak ? (currentCandle.highY < previousPeak.highY ? 'HH' : 'LH') : null,
                goldPrice: convertYToPrice(canvas, currentCandle.highY)
            });
        }

        if (isSwingLow) {
            const previousValley = lowSwings[lowSwings.length - 1];
            appendChronologically(lowSwings, {
                ...currentCandle,
                type: 'low',
                label: previousValley ? (currentCandle.lowY < previousValley.lowY ? 'HL' : 'LL') : null,
                goldPrice: convertYToPrice(canvas, currentCandle.lowY)
            });
        }
    }

    const swingPoints = [];
    for (let index = 0; index < highSwings.length; index++) appendChronologically(swingPoints, highSwings[index]);
    for (let index = 0; index < lowSwings.length; index++) appendChronologically(swingPoints, lowSwings[index]);

    if (ctx) {
        ctx.save();
        try {
            ctx.font = 'bold 14px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (swingPoints.length > 1) {
                ctx.beginPath();
                ctx.setLineDash([5, 4]);
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 1;
                const firstPoint = swingPoints[0];
                ctx.moveTo(firstPoint.x, firstPoint.type === 'high' ? firstPoint.highY : firstPoint.lowY);
                for (let index = 1; index < swingPoints.length; index++) {
                    const point = swingPoints[index];
                    ctx.lineTo(point.x, point.type === 'high' ? point.highY : point.lowY);
                }
                ctx.stroke();
            }

            for (let index = 0; index < swingPoints.length; index++) {
                const point = swingPoints[index];
                if (!point.label) continue;
                const isHigh = point.type === 'high';
                ctx.fillStyle = isHigh ? '#1b5e20' : '#b71c1c';
                const pointY = isHigh ? point.highY - 5 : point.lowY + 17;
                const priceText = Number.isFinite(point.goldPrice) ? point.goldPrice.toFixed(2) : '\u2014';
                ctx.fillText(`${point.label} ($${priceText})`, point.x, Math.max(14, Math.min(canvas.height - 7, pointY)));
            }
        } finally {
            ctx.restore();
        }
    }

    return { highSwings, lowSwings, swingPoints };
}

export async function scanCanvasForCandles(canvas, ctx) {
    if (!canvas || !ctx || !Number.isFinite(canvas.width) || !Number.isFinite(canvas.height)) {
        return { candles: [], detectedCandles: [], highSwings: [], lowSwings: [], swingPoints: [], livePrice: null };
    }

    const width = canvas.width;
    const height = canvas.height;
    const startX = Math.floor(width * 0.04);
    const endX = Math.floor(width * 0.80);
    const startY = Math.floor(height * 0.12);
    const endY = Math.floor(height * 0.85);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const columnCandles = [];

    for (let x = startX; x < endX; x++) {
        const bearishY = [];
        const bullishY = [];
        for (let y = startY; y < endY; y++) {
            const pixelIndex = (y * width + x) * 4;
            const color = classifyCandleColor(pixels[pixelIndex], pixels[pixelIndex + 1], pixels[pixelIndex + 2]);
            if (color === 'bearish') bearishY.push(y);
            if (color === 'bullish') bullishY.push(y);
        }

        const bearishSegment = findVerticalSegment(bearishY);
        const bullishSegment = findVerticalSegment(bullishY);
        let segment = null;
        if (bearishSegment && bullishSegment) {
            segment = bearishY.length >= bullishY.length
                ? { ...bearishSegment, color: 'bearish' }
                : { ...bullishSegment, color: 'bullish' };
        } else if (bearishSegment) {
            segment = { ...bearishSegment, color: 'bearish' };
        } else if (bullishSegment) {
            segment = { ...bullishSegment, color: 'bullish' };
        }
        if (segment) {
            columnCandles.push({
                x,
                ...segment,
                coloredY: segment.color === 'bearish' ? bearishY : bullishY
            });
        }
    }

    const candles = [];
    for (let index = 0; index < columnCandles.length; index++) {
        const column = columnCandles[index];
        const previous = candles[candles.length - 1];
        if (previous && previous.color === column.color && column.x === previous.endX + 1) {
            previous.endX = column.x;
            previous.x = Math.round((previous.startX + previous.endX) / 2);
            previous.highY = Math.min(previous.highY, column.highY);
            previous.lowY = Math.max(previous.lowY, column.lowY);
            previous.columns.push(column);
        } else {
            candles.push({
                x: column.x,
                highY: column.highY,
                lowY: column.lowY,
                color: column.color,
                startX: column.x,
                endX: column.x,
                columns: [column]
            });
        }
    }

    canvas.priceAxisScale = await extractChartPriceScale(canvas);

    for (let index = 0; index < candles.length; index++) {
        const candle = candles[index];
        const rowCoverage = new Map();
        for (let columnIndex = 0; columnIndex < candle.columns.length; columnIndex++) {
            const column = candle.columns[columnIndex];
            for (let pixelIndex = 0; pixelIndex < column.coloredY.length; pixelIndex++) {
                const y = column.coloredY[pixelIndex];
                rowCoverage.set(y, (rowCoverage.get(y) ?? 0) + 1);
            }
        }
        const bodyCoverageThreshold = Math.max(1, Math.ceil(candle.columns.length * 0.5));
        const bodyRows = [];
        for (const [y, coverage] of rowCoverage) {
            if (coverage >= bodyCoverageThreshold) bodyRows.push(y);
        }
        bodyRows.sort((first, second) => first - second);
        candle.bodyHighY = bodyRows.length ? bodyRows[0] : candle.highY;
        candle.bodyLowY = bodyRows.length ? bodyRows[bodyRows.length - 1] : candle.lowY;
        candle.highPrice = convertYToPrice(canvas, candle.highY);
        candle.lowPrice = convertYToPrice(canvas, candle.lowY);
        candle.bodyHighPrice = convertYToPrice(canvas, candle.bodyHighY);
        candle.bodyLowPrice = convertYToPrice(canvas, candle.bodyLowY);
        candle.openPrice = candle.color === 'bullish' ? candle.bodyLowPrice : candle.bodyHighPrice;
        candle.closePrice = candle.color === 'bullish' ? candle.bodyHighPrice : candle.bodyLowPrice;
        candle.shape = measureCandleShape(candle);
        delete candle.columns;
    }

    const liveCandle = candles[candles.length - 1];
    const livePrice = liveCandle ? convertYToPrice(canvas, liveCandle.highY) : null;
    const timeframe = await extractChartTimeframe(canvas);
    const structure = calculateMarketStructure(candles, canvas, ctx);
    return {
        candles,
        detectedCandles: candles,
        highSwings: structure.highSwings,
        lowSwings: structure.lowSwings,
        swingPoints: structure.swingPoints,
        timeframe,
        priceAxisScale: canvas.priceAxisScale,
        liveCandle: liveCandle ?? null,
        livePrice: Number.isFinite(livePrice) ? livePrice : null
    };
}
