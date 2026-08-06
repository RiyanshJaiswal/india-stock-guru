/**
 * ContextBuilder — merges collector output into a single ResearchContext.
 *
 * Pure and synchronous: collectors do the I/O, the builder does the merging,
 * deduplication, ranking, timeline construction, conflict detection, gap
 * marking and quality scoring. No AI, no summaries, no recommendations.
 */

import { clamp, clamp01 } from "./research-collector";
import type { CollectorOutput } from "./research-collector";
import {
  QUALITY_WEIGHTS,
  type EvidenceDirection,
  type EvidenceQuality,
  type ResearchConflict,
  type ResearchContext,
  type ResearchDomain,
  type ResearchDomainCoverage,
  type ResearchEvidence,
  type ResearchGap,
  type ResearchRequest,
  type ResearchSummary,
  type ResearchTimeline,
  type ResearchTimelineEntry,
} from "./research-types";

export type BuilderInput = {
  symbol: string;
  ticker: string;
  exchange: "NSE" | "BSE" | null;
  request: ResearchRequest;
  /** Collector results paired with their coverage metadata. */
  parts: { coverage: ResearchDomainCoverage; output: CollectorOutput }[];
  /** Injected clock keeps the builder deterministic in tests. */
  now?: number;
};

const DOMAINS: ResearchDomain[] = [
  "market",
  "technical",
  "fundamental",
  "news",
  "corporate-action",
  "event",
];

/* ------------------------------------------------------------ deduplication */

const normaliseText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const fingerprint = (item: ResearchEvidence): string => {
  if (item.value.kind === "text") {
    return `${item.domain}|${item.key}|${normaliseText(item.value.value)}`;
  }
  if (item.value.kind === "number") {
    return `${item.domain}|${item.key}|${item.value.value}|${item.value.unit}`;
  }
  if (item.value.kind === "boolean") return `${item.domain}|${item.key}|${item.value.value}`;
  return `${item.domain}|${item.key}|none`;
};

/** Keep the most reliable, then most important, then freshest copy. */
function dedupeEvidence(items: ResearchEvidence[]): ResearchEvidence[] {
  const byId = new Map<string, ResearchEvidence>();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing || preferred(item, existing)) byId.set(item.id, item);
  }
  const byFingerprint = new Map<string, ResearchEvidence>();
  for (const item of byId.values()) {
    const key = fingerprint(item);
    const existing = byFingerprint.get(key);
    if (!existing || preferred(item, existing)) byFingerprint.set(key, item);
  }
  return [...byFingerprint.values()];
}

function preferred(candidate: ResearchEvidence, current: ResearchEvidence): boolean {
  if (candidate.reliability !== current.reliability)
    return candidate.reliability > current.reliability;
  if (candidate.importance !== current.importance)
    return candidate.importance > current.importance;
  const a = candidate.observedAt ? Date.parse(candidate.observedAt) : 0;
  const b = current.observedAt ? Date.parse(current.observedAt) : 0;
  return a > b;
}

/* ----------------------------------------------------------------- ranking */

const rankEvidence = (items: ResearchEvidence[]) =>
  [...items].sort((a, b) => {
    if (b.importance !== a.importance) return b.importance - a.importance;
    if (b.reliability !== a.reliability) return b.reliability - a.reliability;
    const at = a.observedAt ? Date.parse(a.observedAt) : 0;
    const bt = b.observedAt ? Date.parse(b.observedAt) : 0;
    if (bt !== at) return bt - at;
    return a.id.localeCompare(b.id);
  });

/* ---------------------------------------------------------------- timeline */

function buildTimeline(entries: ResearchTimelineEntry[]): ResearchTimeline {
  const seen = new Map<string, ResearchTimelineEntry>();
  for (const entry of entries) {
    const time = Date.parse(entry.at);
    if (Number.isNaN(time)) continue;
    const key = `${entry.domain}|${normaliseText(entry.title)}|${entry.at.slice(0, 10)}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, entry);
      continue;
    }
    // Merge duplicates instead of dropping their provenance.
    seen.set(key, {
      ...existing,
      importance: Math.max(existing.importance, entry.importance),
      detail: existing.detail ?? entry.detail,
      evidenceIds: [...new Set([...existing.evidenceIds, ...entry.evidenceIds])],
    });
  }
  const sorted = [...seen.values()].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at) || b.importance - a.importance,
  );
  return {
    from: sorted.length > 0 ? (sorted[sorted.length - 1] as ResearchTimelineEntry).at : null,
    to: sorted.length > 0 ? (sorted[0] as ResearchTimelineEntry).at : null,
    entries: sorted,
  };
}

/* --------------------------------------------------------------- conflicts */

/** Topics where evidence from different domains is directly comparable. */
const CONFLICT_TOPICS: { topic: string; tags: string[] }[] = [
  { topic: "Trend vs momentum", tags: ["trend", "momentum"] },
  { topic: "Growth vs profitability", tags: ["growth", "profitability"] },
  { topic: "Valuation vs growth", tags: ["valuation", "growth"] },
  { topic: "Leverage vs cash flow", tags: ["leverage", "cashflow"] },
  { topic: "Price action vs fundamentals", tags: ["market", "fundamental"] },
];

function detectConflicts(items: ResearchEvidence[]): ResearchConflict[] {
  const conflicts: ResearchConflict[] = [];
  for (const { topic, tags } of CONFLICT_TOPICS) {
    const pool = items.filter(
      (item) => item.direction !== "neutral" && tags.some((tag) => item.tags.includes(tag)),
    );
    if (pool.length < 2) continue;
    const bullish = pool.filter((item) => item.direction === "bullish");
    const bearish = pool.filter((item) => item.direction === "bearish");
    if (bullish.length === 0 || bearish.length === 0) continue;

    const weight = (list: ResearchEvidence[]) =>
      list.reduce((sum, item) => sum + item.importance * item.reliability, 0);
    const bullWeight = weight(bullish);
    const bearWeight = weight(bearish);
    const total = bullWeight + bearWeight;
    // Balanced opposing weight = high severity; a lopsided split is weak.
    const balance = total === 0 ? 0 : 1 - Math.abs(bullWeight - bearWeight) / total;
    const topBull = rankEvidence(bullish)[0] as ResearchEvidence;
    const topBear = rankEvidence(bearish)[0] as ResearchEvidence;
    const participants = [...rankEvidence(bullish).slice(0, 4), ...rankEvidence(bearish).slice(0, 4)];

    conflicts.push({
      id: `conflict:${normaliseText(topic).replace(/ /g, "-")}`,
      topic,
      description: `${bullish.length} bullish signal(s) including "${topBull.label}" oppose ${bearish.length} bearish signal(s) including "${topBear.label}".`,
      evidenceIds: participants.map((item) => item.id),
      domains: [...new Set(participants.map((item) => item.domain))],
      severity: Math.round(clamp(balance * 100)),
    });
  }
  return conflicts.sort((a, b) => b.severity - a.severity);
}

/* ------------------------------------------------------------------- gaps */

function dedupeGaps(gaps: ResearchGap[]): ResearchGap[] {
  const map = new Map<string, ResearchGap>();
  for (const gap of gaps) map.set(`${gap.domain}|${gap.key}`, gap);
  return [...map.values()].sort(
    (a, b) => a.domain.localeCompare(b.domain) || a.key.localeCompare(b.key),
  );
}

/* ---------------------------------------------------------------- quality */

function buildQuality(
  items: ResearchEvidence[],
  coverage: ResearchDomainCoverage[],
  conflicts: ResearchConflict[],
  gaps: ResearchGap[],
  now: number,
): EvidenceQuality {
  const notes: string[] = [];

  const coverageScore =
    coverage.length === 0
      ? 0
      : (coverage.reduce((sum, entry) => sum + (entry.ok ? entry.completeness : 0), 0) /
          coverage.length) *
        100;
  const failed = coverage.filter((entry) => !entry.ok);
  if (failed.length > 0) {
    notes.push(`${failed.length} collector(s) failed: ${failed.map((f) => f.domain).join(", ")}.`);
  }

  const reliabilityScore =
    items.length === 0
      ? 0
      : (items.reduce((sum, item) => sum + item.reliability, 0) / items.length) * 100;

  const dated = items
    .map((item) => (item.observedAt ? Date.parse(item.observedAt) : Number.NaN))
    .filter((time) => !Number.isNaN(time));
  let freshnessScore = 0;
  if (dated.length > 0) {
    const ageDays = dated.map((time) => Math.max(0, (now - time) / 86_400_000));
    const median = ageDays.sort((a, b) => a - b)[Math.floor(ageDays.length / 2)] ?? 0;
    // 0 days -> 100, 90+ days -> 0.
    freshnessScore = clamp(100 - (median / 90) * 100);
    if (median > 30) notes.push(`Median evidence age is ${Math.round(median)} days.`);
  } else {
    notes.push("No evidence carried a usable timestamp.");
  }

  const consistencyScore =
    conflicts.length === 0
      ? 100
      : clamp(100 - conflicts.reduce((sum, c) => sum + c.severity, 0) / conflicts.length);
  if (conflicts.length > 0) notes.push(`${conflicts.length} conflicting signal group(s) detected.`);
  if (gaps.length > 0) notes.push(`${gaps.length} data point(s) unavailable.`);

  const overall =
    coverageScore * QUALITY_WEIGHTS.coverage +
    reliabilityScore * QUALITY_WEIGHTS.reliability +
    freshnessScore * QUALITY_WEIGHTS.freshness +
    consistencyScore * QUALITY_WEIGHTS.consistency;

  const rounded = Math.round(clamp(overall));
  const grade: EvidenceQuality["grade"] =
    items.length === 0 ? "insufficient" : rounded >= 75 ? "high" : rounded >= 50 ? "medium" : "low";

  return {
    overall: rounded,
    coverage: Math.round(clamp(coverageScore)),
    reliability: Math.round(clamp(reliabilityScore)),
    freshness: Math.round(clamp(freshnessScore)),
    consistency: Math.round(clamp(consistencyScore)),
    grade,
    notes,
  };
}

/* ---------------------------------------------------------------- summary */

function buildSummary(
  items: ResearchEvidence[],
  conflicts: ResearchConflict[],
  gaps: ResearchGap[],
): ResearchSummary {
  const byDomain = Object.fromEntries(DOMAINS.map((d) => [d, 0])) as Record<
    ResearchDomain,
    number
  >;
  const byDirection: Record<EvidenceDirection, number> = {
    bullish: 0,
    bearish: 0,
    neutral: 0,
  };
  const times: number[] = [];
  for (const item of items) {
    byDomain[item.domain] += 1;
    byDirection[item.direction] += 1;
    if (item.observedAt) {
      const time = Date.parse(item.observedAt);
      if (!Number.isNaN(time)) times.push(time);
    }
  }
  times.sort((a, b) => a - b);
  return {
    totalEvidence: items.length,
    byDomain,
    byDirection,
    topEvidenceIds: items.slice(0, 15).map((item) => item.id),
    conflictCount: conflicts.length,
    gapCount: gaps.length,
    freshestAt: times.length > 0 ? new Date(times[times.length - 1] as number).toISOString() : null,
    stalestAt: times.length > 0 ? new Date(times[0] as number).toISOString() : null,
  };
}

/* ----------------------------------------------------------------- public */

/** Merge every collector output into one ranked, scored ResearchContext. */
export function buildResearchContext(input: BuilderInput): ResearchContext {
  const now = input.now ?? Date.now();

  const rawEvidence: ResearchEvidence[] = [];
  const rawTimeline: ResearchTimelineEntry[] = [];
  const rawGaps: ResearchGap[] = [];
  let companyName: string | null = null;
  let currency: string | null = null;
  let exchange = input.exchange;

  for (const part of input.parts) {
    rawEvidence.push(...part.output.evidence);
    rawTimeline.push(...part.output.timeline);
    rawGaps.push(...part.output.gaps);
    const identity = part.output.identity;
    if (identity) {
      companyName = companyName ?? identity.companyName ?? null;
      currency = currency ?? identity.currency ?? null;
      exchange = exchange ?? identity.exchange ?? null;
    }
  }

  for (const part of input.parts) {
    if (!part.coverage.ok) {
      rawGaps.push({
        domain: part.coverage.domain,
        key: `collector.${part.coverage.collectorId}`,
        label: `${part.coverage.domain} data`,
        reason: part.coverage.message ?? `Collector ${part.coverage.collectorId} returned nothing.`,
      });
    }
  }

  const evidence = rankEvidence(dedupeEvidence(rawEvidence));
  const timeline = buildTimeline(rawTimeline);
  const conflicts = detectConflicts(evidence);
  const gaps = dedupeGaps(rawGaps);
  const coverage = input.parts.map((part) => ({
    ...part.coverage,
    evidenceCount: part.output.evidence.length,
    completeness: clamp01(part.output.completeness),
  }));

  return {
    version: 1,
    symbol: input.symbol,
    ticker: input.ticker,
    exchange,
    companyName,
    currency,
    builtAt: new Date(now).toISOString(),
    request: input.request,
    evidence,
    timeline,
    conflicts,
    gaps,
    coverage,
    summary: buildSummary(evidence, conflicts, gaps),
    quality: buildQuality(evidence, coverage, conflicts, gaps, now),
  };
}
