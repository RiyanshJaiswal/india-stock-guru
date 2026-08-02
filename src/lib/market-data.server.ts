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

function toQuote(raw: RawQuote): Quote {
  const symbol = String(raw['symbol'] ?? "");
  const price = nullable(raw['regularMarketPrice']);
  const previousClose = nullable(raw['regularMarketPreviousClose']);
  return {
    symbol,
    ticker: stripSuffix(symbol),
    name: String(raw['longName'] ?? raw['shortName'] ?? symbol),
    exchange: String(raw['fullExchangeName'] ?? exchangeOf(symbol)),
    currency: String(raw['currency'] ?? "INR"),
    marketState: String(raw['marketState'] ?? "CLOSED"),
    price,
    previousClose,
    change: nullable(raw['regularMarketChange']),
    changePercent: nullable(raw['regularMarketChangePercent']),
    open: nullable(raw['regularMarketOpen']),
    dayHigh: nullable(raw['regularMarketDayHigh']),
    dayLow: nullable(raw['regularMarketDayLow']),
    fiftyTwoWeekHigh: nullable(raw['fiftyTwoWeekHigh']),
    fiftyTwoWeekLow: nullable(raw['fiftyTwoWeekLow']),
    volume: nullable(raw['regularMarketVolume']),
    marketCap: nullable(raw['marketCap']),
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
      const symbol = String(item['symbol'] ?? "");
      return (
        item['quoteType'] === "EQUITY" && /\.(NS|BO)$/i.test(symbol) && !/^0P/i.test(symbol)
      );
    })
    .slice(0, 12)
    .map((item) => {
      const symbol = String(item['symbol']);
      return {
        symbol,
        ticker: stripSuffix(symbol),
        name: String(item['longname'] ?? item['shortname'] ?? symbol),
        exchange: exchangeOf(symbol),
      };
    });
}

/** Latest available quotes for one or more symbols. */
export async function providerQuotes(symbols: string[]): Promise<Quote[]> {
  if (symbols.length === 0) return [];

  const request = async (retry: boolean): Promise<Response> => {
    const { cookie, crumb } = await getSession(retry);
    const url = `${BASE}/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}&crumb=${encodeURIComponent(crumb)}`;
    return fetch(url, { headers: { "user-agent": UA, cookie, accept: "application/json" } });
  };

  let res = await request(false);
  if (res.status === 401 || res.status === 403) res = await request(true);
  if (!res.ok) throw new Error(`Quote fetch failed (${res.status})`);

  const body = (await res.json()) as { quoteResponse?: { result?: RawQuote[] } };
  return (body.quoteResponse?.result ?? []).map(toQuote);
}
