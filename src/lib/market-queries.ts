import { queryOptions } from "@tanstack/react-query";
import { getQuotes, searchStocks } from "@/lib/market.functions";
import type { Quote } from "@/lib/market-types";

/** Reusable query definitions so every surface shares one cache entry. */

// Live NSE quotes are polled while the market is open. A 10s interval keeps
// the UI responsive like a typical retail trading app without hammering NSE.
const LIVE_QUOTE_INTERVAL = 10_000;
const LIVE_QUOTE_STALE_TIME = 5_000;

export const searchQuery = (query: string) =>
  queryOptions({
    queryKey: ["stock-search", query],
    queryFn: () => searchStocks({ data: { query } }),
    enabled: query.trim().length >= 2,
    staleTime: 5 * 60_000,
  });

export const quotesQuery = (symbols: string[]) =>
  queryOptions({
    queryKey: ["quotes", [...symbols].sort()],
    queryFn: () => getQuotes({ data: { symbols } }),
    enabled: symbols.length > 0,
    staleTime: LIVE_QUOTE_STALE_TIME,
    refetchInterval: LIVE_QUOTE_INTERVAL,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

export const quoteQuery = (symbol: string) =>
  queryOptions({
    queryKey: ["quote", symbol],
    queryFn: async (): Promise<Quote | null> => {
      const [quote] = await getQuotes({ data: { symbols: [symbol] } });
      return quote ?? null;
    },
    staleTime: LIVE_QUOTE_STALE_TIME,
    refetchInterval: LIVE_QUOTE_INTERVAL,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });
