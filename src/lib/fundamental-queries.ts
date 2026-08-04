import { queryOptions } from "@tanstack/react-query";
import { getFundamentals } from "@/lib/fundamental.functions";
import { QUARTERS_REQUESTED, YEARS_REQUESTED } from "@/lib/fundamental-types";

/** Shared query definition for the fundamental analysis engine. */
export const fundamentalsQuery = (
  symbol: string,
  quarters: number = QUARTERS_REQUESTED,
  years: number = YEARS_REQUESTED,
) =>
  queryOptions({
    queryKey: ["fundamentals", symbol, quarters, years],
    queryFn: () => getFundamentals({ data: { symbol, quarters, years } }),
    enabled: symbol.trim().length > 0,
    staleTime: 15 * 60_000,
  });
