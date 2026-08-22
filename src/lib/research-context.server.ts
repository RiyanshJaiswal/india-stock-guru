/**
 * Research Context service layer — the orchestration entry point.
 *
 * Runs every requested collector in parallel, records per-domain coverage,
 * and hands everything to the ContextBuilder. No AI calls happen here.
 *
 * Reliability rule: one slow provider must never block the whole research
 * request. A timed-out domain is recorded as a data gap while other domains
 * remain usable.
 */

import { exchangeOf } from "./market-types";
import { buildResearchContext } from "./research-context-builder";
import { RESEARCH_COLLECTORS } from "./research-collectors.server";
import { stripSuffix } from "./market-types";
import { emptyOutput } from "./research-collector";
import type {
  ResearchContextResult,
  ResearchDomainCoverage,
  ResearchRequest,
} from "./research-types";

const COLLECTOR_TIMEOUT_MS = 9_000;

async function collectWithTimeout(
  collector: (typeof RESEARCH_COLLECTORS)[number],
  request: ResearchRequest,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      collector.collect(request),
      new Promise<ReturnType<typeof emptyOutput>>((resolve) => {
        timer = setTimeout(
          () => resolve(emptyOutput(`${collector.domain} data timed out after ${COLLECTOR_TIMEOUT_MS}ms.`)),
          COLLECTOR_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runResearchContext(
  request: ResearchRequest,
): Promise<ResearchContextResult> {
  const collectors = RESEARCH_COLLECTORS.filter((collector) =>
    request.domains.includes(collector.domain),
  );

  if (collectors.length === 0) {
    return {
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        symbol: request.symbol,
        message: "No collectors matched the requested domains.",
        coverage: [],
      },
    };
  }

  const parts = await Promise.all(
    collectors.map(async (collector) => {
      const startedAt = Date.now();
      const output = await collectWithTimeout(collector, request);
      const coverage: ResearchDomainCoverage = {
        domain: collector.domain,
        collectorId: collector.id,
        ok: output.ok,
        evidenceCount: output.evidence.length,
        completeness: output.completeness,
        durationMs: Date.now() - startedAt,
        message: output.message,
      };
      return { coverage, output };
    }),
  );

  const coverage = parts.map((part) => part.coverage);

  if (parts.every((part) => !part.coverage.ok)) {
    return {
      ok: false,
      error: {
        code: "ALL_COLLECTORS_FAILED",
        symbol: request.symbol,
        message: `Every research collector failed for ${request.symbol}.`,
        coverage,
      },
    };
  }

  const context = buildResearchContext({
    symbol: request.symbol,
    ticker: stripSuffix(request.symbol),
    exchange: exchangeOf(request.symbol),
    request,
    parts,
  });

  if (context.evidence.length === 0) {
    return {
      ok: false,
      error: {
        code: "NO_EVIDENCE",
        symbol: request.symbol,
        message: `No usable evidence was collected for ${request.symbol}.`,
        coverage: context.coverage,
      },
    };
  }

  return { ok: true, data: context };
}
