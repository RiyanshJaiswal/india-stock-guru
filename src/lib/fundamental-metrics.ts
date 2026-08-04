/**
 * Pure, reusable fundamental calculation services.
 *
 * No provider knowledge, no I/O, no placeholders — every helper returns
 * `null` when its inputs are missing so the caller can render an explicit
 * "not reported" state.
 */

import type {
  AnnualResult,
  BalanceSheetRow,
  CashFlowRow,
  Money,
  Percent,
  ProfitAndLossRow,
  QuarterlyResult,
  Ratio,
} from "./fundamental-types";

const isNum = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Safe division; null when either side is missing or the divisor is zero. */
export function divide(numerator: Money, denominator: Money): Ratio {
  if (!isNum(numerator) || !isNum(denominator) || denominator === 0) return null;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}

/** Percentage of a base value, rounded to 2 decimals. */
export function percentOf(part: Money, whole: Money): Percent {
  const ratio = divide(part, whole);
  return ratio === null ? null : round(ratio * 100);
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Simple period-over-period growth in percent. */
export function growth(current: Money, previous: Money): Percent {
  if (!isNum(current) || !isNum(previous) || previous === 0) return null;
  return round(((current - previous) / Math.abs(previous)) * 100);
}

/** Compound annual growth rate over `years`, in percent. */
export function cagr(latest: Money, earliest: Money, years: number): Percent {
  if (!isNum(latest) || !isNum(earliest) || years <= 0) return null;
  if (earliest <= 0 || latest <= 0) return null;
  return round(((latest / earliest) ** (1 / years) - 1) * 100);
}

/** Sum of the last `count` values; null when any required value is missing. */
export function sumTrailing(values: Money[], count: number): Money {
  const slice = values.slice(0, count);
  if (slice.length < count) return null;
  let total = 0;
  for (const value of slice) {
    if (!isNum(value)) return null;
    total += value;
  }
  return total;
}

/* ------------------------------------------------------------------ *
 * Ratio services
 * ------------------------------------------------------------------ */

export const bookValuePerShare = (equity: Money, shares: Money): Money => {
  const value = divide(equity, shares);
  return value === null ? null : round(value);
};

export const returnOnEquity = (netIncome: Money, equity: Money): Percent =>
  percentOf(netIncome, equity);

export const returnOnAssets = (netIncome: Money, assets: Money): Percent =>
  percentOf(netIncome, assets);

/** ROCE = EBIT / (total assets - current liabilities). */
export const returnOnCapitalEmployed = (
  ebit: Money,
  totalAssets: Money,
  currentLiabilities: Money,
): Percent => {
  if (!isNum(ebit)) return null;
  if (isNum(totalAssets) && isNum(currentLiabilities)) {
    return percentOf(ebit, totalAssets - currentLiabilities);
  }
  return null;
};

export const debtToEquity = (totalDebt: Money, equity: Money): Ratio => {
  const value = divide(totalDebt, equity);
  return value === null ? null : round(value);
};

export const currentRatio = (currentAssets: Money, currentLiabilities: Money): Ratio => {
  const value = divide(currentAssets, currentLiabilities);
  return value === null ? null : round(value);
};

export const quickRatio = (
  currentAssets: Money,
  inventory: Money,
  currentLiabilities: Money,
): Ratio => {
  if (!isNum(currentAssets) || !isNum(currentLiabilities)) return null;
  const liquid = currentAssets - (isNum(inventory) ? inventory : 0);
  const value = divide(liquid, currentLiabilities);
  return value === null ? null : round(value);
};

/** Interest coverage = EBIT / interest expense. */
export const interestCoverage = (ebit: Money, interestExpense: Money): Ratio => {
  if (!isNum(interestExpense) || interestExpense === 0) return null;
  const value = divide(ebit, Math.abs(interestExpense));
  return value === null ? null : round(value);
};

export const freeCashFlow = (operatingCashFlow: Money, capex: Money): Money => {
  if (!isNum(operatingCashFlow)) return null;
  return round(operatingCashFlow - Math.abs(isNum(capex) ? capex : 0), 0);
};

/* ------------------------------------------------------------------ *
 * Period series services
 * ------------------------------------------------------------------ */

/** Build the quarterly results table (newest first, YoY vs 4 quarters back). */
export function buildQuarterlyResults(rows: ProfitAndLossRow[]): QuarterlyResult[] {
  return rows.map((row, index) => {
    const yearAgo = rows[index + 4];
    return {
      asOfDate: row.asOfDate,
      currency: row.currency,
      revenue: row.revenue,
      operatingIncome: row.operatingIncome,
      ebitda: row.ebitda,
      netIncome: row.netIncome,
      dilutedEps: row.dilutedEps,
      operatingMargin: percentOf(row.operatingIncome, row.revenue),
      netProfitMargin: percentOf(row.netIncome, row.revenue),
      revenueGrowthYoY: yearAgo ? growth(row.revenue, yearAgo.revenue) : null,
      netIncomeGrowthYoY: yearAgo ? growth(row.netIncome, yearAgo.netIncome) : null,
    };
  });
}

/** Build the annual results table (newest first, YoY vs the previous year). */
export function buildAnnualResults(rows: ProfitAndLossRow[]): AnnualResult[] {
  return rows.map((row, index) => {
    const previous = rows[index + 1];
    return {
      asOfDate: row.asOfDate,
      currency: row.currency,
      revenue: row.revenue,
      operatingIncome: row.operatingIncome,
      ebitda: row.ebitda,
      netIncome: row.netIncome,
      basicEps: row.basicEps,
      dilutedEps: row.dilutedEps,
      operatingMargin: percentOf(row.operatingIncome, row.revenue),
      netProfitMargin: percentOf(row.netIncome, row.revenue),
      revenueGrowthYoY: previous ? growth(row.revenue, previous.revenue) : null,
      epsGrowthYoY: previous ? growth(row.dilutedEps, previous.dilutedEps) : null,
    };
  });
}

/** Trailing-twelve-month total from quarterly rows via a field selector. */
export const ttm = (
  rows: ProfitAndLossRow[] | CashFlowRow[],
  pick: (row: never) => Money,
): Money =>
  sumTrailing((rows as never[]).map((row) => pick(row)), 4);

/** Latest non-null value of a field across newest-first rows. */
export function latestValue<T>(rows: T[], pick: (row: T) => Money): Money {
  for (const row of rows) {
    const value = pick(row);
    if (isNum(value)) return value;
  }
  return null;
}

export type { BalanceSheetRow };
