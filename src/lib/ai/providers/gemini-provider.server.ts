/**
 * GeminiProvider (server-only) — Gemini models through the Lovable AI Gateway
 * OpenAI-compatible chat completions endpoint.
 *
 * Buffered (non-streaming) because Gemini Flash returns quickly; the schema is
 * enforced with `response_format: json_schema`.
 */

import type { AIProvider, AIProviderRequest, AIProviderResponse } from "../ai-types";

const ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3.6-flash";

function apiKey(): string | undefined {
  return process.env["LOVABLE_API_KEY"];
}

async function complete(request: AIProviderRequest): Promise<AIProviderResponse> {
  const key = apiKey();
  if (!key) throw new Error("LOVABLE_API_KEY is not configured.");
  const model = process.env["AI_GEMINI_MODEL"] ?? DEFAULT_MODEL;

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
    if (response.status === 429) throw new Error("AI rate limit reached. Try again shortly.");
    if (response.status === 402) throw new Error("AI credits exhausted for this workspace.");
    throw new Error(`AI gateway error ${response.status}: ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = payload.choices?.[0]?.message?.content ?? "";
  if (!raw.trim()) throw new Error("The model returned an empty response.");
  return { raw, model };
}

export const geminiProvider: AIProvider = {
  id: "gemini",
  name: "Gemini (Lovable AI Gateway)",
  isConfigured: () => Boolean(apiKey()),
  complete,
};
