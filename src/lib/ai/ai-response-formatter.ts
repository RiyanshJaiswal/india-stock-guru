/**
 * AIResponseFormatter — validates and normalises raw model JSON into the
 * mandatory 10-part AIAnswer.
 *
 * This is the guardrail that enforces "never invent facts": any claim citing
 * an evidence id that is not in the selected context is dropped, and the
 * confidence score is capped by the measured evidence quality.
 */

import { sourcesFor } from "./ai-context-selector";
import {
  INSUFFICIENT_EVIDENCE_MESSAGE,
  type AIAnswer,
  type AIClaim,
  type AIIntent,
  type AISelectedContext,
} from "./ai-types";

type RawClaim = { statement?: unknown; evidenceIds?: unknown };
type RawAnswer = Record<string, unknown>;

const asString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function normaliseClaims(
  raw: unknown,
  knownIds: Set<string>,
  dropped: { count: number },
): AIClaim[] {
  if (!Array.isArray(raw)) return [];
  const out: AIClaim[] = [];
  for (const entry of raw as RawClaim[]) {
    const statement = asString(entry?.statement);
    if (!statement) continue;
    const ids = Array.isArray(entry?.evidenceIds)
      ? [...new Set((entry.evidenceIds as unknown[]).map(asString))].filter((id) => knownIds.has(id))
      : [];
    if (ids.length === 0) {
      dropped.count += 1;
      continue;
    }
    out.push({ statement, evidenceIds: ids });
  }
  return out;
}

export function parseModelJson(raw: string): RawAnswer | null {
  const trimmed = raw.trim();
  const candidate = trimmed.startsWith("{")
    ? trimmed
    : trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
  if (!candidate) return null;
  try {
    const parsed: unknown = JSON.parse(candidate);
    return parsed && typeof parsed === "object" ? (parsed as RawAnswer) : null;
  } catch {
    return null;
  }
}

/** Answer returned when the evidence bar is not met. */
export function insufficientAnswer(params: {
  intent: AIIntent;
  question: string;
  symbols: string[];
  reason: string;
  providerId: string;
  missing?: string[];
}): AIAnswer {
  return {
    version: 1,
    intent: params.intent,
    symbols: params.symbols,
    question: params.question,
    summary: INSUFFICIENT_EVIDENCE_MESSAGE,
    evidence: [],
    technicalEvidence: [],
    fundamentalEvidence: [],
    newsEvidence: [],
    corporateEvents: [],
    risks: [],
    missingInformation: [params.reason, ...(params.missing ?? [])],
    confidence: 0,
    sources: [],
    insufficient: true,
    generatedAt: new Date().toISOString(),
    providerId: params.providerId,
    model: null,
    droppedClaims: 0,
  };
}

export function formatAnswer(params: {
  raw: RawAnswer;
  intent: AIIntent;
  question: string;
  contexts: AISelectedContext[];
  providerId: string;
  model: string | null;
}): AIAnswer {
  const { raw, contexts } = params;
  const knownIds = new Set(contexts.flatMap((context) => context.evidence.map((item) => item.id)));
  const dropped = { count: 0 };

  const evidence = normaliseClaims(raw["evidence"], knownIds, dropped);
  const technicalEvidence = normaliseClaims(raw["technicalEvidence"], knownIds, dropped);
  const fundamentalEvidence = normaliseClaims(raw["fundamentalEvidence"], knownIds, dropped);
  const newsEvidence = normaliseClaims(raw["newsEvidence"], knownIds, dropped);
  const corporateEvents = normaliseClaims(raw["corporateEvents"], knownIds, dropped);
  const risks = normaliseClaims(raw["risks"], knownIds, dropped);

  const allClaims = [
    ...evidence,
    ...technicalEvidence,
    ...fundamentalEvidence,
    ...newsEvidence,
    ...corporateEvents,
    ...risks,
  ];
  const citedIds = new Set(allClaims.flatMap((claim) => claim.evidenceIds));

  const symbols = contexts.map((context) => context.symbol);
  const modelSaysInsufficient = raw["insufficient"] === true;
  const summary = asString(raw["summary"]);

  const gapNotes = contexts.flatMap((context) =>
    context.gaps.map((gap) => `${context.ticker} · ${gap.label}: ${gap.reason}`),
  );
  const modelMissing = Array.isArray(raw["missingInformation"])
    ? (raw["missingInformation"] as unknown[]).map(asString).filter(Boolean)
    : [];
  const missingInformation = [...new Set([...modelMissing, ...gapNotes])];

  if (modelSaysInsufficient || allClaims.length === 0 || !summary) {
    return {
      ...insufficientAnswer({
        intent: params.intent,
        question: params.question,
        symbols,
        reason:
          allClaims.length === 0
            ? "The model produced no evidence-backed statements."
            : "The model reported that the available evidence is not sufficient.",
        providerId: params.providerId,
      }),
      missingInformation: [
        ...new Set([
          allClaims.length === 0
            ? "The model produced no evidence-backed statements."
            : "The model reported that the available evidence is not sufficient.",
          ...missingInformation,
        ]),
      ],
      model: params.model,
      droppedClaims: dropped.count,
    };
  }

  // Confidence never exceeds the measured quality of the evidence it rests on.
  const qualityCap = Math.min(...contexts.map((context) => context.quality.overall));
  const modelConfidence = Number(raw["confidence"]);
  const confidence = Math.round(
    Math.max(
      0,
      Math.min(
        Number.isFinite(modelConfidence) ? Math.min(100, Math.max(0, modelConfidence)) : 50,
        qualityCap,
      ),
    ),
  );

  return {
    version: 1,
    intent: params.intent,
    symbols,
    question: params.question,
    summary,
    evidence,
    technicalEvidence,
    fundamentalEvidence,
    newsEvidence,
    corporateEvents,
    risks,
    missingInformation,
    confidence,
    sources: sourcesFor(contexts, citedIds),
    insufficient: false,
    generatedAt: new Date().toISOString(),
    providerId: params.providerId,
    model: params.model,
    droppedClaims: dropped.count,
  };
}
