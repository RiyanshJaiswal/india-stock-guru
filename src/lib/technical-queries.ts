import { queryOptions } from "@tanstack/react-query";
import { getHistory, getTechnicalAnalysis } from "@/lib/technical.functions";
import type { Interval, Range } from "@/lib/technical-types";

/** Shared query definitions for the technical analysis engine. */

export const technicalAnalysisQuery = (
  symbol: string,
  interval: Interval = "1d",
  range: Range = "1y",
) =>
  queryOptions({
    queryKey: ["technical-analysis", symbol, interval, range],
    queryFn: () => getTechnicalAnalysis({ data: { symbol, interval, range } }),
    enabled: symbol.trim().length > 0,
    staleTime: 60_000,
  });

export const historyQuery = (
  symbol: string,
  interval: Interval = "1d",
  range: Range = "1y",
) =>
  queryOptions({
    queryKey: ["history", symbol, interval, range],
    queryFn: () => getHistory({ data: { symbol, interval, range } }),
    enabled: symbol.trim().length > 0,
    staleTime: 60_000,
  });
