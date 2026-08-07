/**
 * Provider registry (server-only).
 *
 * Resolution order: explicit request override → `AI_PROVIDER` env → first
 * configured hosted provider → MockProvider. Swapping to FastAPI means adding
 * one more adapter here; nothing upstream changes.
 */

import type { AIProvider, AIProviderId } from "../ai-types";
import { openAIProvider } from "./openai-provider.server";
import { geminiProvider } from "./gemini-provider.server";
import { ollamaProvider } from "./ollama-provider.server";
import { mockProvider } from "./mock-provider";

export const AI_PROVIDERS: Record<AIProviderId, AIProvider> = {
  openai: openAIProvider,
  gemini: geminiProvider,
  ollama: ollamaProvider,
  mock: mockProvider,
};

const PREFERENCE: AIProviderId[] = ["openai", "gemini", "ollama"];

export function resolveProvider(requested?: AIProviderId): AIProvider {
  if (requested) {
    const provider = AI_PROVIDERS[requested];
    if (provider?.isConfigured()) return provider;
  }
  const configured = process.env["AI_PROVIDER"] as AIProviderId | undefined;
  if (configured && AI_PROVIDERS[configured]?.isConfigured()) return AI_PROVIDERS[configured];
  for (const id of PREFERENCE) {
    if (AI_PROVIDERS[id].isConfigured()) return AI_PROVIDERS[id];
  }
  return mockProvider;
}

export function providerStatus() {
  return (Object.keys(AI_PROVIDERS) as AIProviderId[]).map((id) => ({
    id,
    name: AI_PROVIDERS[id].name,
    configured: AI_PROVIDERS[id].isConfigured(),
  }));
}
