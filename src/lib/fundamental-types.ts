/**
 * Fundamental analysis DTOs (client-safe, provider-independent).
 *
 * These are the exact shapes a future FastAPI backend must return. Every
 * numeric field is nullable: when a provider cannot supply a value we return
 * `null` plus an explicit coverage/unavailability note — never a placeholder.
 */

/** Money is always expressed in the reporting currency of the statement. */
export type Money = number | null;
/** Ratios are plain multiples (e.g. 1.86), percentages are 0-100. */
export type Ratio = number | null;
export type Percent = number | null;

export type StatementPeriodType = "annual" | "quarterly";

export type PeriodMeta = {
  /** ISO date of the period end, e.g. "2026-03-31". */
  asOfDate: string;
  periodType: StatementPeriodType;
  currency: string | null;
};

export type ProfitAndLossRow = PeriodMeta & {
  revenue: Money;
  costOfRevenue: Money;
  grossProfit: Money;
  operatingExpenses: Money;
  operatingIncome: Money;
  ebitda: Money;
  ebit: Money;
  interestExpense: Money;
  pretaxIncome: Money;
  taxExpense: Money;
  netIncome: Money;
  basicEps: Money;
  dilutedEps: Money;
};

export type BalanceSheetRow = PeriodMeta & {
  totalAssets: Money;
  currentAssets: Money;
  cashAndEquivalents: Money;
  inventory: Money;
  receivables: Money;
  totalLiabilities: Money;
  currentLiabilities: Money;
  totalDebt: Money;
  stockholdersEquity: Money;
  investedCapital: Money;
  sharesOutstanding: Money;
};

export type CashFlowRow = PeriodMeta & {
  operatingCashFlow: Money;
  investingCashFlow: Money;
  financingCashFlow: Money;
  capitalExpenditure: Money;
  freeCashFlow: Money;
  netIncome: Money;
};

export type FinancialStatements = {
  profitAndLoss: ProfitAndLossRow[];
  balanceSheet: BalanceSheetRow[];
  cashFlow: CashFlowRow[];
};

/** One reported quarter, newest first. */
export type QuarterlyResult = {
  asOfDate: string;
  currency: string | null;
  revenue: Money;
  operatingIncome: Money;
  ebitda: Money;
  netIncome: Money;
  dilutedEps: Money;
  operatingMargin: Percent;
  netProfitMargin: Percent;
  /** Year-over-year revenue growth vs the same quarter last year. */
  revenueGrowthYoY: Percent;
  netIncomeGrowthYoY: Percent;
};

/** One reported financial year, newest first. */
export type AnnualResult = {
  asOfDate: string;
  currency: string | null;
  revenue: Money;
  operatingIncome: Money;
  ebitda: Money;
  netIncome: Money;
  basicEps: Money;
  dilutedEps: Money;
  operatingMargin: Percent;
  netProfitMargin: Percent;
  revenueGrowthYoY: Percent;
  epsGrowthYoY: Percent;
};

export type DividendEvent = {
  /** Epoch ms of the ex-dividend date. */
  date: number;
  amount: number;
};

export type DividendInfo = {
  dividendRate: Money;
  dividendYield: Percent;
  payoutRatio: Percent;
  fiveYearAverageYield: Percent;
  exDividendDate: number | null;
  /** Newest first. Empty array means the provider reported no payouts. */
  history: DividendEvent[];
};

export type ShareholdingCategory =
  | "promoter"
  | "fii"
  | "dii"
  | "public"
  | "insiders"
  | "institutions";

export type ShareholdingSlice = {
  category: ShareholdingCategory;
  percent: Percent;
};

export type ShareholdingSnapshot = {
  /** ISO date the pattern was reported on, when the provider states one. */
  asOfDate: string | null;
  slices: ShareholdingSlice[];
};

export type ShareholdingPattern = {
  latest: ShareholdingSnapshot | null;
  /** Newest first. Empty when the provider exposes no history. */
  history: ShareholdingSnapshot[];
  /** Categories the active provider cannot supply at all. */
  unavailable: ShareholdingCategory[];
};

export type ValuationMetrics = {
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
};

export type ProfitabilityMetrics = {
  roe: Percent;
  roce: Percent;
  roa: Percent;
  grossMargin: Percent;
  operatingMargin: Percent;
  netProfitMargin: Percent;
  ebitdaMargin: Percent;
};

export type LeverageMetrics = {
  debtToEquity: Ratio;
  currentRatio: Ratio;
  quickRatio: Ratio;
  interestCoverage: Ratio;
};

export type GrowthMetrics = {
  revenueGrowthYoY: Percent;
  revenueCagr3Y: Percent;
  revenueCagr5Y: Percent;
  epsGrowthYoY: Percent;
  epsCagr3Y: Percent;
  netIncomeGrowthYoY: Percent;
};

export type CashFlowMetrics = {
  operatingCashFlow: Money;
  freeCashFlow: Money;
  capitalExpenditure: Money;
  fcfMargin: Percent;
};

export type CompanyProfile = {
  symbol: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  currency: string | null;
  employees: number | null;
  website: string | null;
  summary: string | null;
};

/**
 * Coverage tells the UI exactly how much history the provider actually
 * returned against what was requested, so nothing is ever invented.
 */
export type CoverageEntry = {
  dataset:
    | "quarterlyResults"
    | "annualResults"
    | "balanceSheet"
    | "cashFlow"
    | "profitAndLoss"
    | "dividendHistory"
    | "shareholdingPattern";
  requestedPeriods: number;
  availablePeriods: number;
  /** Present when the dataset is partially or fully unsupported. */
  note?: string;
};

export type FundamentalAnalysis = {
  symbol: string;
  provider: string;
  /** Epoch ms when the snapshot was assembled. */
  fetchedAt: number;
  profile: CompanyProfile;
  valuation: ValuationMetrics;
  profitability: ProfitabilityMetrics;
  leverage: LeverageMetrics;
  growth: GrowthMetrics;
  cashFlow: CashFlowMetrics;
  dividends: DividendInfo;
  shareholding: ShareholdingPattern;
  quarterlyResults: QuarterlyResult[];
  annualResults: AnnualResult[];
  statements: FinancialStatements;
  coverage: CoverageEntry[];
};

export type FundamentalErrorCode =
  | "NOT_FOUND"
  | "NO_FUNDAMENTALS"
  | "PROVIDER_ERROR"
  | "PROVIDER_UNAVAILABLE";

export type FundamentalError = {
  code: FundamentalErrorCode;
  symbol: string;
  message: string;
  provider?: string;
};

export type FundamentalAnalysisResult =
  | { ok: true; data: FundamentalAnalysis }
  | { ok: false; error: FundamentalError };

/** Requested depth — providers return less when they have less. */
export const QUARTERS_REQUESTED = 12;
export const YEARS_REQUESTED = 10;
