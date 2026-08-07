/**
 * MockProvider — deterministic development provider.
 *
 * It performs no network call and no reasoning. It reads the evidence ids out
 * of the prompt payload and returns a schema-valid answer built purely from
 * them, so the whole pipeline (router → selector → formatter) can be
 * exercised offline without a key.
 */

import type { AIProvider, AIProviderRequest, AIProviderResponse } from "../ai-types";

type PromptEvidence = {
  id: string;
  domain: string;
  label: string;
  value?: { kind: string; value?: unknown; unit?: string };
  direction?: string;
  at?: string | null;
};

const render = (item: PromptEvidence): string => {
  const value = item.value;
  const rendered =
    value && value.kind === "number"
      ? `${value.value}${value.unit === "percent" ? "%" : ""}`
      : value && (value.kind === "text" || value.kind === "boolean")
        ? String(value.value)
        : "reported";
  const dated = item.at ? ` (as of ${item.at.slice(0, 10)})` : "";
  return `${item.label}: ${rendered}${dated}.`;
};

function readContext(user: string): { evidence: PromptEvidence[]; gaps: string[] } {
  const start = user.indexOf("[", user.indexOf("RESEARCH CONTEXT"));
  const end = user.lastIndexOf("]");
  if (start < 0 || end <= start) return { evidence: [], gaps: [] };
  try {
    const parsed = JSON.parse(user.slice(start, end + 1)) as {
      evidence?: PromptEvidence[];
      gaps?: string[];
    }[];
    return {
      evidence: parsed.flatMap((entry) => entry.evidence ?? []),
      gaps: parsed.flatMap((entry) => entry.gaps ?? []),
    };
  } catch {
    return { evidence: [], gaps: [] };
  }
}

const claims = (items: PromptEvidence[], limit: number) =>
  items.slice(0, limit).map((item) => ({ statement: render(item), evidenceIds: [item.id] }));

async function complete(request: AIProviderRequest): Promise<AIProviderResponse> {
  const { evidence, gaps } = readContext(request.user);
  const of = (domain: string) => evidence.filter((item) => item.domain === domain);
  const bearish = evidence.filter((item) => item.direction === "bearish");

  const answer = {
    summary:
      evidence.length === 0
        ? ""
        : `Deterministic mock reading of ${evidence.length} evidence items for intent "${request.intent}". Every statement below restates a single supplied fact; no interpretation is added.`,
    evidence: claims(evidence, 5),
    technicalEvidence: claims(of("technical"), 5),
    fundamentalEvidence: claims(of("fundamental"), 5),
    newsEvidence: claims(of("news"), 5),
    corporateEvents: claims([...of("corporate-action"), ...of("event")], 5),
    risks: claims(bearish, 4),
    missingInformation: gaps,
    confidence: evidence.length === 0 ? 0 : 55,
    insufficient: evidence.length === 0,
  };

  return { raw: JSON.stringify(answer), model: "mock-deterministic-1" };
}

export const mockProvider: AIProvider = {
  id: "mock",
  name: "Mock (development)",
  isConfigured: () => true,
  complete,
};
