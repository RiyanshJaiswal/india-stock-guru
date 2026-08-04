/**
 * Yahoo Finance fundamentals adapter (server-only).
 *
 * The ONLY file that knows Yahoo's payload shape. Swap it for a FastAPI
 * adapter by implementing `FundamentalProvider` and registering that instead.
 */

import {
  byNewestFirst,
  type FundamentalProvider,
  type FundamentalRequest,
  type FundamentalSnapshot,
  type ProviderMarketStats,
} from "../fundamental-provider";
import { round } from "../fundamental-metrics";
import type {
  BalanceSheetRow,
  CashFlowRow,
  CoverageEntry,
  DividendEvent,
  Money,
  ProfitAndLossRow,
} from "../fundamental-types";

const BASE = "https://query2.finance.yahoo.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

type Session = { cookie: string; crumb: string; createdAt: number };
let session: Session | null = null;

async function createSession(): Promise<Session> {
  const seed = await fetch("https://fc.yahoo.com", { headers: { "user-agent": UA } });
  const headers = seed.headers as Headers & { getSetCookie?: () => string[] };
  const raw = headers.getSetCookie?.() ?? [seed.headers.get("set-cookie") ?? ""];
  const cookie = raw
    .filter(Boolean)
    .map((value) => value.split(";")[0])
    .join("; ");

  const crumbRes = await fetch(`${BASE}/v1/test/getcrumb`, {
    headers: { "user-agent": UA, cookie },
  });
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.includes("<")) {
    throw new Error("Could not authenticate with the fundamentals provider");
  }
  return { cookie, crumb, createdAt: Date.now() };
}

async function getSession(refresh = false): Promise<Session> {
  if (refresh || !session || Date.now() - session.createdAt > 20 * 60_000) {
    session = await createSession();
  }
  return session;
}

async function authorizedJson<T>(path: string): Promise<T> {
  const call = async (retry: boolean) => {
    const { cookie, crumb } = await getSession(retry);
    const joiner = path.includes("?") ? "&" : "?";
    return fetch(`${BASE}${path}${joiner}crumb=${encodeURIComponent(crumb)}`, {
      headers: { "user-agent": UA, cookie, accept: "application/json" },
    });
  };
  let res = await call(false);
  if (res.status === 401 || res.status === 403) res = await call(true);
  if (!res.ok) throw new Error(`Fundamentals request failed (${res.status})`);
  return (await res.json()) as T;
}

type RawValue = { raw?: number } | number | null | undefined;
const val = (value: RawValue): Money => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = value?.raw;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
};
const pct = (value: RawValue): Money => {
  const num = val(value);
  return num === null ? null : round(num * 100);
};
const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/* --------------------------- timeseries feed ---------------------------- */

type TimeseriesPoint = {
  asOfDate?: string;
  currencyCode?: string;
  reportedValue?: { raw?: number };
};
type TimeseriesResult = Record<string, TimeseriesPoint[] | unknown>;

const ANNUAL_KEYS = [
  "TotalRevenue",
  "CostOfRevenue",
  "GrossProfit",
  "OperatingExpense",
  "OperatingIncome",
  "EBITDA",
  "EBIT",
  "InterestExpense",
  "PretaxIncome",
  "TaxProvision",
  "NetIncome",
  "BasicEPS",
  "DilutedEPS",
  "TotalAssets",
  "CurrentAssets",
  "CashAndCashEquivalents",
  "Inventory",
  "AccountsReceivable",
  "TotalLiabilitiesNetMinorityInterest",
  "CurrentLiabilities",
  "TotalDebt",
  "StockholdersEquity",
  "InvestedCapital",
  "ShareIssued",
  "OperatingCashFlow",
  "InvestingCashFlow",
  "FinancingCashFlow",
  "CapitalExpenditure",
  "FreeCashFlow",
] as const;

type PeriodMap = Map<string, { currency: string | null; values: Map<string, number> }>;

function collect(results: TimeseriesResult[], prefix: "annual" | "quarterly"): PeriodMap {
  const periods: PeriodMap = new Map();
  for (const result of results) {
    for (const [key, value] of Object.entries(result)) {
      if (key === "meta" || key === "timestamp" || !Array.isArray(value)) continue;
      if (!key.startsWith(prefix)) continue;
      const field = key.slice(prefix.length);
      for (const point of value as TimeseriesPoint[]) {
        const date = point?.asOfDate;
        const raw = point?.reportedValue?.raw;
        if (!date || typeof raw !== "number" || !Number.isFinite(raw)) continue;
        const entry = periods.get(date) ?? {
          currency: point.currencyCode ?? null,
          values: new Map<string, number>(),
        };
        entry.values.set(field, raw);
        periods.set(date, entry);
      }
    }
  }
  return periods;
}

const get = (values: Map<string, number>, field: string): Money =>
  values.has(field) ? (values.get(field) as number) : null;

function toProfitAndLoss(periods: PeriodMap, periodType: "annual" | "quarterly") {
  const rows: ProfitAndLossRow[] = [];
  for (const [asOfDate, { currency, values }] of periods) {
    rows.push({
      asOfDate,
      periodType,
      currency,
      revenue: get(values, "TotalRevenue"),
      costOfRevenue: get(values, "CostOfRevenue"),
      grossProfit: get(values, "GrossProfit"),
      operatingExpenses: get(values, "OperatingExpense"),
      operatingIncome: get(values, "OperatingIncome"),
      ebitda: get(values, "EBITDA"),
      ebit: get(values, "EBIT") ?? get(values, "OperatingIncome"),
      interestExpense: get(values, "InterestExpense"),
      pretaxIncome: get(values, "PretaxIncome"),
      taxExpense: get(values, "TaxProvision"),
      netIncome: get(values, "NetIncome"),
      basicEps: get(values, "BasicEPS"),
      dilutedEps: get(values, "DilutedEPS"),
    });
  }
  return byNewestFirst(rows).filter(
    (row) => row.revenue !== null || row.netIncome !== null || row.operatingIncome !== null,
  );
}

function toBalanceSheet(periods: PeriodMap, periodType: "annual" | "quarterly") {
  const rows: BalanceSheetRow[] = [];
  for (const [asOfDate, { currency, values }] of periods) {
    const row: BalanceSheetRow = {
      asOfDate,
      periodType,
      currency,
      totalAssets: get(values, "TotalAssets"),
      currentAssets: get(values, "CurrentAssets"),
      cashAndEquivalents: get(values, "CashAndCashEquivalents"),
      inventory: get(values, "Inventory"),
      receivables: get(values, "AccountsReceivable"),
      totalLiabilities: get(values, "TotalLiabilitiesNetMinorityInterest"),
      currentLiabilities: get(values, "CurrentLiabilities"),
      totalDebt: get(values, "TotalDebt"),
      stockholdersEquity: get(values, "StockholdersEquity"),
      investedCapital: get(values, "InvestedCapital"),
      sharesOutstanding: get(values, "ShareIssued"),
    };
    if (row.totalAssets !== null || row.stockholdersEquity !== null) rows.push(row);
  }
  return byNewestFirst(rows);
}

function toCashFlow(periods: PeriodMap, periodType: "annual" | "quarterly") {
  const rows: CashFlowRow[] = [];
  for (const [asOfDate, { currency, values }] of periods) {
    const row: CashFlowRow = {
      asOfDate,
      periodType,
      currency,
      operatingCashFlow: get(values, "OperatingCashFlow"),
      investingCashFlow: get(values, "InvestingCashFlow"),
      financingCashFlow: get(values, "FinancingCashFlow"),
      capitalExpenditure: get(values, "CapitalExpenditure"),
      freeCashFlow: get(values, "FreeCashFlow"),
      netIncome: get(values, "NetIncome"),
    };
    if (row.operatingCashFlow !== null || row.freeCashFlow !== null) rows.push(row);
  }
  return byNewestFirst(rows);
}

/* ------------------------------ dividends ------------------------------- */

async function fetchDividendHistory(symbol: string): Promise<DividendEvent[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1mo&range=10y&events=div`;
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    chart?: {
      result?: { events?: { dividends?: Record<string, { amount?: number; date?: number }> } }[];
    };
  };
  const dividends = body.chart?.result?.[0]?.events?.dividends ?? {};
  return Object.values(dividends)
    .filter((item) => typeof item?.amount === "number" && typeof item?.date === "number")
    .map((item) => ({ date: (item.date as number) * 1000, amount: item.amount as number }))
    .sort((a, b) => b.date - a.date);
}

/* ------------------------------- adapter -------------------------------- */

type QuoteSummary = {
  quoteSummary?: {
    error?: { description?: string } | null;
    result?: Record<string, Record<string, unknown>>[];
  };
};

export const yahooFundamentalProvider: FundamentalProvider = {
  id: "yahoo",

  async fetchSnapshot(request: FundamentalRequest): Promise<FundamentalSnapshot> {
    const { symbol, quarters, years } = request;
    const modules = [
      "assetProfile",
      "summaryDetail",
      "defaultKeyStatistics",
      "financialData",
      "majorHoldersBreakdown",
      "price",
    ].join(",");

    const types = ANNUAL_KEYS.flatMap((key) => [`annual${key}`, `quarterly${key}`]).join(",");
    const period2 = Math.floor(Date.now() / 1000);
    const period1 = period2 - years * 400 * 86_400;

    const [summary, series, dividendHistory] = await Promise.all([
      authorizedJson<QuoteSummary>(
        `/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`,
      ),
      authorizedJson<{ timeseries?: { result?: TimeseriesResult[] } }>(
        `/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&type=${types}&period1=${period1}&period2=${period2}`,
      ),
      fetchDividendHistory(symbol),
    ]);

    if (summary.quoteSummary?.error) {
      throw new Error(summary.quoteSummary.error.description ?? "Fundamentals provider error");
    }
    const result = summary.quoteSummary?.result?.[0];
    if (!result) throw new Error(`No fundamentals reported for ${symbol}.`);

    const profile = result['assetProfile'] ?? {};
    const detail = result['summaryDetail'] ?? {};
    const keyStats = result['defaultKeyStatistics'] ?? {};
    const financial = result['financialData'] ?? {};
    const holders = result['majorHoldersBreakdown'] ?? {};
    const price = result['price'] ?? {};

    const timeseries = series.timeseries?.result ?? [];
    const annual = collect(timeseries, "annual");
    const quarterly = collect(timeseries, "quarterly");

    const stats: ProviderMarketStats = {
      marketCap: val(detail['marketCap'] as RawValue),
      enterpriseValue: val(keyStats['enterpriseValue'] as RawValue),
      peRatioTTM: val(detail['trailingPE'] as RawValue),
      forwardPE: val(keyStats['forwardPE'] as RawValue) ?? val(detail['forwardPE'] as RawValue),
      pbRatio: val(keyStats['priceToBook'] as RawValue),
      priceToSalesTTM: val(detail['priceToSalesTrailing12Months'] as RawValue),
      evToEbitda: val(keyStats['enterpriseToEbitda'] as RawValue),
      evToRevenue: val(keyStats['enterpriseToRevenue'] as RawValue),
      bookValuePerShare: val(keyStats['bookValue'] as RawValue),
      epsBasicTTM: val(keyStats['trailingEps'] as RawValue),
      epsDilutedTTM: val(keyStats['trailingEps'] as RawValue),
      sharesOutstanding: val(keyStats['sharesOutstanding'] as RawValue),
      currentRatio: val(financial['currentRatio'] as RawValue),
      quickRatio: val(financial['quickRatio'] as RawValue),
      debtToEquity: (() => {
        const reported = val(financial['debtToEquity'] as RawValue);
        return reported === null ? null : round(reported / 100);
      })(),
      returnOnEquity: pct(financial['returnOnEquity'] as RawValue),
      returnOnAssets: pct(financial['returnOnAssets'] as RawValue),
      grossMargin: pct(financial['grossMargins'] as RawValue),
      operatingMargin: pct(financial['operatingMargins'] as RawValue),
      profitMargin: pct(financial['profitMargins'] as RawValue),
      ebitda: val(financial['ebitda'] as RawValue),
      totalRevenueTTM: val(financial['totalRevenue'] as RawValue),
      operatingCashFlowTTM: val(financial['operatingCashflow'] as RawValue),
      freeCashFlowTTM: val(financial['freeCashflow'] as RawValue),
    };

    const insiders = pct(holders['insidersPercentHeld'] as RawValue);
    const institutions = pct(holders['institutionsPercentHeld'] as RawValue);
    const publicHeld =
      insiders !== null && institutions !== null
        ? round(Math.max(0, 100 - insiders - institutions))
        : null;

    const coverage: CoverageEntry[] = [
      {
        dataset: "shareholdingPattern",
        requestedPeriods: 1,
        availablePeriods: insiders === null && institutions === null ? 0 : 1,
        note: "Yahoo reports insider/institution splits only. Promoter, FII and DII break-ups and quarter-wise shareholding history require an Indian filings provider.",
      },
    ];

    return {
      symbol,
      profile: {
        symbol,
        name: str(price['longName']) ?? str(price['shortName']),
        sector: str(profile['sector']),
        industry: str(profile['industry']),
        currency: str(price['currency']) ?? str(detail['currency']),
        employees: typeof profile['fullTimeEmployees'] === "number"
          ? (profile['fullTimeEmployees'] as number)
          : null,
        website: str(profile['website']),
        summary: str(profile['longBusinessSummary']),
      },
      stats,
      annualProfitAndLoss: toProfitAndLoss(annual, "annual").slice(0, years),
      quarterlyProfitAndLoss: toProfitAndLoss(quarterly, "quarterly").slice(0, quarters),
      annualBalanceSheet: toBalanceSheet(annual, "annual").slice(0, years),
      quarterlyBalanceSheet: toBalanceSheet(quarterly, "quarterly").slice(0, quarters),
      annualCashFlow: toCashFlow(annual, "annual").slice(0, years),
      quarterlyCashFlow: toCashFlow(quarterly, "quarterly").slice(0, quarters),
      dividends: {
        dividendRate: val(detail['dividendRate'] as RawValue),
        dividendYield: (() => {
          const raw = val(detail['dividendYield'] as RawValue);
          if (raw === null) return null;
          // Yahoo returns either a fraction or an already-scaled percentage.
          return round(raw > 1 ? raw : raw * 100);
        })(),
        payoutRatio: pct(detail['payoutRatio'] as RawValue),
        fiveYearAverageYield: val(detail['fiveYearAvgDividendYield'] as RawValue),
        exDividendDate: (() => {
          const raw = val(detail['exDividendDate'] as RawValue);
          return raw === null ? null : raw * 1000;
        })(),
        history: dividendHistory,
      },
      shareholding: {
        latest:
          insiders === null && institutions === null
            ? null
            : {
                asOfDate: null,
                slices: [
                  { category: "insiders", percent: insiders },
                  { category: "institutions", percent: institutions },
                  { category: "public", percent: publicHeld },
                ],
              },
        history: [],
        unavailable: ["promoter", "fii", "dii"],
      },
      coverage,
    };
  },
};
