/** Market data providers (server-only). */
import { exchangeOf, stripSuffix, type Quote, type SearchResult } from "./market-types";
import type { Candle, Interval, Range } from "./technical-types";
import { withCache } from "./market-cache.server";
import { fetchNseLiveQuotes } from "./providers/nse-live.server";

const BASE = "https://query2.finance.yahoo.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const TWELVE_DATA_BASE = "https://api.twelvedata.com";
const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY;

type Session = { cookie: string; crumb: string; createdAt: number };
let session: Session | null = null;
const LEGACY_SYMBOL_MAP: Record<string, string> = { "TATAMOTORS.NS": "TMCV.NS", "TATAMOTORS.BO": "544569.BO" };
function providerSymbol(symbol: string): string { return LEGACY_SYMBOL_MAP[symbol.toUpperCase()] ?? symbol; }
function twelveSymbol(symbol: string): { symbol: string; exchange: string } { const normalized = providerSymbol(symbol); const [ticker, suffix] = normalized.split("."); return { symbol: ticker ?? normalized, exchange: suffix === "BO" ? "BSE" : "NSE" }; }
function isNseEquitySymbol(symbol: string): boolean { const upper = symbol.toUpperCase(); return !upper.startsWith("^") && !upper.endsWith(".BO"); }

function rangeStartMs(range: Range, endMs = Date.now()): number | null {
  if (range === "max") return null;
  const start = new Date(endMs);
  if (range === "1mo") start.setMonth(start.getMonth() - 1);
  else if (range === "3mo") start.setMonth(start.getMonth() - 3);
  else if (range === "6mo") start.setMonth(start.getMonth() - 6);
  else if (range === "1y") start.setFullYear(start.getFullYear() - 1);
  else if (range === "2y") start.setFullYear(start.getFullYear() - 2);
  else if (range === "5y") start.setFullYear(start.getFullYear() - 5);
  return start.getTime();
}

function clampToRequestedRange(candles: Candle[], range: Range, endMs = Date.now()): Candle[] {
  const startMs = rangeStartMs(range, endMs);
  if (startMs === null) return candles;
  return candles.filter((candle) => candle.time >= startMs && candle.time <= endMs);
}

async function createSession(): Promise<Session> {
  const seed = await fetch("https://fc.yahoo.com", { headers: { "user-agent": UA } });
  const headers = seed.headers as Headers & { getSetCookie?: () => string[] };
  const raw = headers.getSetCookie?.() ?? [seed.headers.get("set-cookie") ?? ""];
  const cookie = raw.filter(Boolean).map((value) => value.split(";")[0]).join("; ");
  const crumbRes = await fetch(`${BASE}/v1/test/getcrumb`, { headers: { "user-agent": UA, cookie } });
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.includes("<")) throw new Error("Could not authenticate with market data provider");
  return { cookie, crumb, createdAt: Date.now() };
}
async function getSession(refresh = false): Promise<Session> { if (refresh || !session || Date.now() - session.createdAt > 20 * 60_000) session = await createSession(); return session; }
const nullable = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
type RawQuote = Record<string, unknown>;
function validateRawQuote(raw: RawQuote): void { const price = nullable(raw["regularMarketPrice"]); if (price === null || price <= 0) throw new Error("Market provider returned an invalid quote price"); const marketState = String(raw["marketState"] ?? "").toUpperCase(); const marketTime = nullable(raw["regularMarketTime"]); if (marketTime !== null && marketState && marketState !== "CLOSED") { const ageMs = Date.now() - marketTime * 1000; if (ageMs > 6 * 60 * 60_000 || ageMs < -5 * 60_000) throw new Error("Market quote is stale or has an invalid timestamp"); } }
function toQuote(raw: RawQuote, requestedSymbol?: string): Quote {
  validateRawQuote(raw);
  const symbol = String(raw["symbol"] ?? requestedSymbol ?? "");
  const price = nullable(raw["regularMarketPrice"]);
  const reportedMarketCap = nullable(raw["marketCap"] ?? raw["marketCapEstimate"]);
  const sharesOutstanding = nullable(raw["sharesOutstanding"]);
  const calculatedMarketCap = price !== null && sharesOutstanding !== null && sharesOutstanding > 0 ? price * sharesOutstanding : null;
  return { symbol: requestedSymbol ?? symbol, ticker: stripSuffix(requestedSymbol ?? symbol), name: String(raw["longName"] ?? raw["shortName"] ?? symbol), exchange: String(raw["fullExchangeName"] ?? raw["exchangeName"] ?? exchangeOf(requestedSymbol ?? symbol)), currency: String(raw["currency"] ?? "INR"), marketState: String(raw["marketState"] ?? "CLOSED"), timestamp: typeof raw["regularMarketTime"] === "number" ? new Date((raw["regularMarketTime"] as number) * 1000).toISOString() : null, price, previousClose: nullable(raw["regularMarketPreviousClose"] ?? raw["chartPreviousClose"]), change: nullable(raw["regularMarketChange"]), changePercent: nullable(raw["regularMarketChangePercent"]), open: nullable(raw["regularMarketOpen"]), dayHigh: nullable(raw["regularMarketDayHigh"]), dayLow: nullable(raw["regularMarketDayLow"]), fiftyTwoWeekHigh: nullable(raw["fiftyTwoWeekHigh"]), fiftyTwoWeekLow: nullable(raw["fiftyTwoWeekLow"]), volume: nullable(raw["regularMarketVolume"]), marketCap: reportedMarketCap ?? calculatedMarketCap };
}

/** Yahoo chart metadata remains a recovery path for non-NSE current quotes. */
async function yahooChartQuote(requestedSymbol: string): Promise<Quote> {
  const normalized = providerSymbol(requestedSymbol);
  const url = `${BASE}/v8/finance/chart/${encodeURIComponent(normalized)}?interval=1d&range=5d&includePrePost=false&events=div%2Csplits`;
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
  if (!res.ok) throw new Error(`Quote recovery failed (${res.status})`);
  const body = (await res.json()) as { chart?: { error?: { description?: string } | null; result?: Array<{ meta?: RawQuote }> } };
  if (body.chart?.error) throw new Error(body.chart.error.description ?? "Yahoo quote recovery failed");
  const meta = body.chart?.result?.[0]?.meta;
  if (!meta) throw new Error("Yahoo returned no quote metadata");
  return toQuote({ ...meta, symbol: normalized, regularMarketPreviousClose: meta["regularMarketPreviousClose"] ?? meta["chartPreviousClose"], fullExchangeName: meta["fullExchangeName"] ?? meta["exchangeName"], marketState: meta["marketState"] ?? "CLOSED" }, requestedSymbol);
}

/** Yahoo fundamentals timeseries remains available only for non-NSE quote enrichment. */
async function yahooFundamentalMarketCap(requestedSymbol: string): Promise<number | null> {
  const normalized = providerSymbol(requestedSymbol);
  const end = Math.floor(Date.now() / 1000);
  const start = end - 180 * 86_400;
  const url = `${BASE.replace("query2", "query1")}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(normalized)}?symbol=${encodeURIComponent(normalized)}&type=trailingMarketCap&period1=${start}&period2=${end}`;
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!res.ok) return null;
    const body = (await res.json()) as { timeseries?: { result?: Array<{ trailingMarketCap?: Array<{ reportedValue?: { raw?: number } }> }> } };
    const value = body.timeseries?.result?.[0]?.trailingMarketCap?.at(-1)?.reportedValue?.raw;
    return nullable(value);
  } catch { return null; }
}

function validateCandles(candles: Candle[], range: Range): Candle[] {
  const valid = candles.filter((c) => Number.isFinite(c.time) && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close) && c.close > 0 && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close)).sort((a, b) => a.time - b.time);
  const deduped: Candle[] = [];
  for (const candle of valid) { const previous = deduped[deduped.length - 1]; if (previous?.time === candle.time) deduped[deduped.length - 1] = candle; else deduped.push(candle); }
  if (deduped.length === 0) throw new Error("Market provider returned no valid candles");
  const maxAgeDays = range === "1mo" || range === "3mo" || range === "6mo" || range === "1y" ? 15 : range === "2y" ? 30 : 120;
  const ageDays = (Date.now() - deduped[deduped.length - 1].time) / 86_400_000;
  if (ageDays > maxAgeDays) throw new Error(`Historical market data is stale (${Math.floor(ageDays)} days old)`);
  return deduped;
}

export async function providerSearch(query: string): Promise<SearchResult[]> { return withCache(`search:${query.trim().toLowerCase()}`, 5 * 60_000, async () => { const url = `${BASE}/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=25&newsCount=0&listsCount=0&enableFuzzyQuery=false`; const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } }); if (!res.ok) throw new Error(`Search failed (${res.status})`); const body = (await res.json()) as { quotes?: RawQuote[] }; return (body.quotes ?? []).filter((item) => { const symbol = String(item["symbol"] ?? ""); return item["quoteType"] === "EQUITY" && /\.(NS|BO)$/i.test(symbol) && !/^0P/i.test(symbol); }).slice(0, 12).map((item) => { const symbol = String(item["symbol"]); return { symbol, ticker: stripSuffix(symbol), name: String(item["longname"] ?? item["shortname"] ?? symbol), exchange: exchangeOf(symbol) }; }); }); }

async function twelveDataQuotes(symbols: string[]): Promise<Quote[]> { if (!TWELVE_DATA_API_KEY) throw new Error("Twelve Data fallback is not configured"); return Promise.all(symbols.map(async (requestedSymbol) => { const { symbol, exchange } = twelveSymbol(requestedSymbol); const url = `${TWELVE_DATA_BASE}/quote?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange)}&apikey=${encodeURIComponent(TWELVE_DATA_API_KEY)}`; const res = await fetch(url, { headers: { accept: "application/json" } }); if (!res.ok) throw new Error(`Twelve Data quote failed (${res.status})`); const raw = (await res.json()) as Record<string, unknown>; if (String(raw["status"] ?? "ok").toLowerCase() === "error" || raw["code"]) throw new Error(String(raw["message"] ?? "Twelve Data quote error")); const price = Number(raw["close"]); if (!Number.isFinite(price) || price <= 0) throw new Error("Twelve Data returned an invalid quote"); return { symbol: requestedSymbol, ticker: stripSuffix(requestedSymbol), name: String(raw["name"] ?? symbol), exchange, currency: String(raw["currency"] ?? "INR"), marketState: "UNKNOWN", timestamp: null, price, previousClose: nullable(Number(raw["previous_close"])), change: nullable(Number(raw["change"])), changePercent: nullable(Number(raw["percent_change"])), open: nullable(Number(raw["open"])), dayHigh: nullable(Number(raw["high"])), dayLow: nullable(Number(raw["low"])), fiftyTwoWeekHigh: nullable(Number(raw["fifty_two_week"])), fiftyTwoWeekLow: null, volume: nullable(Number(raw["volume"])), marketCap: nullable(Number(raw["market_cap"])) } satisfies Quote; })); }

async function yahooQuotes(symbols: string[]): Promise<Quote[]> {
  if (symbols.length === 0) return [];
  const requestedToProvider = new Map(symbols.map((symbol) => [symbol, providerSymbol(symbol)]));
  const providerSymbols = [...new Set(requestedToProvider.values())];
  const request = async (retry: boolean): Promise<Response> => { const { cookie, crumb } = await getSession(retry); const url = `${BASE}/v7/finance/quote?symbols=${encodeURIComponent(providerSymbols.join(","))}&crumb=${encodeURIComponent(crumb)}`; return fetch(url, { headers: { "user-agent": UA, cookie, accept: "application/json" } }); };
  let res = await request(false); if (res.status === 401 || res.status === 403) res = await request(true); if (!res.ok) throw new Error(`Quote fetch failed (${res.status})`);
  const body = (await res.json()) as { quoteResponse?: { result?: RawQuote[] } };
  const providerResults = body.quoteResponse?.result ?? [];
  const quotes: Quote[] = [];
  const missing: string[] = [];
  for (const requestedSymbol of symbols) {
    const providerResult = providerResults.find((item) => String(item["symbol"] ?? "").toUpperCase() === providerSymbol(requestedSymbol).toUpperCase());
    if (providerResult) { try { quotes.push(toQuote(providerResult, requestedSymbol)); } catch { missing.push(requestedSymbol); } } else missing.push(requestedSymbol);
  }
  if (missing.length > 0) { const recovered = await Promise.allSettled(missing.map((symbol) => yahooChartQuote(symbol))); recovered.forEach((result) => { if (result.status === "fulfilled") quotes.push(result.value); }); }
  return Promise.all(quotes.map(async (quote) => quote.marketCap !== null ? quote : { ...quote, marketCap: await yahooFundamentalMarketCap(quote.symbol) }));
}

function nseQuoteToQuote(raw: Awaited<ReturnType<typeof fetchNseLiveQuotes>>["quotes"][number]): Quote {
  return {
    symbol: `${raw.symbol}.NS`,
    ticker: raw.symbol,
    name: raw.companyName,
    exchange: "NSE",
    currency: "INR",
    marketState: raw.marketState,
    timestamp: raw.timestamp,
    price: raw.lastPrice,
    previousClose: raw.previousClose,
    change: raw.change,
    changePercent: raw.pChange,
    open: raw.open,
    dayHigh: raw.dayHigh,
    dayLow: raw.dayLow,
    fiftyTwoWeekHigh: raw.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: raw.fiftyTwoWeekLow,
    volume: raw.volume,
    marketCap: raw.marketCap,
  };
}

export async function providerQuotes(symbols: string[]): Promise<Quote[]> {
  if (symbols.length === 0) return [];
  const uniqueSymbols = [...new Set(symbols.map((s) => s.trim()).filter(Boolean))];
  return withCache(`quotes:${uniqueSymbols.sort().join(",")}`, 30_000, async () => {
    const nseSymbols = uniqueSymbols.filter(isNseEquitySymbol);
    const otherSymbols = uniqueSymbols.filter((symbol) => !isNseEquitySymbol(symbol));
    const quotes: Quote[] = [];

    if (nseSymbols.length > 0) {
      try {
        const nseResult = await fetchNseLiveQuotes(nseSymbols);
        quotes.push(...nseResult.quotes.map(nseQuoteToQuote));
        const failedNse = nseSymbols.filter((requested) => !nseResult.quotes.some((quote) => quote.symbol === stripSuffix(requested)));
        if (failedNse.length > 0 && TWELVE_DATA_API_KEY) {
          try { quotes.push(...await twelveDataQuotes(failedNse)); } catch { /* keep successful NSE quotes */ }
        }
      } catch {
        if (TWELVE_DATA_API_KEY) {
          try { quotes.push(...await twelveDataQuotes(nseSymbols)); } catch { /* return empty/partial quotes */ }
        }
      }
    }

    if (otherSymbols.length > 0) {
      try { quotes.push(...await yahooQuotes(otherSymbols)); } catch {
        if (TWELVE_DATA_API_KEY) {
          try { quotes.push(...await twelveDataQuotes(otherSymbols)); } catch { /* return successful quotes from other sources */ }
        }
      }
    }

    return quotes;
  });
}

async function twelveDataHistory(symbol: string, interval: Interval, range: Range): Promise<Candle[]> { if (!TWELVE_DATA_API_KEY) throw new Error("Twelve Data fallback is not configured"); if (interval !== "1d" || range === "max") throw new Error("Twelve Data fallback supports daily bounded history only"); const outputsize = range === "1mo" ? 31 : range === "3mo" ? 93 : range === "6mo" ? 186 : range === "1y" ? 366 : 730; const { symbol: ticker, exchange } = twelveSymbol(symbol); const url = `${TWELVE_DATA_BASE}/time_series?symbol=${encodeURIComponent(ticker)}&exchange=${encodeURIComponent(exchange)}&interval=1day&outputsize=${outputsize}&apikey=${encodeURIComponent(TWELVE_DATA_API_KEY)}`; const res = await fetch(url, { headers: { accept: "application/json" } }); if (!res.ok) throw new Error(`Twelve Data history failed (${res.status})`); const body = (await res.json()) as { status?: string; message?: string; values?: Array<Record<string, string>> }; if (body.status === "error" || !body.values) throw new Error(body.message ?? "Twelve Data history error"); const candles = body.values.map((v) => ({ time: Date.parse(`${v.datetime}T00:00:00+05:30`), open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close), volume: Number(v.volume ?? 0) })).filter((c) => Number.isFinite(c.time) && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close)); return validateCandles(clampToRequestedRange(candles.sort((a, b) => a.time - b.time), range), range); }

async function yahooHistory(symbolForProvider: string, interval: Interval, range: Range): Promise<Candle[]> {
  const endMs = Date.now();
  const startMs = rangeStartMs(range, endMs);
  const rangeParams = startMs === null ? `range=${range}` : `period1=${Math.floor(startMs / 1000)}&period2=${Math.ceil(endMs / 1000)}`;
  const url = `${BASE}/v8/finance/chart/${encodeURIComponent(symbolForProvider)}?interval=${interval}&${rangeParams}&includePrePost=false&events=div%2Csplits`;
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
  if (!res.ok) throw new Error(`History fetch failed (${res.status})`);
  const body = (await res.json()) as { chart?: { error?: { description?: string } | null; result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }> } }> } };
  if (body.chart?.error) throw new Error(body.chart.error.description ?? "History provider error");
  const result = body.chart?.result?.[0]; const timestamps = result?.timestamp ?? []; const quote = result?.indicators?.quote?.[0]; if (!quote || timestamps.length === 0) throw new Error("Yahoo returned no historical candles");
  const candles: Candle[] = [];
  for (let i = 0; i < timestamps.length; i += 1) { const open = quote.open?.[i], high = quote.high?.[i], low = quote.low?.[i], close = quote.close?.[i], volume = quote.volume?.[i], time = timestamps[i]; if (time === undefined || typeof open !== "number" || typeof high !== "number" || typeof low !== "number" || typeof close !== "number") continue; candles.push({ time: time * 1000, open, high, low, close, volume: typeof volume === "number" ? volume : 0 }); }
  return clampToRequestedRange(candles, range, endMs);
}

async function tataMotorsAdjustedHistory(interval: Interval, range: Range): Promise<Candle[]> {
  const current = await yahooHistory("TMCV.NS", interval, range);
  if (range === "1mo" || range === "3mo" || range === "6mo") return validateCandles(current, range);
  const legacy = await yahooHistory("TATAMOTORS.NS", interval, range);
  if (legacy.length === 0 || current.length === 0) return validateCandles(current, range);
  const demergerTime = Date.parse("2025-10-14T00:00:00+05:30");
  const legacyBefore = legacy.filter((c) => c.time < demergerTime);
  if (legacyBefore.length === 0) return validateCandles(current, range);
  const anchor = legacyBefore.at(-1)?.close ?? 0;
  if (!anchor) return validateCandles(current, range);
  const impliedCvValue = 260.75;
  const adjustmentFactor = impliedCvValue / anchor;
  const adjustedLegacy = legacyBefore.map((c) => ({ ...c, open: c.open * adjustmentFactor, high: c.high * adjustmentFactor, low: c.low * adjustmentFactor, close: c.close * adjustmentFactor }));
  return validateCandles([...adjustedLegacy, ...current], range);
}

export async function providerHistory(symbol: string, interval: Interval = "1d", range: Range = "1y"): Promise<Candle[]> {
  return withCache(`history:${providerSymbol(symbol)}:${interval}:${range}`, 5 * 60_000, async () => {
    try {
      if (symbol.toUpperCase() === "TATAMOTORS.NS" && interval === "1d") return await tataMotorsAdjustedHistory(interval, range);
      const candles = await yahooHistory(providerSymbol(symbol), interval, range);
      return validateCandles(clampToRequestedRange(candles, range), range);
    } catch (primaryError) {
      if (!TWELVE_DATA_API_KEY) throw primaryError;
      return twelveDataHistory(symbol, interval, range);
    }
  });
}
