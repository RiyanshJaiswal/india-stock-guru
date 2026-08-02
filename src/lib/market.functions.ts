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
    const { providerQuotes } = await import("./market-data.server");
    return providerQuotes(data.symbols);
  });
