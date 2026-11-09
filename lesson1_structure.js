const MIN_CANDLE_RUN = 3;
const HIGH_PRICE_BOUNDARY = 4140.00;
const LOW_PRICE_BOUNDARY = 3840.00;
const TESSERACT_MODULE_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js';

function classifyCandleColor(red, green, blue) {
    if (red > 140 && green < 100 && blue < 100) return 'bearish';
    if (red < 130 && green > 110 && blue > 110) return 'bullish';
    return null;
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

export function convertYToPrice(canvas, targetY) {
    if (!canvas || !Number.isFinite(canvas.height) || !Number.isFinite(targetY)) return NaN;
    const maxPrice = HIGH_PRICE_BOUNDARY;
    const minPrice = LOW_PRICE_BOUNDARY;
    const topY = canvas.height * 0.12;
    const bottomY = canvas.height * 0.85;
    const pricePerPixel = (maxPrice - minPrice) / (bottomY - topY);
    const convertedPrice = maxPrice - ((targetY - topY) * pricePerPixel);
    return Number.isFinite(convertedPrice) ? Number.parseFloat(convertedPrice.toFixed(2)) : NaN;
}

export function convertPriceToY(canvas, targetPrice) {
    if (!canvas || !Number.isFinite(canvas.height) || !Number.isFinite(targetPrice)) return NaN;
    const maxPrice = HIGH_PRICE_BOUNDARY;
    const minPrice = LOW_PRICE_BOUNDARY;
    const topY = canvas.height * 0.12;
    const bottomY = canvas.height * 0.85;
    const pricePerPixel = (maxPrice - minPrice) / (bottomY - topY);
    return topY + ((maxPrice - targetPrice) / pricePerPixel);
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
        liveCandle: liveCandle ?? null,
        livePrice: Number.isFinite(livePrice) ? livePrice : null
    };
}
