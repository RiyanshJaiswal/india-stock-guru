/**
 * Research Context Engine — shared DTOs (client-safe, provider-independent).
 *
 * The Research Context is the evidence package assembled BEFORE any AI model
 * is called. It contains no summaries, no recommendations and no generated
 * prose: only normalised, deduplicated, quality-scored facts pulled from the
 * Market, Technical, Fundamental and News engines.
 *
 * The shapes below are the exact contract a future FastAPI backend must
 * return, and the exact payload an OpenAI / Gemini / Ollama reasoning layer
 * will later consume.
 */

/** Which engine produced a piece of evidence. */
export type ResearchDomain =
  | "market"
  | "technical"
  | "fundamental"
  | "news"
  | "corporate-action"
  | "event";

/** Directional meaning of an evidence item, purely rule-derived. */
export type EvidenceDirection = "bullish" | "bearish" | "neutral";

/** How the value was obtained. */
export type EvidenceOrigin = "provider" | "computed";

/** Machine-readable evidence value. Never a formatted string. */
export type EvidenceValue =
  | { kind: "number"; value: number; unit: EvidenceUnit }
  | { kind: "text"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "none" };

export type EvidenceUnit =
  | "currency"
  | "percent"
  | "ratio"
  | "multiple"
  | "count"
  | "price"
  | "score"
  | "none";

/**
 * One atomic, attributable fact.
 *
 * `key` is a stable dotted identifier (e.g. "technical.rsi") used for
 * deduplication and for conflict detection between domains.
 */
export type ResearchEvidence = {
  /** Deterministic id: `${domain}:${key}` plus a discriminator when repeated. */
  id: string;
  domain: ResearchDomain;
  key: string;
  label: string;
  value: EvidenceValue;
  direction: EvidenceDirection;
  /** 0-100 relative importance within the whole context. */
  importance: number;
  /** 0-1 trust in the underlying source/derivation. */
  reliability: number;
  origin: EvidenceOrigin;
  sourceId: string;
  sourceName: string;
  /** ISO-8601 UTC of the fact itself, when the source states one. */
  observedAt: string | null;
  url: string | null;
  /** Free-form provider note (coverage caveats, currency mismatch, etc.). */
  note: string | null;
  /** Machine tags for downstream filtering, e.g. ["earnings","valuation"]. */
  tags: string[];
};

/** A dated entry on the chronological research timeline. */
export type ResearchTimelineEntry = {
  id: string;
  /** ISO-8601 UTC. Entries without a date never enter the timeline. */
  at: string;
  domain: ResearchDomain;
  title: string;
  detail: string | null;
  importance: number;
  direction: EvidenceDirection;
  sourceId: string;
  url: string | null;
  /** Evidence ids this entry was derived from. */
  evidenceIds: string[];
};

/** Newest-first chronological view across every domain. */
export type ResearchTimeline = {
  /** ISO-8601 UTC of the oldest / newest entry, null when empty. */
  from: string | null;
  to: string | null;
  entries: ResearchTimelineEntry[];
};

/** Two or more evidence items that point in opposite directions. */
export type ResearchConflict = {
  id: string;
  topic: string;
  description: string;
  /** Evidence ids taking part in the disagreement. */
  evidenceIds: string[];
  domains: ResearchDomain[];
  /** 0-100 — how material the disagreement is. */
  severity: number;
};

/** Something the engines could not supply. Never silently defaulted. */
export type ResearchGap = {
  domain: ResearchDomain;
  key: string;
  label: string;
  reason: string;
};

/** Per-domain collection outcome, mirroring the news coverage model. */
export type ResearchDomainCoverage = {
  domain: ResearchDomain;
  collectorId: string;
  ok: boolean;
  evidenceCount: number;
  /** 0-1 share of the expected fields this run actually resolved. */
  completeness: number;
  /** Milliseconds the collector took. */
  durationMs: number;
  message: string | null;
};

/**
 * Aggregate, purely numeric quality statement about the evidence set.
 * This is NOT a summary of the company — it describes the data itself.
 */
export type ResearchSummary = {
  totalEvidence: number;
  byDomain: Record<ResearchDomain, number>;
  byDirection: Record<EvidenceDirection, number>;
  /** Ids of the highest-importance evidence, newest/strongest first. */
  topEvidenceIds: string[];
  conflictCount: number;
  gapCount: number;
  /** ISO-8601 UTC of the freshest dated evidence. */
  freshestAt: string | null;
  stalestAt: string | null;
};

/** 0-100 breakdown of how trustworthy and complete the evidence set is. */
export type EvidenceQuality = {
  /** Weighted blend of the four components below. */
  overall: number;
  /** Domains that returned data vs domains attempted. */
  coverage: number;
  /** Mean reliability of collected evidence. */
  reliability: number;
  /** Recency of dated evidence. */
  freshness: number;
  /** Inverse of conflict severity. */
  consistency: number;
  grade: "high" | "medium" | "low" | "insufficient";
  notes: string[];
};

/** Everything an AI reasoning layer needs, and nothing it must invent. */
export type ResearchContext = {
  /** Schema version so downstream prompts can pin a shape. */
  version: 1;
  symbol: string;
  ticker: string;
  exchange: "NSE" | "BSE" | null;
  companyName: string | null;
  currency: string | null;
  /** ISO-8601 UTC when the context was assembled. */
  builtAt: string;
  request: ResearchRequest;
  evidence: ResearchEvidence[];
  timeline: ResearchTimeline;
  conflicts: ResearchConflict[];
  gaps: ResearchGap[];
  coverage: ResearchDomainCoverage[];
  summary: ResearchSummary;
  quality: EvidenceQuality;
};

export type ResearchRequest = {
  symbol: string;
  domains: ResearchDomain[];
  /** Technical lookback used for this run. */
  interval: "1d" | "1wk" | "1mo";
  range: "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y" | "max";
  quarters: number;
  years: number;
  newsLimit: number;
  newsSinceDays: number;
};

export type ResearchErrorCode =
  | "INVALID_REQUEST"
  | "ALL_COLLECTORS_FAILED"
  | "NO_EVIDENCE"
  | "COLLECTOR_ERROR";

export type ResearchError = {
  code: ResearchErrorCode;
  symbol: string;
  message: string;
  coverage: ResearchDomainCoverage[];
};

export type ResearchContextResult =
  | { ok: true; data: ResearchContext }
  | { ok: false; error: ResearchError };

/** Domains collected by default. */
export const DEFAULT_RESEARCH_DOMAINS: ResearchDomain[] = [
  "market",
  "technical",
  "fundamental",
  "news",
];

/** Weight of each quality component in `overall`. Sums to 1. */
export const QUALITY_WEIGHTS = {
  coverage: 0.35,
  reliability: 0.25,
  freshness: 0.2,
  consistency: 0.2,
} as const;
