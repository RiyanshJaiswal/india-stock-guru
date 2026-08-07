/**
 * AIQuestionRouter — turns a classified question into an execution plan.
 *
 * The router decides WHICH research domains must be collected, how much
 * evidence the model may see and how strict the quality bar is. It never
 * calls a provider and never touches upstream engines.
 */

import { classifyIntent } from "./intent-classifier";
import type { AIIntent, AIRoutePlan, IntentClassification } from "./ai-types";
import type { ResearchDomain } from "../research-types";

const ALL: ResearchDomain[] = ["market", "technical", "fundamental", "news"];

type Policy = Omit<AIRoutePlan, "intent" | "symbols" | "multiSymbol">;

const POLICIES: Record<AIIntent, Policy> = {
  "why-fall": {
    domains: ALL, requiredDomains: ["market"], evidenceBudget: 40, minQuality: 35,
    focus: "Explain the decline strictly from dated evidence. Rank causes by importance and recency.",
  },
  "why-rise": {
    domains: ALL, requiredDomains: ["market"], evidenceBudget: 40, minQuality: 35,
    focus: "Explain the advance strictly from dated evidence. Rank causes by importance and recency.",
  },
  "explain-movement": {
    domains: ALL, requiredDomains: ["market"], evidenceBudget: 40, minQuality: 30,
    focus: "Describe the latest price action and attribute it only to evidence that is dated close to it.",
  },
  "technical-analysis": {
    domains: ["market", "technical"], requiredDomains: ["technical"], evidenceBudget: 45, minQuality: 40,
    focus: "Read the indicator set as a whole. State the trend, momentum, volatility and key levels.",
  },
  "fundamental-analysis": {
    domains: ["market", "fundamental"], requiredDomains: ["fundamental"], evidenceBudget: 45, minQuality: 40,
    focus: "Assess valuation, profitability, leverage and growth using only reported figures.",
  },
  "news-analysis": {
    domains: ["market", "news"], requiredDomains: ["news"], evidenceBudget: 40, minQuality: 30,
    focus: "Group headlines by theme, note the source and date of each, and flag single-source stories.",
  },
  "corporate-actions": {
    domains: ["news"], requiredDomains: ["news"], evidenceBudget: 30, minQuality: 25,
    focus: "List only confirmed corporate actions and exchange filings with their dates.",
  },
  "compare-stocks": {
    domains: ALL, requiredDomains: ["market"], evidenceBudget: 30, minQuality: 40,
    focus: "Compare the symbols metric by metric. Never compare a metric that is missing for one of them.",
  },
  "buy-or-wait": {
    domains: ALL, requiredDomains: ["market", "technical"], evidenceBudget: 45, minQuality: 50,
    focus: "Lay out the case for acting now versus waiting. Present trade-offs, not a directive.",
  },
  "swing-trade": {
    domains: ["market", "technical", "news"], requiredDomains: ["technical"], evidenceBudget: 40, minQuality: 45,
    focus: "Focus on multi-day structure: trend, momentum, volatility and the nearest levels.",
  },
  "long-term": {
    domains: ALL, requiredDomains: ["fundamental"], evidenceBudget: 45, minQuality: 50,
    focus: "Weight multi-year fundamentals over short-term price action.",
  },
  "risk-analysis": {
    domains: ALL, requiredDomains: ["market"], evidenceBudget: 45, minQuality: 35,
    focus: "Enumerate concrete, evidenced risks: leverage, volatility, concentration, regulatory and event risk.",
  },
  portfolio: {
    domains: ALL, requiredDomains: ["market"], evidenceBudget: 35, minQuality: 30,
    focus: "Answer at the holdings level. Use only the positions supplied with the request.",
  },
  "general-market": {
    domains: ["market", "news"], requiredDomains: ["market"], evidenceBudget: 35, minQuality: 25,
    focus: "Answer about the broad market. Do not extrapolate a single stock to the index.",
  },
};

export function policyFor(intent: AIIntent): Policy {
  return POLICIES[intent];
}

export function routeQuestion(
  question: string,
  hintedSymbols: string[] = [],
): { classification: IntentClassification; plan: AIRoutePlan } {
  const classification = classifyIntent(question, hintedSymbols);
  const policy = POLICIES[classification.intent];
  const multiSymbol = classification.intent === "compare-stocks" || classification.intent === "portfolio";
  const symbols = multiSymbol ? classification.symbols : classification.symbols.slice(0, 1);

  return {
    classification,
    plan: {
      intent: classification.intent,
      symbols,
      domains: policy.domains,
      requiredDomains: policy.requiredDomains,
      evidenceBudget: policy.evidenceBudget,
      minQuality: policy.minQuality,
      multiSymbol,
      focus: policy.focus,
    },
  };
}
