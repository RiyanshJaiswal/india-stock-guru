/**
 * Provider adapter contract for fundamentals.
 *
 * A provider returns a *raw snapshot* — statements, market stats, dividends
 * and shareholding as reported. All ratio/margin/growth derivation happens
 * once, provider-independently, in `fundamental-metrics.ts`. Adding a new
 * source (FastAPI, screener feed, exchange filings) means implementing this
 * one interface.
 */

import type {
  BalanceSheetRow,
  CashFlowRow,
  CompanyProfile,
  CoverageEntry,
  DividendInfo,
  Money,
  Percent,
  ProfitAndLossRow,
  Ratio,
  ShareholdingPattern,
} from "./fundamental-types";

/** Point-in-time market/statistics values the provider states directly. */
export type ProviderMarketStats = {
  marketCap: Money;
  enterpriseValue: Money;
  peRatioTTM: Ratio;
  forwardPE: Ratio;
  pbRatio: Ratio;
  priceToSalesTTM: Ratio;
  evToEbitda: Ratio;
  evToRevenue: Ratio;
  bookValuePerShare: Money;
  epsBasicTTM: Money;
  epsDilutedTTM: Money;
  sharesOutstanding: Money;
  /** Reported TTM liquidity ratios, used when statements lack inventory. */
  currentRatio: Ratio;
  quickRatio: Ratio;
  debtToEquity: Ratio;
  returnOnEquity: Percent;
  returnOnAssets: Percent;
  grossMargin: Percent;
  operatingMargin: Percent;
  profitMargin: Percent;
  ebitda: Money;
  totalRevenueTTM: Money;
  operatingCashFlowTTM: Money;
  freeCashFlowTTM: Money;
};

export type FundamentalSnapshot = {
  symbol: string;
  profile: CompanyProfile;
  stats: ProviderMarketStats;
  annualProfitAndLoss: ProfitAndLossRow[];
  quarterlyProfitAndLoss: ProfitAndLossRow[];
  annualBalanceSheet: BalanceSheetRow[];
  quarterlyBalanceSheet: BalanceSheetRow[];
  annualCashFlow: CashFlowRow[];
  quarterlyCashFlow: CashFlowRow[];
  dividends: DividendInfo;
  shareholding: ShareholdingPattern;
  /** Provider-declared gaps, merged into the final analysis coverage. */
  coverage: CoverageEntry[];
};

export type FundamentalRequest = {
  symbol: string;
  quarters: number;
  years: number;
};

export type FundamentalProvider = {
  /** Stable id surfaced in the analysis model, e.g. "yahoo" or "fastapi". */
  id: string;
  fetchSnapshot(request: FundamentalRequest): Promise<FundamentalSnapshot>;
};

/** Sort helper: statement rows are always returned newest first. */
export const byNewestFirst = <T extends { asOfDate: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => (a.asOfDate < b.asOfDate ? 1 : -1));
