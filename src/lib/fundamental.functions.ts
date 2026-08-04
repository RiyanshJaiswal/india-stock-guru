/**
 * Fundamental analysis API service layer.
 *
 * `getFundamentals` is the only entry point the UI should use. To move onto
 * the FastAPI backend, register a FastAPI adapter in `resolveProvider` —
 * inputs and outputs stay identical.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  QUARTERS_REQUESTED,
  YEARS_REQUESTED,
  type FundamentalAnalysisResult,
} from "./fundamental-types";

const fundamentalsInput = z.object({
  symbol: z.string().trim().min(1).max(24),
  quarters: z.number().int().min(1).max(40).default(QUARTERS_REQUESTED),
  years: z.number().int().min(1).max(20).default(YEARS_REQUESTED),
});

export type FundamentalsInput = z.infer<typeof fundamentalsInput>;

export const getFundamentals = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => fundamentalsInput.parse(data))
  .handler(async ({ data }): Promise<FundamentalAnalysisResult> => {
    const { runFundamentalAnalysis } = await import("./fundamental-service.server");
    return runFundamentalAnalysis(data.symbol, data.quarters, data.years);
  });
