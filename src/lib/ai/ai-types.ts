/**
 * AI Reasoning Layer — shared DTOs (client-safe, provider-independent).
 *
 * The reasoning layer consumes ONLY a ResearchContext (Phase 6.1). It never
 * touches market/technical/fundamental/news providers directly, and it never
 * invents facts: every claim must cite an evidence id present in the context.
 *
 * These shapes are the exact contract a future FastAPI backend must return.
 */

import type {
  ResearchContext,
  ResearchDomain,
  ResearchEvidence,
} from "../research-types";

/** Every supported user intent. */
export type AIIntent =
  | "why-fall"
  | "why-rise"
  | "explain-movement"
  | "technical-analysis"
  | "fundamental-analysis"
  | "news-analysis"
  | "corporate-actions"
  | "compare-stocks"
  | "buy-or-wait"
  | "swing-trade"
  | "long-term"
  | "risk-analysis"
  | "portfolio"
  | "general-market";

export const AI_INTENTS: AIIntent[] = [
  "why-fall",
  "why-rise",
  "explain-movement",
  "technical-analysis",
  "fundamental-analysis",
  "news-analysis",
  "corporate-actions",
  "compare-stocks",
  "buy-or-wait",
  "swing-trade",
  "long-term",
  "risk-analysis",
  "portfolio",
  "general-market",
];

/** Result of the IntentClassifier. Purely rule-based, no model call. */
export type IntentClassification = {
  intent: AIIntent;
  /** 0-1 confidence in the classification itself. */
  confidence: number;
  /** Symbols detected in the question, uppercased, in order of appearance. */
  symbols: string[];
  /** Matched keywords that drove the decision (explainability). */
  matched: string[];
  /** Ranked runner-up intents with their scores. */
  alternatives: { intent: AIIntent; score: number }[];
};

/** Routing plan produced by the AIQuestionRouter. */
export type AIRoutePlan = {
  intent: AIIntent;
  /** Symbols the caller must build a ResearchContext for. */
  symbols: string[];
  /** Research domains required to answer this intent. */
  domains: ResearchDomain[];
  /** Domains that must be present or the answer is refused. */
  requiredDomains: ResearchDomain[];
  /** Max evidence items handed to the model. */
  evidenceBudget: number;
  /** Minimum evidence-quality score (0-100) needed to answer. */
  minQuality: number;
  /** Whether the intent needs more than one ResearchContext. */
  multiSymbol: boolean;
  /** Extra instruction appended to the reasoning prompt. */
  focus: string;
};

/** Evidence subset chosen by the AIContextSelector for one symbol. */
export type AISelectedContext = {
  symbol: string;
  ticker: string;
  companyName: string | null;
  exchange: "NSE" | "BSE" | null;
  currency: string | null;
  builtAt: string;
  evidence: ResearchEvidence[];
  timeline: ResearchContext["timeline"]["entries"];
  conflicts: ResearchContext["conflicts"];
  gaps: ResearchContext["gaps"];
  coverage: ResearchContext["coverage"];
  quality: ResearchContext["quality"];
  /** Evidence ids grouped per domain, in selection order. */
  byDomain: Record<ResearchDomain, string[]>;
  /** Ids dropped by the budget, kept for auditability. */
  droppedIds: string[];
};

export type AISource = {
  id: string;
  name: string;
  url: string | null;
  domain: ResearchDomain;
  observedAt: string | null;
};

/** One evidence-backed statement. `evidenceIds` must exist in the context. */
export type AIClaim = {
  statement: string;
  evidenceIds: string[];
};

export type AIAnswerSectionKey =
  | "evidence"
  | "technical"
  | "fundamental"
  | "news"
  | "corporateEvents"
  | "risks";

/** The mandatory 10-part answer shape. */
export type AIAnswer = {
  version: 1;
  intent: AIIntent;
  symbols: string[];
  question: string;
  /** 1. Plain-language summary. Empty only when insufficient. */
  summary: string;
  /** 2. General evidence supporting the summary. */
  evidence: AIClaim[];
  /** 3. Technical evidence. */
  technicalEvidence: AIClaim[];
  /** 4. Fundamental evidence. */
  fundamentalEvidence: AIClaim[];
  /** 5. News evidence. */
  newsEvidence: AIClaim[];
  /** 6. Corporate events / actions. */
  corporateEvents: AIClaim[];
  /** 7. Risks. */
  risks: AIClaim[];
  /** 8. What the evidence set could not supply. */
  missingInformation: string[];
  /** 9. 0-100, capped by evidence quality. */
  confidence: number;
  /** 10. Every source behind the cited evidence. */
  sources: AISource[];
  /** True when the engine refused for lack of verified evidence. */
  insufficient: boolean;
  generatedAt: string;
  providerId: string;
  model: string | null;
  /** Claims dropped because they cited unknown evidence ids. */
  droppedClaims: number;
};

export const INSUFFICIENT_EVIDENCE_MESSAGE =
  "Insufficient verified evidence to answer confidently.";

/** ---- Provider interface -------------------------------------------- */

export type AIProviderId = "openai" | "gemini" | "ollama" | "mock";

/** Provider-neutral request. Providers see prompts only — never providers. */
export type AIProviderRequest = {
  system: string;
  user: string;
  /** JSON Schema the provider must make the model conform to. */
  schema: Record<string, unknown>;
  schemaName: string;
  intent: AIIntent;
};

export type AIProviderResponse = {
  /** Raw JSON text returned by the model. */
  raw: string;
  model: string | null;
};

export type AIProvider = {
  id: AIProviderId;
  /** Display name for logs / diagnostics. */
  name: string;
  /** False when the required env config is absent. */
  isConfigured(): boolean;
  complete(request: AIProviderRequest): Promise<AIProviderResponse>;
};

export type AIErrorCode =
  | "NO_PROVIDER"
  | "PROVIDER_ERROR"
  | "INVALID_MODEL_OUTPUT"
  | "INSUFFICIENT_EVIDENCE"
  | "INVALID_REQUEST"
  | "CONTEXT_ERROR";

export type AIError = {
  code: AIErrorCode;
  message: string;
  intent: AIIntent | null;
  symbols: string[];
};

export type AIReasoningResult =
  | { ok: true; data: AIAnswer }
  | { ok: false; error: AIError };

export type AIReasoningRequest = {
  question: string;
  /** Optional caller-supplied symbols (e.g. the open stock page). */
  symbols?: string[];
  /** Force a provider; otherwise resolved from AI_PROVIDER / availability. */
  provider?: AIProviderId;
  /** Optional portfolio context lines, already redacted by the caller. */
  portfolio?: { symbol: string; quantity: number; avgPrice: number }[];
};
