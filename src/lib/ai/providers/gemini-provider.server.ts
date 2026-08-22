/**
 * GeminiProvider (server-only) — Gemini models through the Lovable AI Gateway
 * OpenAI-compatible chat completions endpoint.
 *
 * Uses a model fallback chain so a temporary 429/5xx/model availability issue
 * on one Gemini model does not make the entire AI Researcher request fail.
 */

import type { AIProvider, AIProviderRequest, AIProviderResponse } from "../ai-types";

const ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODELS = [
  "google/gemini-3.7-flash",
  "google/gemini-3.6-flash",
  "google/gemini-3.5-flash",
  "google/gemini-3.5-flash-lite",
];

function apiKey(): string | undefined {
  return process.env["LOVABLE_API_KEY"];
}

function models(): string[] {
  const configured = process.env["AI_GEMINI_MODELS"]
    ?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  const primary = process.env["AI_GEMINI_MODEL"]?.trim();
  const candidates = configured?.length ? configured : DEFAULT_MODELS;

  return Array.from(new Set([
    ...(primary ? [primary] : []),
    ...candidates,
  ]));
}

function isTransientOrModelFailure(status: number): boolean {
  return status === 404 || status === 408 || status === 409 || status === 429 || status >= 500;
}

async function complete(request: AIProviderRequest): Promise<AIProviderResponse> {
  const key = apiKey();
  if (!key) throw new Error("LOVABLE_API_KEY is not configured.");

  const candidates = models();
  const failures: string[] = [];

  for (const model of candidates) {
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": key,
          "X-Lovable-AIG-SDK": "fetch",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: request.schemaName, strict: true, schema: request.schema },
          },
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        const message = `AI gateway error ${response.status}: ${detail.slice(0, 220)}`;
        failures.push(`${model}: ${message}`);

        // Move immediately to the next model for transient capacity/rate-limit
        // failures and unavailable/invalid model IDs. Do not expose provider
        // details to the user unless every fallback is exhausted.
        if (isTransientOrModelFailure(response.status)) continue;

        throw new Error(message);
      }

      const payload = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const raw = payload.choices?.[0]?.message?.content ?? "";
      if (!raw.trim()) {
        failures.push(`${model}: empty response`);
        continue;
      }

      return { raw, model };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${model}: ${message}`);
      continue;
    }
  }

  throw new Error(
    `All Gemini models failed. Tried ${candidates.length} model(s). ${failures.slice(-4).join(" | ")}`,
  );
}

export const geminiProvider: AIProvider = {
  id: "gemini",
  name: "Gemini (Lovable AI Gateway)",
  isConfigured: () => Boolean(apiKey()),
  complete,
};
