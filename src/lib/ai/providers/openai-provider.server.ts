/**
 * OpenAIProvider (server-only) — routed through the Lovable AI Gateway
 * Responses API, which is OpenAI-compatible and keeps the key server-side.
 *
 * Reasoning models can run for minutes, so the call always streams and the
 * deltas are accumulated here; the caller only ever sees the final JSON text.
 */

import type { AIProvider, AIProviderRequest, AIProviderResponse } from "../ai-types";

const ENDPOINT = "https://ai.gateway.lovable.dev/v1/responses";
const DEFAULT_MODEL = "openai/gpt-5.6-sol";

function apiKey(): string | undefined {
  return process.env["LOVABLE_API_KEY"];
}

async function readStream(response: Response): Promise<string> {
  const body = response.body;
  if (!body) throw new Error("The AI gateway returned an empty stream.");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let completed = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const event = JSON.parse(payload) as {
          type?: string;
          delta?: string;
          response?: { output_text?: string | string[] };
        };
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          text += event.delta;
        } else if (event.type === "response.completed") {
          const output = event.response?.output_text;
          completed = Array.isArray(output) ? output.join("") : (output ?? "");
        }
      } catch {
        // Ignore keep-alive / partial frames.
      }
    }
  }
  return text || completed;
}

async function complete(request: AIProviderRequest): Promise<AIProviderResponse> {
  const key = apiKey();
  if (!key) throw new Error("LOVABLE_API_KEY is not configured.");
  const model = process.env["AI_OPENAI_MODEL"] ?? DEFAULT_MODEL;

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model,
      stream: true,
      store: false,
      instructions: request.system,
      input: [{ role: "user", content: [{ type: "input_text", text: request.user }] }],
      reasoning: { effort: "medium", summary: "auto" },
      text: {
        format: {
          type: "json_schema",
          name: request.schemaName,
          strict: true,
          schema: request.schema,
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 429) throw new Error("AI rate limit reached. Try again shortly.");
    if (response.status === 402) throw new Error("AI credits exhausted for this workspace.");
    throw new Error(`AI gateway error ${response.status}: ${detail.slice(0, 300)}`);
  }

  const raw = await readStream(response);
  if (!raw.trim()) throw new Error("The model returned an empty response.");
  return { raw, model };
}

export const openAIProvider: AIProvider = {
  id: "openai",
  name: "OpenAI (Lovable AI Gateway)",
  isConfigured: () => Boolean(apiKey()),
  complete,
};
