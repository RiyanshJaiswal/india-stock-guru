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

    // Canonicalize the daily change from the latest two validated daily
    // candles. Quote endpoints can occasionally expose a stale previousClose
    // (especially around session/market-date boundaries). The chart history
    // is the same source used by the UI, so deriving the daily change from it
    // prevents dashboard, watchlist and detail-page mismatches.
    return Promise.all(quotes.map(async (quote) => {
      if (quote.price === null) return quote;

      try {
        const candles = await providerHistory(quote.symbol, "1d", "1mo");
        if (candles.length >= 2) {
          const previousClose = candles[candles.length - 2].close;
          if (Number.isFinite(previousClose) && previousClose > 0) {
            const change = quote.price - previousClose;
            const changePercent = (change / previousClose) * 100;
            return {
              ...quote,
              previousClose,
              change,
              changePercent,
            };
          }
        }
      } catch {
        // Keep the provider quote as a safe fallback when history is
        // temporarily unavailable.
      }

      if (quote.previousClose === null || quote.previousClose === 0) return quote;
      const change = quote.price - quote.previousClose;
      const changePercent = (change / quote.previousClose) * 100;
      return {
        ...quote,
        change,
        changePercent,
      };
    }));
  });
