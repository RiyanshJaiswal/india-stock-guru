/**
 * AIReasoningEngine (server-only).
 *
 * Pipeline: route → build ResearchContext(s) → select evidence → prompt a
 * provider → format + validate the answer.
 *
 * The engine consumes ONLY ResearchContext objects. It never imports a market,
 * technical, fundamental or news provider; the sole upstream call is to the
 * Phase 6.1 research service, which owns all data collection.
 */

import { routeQuestion } from "./ai-question-router";
import { meetsRequirements, selectContext } from "./ai-context-selector";
import { ANSWER_SCHEMA, ANSWER_SCHEMA_NAME, SYSTEM_PROMPT, buildUserPrompt } from "./ai-prompt";
import { formatAnswer, insufficientAnswer, parseModelJson } from "./ai-response-formatter";
import { resolveProvider } from "./providers/registry.server";
import { runResearchContext } from "../research-context.server";
import type { ResearchContext, ResearchDomain, ResearchRequest } from "../research-types";
import type {
  AIReasoningRequest,
  AIReasoningResult,
  AISelectedContext,
} from "./ai-types";

const researchRequestFor = (symbol: string, domains: ResearchDomain[]): ResearchRequest => ({
  symbol,
  domains,
  interval: "1d",
  range: "1y",
  quarters: 12,
  years: 10,
  newsLimit: 30,
  newsSinceDays: 14,
});

/** Reason over already-built contexts. Use this from a FastAPI bridge. */
export async function reasonOverContexts(
  request: AIReasoningRequest,
  contexts: ResearchContext[],
): Promise<AIReasoningResult> {
  const { plan } = routeQuestion(request.question, request.symbols ?? []);
  const provider = resolveProvider(request.provider);
  const selected: AISelectedContext[] = contexts.map((context) => selectContext(context, plan));

  const gate = meetsRequirements(selected, plan);
  if (!gate.ok) {
    return {
      ok: true,
      data: insufficientAnswer({
        intent: plan.intent,
        question: request.question,
        symbols: selected.map((context) => context.symbol),
        reason: gate.reason ?? "The evidence set does not meet this question's requirements.",
        providerId: provider.id,
        missing: selected.flatMap((context) =>
          context.gaps.map((gap) => `${context.ticker} · ${gap.label}: ${gap.reason}`),
        ),
      }),
    };
  }

  let raw: string;
  let model: string | null;
  try {
    const response = await provider.complete({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(request.question, plan, selected, request.portfolio),
      schema: ANSWER_SCHEMA,
      schemaName: ANSWER_SCHEMA_NAME,
      intent: plan.intent,
    });
    raw = response.raw;
    model = response.model;
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "PROVIDER_ERROR",
        message: error instanceof Error ? error.message : "The AI provider failed.",
        intent: plan.intent,
        symbols: selected.map((context) => context.symbol),
      },
    };
  }

  const parsed = parseModelJson(raw);
  if (!parsed) {
    return {
      ok: false,
      error: {
        code: "INVALID_MODEL_OUTPUT",
        message: "The model did not return valid JSON for the required answer schema.",
        intent: plan.intent,
        symbols: selected.map((context) => context.symbol),
      },
    };
  }

  return {
    ok: true,
    data: formatAnswer({
      raw: parsed,
      intent: plan.intent,
      question: request.question,
      contexts: selected,
      providerId: provider.id,
      model,
    }),
  };
}

/** Full pipeline: collect the research contexts, then reason over them. */
export async function runAIReasoning(
  request: AIReasoningRequest,
): Promise<AIReasoningResult> {
  const question = request.question.trim();
  if (!question) {
    return {
      ok: false,
      error: { code: "INVALID_REQUEST", message: "The question is empty.", intent: null, symbols: [] },
    };
  }

  const { plan } = routeQuestion(question, request.symbols ?? []);

  if (plan.symbols.length === 0) {
    return {
      ok: true,
      data: insufficientAnswer({
        intent: plan.intent,
        question,
        symbols: [],
        reason:
          "No company symbol was identified in the question, so no verifiable evidence could be collected.",
        providerId: resolveProvider(request.provider).id,
      }),
    };
  }

  const results = await Promise.all(
    plan.symbols
      .slice(0, plan.multiSymbol ? 4 : 1)
      .map((symbol) => runResearchContext(researchRequestFor(symbol, plan.domains))),
  );

  const contexts = results.flatMap((result) => (result.ok ? [result.data] : []));
  if (contexts.length === 0) {
    const first = results.find((result) => !result.ok);
    return {
      ok: true,
      data: insufficientAnswer({
        intent: plan.intent,
        question,
        symbols: plan.symbols,
        reason:
          !first || first.ok
            ? "The research context engine returned no evidence."
            : first.error.message,
        providerId: resolveProvider(request.provider).id,
      }),
    };
  }

  return reasonOverContexts({ ...request, question }, contexts);
}
