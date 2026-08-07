/**
 * OllamaProvider (server-only) — self-hosted models over the Ollama HTTP API.
 *
 * Enabled by setting `OLLAMA_BASE_URL` (e.g. http://127.0.0.1:11434) and
 * optionally `OLLAMA_MODEL`. Ollama accepts a JSON Schema in `format`, which
 * gives the same structured guarantee as the hosted providers.
 */

import type { AIProvider, AIProviderRequest, AIProviderResponse } from "../ai-types";

const DEFAULT_MODEL = "llama3.1";

const baseUrl = () => process.env["OLLAMA_BASE_URL"]?.replace(/\/+$/, "");

async function complete(request: AIProviderRequest): Promise<AIProviderResponse> {
  const base = baseUrl();
  if (!base) throw new Error("OLLAMA_BASE_URL is not configured.");
  const model = process.env["OLLAMA_MODEL"] ?? DEFAULT_MODEL;

  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: request.schema,
      options: { temperature: 0 },
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Ollama error ${response.status}: ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as { message?: { content?: string } };
  const raw = payload.message?.content ?? "";
  if (!raw.trim()) throw new Error("The local model returned an empty response.");
  return { raw, model };
}

export const ollamaProvider: AIProvider = {
  id: "ollama",
  name: "Ollama (self-hosted)",
  isConfigured: () => Boolean(baseUrl()),
  complete,
};
