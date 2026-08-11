/**
 * Market data provider (server-only).
 *
 * Currently talks to Yahoo Finance's public endpoints, which cover every
 * NSE (.NS) and BSE (.BO) listed instrument. This file is the ONLY place
 * that knows about the upstream provider — swap the two exported functions
 * for FastAPI calls and the rest of the app is untouched.
 */

import {
  exchangeOf,
  stripSuffix,
  type Quote,
  type SearchResult,
} from "./market-types";
import type { Candle, Interval, Range } from "./technical-types";

const BASE = "https://query2.finance.yahoo.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

type Session = { cookie: string; crumb: string; createdAt: number };
let session: Session | null = null;

/**
 * Yahoo/NSE changed Tata Motors' trading symbol after the 2025 demerger.
 * Keep the legacy symbol working inside the app so existing watchlists and
 * portfolio entries do not break, while querying the current NSE symbol.
 */
const LEGACY_SYMBOL_MAP: Record<string, string> = {
  "TATAMOTORS.NS": "TMCV.NS",
  "TATAMOTORS.BO": "544569.BO",
};

function providerSymbol(symbol: string): string {
  return LEGACY_SYMBOL_MAP[symbol.toUpperCase()] ?? symbol;
}

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
  if (!crumb || crumb.includes("<")) throw new Error("Could not authenticate with market data provider");

  return { cookie, crumb, createdAt: Date.now() };
}

async function getSession(refresh = false): Promise<Session> {
  if (refresh || !session || Date.now() - session.createdAt > 20 * 60_000) {
    session = await createSession();
  }
  return session;
}

const nullable = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

type RawQuote = Record<string, unknown>;

function toQuote(raw: RawQuote, requestedSymbol?: string): Quote {
  const symbol = String(raw["symbol"] ?? requestedSymbol ?? "");
  const price = nullable(raw["regularMarketPrice"]);
  const previousClose = nullable(raw["regularMarketPreviousClose"]);
  return {
    // Preserve the app's requested/legacy symbol so existing Watchlist and
    // Portfolio lookups continue to match after provider symbol normalization.
    symbol: requestedSymbol ?? symbol,
    ticker: stripSuffix(requestedSymbol ?? symbol),
    name: String(raw["longName"] ?? raw["shortName"] ?? symbol),
    exchange: String(raw["fullExchangeName"] ?? exchangeOf(requestedSymbol ?? symbol)),
    currency: String(raw["currency"] ?? "INR"),
    marketState: String(raw["marketState"] ?? "CLOSED"),
    price,
    previousClose,
    change: nullable(raw["regularMarketChange"]),
    changePercent: nullable(raw["regularMarketChangePercent"]),
    open: nullable(raw["regularMarketOpen"]),
    dayHigh: nullable(raw["regularMarketDayHigh"]),
    dayLow: nullable(raw["regularMarketDayLow"]),
    fiftyTwoWeekHigh: nullable(raw["fiftyTwoWeekHigh"]),
    fiftyTwoWeekLow: nullable(raw["fiftyTwoWeekLow"]),
    volume: nullable(raw["regularMarketVolume"]),
    marketCap: nullable(raw["marketCap"]),
  };
}

/** Full-text search across NSE/BSE listed equities. */
export async function providerSearch(query: string): Promise<SearchResult[]> {
  const url = `${BASE}/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=25&newsCount=0&listsCount=0&enableFuzzyQuery=false`;
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);

  const body = (await res.json()) as { quotes?: RawQuote[] };
  return (body.quotes ?? [])
    .filter((item) => {
      const symbol = String(item["symbol"] ?? "");
      return (
        item["quoteType"] === "EQUITY" && /\.(NS|BO)$/i.test(symbol) && !/^0P/i.test(symbol)
      );
    })
    .slice(0, 12)
    .map((item) => {
      const symbol = String(item["symbol"]);
      return {
        symbol,
        ticker: stripSuffix(symbol),
        name: String(item["longname"] ?? item["shortname"] ?? symbol),
        exchange: exchangeOf(symbol),
      };
    });
}

/** Latest available quotes for one or more symbols. */
export async function providerQuotes(symbols: string[]): Promise<Quote[]> {
  if (symbols.length === 0) return [];

  const requestedToProvider = new Map(
    symbols.map((symbol) => [symbol, providerSymbol(symbol)]),
  );
  const providerSymbols = [...new Set(requestedToProvider.values())];

  const request = async (retry: boolean): Promise<Response> => {
    const { cookie, crumb } = await getSession(retry);
    const url = `${BASE}/v7/finance/quote?symbols=${encodeURIComponent(providerSymbols.join(","))}&crumb=${encodeURIComponent(crumb)}`;
    return fetch(url, { headers: { "user-agent": UA, cookie, accept: "application/json" } });
  };

  let res = await request(false);
  if (res.status === 401 || res.status === 403) res = await request(true);
  if (!res.ok) throw new Error(`Quote fetch failed (${res.status})`);

  const body = (await res.json()) as { quoteResponse?: { result?: RawQuote[] } };
  const providerResults = body.quoteResponse?.result ?? [];

  return symbols.flatMap((requestedSymbol) => {
    const providerResult = providerResults.find(
      (item) => String(item["symbol"] ?? "").toUpperCase() === providerSymbol(requestedSymbol).toUpperCase(),
    );
    return providerResult ? [toQuote(providerResult, requestedSymbol)] : [];
  });
}

/** Historical OHLCV candles used by the technical analysis engine. */
export async function providerHistory(
  symbol: string,
  interval: Interval = "1d",
  range: Range = "1y",
): Promise<Candle[]> {
  const symbolForProvider = providerSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbolForProvider)}?interval=${interval}&range=${range}&includePrePost=false`;
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
  if (!res.ok) throw new Error(`History fetch failed (${res.status})`);

  const body = (await res.json()) as {
    chart?: {
      error?: { description?: string } | null;
      result?: {
        timestamp?: number[];
        indicators?: {
          quote?: {
            open?: (number | null)[];
            high?: (number | null)[];
            low?: (number | null)[];
            close?: (number | null)[];
            volume?: (number | null)[];
          }[];
        };
      }[];
    };
  };

  if (body.chart?.error) {
    throw new Error(body.chart.error.description ?? "History provider error");
  }

  const result = body.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  if (!quote || timestamps.length === 0) return [];

  const candles: Candle[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = quote.close?.[i];
    const volume = quote.volume?.[i];
    const time = timestamps[i];
    if (
      time === undefined ||
      typeof open !== "number" ||
      typeof high !== "number" ||
      typeof low !== "number" ||
      typeof close !== "number"
    ) {
      continue;
    }
    candles.push({
      time: time * 1000,
      open,
      high,
      low,
      close,
      volume: typeof volume === "number" ? volume : 0,
    });
  }
  return candles;
}
