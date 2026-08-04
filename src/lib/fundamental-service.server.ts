/**
 * Unified fundamental analysis service (server-only).
 *
 * Resolves the active provider adapter, fetches the raw snapshot and hands it
 * to the provider-independent engine. All failures become structured errors.
 */

import { buildFundamentalAnalysis } from "./fundamental-analysis";
import type { FundamentalProvider } from "./fundamental-provider";
import { yahooFundamentalProvider } from "./providers/yahoo-fundamentals.server";
import type { FundamentalAnalysisResult } from "./fundamental-types";

/**
 * Adapter registry. Add a FastAPI adapter here and point
 * `FUNDAMENTALS_PROVIDER` at it — nothing else in the app changes.
 */
const providers: Record<string, FundamentalProvider> = {
  yahoo: yahooFundamentalProvider,
};

export function resolveProvider(): FundamentalProvider {
  const id = process.env['FUNDAMENTALS_PROVIDER'] ?? "yahoo";
  return providers[id] ?? yahooFundamentalProvider;
}

export async function runFundamentalAnalysis(
  symbol: string,
  quarters: number,
  years: number,
): Promise<FundamentalAnalysisResult> {
  const provider = resolveProvider();
  try {
    const snapshot = await provider.fetchSnapshot({ symbol, quarters, years });
    const hasAny =
      snapshot.annualProfitAndLoss.length > 0 ||
      snapshot.quarterlyProfitAndLoss.length > 0 ||
      snapshot.stats.marketCap !== null;

    if (!hasAny) {
      return {
        ok: false,
        error: {
          code: "NO_FUNDAMENTALS",
          symbol,
          provider: provider.id,
          message: `No fundamental data reported for ${symbol}.`,
        },
      };
    }
    return { ok: true, data: buildFundamentalAnalysis(snapshot, provider.id) };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "PROVIDER_ERROR",
        symbol,
        provider: provider.id,
        message:
          error instanceof Error ? error.message : "Fundamentals provider failed.",
      },
    };
  }
}
