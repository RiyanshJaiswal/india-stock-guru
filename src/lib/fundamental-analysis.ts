/**
 * Fundamental analysis engine — turns a provider snapshot into the unified
 * `FundamentalAnalysis` model. Provider-agnostic and side-effect free.
 */

import {
  buildAnnualResults,
  buildQuarterlyResults,
  bookValuePerShare,
  currentRatio,
  debtToEquity,
  divide,
  freeCashFlow,
  growth,
  interestCoverage,
  latestValue,
  percentOf,
  quickRatio,
  returnOnAssets,
  returnOnCapitalEmployed,
  returnOnEquity,
  round,
  sumTrailing,
  cagr,
} from "./fundamental-metrics";
import type { FundamentalSnapshot } from "./fundamental-provider";
import {
  QUARTERS_REQUESTED,
  YEARS_REQUESTED,
  type CoverageEntry,
  type FundamentalAnalysis,
  type Money,
  type Percent,
} from "./fundamental-types";

const firstOr = <T>(rows: T[]): T | null => rows[0] ?? null;

/** Prefer a computed value, fall back to the provider's reported one. */
const pick = <T extends number | null>(computed: T, reported: T): T =>
  computed !== null ? computed : reported;

export function buildFundamentalAnalysis(
  snapshot: FundamentalSnapshot,
  providerId: string,
): FundamentalAnalysis {
  const {
    stats,
    annualProfitAndLoss,
    quarterlyProfitAndLoss,
    annualBalanceSheet,
    quarterlyBalanceSheet,
    annualCashFlow,
    quarterlyCashFlow,
  } = snapshot;

  const balanceSheet = [...quarterlyBalanceSheet, ...annualBalanceSheet];
  const latestBalance = firstOr(balanceSheet);
  const latestAnnualPl = firstOr(annualProfitAndLoss);

  /* --- trailing twelve months, computed from quarters when possible ------ */
  const quarterlyRevenue = quarterlyProfitAndLoss.map((row) => row.revenue);
  const quarterlyNetIncome = quarterlyProfitAndLoss.map((row) => row.netIncome);
  const quarterlyEbit = quarterlyProfitAndLoss.map((row) => row.ebit);
  const quarterlyOperating = quarterlyProfitAndLoss.map((row) => row.operatingIncome);
  const quarterlyGross = quarterlyProfitAndLoss.map((row) => row.grossProfit);
  const quarterlyEbitda = quarterlyProfitAndLoss.map((row) => row.ebitda);
  const quarterlyInterest = quarterlyProfitAndLoss.map((row) => row.interestExpense);

  const revenueTTM: Money =
    sumTrailing(quarterlyRevenue, 4) ?? stats.totalRevenueTTM ?? latestAnnualPl?.revenue ?? null;
  const netIncomeTTM: Money =
    sumTrailing(quarterlyNetIncome, 4) ?? latestAnnualPl?.netIncome ?? null;
  const ebitTTM: Money = sumTrailing(quarterlyEbit, 4) ?? latestAnnualPl?.ebit ?? null;
  const operatingTTM: Money =
    sumTrailing(quarterlyOperating, 4) ?? latestAnnualPl?.operatingIncome ?? null;
  const grossTTM: Money = sumTrailing(quarterlyGross, 4) ?? latestAnnualPl?.grossProfit ?? null;
  const ebitdaTTM: Money =
    sumTrailing(quarterlyEbitda, 4) ?? stats.ebitda ?? latestAnnualPl?.ebitda ?? null;
  const interestTTM: Money =
    sumTrailing(quarterlyInterest, 4) ?? latestAnnualPl?.interestExpense ?? null;

  const equity = latestBalance?.stockholdersEquity ?? null;
  const totalAssets = latestBalance?.totalAssets ?? null;
  const currentAssets = latestBalance?.currentAssets ?? null;
  const currentLiabilities = latestBalance?.currentLiabilities ?? null;
  const totalDebt = latestBalance?.totalDebt ?? null;
  const inventory = latestBalance?.inventory ?? null;
  const shares = latestBalance?.sharesOutstanding ?? stats.sharesOutstanding ?? null;

  const operatingCashFlowTTM: Money =
    sumTrailing(
      quarterlyCashFlow.map((row) => row.operatingCashFlow),
      4,
    ) ??
    stats.operatingCashFlowTTM ??
    latestValue(annualCashFlow, (row) => row.operatingCashFlow);

  const capexTTM: Money =
    sumTrailing(
      quarterlyCashFlow.map((row) => row.capitalExpenditure),
      4,
    ) ?? latestValue(annualCashFlow, (row) => row.capitalExpenditure);

  const fcfTTM: Money =
    freeCashFlow(operatingCashFlowTTM, capexTTM) ??
    stats.freeCashFlowTTM ??
    latestValue(annualCashFlow, (row) => row.freeCashFlow);

  const annualResults = buildAnnualResults(annualProfitAndLoss);
  const quarterlyResults = buildQuarterlyResults(quarterlyProfitAndLoss);

  const revenueSeries = annualProfitAndLoss.map((row) => row.revenue);
  const epsSeries = annualProfitAndLoss.map((row) => row.dilutedEps);
  const seriesCagr = (series: Money[], years: number): Percent =>
    series.length > years ? cagr(series[0] ?? null, series[years] ?? null, years) : null;

  // Statements can be filed in a different currency than the listing (Yahoo
  // reports Indian ADR-style filings in USD). Per-share figures are only
  // derived when both sides agree; otherwise the provider's value is used.
  const statementCurrency = latestBalance?.currency ?? latestAnnualPl?.currency ?? null;
  const currencyMatches =
    statementCurrency !== null &&
    snapshot.profile.currency !== null &&
    statementCurrency === snapshot.profile.currency;

  const bvps =
    (currencyMatches ? bookValuePerShare(equity, shares) : null) ??
    stats.bookValuePerShare ??
    null;


  const analysis: FundamentalAnalysis = {
    symbol: snapshot.symbol,
    provider: providerId,
    fetchedAt: Date.now(),
    profile: snapshot.profile,
    valuation: {
      marketCap: stats.marketCap,
      enterpriseValue: stats.enterpriseValue,
      peRatioTTM: stats.peRatioTTM,
      forwardPE: stats.forwardPE,
      pbRatio: stats.pbRatio,
      priceToSalesTTM: stats.priceToSalesTTM,
      evToEbitda: stats.evToEbitda,
      evToRevenue: stats.evToRevenue,
      bookValuePerShare: bvps,
      epsBasicTTM:
        stats.epsBasicTTM ??
        (currencyMatches
          ? sumTrailing(quarterlyProfitAndLoss.map((row) => row.basicEps), 4)
          : null),
      epsDilutedTTM:
        (currencyMatches
          ? sumTrailing(quarterlyProfitAndLoss.map((row) => row.dilutedEps), 4)
          : null) ?? stats.epsDilutedTTM,

    },
    profitability: {
      roe: pick(returnOnEquity(netIncomeTTM, equity), stats.returnOnEquity),
      roce: returnOnCapitalEmployed(ebitTTM, totalAssets, currentLiabilities),
      roa: pick(returnOnAssets(netIncomeTTM, totalAssets), stats.returnOnAssets),
      grossMargin: pick(percentOf(grossTTM, revenueTTM), stats.grossMargin),
      operatingMargin: pick(percentOf(operatingTTM, revenueTTM), stats.operatingMargin),
      netProfitMargin: pick(percentOf(netIncomeTTM, revenueTTM), stats.profitMargin),
      ebitdaMargin: percentOf(ebitdaTTM, revenueTTM),
    },
    leverage: {
      debtToEquity: pick(debtToEquity(totalDebt, equity), stats.debtToEquity),
      currentRatio: pick(currentRatio(currentAssets, currentLiabilities), stats.currentRatio),
      quickRatio: pick(
        quickRatio(currentAssets, inventory, currentLiabilities),
        stats.quickRatio,
      ),
      interestCoverage: interestCoverage(ebitTTM, interestTTM),
    },
    growth: {
      revenueGrowthYoY: annualResults[0]?.revenueGrowthYoY ?? null,
      revenueCagr3Y: seriesCagr(revenueSeries, 3),
      revenueCagr5Y: seriesCagr(revenueSeries, 5),
      epsGrowthYoY: annualResults[0]?.epsGrowthYoY ?? null,
      epsCagr3Y: seriesCagr(epsSeries, 3),
      netIncomeGrowthYoY: growth(
        annualProfitAndLoss[0]?.netIncome ?? null,
        annualProfitAndLoss[1]?.netIncome ?? null,
      ),
    },
    cashFlow: {
      operatingCashFlow: operatingCashFlowTTM,
      freeCashFlow: fcfTTM,
      capitalExpenditure: capexTTM,
      fcfMargin: percentOf(fcfTTM, revenueTTM),
    },
    dividends: snapshot.dividends,
    shareholding: snapshot.shareholding,
    quarterlyResults,
    annualResults,
    statements: {
      profitAndLoss: annualProfitAndLoss,
      balanceSheet: annualBalanceSheet,
      cashFlow: annualCashFlow,
    },
    coverage: buildCoverage(snapshot),
  };

  // Derived book value per share is rounded already; keep P/B consistent when
  // the provider omits it but we can compute it from a live market cap.
  if (analysis.valuation.pbRatio === null && bvps !== null && shares !== null) {
    const priceImplied = divide(stats.marketCap, shares);
    if (priceImplied !== null) analysis.valuation.pbRatio = round(priceImplied / bvps);
  }

  return analysis;
}

function buildCoverage(snapshot: FundamentalSnapshot): CoverageEntry[] {
  const entries: CoverageEntry[] = [
    {
      dataset: "quarterlyResults",
      requestedPeriods: QUARTERS_REQUESTED,
      availablePeriods: snapshot.quarterlyProfitAndLoss.length,
    },
    {
      dataset: "annualResults",
      requestedPeriods: YEARS_REQUESTED,
      availablePeriods: snapshot.annualProfitAndLoss.length,
    },
    {
      dataset: "profitAndLoss",
      requestedPeriods: YEARS_REQUESTED,
      availablePeriods: snapshot.annualProfitAndLoss.length,
    },
    {
      dataset: "balanceSheet",
      requestedPeriods: YEARS_REQUESTED,
      availablePeriods: snapshot.annualBalanceSheet.length,
    },
    {
      dataset: "cashFlow",
      requestedPeriods: YEARS_REQUESTED,
      availablePeriods: snapshot.annualCashFlow.length,
    },
    {
      dataset: "dividendHistory",
      requestedPeriods: YEARS_REQUESTED,
      availablePeriods: snapshot.dividends.history.length,
    },
    {
      dataset: "shareholdingPattern",
      requestedPeriods: 1,
      availablePeriods: snapshot.shareholding.latest ? 1 : 0,
    },
  ];

  // Provider-declared notes win over the generic counts.
  for (const declared of snapshot.coverage) {
    const existing = entries.find((entry) => entry.dataset === declared.dataset);
    if (existing) Object.assign(existing, declared);
    else entries.push(declared);
  }
  return entries;
}
