/**
 * Market API service layer.
 *
 * Every UI read goes through these server functions. To move onto the
 * FastAPI backend later, replace the provider imports below with `fetch`
 * calls to your API base URL — signatures and return types stay identical.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Quote, SearchResult } from "./market-types";

const searchInput = z.object({ query: z.string().trim().min(1).max(64) });
const quotesInput = z.object({ symbols: z.array(z.string().min(1).max(24)).min(1).max(25) });

export const searchStocks = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => searchInput.parse(data))
  .handler(async ({ data }): Promise<SearchResult[]> => {
    const { providerSearch } = await import("./market-data.server");
    return providerSearch(data.query);
  });

export const getQuotes = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => quotesInput.parse(data))
  .handler(async ({ data }): Promise<Quote[]> => {
    const { providerQuotes, providerHistory } = await import("./market-data.server");
    const quotes = await providerQuotes(data.symbols);

    // Canonicalize fields from the same validated daily history used by the
    // chart. This keeps dashboard/watchlist/detail values consistent.
    return Promise.all(
      quotes.map(async (quote) => {
        if (quote.price === null) return quote;

        try {
          const candles = await providerHistory(quote.symbol, "1d", "1mo");
          if (candles.length >= 2) {
            const latestCandle = candles[candles.length - 1];
            const previousClose = candles[candles.length - 2].close;
            const change = quote.price - previousClose;
            const changePercent = previousClose > 0 ? (change / previousClose) * 100 : quote.changePercent;

            return {
              ...quote,
              open: quote.open ?? latestCandle.open,
              previousClose,
              change,
              changePercent,
              dayHigh: quote.dayHigh ?? latestCandle.high,
              dayLow: quote.dayLow ?? latestCandle.low,
              volume: quote.volume ?? latestCandle.volume,
            };
          }
        } catch {
          // Keep provider values when history is temporarily unavailable.
        }

        if (quote.previousClose === null || quote.previousClose === 0) return quote;
        const change = quote.price - quote.previousClose;
        const changePercent = (change / quote.previousClose) * 100;
        return { ...quote, change, changePercent };
      }),
    );
  });
