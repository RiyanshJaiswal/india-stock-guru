/**
 * Technical analysis engine — composes the reusable indicator services in
 * `indicators.ts` into a single `TechnicalAnalysis` model.
 *
 * Client-safe and provider-agnostic: it only takes candles in. The same
 * function will be used against a FastAPI-supplied candle feed later.
 */

import {
  adx,
  adxLatest,
  bollingerBands,
  bollingerLatest,
  closes,
  ema,
  fibonacci,
  last,
  macd,
  macdLatest,
  pivotPoints,
  rsi,
  sma,
  supertrend,
  supertrendLatest,
  supportResistance,
  vwap,
  atr,
} from "./indicators";
import {
  MA_PERIODS,
  MIN_CANDLES,
  type Bias,
  type Candle,
  type Interval,
  type Range,
  type TechnicalAnalysis,
  type TechnicalAnalysisResult,
  type TechnicalIndicators,
  type TrendDetection,
  type Trend,
} from "./technical-types";

function detectTrend(input: {
  price: number;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  adxValue: number | null;
  plusDi: number | null;
  minusDi: number | null;
  macdHistogram: number | null;
  rsiValue: number | null;
  supertrendDirection: "bullish" | "bearish" | null;
}): TrendDetection {
  const reasons: string[] = [];
  let score = 0;
  let votes = 0;

  const vote = (bullish: boolean | null, reason: string) => {
    if (bullish === null) return;
    votes += 1;
    score += bullish ? 1 : -1;
    reasons.push(reason);
  };

  if (input.ema20 !== null && input.ema50 !== null) {
    vote(
      input.ema20 > input.ema50,
      input.ema20 > input.ema50 ? "EMA 20 above EMA 50" : "EMA 20 below EMA 50",
    );
  }
  if (input.ema200 !== null) {
    vote(
      input.price > input.ema200,
      input.price > input.ema200 ? "Price above EMA 200" : "Price below EMA 200",
    );
  }
  if (input.macdHistogram !== null) {
    vote(
      input.macdHistogram > 0,
      input.macdHistogram > 0 ? "MACD histogram positive" : "MACD histogram negative",
    );
  }
  if (input.plusDi !== null && input.minusDi !== null) {
    vote(
      input.plusDi > input.minusDi,
      input.plusDi > input.minusDi ? "+DI above -DI" : "-DI above +DI",
    );
  }
  if (input.supertrendDirection !== null) {
    vote(
      input.supertrendDirection === "bullish",
      `Supertrend ${input.supertrendDirection}`,
    );
  }
  if (input.rsiValue !== null && (input.rsiValue > 60 || input.rsiValue < 40)) {
    vote(input.rsiValue > 60, `RSI at ${input.rsiValue}`);
  }

  const ratio = votes === 0 ? 0 : score / votes;
  const trending = input.adxValue !== null ? input.adxValue >= 20 : Math.abs(ratio) >= 0.6;

  let trend: Trend = "sideways";
  if (trending && ratio >= 0.34) trend = "uptrend";
  else if (trending && ratio <= -0.34) trend = "downtrend";

  let bias: Bias = "neutral";
  if (ratio >= 0.34) bias = "bullish";
  else if (ratio <= -0.34) bias = "bearish";

  if (input.adxValue !== null) {
    reasons.push(`ADX ${input.adxValue} (${trending ? "trending" : "range-bound"})`);
  }

  return {
    trend,
    bias,
    strength: Math.round(Math.abs(ratio) * 100),
    reasons,
  };
}

/** Build the full indicator set from candles. */
export function computeIndicators(candles: Candle[]): TechnicalIndicators {
  const closeSeries = closes(candles);
  const price = closeSeries[closeSeries.length - 1] as number;

  const emaMap: Record<number, number | null> = {};
  const smaMap: Record<number, number | null> = {};
  for (const period of MA_PERIODS) {
    emaMap[period] = last(ema(closeSeries, period)) ?? null;
    smaMap[period] = last(sma(closeSeries, period)) ?? null;
  }

  const macdSeries = macd(closeSeries);
  const macdValues = macdLatest(macdSeries);
  const bb = bollingerLatest(bollingerBands(closeSeries), price);
  const adxSeries = adxLatest(adx(candles));
  const st = supertrendLatest(supertrend(candles));
  const rsiValue = last(rsi(closeSeries, 14)) ?? null;

  return {
    movingAverages: { ema: emaMap, sma: smaMap },
    rsi: rsiValue,
    macd: macdValues,
    bollingerBands: bb,
    vwap: last(vwap(candles)) ?? null,
    atr: last(atr(candles, 14)) ?? null,
    adx: adxSeries,
    supertrend: st,
    fibonacci: fibonacci(candles),
    pivotPoints: pivotPoints(candles[candles.length - 1] ?? null),
    supportResistance: supportResistance(candles),
    trend: detectTrend({
      price,
      ema20: emaMap[20] ?? null,
      ema50: emaMap[50] ?? null,
      ema200: emaMap[200] ?? null,
      adxValue: adxSeries.adx,
      plusDi: adxSeries.plusDi,
      minusDi: adxSeries.minusDi,
      macdHistogram: macdValues.histogram,
      rsiValue,
      supertrendDirection: st.direction,
    }),
  };
}

/**
 * Analyse candles into the unified model. Returns an explicit error state when
 * history is missing or too short — never placeholder numbers.
 */
export function analyzeCandles(
  symbol: string,
  candles: Candle[],
  interval: Interval,
  range: Range,
): TechnicalAnalysisResult {
  if (candles.length === 0) {
    return {
      ok: false,
      error: {
        code: "NO_HISTORY",
        symbol,
        message: `No historical candles available for ${symbol}.`,
      },
    };
  }
  if (candles.length < MIN_CANDLES) {
    return {
      ok: false,
      error: {
        code: "INSUFFICIENT_HISTORY",
        symbol,
        message: `Only ${candles.length} candles available for ${symbol}; at least ${MIN_CANDLES} are required.`,
      },
    };
  }

  const lastCandle = candles[candles.length - 1] as Candle;
  const data: TechnicalAnalysis = {
    symbol,
    interval,
    range,
    asOf: lastCandle.time,
    candleCount: candles.length,
    lastClose: lastCandle.close,
    indicators: computeIndicators(candles),
  };
  return { ok: true, data };
}
