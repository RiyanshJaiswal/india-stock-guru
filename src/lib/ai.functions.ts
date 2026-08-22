import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const messageSchema = z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(6000) });
const chatInput = z.object({
  symbol: z.string().min(1).max(32),
  userMessage: z.string().trim().min(1).max(2000),
  messages: z.array(messageSchema).max(20),
  context: z.record(z.string(), z.unknown()).default({}),
});

const SYSTEM_PROMPT = `You are Dalal Desk AI, a senior Indian stock-market research analyst and evidence-first market-intelligence assistant.

Your job is NOT to predict prices with certainty. Your job is to transform verified market evidence into a clear decision-support view.

Core reasoning pipeline:
1. Establish the current market/company context.
2. Analyse the latest relevant news and events.
3. Determine Bullish / Bearish / Neutral sentiment and explain the evidence behind it.
4. Identify directly impacted stocks and sectors ONLY when supported by supplied evidence. Never invent peer tickers.
5. Separate FACT from INFERENCE.
6. Identify key catalysts and potential risks.
7. Combine market, technical, fundamental and news evidence.
8. Assess potential dip/accumulation areas ONLY when sufficient technical evidence exists. Never manufacture a price level.
9. End with a practical AI Insight comparing current level, support/dip setup, catalysts and risks.

Required answer structure:
## AI Market Intelligence — [Company/Stock]
1-3 sentence executive summary.

## Sentiment & Signal
- Direction: Bullish / Bearish / Neutral
- Confidence: low / medium / high, with a short reason
- Signal balance: explain what is supporting and opposing the view

## Impact Map
- Directly impacted stock
- Sector/theme impact
- Other stocks only if explicitly supported by the evidence

## Why This Matters
- 2-5 concise evidence-backed reasons
- Clearly label inference as *Inference*

## Key Catalysts
- Near-term and medium-term catalysts supported by evidence

## Potential Risks
- Company, sector, market and thesis-invalidation risks

## Technical & Fundamental Context
- Current price/trend/volatility when supplied
- Support/resistance and momentum when supplied
- Relevant valuation/fundamental signals when supplied
- Explain conflicts instead of hiding them

## Potential Dip / Accumulation Zone
- Show a range only when reliable support, historical behaviour, volatility or equivalent evidence exists
- Explain the evidence used
- If evidence is insufficient, explicitly say: "No reliable dip zone can be established from the available data."
- Never invent support, entry price, target or stop-loss

## AI Insight
- Current setup: favourable / watch / cautious / avoid-until-confirmed
- What would strengthen the thesis
- What would invalidate it
- Distinguish analysis from a trading recommendation
- No profit guarantees

## Evidence Quality
- Overall quality and important data gaps/conflicts

## Sources
- Use ONLY supplied sources. Never invent URLs, publishers, dates or headlines.

Rules:
- Current evidence beats generic knowledge.
- Do not claim a news event is current unless the supplied evidence gives a date/time or clearly identifies it as recent.
- Do not turn a single headline into a strong trading conclusion.
- Cross-check news with price/technical/fundamental evidence whenever available.
- When evidence conflicts, say so explicitly.
- When data is missing, say so instead of guessing.
- Never fabricate stock prices, support/resistance, valuation ratios, financial figures, peer companies or source links.
- Use concise Markdown and short bullets. Avoid walls of text.
- No profit guarantees and no certainty about future prices.`;

const RESEARCH_CACHE_TTL_MS = 5 * 60_000;
const researchCache = new Map<string, { value: string; expiresAt: number }>();
const MAX_CONTEXT_CHARS = 12_000;
const MAX_RESEARCH_CHARS = 14_000;
const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_MESSAGE_CHARS = 1_500;
const MAX_REPLY_LENGTH = 7_000;
const RESEARCH_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 20_000;

const GEMINI_MODELS = [
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
  "gemini-flash-latest",
];

function clampText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n… (truncated)`;
}

function sanitizeContext(context: Record<string, unknown>): string {
  try {
    return clampText(JSON.stringify(context), MAX_CONTEXT_CHARS);
  } catch {
    return "{}";
  }
}

function getCachedResearch(symbol: string): string | undefined {
  const entry = researchCache.get(symbol);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    researchCache.delete(symbol);
    return undefined;
  }
  return entry.value;
}

function setCachedResearch(symbol: string, value: string): void {
  if (researchCache.size > 200) {
    for (const key of [...researchCache.keys()].slice(0, 100)) researchCache.delete(key);
  }
  researchCache.set(symbol, { value, expiresAt: Date.now() + RESEARCH_CACHE_TTL_MS });
}

function formatEvidenceValue(item: {
  value: { kind: string; value?: unknown; unit?: string };
}): string {
  if (item.value.kind === "number") {
    const value = item.value.value;
    const unit = item.value.unit ?? "";
    if (typeof value === "number") {
      if (unit === "percent") return `${value}%`;
      if (unit === "currency" || unit === "price") return `₹${value}`;
      return `${value}${unit ? ` ${unit}` : ""}`;
    }
  }
  if (item.value.kind === "boolean") return String(item.value.value);
  if (item.value.kind === "text") return String(item.value.value ?? "");
  return "N/A";
}

function buildResearchBrief(symbol: string, result: any): string {
  if (!result?.ok || !result.data) return "Verified research context: temporarily unavailable. Do not guess missing data.";

  const data = result.data;
  const directionScore = data.evidence.reduce((score: number, item: any) => {
    const weight = Math.max(0, Math.min(100, Number(item.importance ?? 0))) * Math.max(0, Math.min(1, Number(item.reliability ?? 0)));
    if (item.direction === "bullish") return score + weight;
    if (item.direction === "bearish") return score - weight;
    return score;
  }, 0);

  const selected = [...data.evidence]
    .sort((a: any, b: any) => {
      const ai = Number(a.importance ?? 0) * Number(a.reliability ?? 0);
      const bi = Number(b.importance ?? 0) * Number(b.reliability ?? 0);
      return bi - ai;
    })
    .slice(0, 42);

  const evidenceLines = selected.map((item: any, index: number) => {
    const date = item.observedAt ? item.observedAt : "date unavailable";
    const source = item.sourceName || item.sourceId || "source unavailable";
    const url = item.url ? ` | URL: ${item.url}` : "";
    const tags = Array.isArray(item.tags) && item.tags.length ? ` | Tags: ${item.tags.join(", ")}` : "";
    const note = item.note ? ` | Note: ${item.note}` : "";
    return `${index + 1}. [${item.domain}] ${item.label}: ${formatEvidenceValue(item)} | Direction: ${item.direction} | Importance: ${item.importance} | Reliability: ${item.reliability} | Observed: ${date} | Source: ${source}${url}${tags}${note}`;
  }).join("\n");

  const timeline = (data.timeline?.entries ?? []).slice(0, 12).map((entry: any, index: number) =>
    `${index + 1}. ${entry.at} | [${entry.domain}] ${entry.title}${entry.detail ? ` — ${entry.detail}` : ""} | Direction: ${entry.direction}${entry.url ? ` | URL: ${entry.url}` : ""}`,
  ).join("\n");

  const conflicts = (data.conflicts ?? []).slice(0, 10).map((conflict: any, index: number) =>
    `${index + 1}. ${conflict.topic}: ${conflict.description} | Severity: ${conflict.severity} | Domains: ${(conflict.domains ?? []).join(", ")}`,
  ).join("\n");

  const gaps = (data.gaps ?? []).slice(0, 12).map((gap: any, index: number) =>
    `${index + 1}. [${gap.domain}] ${gap.label}: ${gap.reason}`,
  ).join("\n");

  const coverage = (data.coverage ?? []).map((item: any) =>
    `${item.domain}: ${item.ok ? "OK" : "FAILED"}, evidence=${item.evidenceCount}, completeness=${Math.round(Number(item.completeness ?? 0) * 100)}%, duration=${item.durationMs}ms${item.message ? `, ${item.message}` : ""}`,
  ).join("\n");

  const summary = data.summary
    ? `total=${data.summary.totalEvidence}, bullish=${data.summary.byDirection?.bullish ?? 0}, bearish=${data.summary.byDirection?.bearish ?? 0}, neutral=${data.summary.byDirection?.neutral ?? 0}, conflicts=${data.summary.conflictCount}, gaps=${data.summary.gapCount}`
    : "unavailable";

  const quality = data.quality
    ? `overall=${data.quality.overall}/100, grade=${data.quality.grade}, coverage=${data.quality.coverage}, reliability=${data.quality.reliability}, freshness=${data.quality.freshness}, consistency=${data.quality.consistency}`
    : "unavailable";

  const brief = `VERIFIED RESEARCH CONTEXT (machine-collected; do not invent beyond this package)
Symbol: ${data.symbol || symbol}
Company: ${data.companyName ?? "unknown"}
Exchange: ${data.exchange ?? "unknown"}
Built at: ${data.builtAt ?? "unknown"}

Deterministic evidence balance (not an AI recommendation): ${directionScore.toFixed(1)} (positive = more bullish evidence, negative = more bearish evidence)
Summary: ${summary}
Evidence quality: ${quality}

Domain coverage:
${coverage || "unavailable"}

Top evidence:
${evidenceLines || "No evidence"}

Timeline:
${timeline || "No dated timeline entries"}

Conflicts:
${conflicts || "None recorded"}

Data gaps:
${gaps || "None recorded"}`;

  return clampText(brief, MAX_RESEARCH_CHARS);
}

async function fetchResearchContext(symbol: string): Promise<string> {
  const cached = getCachedResearch(symbol);
  if (cached !== undefined) return cached;

  try {
    const { runResearchContext } = await import("./research-context.server");
    const result = await runResearchContext({
      symbol,
      domains: ["market", "technical", "fundamental", "news"],
      interval: "1d",
      range: "1y",
      quarters: 4,
      years: 2,
      newsLimit: 10,
      newsSinceDays: 14,
    });
    const brief = buildResearchBrief(symbol, result);
    setCachedResearch(symbol, brief);
    return brief;
  } catch (error) {
    console.error(`Research context error for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    return "Verified research context: temporarily unavailable. Use only application evidence supplied separately and do not guess missing values.";
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function extractGeminiContent(body: unknown): {
  text: string | null;
  finishReason?: string;
  finishMessage?: string;
  blockReason?: string;
} {
  if (!body || typeof body !== "object") return { text: null };
  const root = body as { candidates?: unknown; promptFeedback?: { blockReason?: unknown } };
  const candidates = root.candidates;
  const blockReason = typeof root.promptFeedback?.blockReason === "string" ? root.promptFeedback.blockReason : undefined;
  if (!Array.isArray(candidates) || !candidates.length) return { text: null, blockReason };

  const first = candidates[0] as {
    content?: unknown;
    finishReason?: unknown;
    finishMessage?: unknown;
    text?: unknown;
  };
  const finishReason = typeof first.finishReason === "string" ? first.finishReason : undefined;
  const finishMessage = typeof first.finishMessage === "string" ? first.finishMessage : undefined;

  if (typeof first.text === "string" && first.text.trim()) {
    return { text: first.text.trim(), finishReason, finishMessage, blockReason };
  }

  const content = first.content;
  const parts = content && typeof content === "object" ? (content as { parts?: unknown }).parts : null;
  if (!Array.isArray(parts)) return { text: null, finishReason, finishMessage, blockReason };

  const text = parts
    .map((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "")
    .join("")
    .trim();

  return { text: text || null, finishReason, finishMessage, blockReason };
}

function buildPrompt(
  symbol: string,
  userMessage: string,
  history: Array<{ role: string; content: string }>,
  context: Record<string, unknown>,
  researchContext: string,
): string {
  return `${SYSTEM_PROMPT}

Stock symbol: ${symbol}

${researchContext}

CURRENT APPLICATION UI CONTEXT:
${sanitizeContext(context)}

CONVERSATION SO FAR:
${history.map((m) => `${m.role}: ${m.content}`).join("\n") || "No previous conversation."}

USER QUESTION:
${userMessage}`;
}

async function callGeminiModel(apiKey: string, model: string, prompt: string): Promise<{ text: string | null; retryable: boolean }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: 3200,
      thinkingConfig: {
        thinkingLevel: model === "gemini-3.7-flash" || model === "gemini-3.6-flash" || model === "gemini-3.5-flash" ? "medium" : "low",
      },
    },
  };

  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    }, REQUEST_TIMEOUT_MS);

    const raw = await response.text();
    if (!response.ok) {
      console.error(`Gemini ${model} HTTP ${response.status}: ${raw.slice(0, 800)}`);
      return { text: null, retryable: [408, 409, 429, 500, 502, 503, 504].includes(response.status) };
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { text: null, retryable: true };
    }

    const result = extractGeminiContent(json);
    if (result.text) return { text: result.text, retryable: false };

    console.error(`Gemini ${model} returned no text`, JSON.stringify({
      finishReason: result.finishReason,
      finishMessage: result.finishMessage,
      blockReason: result.blockReason,
    }));
    return { text: null, retryable: true };
  } catch (error) {
    console.error(`Gemini ${model} request error: ${error instanceof Error ? error.message : String(error)}`);
    return { text: null, retryable: true };
  }
}

async function callGeminiWithFallback(apiKey: string, prompt: string): Promise<string | null> {
  for (const model of GEMINI_MODELS) {
    const result = await callGeminiModel(apiKey, model, prompt);
    if (result.text) {
      console.info(`Gemini response served by ${model}`);
      return result.text;
    }
    await sleep(150);
  }
  return null;
}

export const askAi = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => chatInput.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      return { mode: "local" as const, content: "## AI Research unavailable\n\nGemini is not configured on the server." };
    }

    const history = data.messages
      .slice(-MAX_HISTORY_MESSAGES)
      .map((message) => ({ role: message.role, content: clampText(message.content, MAX_HISTORY_MESSAGE_CHARS) }));

    const researchContext = await withTimeout(fetchResearchContext(data.symbol), RESEARCH_TIMEOUT_MS);
    const safeResearchContext = researchContext ?? "Verified research context timed out. Do not guess missing research data.";
    const prompt = buildPrompt(data.symbol, data.userMessage, history, { symbol: data.symbol, ...data.context }, safeResearchContext);

    const content = await callGeminiWithFallback(apiKey, prompt);
    if (content) {
      return {
        mode: "ai" as const,
        content: content.length > MAX_REPLY_LENGTH
          ? `${content.slice(0, MAX_REPLY_LENGTH)}\n\n… (response truncated)`
          : content,
      };
    }

    return {
      mode: "local" as const,
      content: "## AI Research temporarily unavailable\n\nAll configured Gemini models failed to return a response. Your live market data is still available.",
    };
  });
