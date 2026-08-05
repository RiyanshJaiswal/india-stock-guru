import { queryOptions } from "@tanstack/react-query";
import { getNewsFeed } from "@/lib/news.functions";

/** Shared query definitions for the news intelligence engine. */

export const companyNewsQuery = (symbol: string, limit = 30, sinceDays = 14) =>
  queryOptions({
    queryKey: ["news", "company", symbol, limit, sinceDays],
    queryFn: () => getNewsFeed({ data: { symbol, query: null, limit, sinceDays } }),
    enabled: symbol.trim().length > 0,
    staleTime: 5 * 60_000,
  });

export const marketNewsQuery = (query = "Indian stock market", limit = 30, sinceDays = 3) =>
  queryOptions({
    queryKey: ["news", "market", query, limit, sinceDays],
    queryFn: () => getNewsFeed({ data: { symbol: null, query, limit, sinceDays } }),
    staleTime: 5 * 60_000,
  });
