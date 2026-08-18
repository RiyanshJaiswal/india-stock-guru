import { queryOptions } from "@tanstack/react-query";
import { getMarketNews } from "@/lib/market-news.functions";
import { getQuotes, searchStocks } from "@/lib/market.functions";
import type { Quote } from "@/lib/market-types";

/** Reusable query definitions so every surface shares one cache entry. */
//
// NOTE: every quote refetch spawns a fresh Python process (nse_service.py),
// and NSELive() re-establishes a session with nseindia.com on each run.
// Polling too aggressively (short interval + background/focus refetch) can
// get the app's IP rate-limited or blocked by NSE, and is unnecessarily
// heavy on the machine. Keep this at 30s / no background polling unless
// you've moved to a persistent, properly rate-limited data source.

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
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

export const quoteQuery = (symbol: string) =>
  queryOptions({
    queryKey: ["quote", symbol],
    queryFn: async (): Promise<Quote | null> => {
      const [quote] = await getQuotes({ data: { symbols: [symbol] } });
      return quote ?? null;
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

export const marketNewsQuery = () =>
  queryOptions({
    queryKey: ["market-news"],
    queryFn: () => getMarketNews({ data: { limit: 6 } }),
    staleTime: 2 * 60_000,
    refetchOnWindowFocus: false,
  });