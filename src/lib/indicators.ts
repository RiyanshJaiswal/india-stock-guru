/**
 * Pure, reusable indicator calculation services.
 *
 * Every function is side-effect free, works on plain number arrays or candles,
 * and returns full series (`(number | null)[]`) so higher-level code can reuse
 * them without recomputation. `null` means "not enough data yet" — never a
 * fabricated value.
 */

import type {
  AdxResult,
  BollingerBands,
  Candle,
  FibonacciLevels,
  MacdResult,
  PivotPoints,
  SupportResistance,
  SupertrendResult,
} from "./technical-types";

/* ------------------------------------------------------------------ utils */

export const last = <T,>(series: T[]): T | null =>
  series.length > 0 ? (series[series.length - 1] as T) : null;

export const closes = (candles: Candle[]) => candles.map((c) => c.close);
export const highs = (candles: Candle[]) => candles.map((c) => c.high);
export const lows = (candles: Candle[]) => candles.map((c) => c.low);
export const volumes = (candles: Candle[]) => candles.map((c) => c.volume);

const round = (value: number, digits = 4) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : Number.NaN;

/* ------------------------------------------------------- moving averages */

/** Simple moving average series. */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i] as number;
    if (i >= period) sum -= values[i - period] as number;
    if (i >= period - 1) out[i] = round(sum / period);
  }
  return out;
}

/** Exponential moving average series, seeded with the first SMA. */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += values[i] as number;
  let prev = seed / period;
  out[period - 1] = round(prev);
  for (let i = period; i < values.length; i += 1) {
    prev = (values[i] as number) * k + prev * (1 - k);
    out[i] = round(prev);
  }
  return out;
}

/** Wilder's smoothing (used by RSI, ATR and ADX). */
export function wilderSmooth(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i] as number;
  let prev = sum / period;
  out[period - 1] = round(prev);
  for (let i = period; i < values.length; i += 1) {
    prev = (prev * (period - 1) + (values[i] as number)) / period;
    out[i] = round(prev);
  }
  return out;
}

/* -------------------------------------------------------------- momentum */

/** Relative Strength Index series (Wilder). */
export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    const diff = (values[i] as number) - (values[i - 1] as number);
    gains.push(Math.max(diff, 0));
    losses.push(Math.max(-diff, 0));
  }

  const avgGain = wilderSmooth(gains, period);
  const avgLoss = wilderSmooth(losses, period);

  for (let i = 0; i < gains.length; i += 1) {
    const g = avgGain[i];
    const l = avgLoss[i];
    if (g === null || g === undefined || l === null || l === undefined) continue;
    const value = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    out[i + 1] = round(value, 2);
  }
  return out;
}

export type MacdSeries = {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
};

/** MACD line, signal line and histogram series. */
export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdSeries {
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const macdLine: (number | null)[] = values.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f === null || f === undefined || s === null || s === undefined
      ? null
      : round(f - s);
  });

  const defined = macdLine.filter((v): v is number => v !== null);
  const signalDefined = ema(defined, signalPeriod);
  const offset = macdLine.length - defined.length;

  const signal: (number | null)[] = new Array(values.length).fill(null);
  const histogram: (number | null)[] = new Array(values.length).fill(null);
  for (let i = 0; i < defined.length; i += 1) {
    const s = signalDefined[i];
    if (s === null || s === undefined) continue;
    signal[offset + i] = s;
    histogram[offset + i] = round((defined[i] as number) - s);
  }

  return { macd: macdLine, signal, histogram };
}

export const macdLatest = (series: MacdSeries): MacdResult => ({
  macd: last(series.macd) ?? null,
  signal: last(series.signal) ?? null,
  histogram: last(series.histogram) ?? null,
});

/* ------------------------------------------------------------ volatility */

export type BollingerSeries = {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
};

/** Bollinger Bands series (SMA basis + standard deviation envelope). */
export function bollingerBands(
  values: number[],
  period = 20,
  multiplier = 2,
): BollingerSeries {
  const middle = sma(values, period);
  const upper: (number | null)[] = new Array(values.length).fill(null);
  const lower: (number | null)[] = new Array(values.length).fill(null);

  for (let i = period - 1; i < values.length; i += 1) {
    const mean = middle[i];
    if (mean === null || mean === undefined) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      variance += ((values[j] as number) - mean) ** 2;
    }
    const sd = Math.sqrt(variance / period);
    upper[i] = round(mean + multiplier * sd);
    lower[i] = round(mean - multiplier * sd);
  }
  return { upper, middle, lower };
}

export function bollingerLatest(
  series: BollingerSeries,
  price: number,
): BollingerBands {
  const upper = last(series.upper) ?? null;
  const middle = last(series.middle) ?? null;
  const lower = last(series.lower) ?? null;
  const width = upper !== null && lower !== null ? upper - lower : null;
  return {
    upper,
    middle,
    lower,
    bandwidth:
      width !== null && middle !== null && middle !== 0
        ? round((width / middle) * 100, 2)
        : null,
    percentB:
      width !== null && lower !== null && width !== 0
        ? round(((price - lower) / width) * 100, 2)
        : null,
  };
}

/** True Range series (first bar uses high-low). */
export function trueRange(candles: Candle[]): number[] {
  return candles.map((c, i) => {
    if (i === 0) return round(c.high - c.low);
    const prevClose = (candles[i - 1] as Candle).close;
    return round(
      Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)),
    );
  });
}

/** Average True Range series (Wilder). */
export function atr(candles: Candle[], period = 14): (number | null)[] {
  return wilderSmooth(trueRange(candles), period);
}

/* ------------------------------------------------------------ volume/trend */

/**
 * Volume Weighted Average Price series, cumulative over the supplied candles.
 * For daily candles this is the running session-anchored VWAP of the window.
 */
export function vwap(candles: Candle[]): (number | null)[] {
  let pv = 0;
  let vol = 0;
  return candles.map((c) => {
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    vol += c.volume;
    return vol > 0 ? round(pv / vol, 2) : null;
  });
}

export type AdxSeries = {
  adx: (number | null)[];
  plusDi: (number | null)[];
  minusDi: (number | null)[];
};

/** Average Directional Index with +DI / -DI series (Wilder). */
export function adx(candles: Candle[], period = 14): AdxSeries {
  const size = candles.length;
  const empty: AdxSeries = {
    adx: new Array(size).fill(null),
    plusDi: new Array(size).fill(null),
    minusDi: new Array(size).fill(null),
  };
  if (size <= period * 2) return empty;

  const plusDm: number[] = [];
  const minusDm: number[] = [];
  const tr: number[] = [];
  for (let i = 1; i < size; i += 1) {
    const cur = candles[i] as Candle;
    const prev = candles[i - 1] as Candle;
    const up = cur.high - prev.high;
    const down = prev.low - cur.low;
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
    tr.push(
      Math.max(
        cur.high - cur.low,
        Math.abs(cur.high - prev.close),
        Math.abs(cur.low - prev.close),
      ),
    );
  }

  const smTr = wilderSmooth(tr, period);
  const smPlus = wilderSmooth(plusDm, period);
  const smMinus = wilderSmooth(minusDm, period);

  const plusDi: (number | null)[] = new Array(size).fill(null);
  const minusDi: (number | null)[] = new Array(size).fill(null);
  const dx: number[] = [];
  const dxIndex: number[] = [];

  for (let i = 0; i < tr.length; i += 1) {
    const t = smTr[i];
    const p = smPlus[i];
    const m = smMinus[i];
    if (t === null || t === undefined || t === 0 || p === null || p === undefined) continue;
    if (m === null || m === undefined) continue;
    const pdi = (p / t) * 100;
    const mdi = (m / t) * 100;
    plusDi[i + 1] = round(pdi, 2);
    minusDi[i + 1] = round(mdi, 2);
    const sum = pdi + mdi;
    dx.push(sum === 0 ? 0 : (Math.abs(pdi - mdi) / sum) * 100);
    dxIndex.push(i + 1);
  }

  const smoothedDx = wilderSmooth(dx, period);
  const adxSeries: (number | null)[] = new Array(size).fill(null);
  for (let i = 0; i < smoothedDx.length; i += 1) {
    const value = smoothedDx[i];
    const idx = dxIndex[i];
    if (value === null || value === undefined || idx === undefined) continue;
    adxSeries[idx] = round(value, 2);
  }

  return { adx: adxSeries, plusDi, minusDi };
}

export const adxLatest = (series: AdxSeries): AdxResult => ({
  adx: last(series.adx) ?? null,
  plusDi: last(series.plusDi) ?? null,
  minusDi: last(series.minusDi) ?? null,
});

export type SupertrendSeries = {
  value: (number | null)[];
  direction: ("bullish" | "bearish" | null)[];
};

/** Supertrend (ATR bands with trend flip logic). */
export function supertrend(
  candles: Candle[],
  period = 10,
  multiplier = 3,
): SupertrendSeries {
  const size = candles.length;
  const atrSeries = atr(candles, period);
  const value: (number | null)[] = new Array(size).fill(null);
  const direction: ("bullish" | "bearish" | null)[] = new Array(size).fill(null);

  let finalUpper: number | null = null;
  let finalLower: number | null = null;
  let bullish = true;

  for (let i = 0; i < size; i += 1) {
    const a = atrSeries[i];
    const c = candles[i] as Candle;
    if (a === null || a === undefined) continue;
    const mid = (c.high + c.low) / 2;
    const basicUpper = mid + multiplier * a;
    const basicLower = mid - multiplier * a;
    const prevClose = i > 0 ? (candles[i - 1] as Candle).close : c.close;

    finalUpper =
      finalUpper === null || basicUpper < finalUpper || prevClose > finalUpper
        ? basicUpper
        : finalUpper;
    finalLower =
      finalLower === null || basicLower > finalLower || prevClose < finalLower
        ? basicLower
        : finalLower;

    if (c.close > finalUpper) bullish = true;
    else if (c.close < finalLower) bullish = false;

    direction[i] = bullish ? "bullish" : "bearish";
    value[i] = round(bullish ? finalLower : finalUpper, 2);
  }

  return { value, direction };
}

export const supertrendLatest = (series: SupertrendSeries): SupertrendResult => ({
  value: last(series.value) ?? null,
  direction: last(series.direction) ?? null,
});

/* -------------------------------------------------------------- levels */

const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** Fibonacci retracement over the swing high/low of the supplied candles. */
export function fibonacci(candles: Candle[]): FibonacciLevels | null {
  if (candles.length === 0) return null;
  let high = -Infinity;
  let low = Infinity;
  let highIndex = 0;
  let lowIndex = 0;
  candles.forEach((c, i) => {
    if (c.high > high) {
      high = c.high;
      highIndex = i;
    }
    if (c.low < low) {
      low = c.low;
      lowIndex = i;
    }
  });
  if (!Number.isFinite(high) || !Number.isFinite(low) || high === low) return null;

  const direction: "up" | "down" = lowIndex < highIndex ? "up" : "down";
  const span = high - low;
  return {
    high: round(high, 2),
    low: round(low, 2),
    direction,
    levels: FIB_RATIOS.map((ratio) => ({
      ratio,
      label: `${(ratio * 100).toFixed(1)}%`,
      price: round(direction === "up" ? high - span * ratio : low + span * ratio, 2),
    })),
  };
}

/** Classic floor-trader pivot points from the last completed candle. */
export function pivotPoints(candle: Candle | null): PivotPoints | null {
  if (!candle) return null;
  const { high, low, close } = candle;
  const pivot = (high + low + close) / 3;
  const range = high - low;
  return {
    pivot: round(pivot, 2),
    r1: round(2 * pivot - low, 2),
    r2: round(pivot + range, 2),
    r3: round(high + 2 * (pivot - low), 2),
    s1: round(2 * pivot - high, 2),
    s2: round(pivot - range, 2),
    s3: round(low - 2 * (high - pivot), 2),
  };
}

/**
 * Swing-based support & resistance: fractal pivots confirmed by `lookback`
 * bars on each side, clustered and returned nearest-first around price.
 */
export function supportResistance(
  candles: Candle[],
  lookback = 3,
  maxLevels = 3,
): SupportResistance {
  const price = candles.length > 0 ? (candles[candles.length - 1] as Candle).close : 0;
  const resistanceRaw: number[] = [];
  const supportRaw: number[] = [];

  for (let i = lookback; i < candles.length - lookback; i += 1) {
    const cur = candles[i] as Candle;
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j += 1) {
      if (j === i) continue;
      const other = candles[j] as Candle;
      if (other.high >= cur.high) isHigh = false;
      if (other.low <= cur.low) isLow = false;
    }
    if (isHigh) resistanceRaw.push(cur.high);
    if (isLow) supportRaw.push(cur.low);
  }

  const cluster = (levels: number[]) => {
    const sorted = [...levels].sort((a, b) => a - b);
    const grouped: number[] = [];
    for (const level of sorted) {
      const prev = grouped[grouped.length - 1];
      if (prev !== undefined && Math.abs(level - prev) / prev < 0.01) {
        grouped[grouped.length - 1] = round((prev + level) / 2, 2);
      } else {
        grouped.push(round(level, 2));
      }
    }
    return grouped;
  };

  const resistance = cluster(resistanceRaw)
    .filter((level) => level > price)
    .sort((a, b) => a - b)
    .slice(0, maxLevels);
  const support = cluster(supportRaw)
    .filter((level) => level < price)
    .sort((a, b) => b - a)
    .slice(0, maxLevels);

  return { support, resistance };
}
