import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Quote } from "./market-types";
import { providerQuotes } from "./market-data.server";
import { withCache } from "./market-cache.server";
import { exchangeOf, stripSuffix } from "./market-types";

const input = z.object({ symbols: z.array(z.string().min(1).max(24)).min(1).max(25) });
const YAHOO = "https://query2.finance.yahoo.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36";
const LEGACY_SYMBOL_MAP: Record<string, string> = { "TATAMOTORS.NS": "TMCV.NS", "TATAMOTORS.BO": "544569.BO" };

function providerSymbol(symbol: string) {
  return LEGACY_SYMBOL_MAP[symbol.toUpperCase()] ?? symbol;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type Meta = Record<string, unknown>;

async function yahooChartQuote(requestedSymbol: string): Promise<Quote | null> {
  const normalized = providerSymbol(requestedSymbol);
  const url = `${YAHOO}/v8/finance/chart/${encodeURIComponent(normalized)}?interval=1d&range=5d&includePrePost=false&events=div%2Csplits`;
  try {
    const response = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!response.ok) return null;
    const body = (await response.json()) as { chart?: { error?: { description?: string } | null; result?: Array<{ meta?: Meta }> } };
    const meta = body.chart?.result?.[0]?.meta;
    if (!meta) return null;

    const price = numberOrNull(meta["regularMarketPrice"]);
    if (price === null || price <= 0) return null;
    const previousClose = numberOrNull(meta["regularMarketPreviousClose"] ?? meta["chartPreviousClose"]);
    const change = numberOrNull(meta["regularMarketChange"]) ?? (previousClose === null ? null : price - previousClose);
    const changePercent = numberOrNull(meta["regularMarketChangePercent"]) ?? (change !== null && previousClose ? (change / previousClose) * 100 : null);

    return {
      symbol: requestedSymbol,
      ticker: stripSuffix(requestedSymbol),
      name: String(meta["longName"] ?? meta["shortName"] ?? stripSuffix(requestedSymbol)),
      exchange: String(meta["fullExchangeName"] ?? meta["exchangeName"] ?? exchangeOf(requestedSymbol)),
      currency: String(meta["currency"] ?? "INR"),
      marketState: String(meta["marketState"] ?? "CLOSED"),
      timestamp: typeof meta["regularMarketTime"] === "number" ? new Date((meta["regularMarketTime"] as number) * 1000).toISOString() : null,
      price,
      previousClose,
      change,
      changePercent,
      open: numberOrNull(meta["regularMarketOpen"]),
      dayHigh: numberOrNull(meta["regularMarketDayHigh"]),
      dayLow: numberOrNull(meta["regularMarketDayLow"]),
      fiftyTwoWeekHigh: numberOrNull(meta["fiftyTwoWeekHigh"]),
      fiftyTwoWeekLow: numberOrNull(meta["fiftyTwoWeekLow"]),
      volume: numberOrNull(meta["regularMarketVolume"]),
      marketCap: numberOrNull(meta["marketCap"]),
    };
  } catch {
    return null;
  }
}

async function fetchPortfolioQuotes(symbols: string[]): Promise<Quote[]> {
  return withCache(`portfolio-quotes:${[...symbols].sort().join(",")}`, 15_000, async () => {
    let primary: Quote[] = [];
    try {
      primary = await providerQuotes(symbols);
    } catch {
      primary = [];
    }

    const bySymbol = new Map(primary.map((quote) => [quote.symbol.toUpperCase(), quote]));
    const missing = symbols.filter((symbol) => !bySymbol.has(symbol.toUpperCase()) || bySymbol.get(symbol.toUpperCase())?.price === null);
    if (missing.length === 0) return primary;

    const fallback = await Promise.all(missing.map((symbol) => yahooChartQuote(symbol)));
    for (const quote of fallback) {
      if (quote) bySymbol.set(quote.symbol.toUpperCase(), quote);
    }
    return symbols.map((symbol) => bySymbol.get(symbol.toUpperCase())).filter((quote): quote is Quote => Boolean(quote));
  });
}

export const getPortfolioQuotes = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data }) => fetchPortfolioQuotes(data.symbols));
