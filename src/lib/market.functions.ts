/**
 * Market API service layer.
 *
 * Every UI read goes through these server functions. The provider layer hides
 * the underlying market-data source so the frontend keeps a stable DTO.
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
    const { providerQuotes } = await import("./market-data.server");
    const quotes = await providerQuotes(data.symbols);

    // Some NSE payload variants include previousClose but omit explicit
    // change/changePercent fields. Derive them from the same quote rather
    // than showing a misleading blank value in the dashboard.
    return quotes.map((quote) => {
      if (quote.change !== null && quote.changePercent !== null) return quote;
      const change = quote.change ?? (
        quote.price !== null && quote.previousClose !== null
          ? quote.price - quote.previousClose
          : null
      );
      const changePercent = quote.changePercent ?? (
        change !== null && quote.previousClose !== null && quote.previousClose !== 0
          ? (change / quote.previousClose) * 100
          : null
      );
      return { ...quote, change, changePercent };
    });
  });
