/**
 * AI Reasoning API service layer.
 *
 * The only entry point the UI (or a future FastAPI bridge) should call.
 * Server-only modules are imported inside the handler so nothing leaks into
 * the client bundle.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { routeQuestion } from "./ai/ai-question-router";
import type { AIReasoningResult, AIRoutePlan, IntentClassification } from "./ai/ai-types";

const askInput = z.object({
  question: z.string().trim().min(2).max(600),
  symbols: z.array(z.string().trim().min(1).max(24)).max(4).optional(),
  provider: z.enum(["openai", "gemini", "ollama", "mock"]).optional(),
  portfolio: z
    .array(
      z.object({
        symbol: z.string().trim().min(1).max(24),
        quantity: z.number().finite(),
        avgPrice: z.number().finite(),
      }),
    )
    .max(50)
    .optional(),
});

export type AskAIInput = z.input<typeof askInput>;

export const askAI = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => askInput.parse(data))
  .handler(async ({ data }): Promise<AIReasoningResult> => {
    const { runAIReasoning } = await import("./ai/ai-reasoning-engine.server");
    try {
      return await runAIReasoning({
        question: data.question,
        ...(data.symbols ? { symbols: data.symbols } : {}),
        ...(data.provider ? { provider: data.provider } : {}),
        ...(data.portfolio ? { portfolio: data.portfolio } : {}),
      });
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "CONTEXT_ERROR",
          message: error instanceof Error ? error.message : "The AI reasoning engine failed.",
          intent: null,
          symbols: data.symbols ?? [],
        },
      };
    }
  });

/** Cheap, model-free routing preview — useful for diagnostics and tests. */
export const classifyQuestion = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z.object({ question: z.string().trim().min(1).max(600) }).parse(data),
  )
  .handler(
    async ({
      data,
    }): Promise<{ classification: IntentClassification; plan: AIRoutePlan }> =>
      routeQuestion(data.question),
  );

/** Which providers are configured in this environment. */
export const getAIProviderStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { providerStatus } = await import("./ai/providers/registry.server");
  return providerStatus();
});
