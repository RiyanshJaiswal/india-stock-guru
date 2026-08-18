/**
 * Market API service layer.
 *
 * Every UI read goes through these server functions. The provider layer hides
 * the underlying market-data source so the frontend keeps a stable DTO.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Quote, SearchResult } from "./market-types";
import { fetchPortfolioQuotes } from "./portfolio-quotes.server";

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
    // NSE remains primary. If it cannot return a symbol, the portfolio quote
    // recovery uses Yahoo chart metadata for only the missing symbols.
    const quotes = await fetchPortfolioQuotes(data.symbols);

    // Recover only a missing opening price. The quote source remains unchanged
    // for all other fields.
    const missingOpen = quotes.filter((quote) => quote.open === null && !quote.symbol.startsWith("^"));
    const recoveredOpen = await Promise.all(
      missingOpen.map(async (quote) => [quote.symbol, await import("./open-price.server").then(({ fetchYahooOpenPrice }) => fetchYahooOpenPrice(quote.symbol))] as const),
    );
    const openBySymbol = new Map(recoveredOpen);

    return quotes.map((quote) => {
      const open = quote.open ?? openBySymbol.get(quote.symbol) ?? null;
      if (quote.change !== null && quote.changePercent !== null && open === quote.open) return quote;
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
      return { ...quote, open, change, changePercent };
    });
  });
