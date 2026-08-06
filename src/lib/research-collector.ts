/**
 * ResearchCollector contract + shared construction helpers.
 *
 * A collector wraps exactly one upstream engine (market, technical,
 * fundamental, news) and returns normalised evidence plus an explicit
 * coverage record. Collectors never throw: failures come back as
 * `ok: false` coverage so the ContextBuilder can mark the gap.
 *
 * Swapping to FastAPI means registering a collector whose `collect`
 * performs a `fetch` — the returned shape is unchanged.
 */

import type {
  EvidenceDirection,
  EvidenceOrigin,
  EvidenceUnit,
  EvidenceValue,
  ResearchDomain,
  ResearchDomainCoverage,
  ResearchEvidence,
  ResearchGap,
  ResearchRequest,
  ResearchTimelineEntry,
} from "./research-types";

export type CollectorOutput = {
  evidence: ResearchEvidence[];
  timeline: ResearchTimelineEntry[];
  gaps: ResearchGap[];
  /** Identity fields the builder uses to fill the context header. */
  identity?: {
    companyName?: string | null;
    currency?: string | null;
    exchange?: "NSE" | "BSE" | null;
  };
  /** 0-1 share of expected fields resolved by this collector. */
  completeness: number;
  ok: boolean;
  message: string | null;
};

export type ResearchCollector = {
  id: string;
  domain: ResearchDomain;
  collect(request: ResearchRequest): Promise<CollectorOutput>;
};

export const emptyOutput = (message: string, ok = false): CollectorOutput => ({
  evidence: [],
  timeline: [],
  gaps: [],
  completeness: 0,
  ok,
  message,
});

export const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const numberValue = (value: number, unit: EvidenceUnit): EvidenceValue => ({
  kind: "number",
  value,
  unit,
});

export const textValue = (value: string): EvidenceValue => ({ kind: "text", value });

/** Epoch ms / seconds / ISO string -> ISO-8601 UTC, or null. */
export function toIso(input: number | string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input <= 0) return null;
    const ms = input < 1e11 ? input * 1000 : input;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Direction from a numeric reading against neutral bounds. */
export function directionFromRange(
  value: number,
  bullishAbove: number,
  bearishBelow: number,
  invert = false,
): EvidenceDirection {
  let direction: EvidenceDirection = "neutral";
  if (value > bullishAbove) direction = "bullish";
  else if (value < bearishBelow) direction = "bearish";
  if (!invert || direction === "neutral") return direction;
  return direction === "bullish" ? "bearish" : "bullish";
}

type EvidenceInit = {
  domain: ResearchDomain;
  key: string;
  label: string;
  value: EvidenceValue;
  sourceId: string;
  sourceName: string;
  importance: number;
  reliability: number;
  origin?: EvidenceOrigin;
  direction?: EvidenceDirection;
  observedAt?: string | null;
  url?: string | null;
  note?: string | null;
  tags?: string[];
  /** Appended to the id when several items share a key (e.g. news items). */
  discriminator?: string;
};

export function makeEvidence(init: EvidenceInit): ResearchEvidence {
  const id = init.discriminator
    ? `${init.domain}:${init.key}:${init.discriminator}`
    : `${init.domain}:${init.key}`;
  return {
    id,
    domain: init.domain,
    key: init.key,
    label: init.label,
    value: init.value,
    direction: init.direction ?? "neutral",
    importance: Math.round(clamp(init.importance)),
    reliability: clamp01(init.reliability),
    origin: init.origin ?? "provider",
    sourceId: init.sourceId,
    sourceName: init.sourceName,
    observedAt: init.observedAt ?? null,
    url: init.url ?? null,
    note: init.note ?? null,
    tags: init.tags ?? [],
  };
}

/**
 * Emit evidence when the metric exists, otherwise record an explicit gap.
 * This is the single place that decides "missing" vs "known".
 */
export function metricOrGap(
  target: { evidence: ResearchEvidence[]; gaps: ResearchGap[] },
  value: number | null | undefined,
  init: Omit<EvidenceInit, "value"> & { unit: EvidenceUnit; missingReason?: string },
): boolean {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    target.gaps.push({
      domain: init.domain,
      key: init.key,
      label: init.label,
      reason: init.missingReason ?? `${init.sourceName} did not report ${init.label}.`,
    });
    return false;
  }
  const { unit, missingReason: _missingReason, ...rest } = init;
  void _missingReason;
  target.evidence.push(makeEvidence({ ...rest, value: numberValue(value, unit) }));
  return true;
}
