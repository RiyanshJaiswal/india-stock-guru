/**
 * Research Context API service layer.
 *
 * The only entry point the UI or a future AI reasoning layer should call.
 * Moving to FastAPI means replacing the dynamic import below with a `fetch`;
 * the request/response contracts stay identical, which is also what the
 * OpenAI / Gemini / Ollama adapters will consume in Phase 6.2.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  DEFAULT_RESEARCH_DOMAINS,
  type ResearchContextResult,
  type ResearchRequest,
} from "./research-types";

const researchInput = z.object({
  symbol: z.string().trim().min(1).max(24),
  domains: z
    .array(z.enum(["market", "technical", "fundamental", "news"]))
    .min(1)
    .max(4)
    .optional(),
  interval: z.enum(["1d", "1wk", "1mo"]).default("1d"),
  range: z.enum(["1mo", "3mo", "6mo", "1y", "2y", "5y", "max"]).default("1y"),
  quarters: z.number().int().min(1).max(40).default(12),
  years: z.number().int().min(1).max(20).default(10),
  newsLimit: z.number().int().min(5).max(100).default(30),
  newsSinceDays: z.number().int().min(1).max(90).default(14),
});

export type ResearchContextInput = z.input<typeof researchInput>;

export const getResearchContext = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => researchInput.parse(data))
  .handler(async ({ data }): Promise<ResearchContextResult> => {
    const request: ResearchRequest = {
      symbol: data.symbol,
      domains: data.domains ?? DEFAULT_RESEARCH_DOMAINS,
      interval: data.interval,
      range: data.range,
      quarters: data.quarters,
      years: data.years,
      newsLimit: data.newsLimit,
      newsSinceDays: data.newsSinceDays,
    };
    const { runResearchContext } = await import("./research-context.server");
    try {
      return await runResearchContext(request);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "COLLECTOR_ERROR",
          symbol: data.symbol,
          message:
            error instanceof Error ? error.message : "Research context service failed.",
          coverage: [],
        },
      };
    }
  });
