/**
 * News Intelligence API service layer.
 *
 * The only entry points the UI (or a future AI reasoning layer) should call.
 * Swapping to the FastAPI backend means replacing the dynamic import with a
 * `fetch` — the input/output contracts stay identical.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { NewsFeedResult } from "./news-types";

const newsInput = z.object({
  symbol: z.string().trim().min(1).max(24).nullable().default(null),
  query: z.string().trim().min(2).max(120).nullable().default(null),
  limit: z.number().int().min(5).max(100).default(30),
  sinceDays: z.number().int().min(1).max(90).default(14),
  providerIds: z.array(z.string().min(1).max(40)).max(20).optional(),
});

export type NewsInput = z.input<typeof newsInput>;

export const getNewsFeed = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => newsInput.parse(data))
  .handler(async ({ data }): Promise<NewsFeedResult> => {
    if (!data.symbol && !data.query) {
      return {
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          symbol: null,
          message: "Provide a symbol or a search query.",
          coverage: [],
        },
      };
    }
    const { aggregateNews } = await import("./news-aggregation.server");
    try {
      return await aggregateNews({
        symbol: data.symbol,
        query: data.query,
        limit: data.limit,
        sinceDays: data.sinceDays,
        ...(data.providerIds ? { providerIds: data.providerIds } : {}),
      });
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "PROVIDER_ERROR",
          symbol: data.symbol,
          message:
            error instanceof Error ? error.message : "News aggregation service failed.",
          coverage: [],
        },
      };
    }
  });
