import { queryOptions } from "@tanstack/react-query";
import { getQuotes, searchStocks } from "@/lib/market.functions";
import type { Quote } from "@/lib/market-types";

/** Reusable query definitions so every surface shares one cache entry. */

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
