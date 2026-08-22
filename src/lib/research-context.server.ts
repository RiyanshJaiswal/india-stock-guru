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

// Research uses several upstream APIs (market history + fundamentals + news).
// 9s was too aggressive for cold provider/authentication paths and caused the
// UI to report a context timeout even when the providers could eventually
// return valid data. Keep a bounded timeout, but give cold starts enough room.
const COLLECTOR_TIMEOUT_MS = 15_000;
const CONTEXT_CACHE_TTL_MS = 60_000;

type CachedContext = { expiresAt: number; result: ResearchContextResult };
const contextCache = new Map<string, CachedContext>();

function contextCacheKey(request: ResearchRequest): string {
  return JSON.stringify({
    symbol: request.symbol,
    domains: [...request.domains].sort(),
    interval: request.interval,
    range: request.range,
    quarters: request.quarters,
    years: request.years,
    newsLimit: request.newsLimit,
    newsSinceDays: request.newsSinceDays,
  });
}

function readContextCache(key: string): ResearchContextResult | null {
  const cached = contextCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    contextCache.delete(key);
    return null;
  }
  return cached.result;
}

function writeContextCache(key: string, result: ResearchContextResult): void {
  // Cache only successful contexts. Failed/empty contexts should not be
  // sticky because a transient upstream failure must be retried.
  if (!result.ok) return;
  contextCache.set(key, { expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS, result });
  // Keep memory bounded on long-lived Railway processes.
  if (contextCache.size > 100) {
    const oldest = contextCache.keys().next().value;
    if (oldest) contextCache.delete(oldest);
  }
}

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
  const cacheKey = contextCacheKey(request);
  const cached = readContextCache(cacheKey);
  if (cached) return cached;

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

  // Keep collectors independent. A slow/failing fundamentals provider must
  // not discard working market, technical, or news evidence.
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

  const result: ResearchContextResult = { ok: true, data: context };
  writeContextCache(cacheKey, result);
  return result;
}
