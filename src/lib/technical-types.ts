/**
 * Technical analysis DTOs (client-safe).
 *
 * These are the exact shapes a future FastAPI backend must return, so the UI
 * and query layer never change when the provider is swapped.
 */

export type Interval = "1d" | "1wk" | "1mo";
export type Range = "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y" | "max";

/** One OHLCV bar. Timestamp is epoch milliseconds (UTC). */
export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Trend = "uptrend" | "downtrend" | "sideways";
export type Bias = "bullish" | "bearish" | "neutral";

export type MovingAverages = {
  /** Period -> latest value (null when there is not enough history). */
  ema: Record<number, number | null>;
  sma: Record<number, number | null>;
};

export type MacdResult = {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
};

export type BollingerBands = {
  upper: number | null;
  middle: number | null;
  lower: number | null;
  bandwidth: number | null;
  percentB: number | null;
};

export type SupertrendResult = {
  value: number | null;
  direction: "bullish" | "bearish" | null;
};

export type AdxResult = {
  adx: number | null;
  plusDi: number | null;
  minusDi: number | null;
};

export type FibonacciLevels = {
  high: number;
  low: number;
  direction: "up" | "down";
  levels: { ratio: number; label: string; price: number }[];
};

export type PivotPoints = {
  pivot: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
};

export type SupportResistance = {
  support: number[];
  resistance: number[];
};

export type TrendDetection = {
  trend: Trend;
  bias: Bias;
  /** 0-100 confidence derived from agreeing signals. */
  strength: number;
  reasons: string[];
};

export type TechnicalIndicators = {
  movingAverages: MovingAverages;
  rsi: number | null;
  macd: MacdResult;
  bollingerBands: BollingerBands;
  vwap: number | null;
  atr: number | null;
  adx: AdxResult;
  supertrend: SupertrendResult;
  fibonacci: FibonacciLevels | null;
  pivotPoints: PivotPoints | null;
  supportResistance: SupportResistance;
  trend: TrendDetection;
};

export type TechnicalAnalysis = {
  symbol: string;
  interval: Interval;
  range: Range;
  /** Epoch ms of the last candle used. */
  asOf: number;
  candleCount: number;
  lastClose: number;
  indicators: TechnicalIndicators;
};

export type TechnicalAnalysisErrorCode =
  | "NO_HISTORY"
  | "INSUFFICIENT_HISTORY"
  | "PROVIDER_ERROR";

export type TechnicalAnalysisError = {
  code: TechnicalAnalysisErrorCode;
  message: string;
  symbol: string;
};

/** Unified result: either analysis data or an explicit error state. */
export type TechnicalAnalysisResult =
  | { ok: true; data: TechnicalAnalysis }
  | { ok: false; error: TechnicalAnalysisError };

/** Minimum bars needed before any analysis is attempted. */
export const MIN_CANDLES = 30;

export const MA_PERIODS = [20, 50, 100, 200] as const;
