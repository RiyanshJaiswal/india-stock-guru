import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const messageSchema = z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(6000) });
const chatInput = z.object({
  symbol: z.string().min(1).max(32),
  userMessage: z.string().trim().min(1).max(2000),
  messages: z.array(messageSchema).max(20),
  context: z.record(z.string(), z.unknown()).default({}),
});

const SYSTEM_PROMPT = `You are Dalal Desk AI, a senior Indian stock-market research assistant.
Answer the user's exact question using the supplied current market context and latest verified news.
Rules:
- Give the answer first, then concise supporting bullets.
- Use only supplied facts for current prices, news, events and company developments. Never invent or guess.
- For news claims, cite the supplied source and date exactly as: (Source Name, DD Mon YYYY).
- Clearly label inference/trend as Trend: Positive, Negative or Neutral and explain why.
- For trading questions, mention the main risk or invalidating condition.
- If a requested data point is unavailable, say so explicitly rather than fabricating it.
- You may synthesize technical, fundamental and news context supplied by the application.
- No profit guarantees or certainty about future prices.
- End with: Confidence: NN% — <short evidence-based reason>`;

const NEWS_CACHE_TTL_MS = 5 * 60_000;
const newsBriefCache = new Map<string, { value: string; expiresAt: number }>();
const MAX_CONTEXT_CHARS = 10_000;
const MAX_NEWS_CHARS = 5_500;
const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_MESSAGE_CHARS = 1_500;
const MAX_REPLY_LENGTH = 3_500;
const NEWS_TIMEOUT_MS = 4_000;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const REQUEST_TIMEOUT_MS = 25_000;
const VERIFIED_FALLBACK_MODEL = "gemini-flash-latest";

function clampText(value: string, maxChars: number): string { return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n… (truncated)`; }
function sanitizeContext(context: Record<string, unknown>): string { try { return clampText(JSON.stringify(context), MAX_CONTEXT_CHARS); } catch { return "{}"; } }
function getCachedNewsBrief(symbol: string): string | undefined {
  const entry = newsBriefCache.get(symbol);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { newsBriefCache.delete(symbol); return undefined; }
  return entry.value;
}
function setCachedNewsBrief(symbol: string, value: string): void {
  if (newsBriefCache.size > 200) for (const key of [...newsBriefCache.keys()].slice(0, 100)) newsBriefCache.delete(key);
  newsBriefCache.set(symbol, { value, expiresAt: Date.now() + NEWS_CACHE_TTL_MS });
}

async function fetchLatestNews(symbol: string): Promise<string> {
  const cached = getCachedNewsBrief(symbol);
  if (cached !== undefined) return cached;
  try {
    const { runResearchContext } = await import("./research-context.server");
    const result = await runResearchContext({ symbol, domains: ["news"], interval: "1d", range: "7d", quarters: 0, years: 0, newsLimit: 6, newsSinceDays: 3 });
    if (!result.ok) { setCachedNewsBrief(symbol, ""); return ""; }
    const items = result.data.evidence.filter((item) => item.domain === "news").sort((a, b) => b.importance - a.importance).slice(0, 6);
    if (!items.length) { setCachedNewsBrief(symbol, ""); return ""; }
    const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
    const brief = items.map((item, index) => {
      const when = item.observedAt ? dateFormatter.format(new Date(item.observedAt)) : "date unknown";
      const headline = item.value.kind === "text" ? item.value.value : item.label;
      return `${index + 1}. ${headline} — ${item.sourceName}, ${when}`;
    }).join("\n");
    const bounded = clampText(brief, MAX_NEWS_CHARS);
    setCachedNewsBrief(symbol, bounded);
    return bounded;
  } catch { return ""; }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))]);
}
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); } finally { clearTimeout(timeout); }
}
function retryDelay(response: Response | null, attempt: number): number {
  const seconds = Number(response?.headers.get("retry-after"));
  const serverDelay = Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 4_000) : 0;
  return Math.max(serverDelay, Math.min(500 * 2 ** attempt, 3_000)) + Math.floor(Math.random() * 250);
}

function extractAiContent(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices.length) return null;
  const message = (choices[0] as { message?: unknown })?.message;
  const content = message && typeof message === "object" ? (message as { content?: unknown }).content : null;
  return typeof content === "string" && content.trim() ? content.trim() : null;
}

async function callGeminiCompatible(apiKey: string, model: string, prompt: string): Promise<string | null> {
  const url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  const payload = {
    model,
    temperature: 0.1,
    max_tokens: 1400,
    messages: [{ role: "user", content: prompt }],
  };

  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
      }, REQUEST_TIMEOUT_MS);
      lastStatus = response.status;
      if (response.ok) return extractAiContent(await response.json());
      if (!RETRYABLE_STATUS.has(response.status) || attempt === 2) break;
      await sleep(retryDelay(response, attempt));
    } catch (error) {
      if (attempt === 2) console.error(error instanceof Error && error.name === "AbortError" ? "Gemini request timed out" : "Gemini request failed");
      else await sleep(600 * (attempt + 1));
    }
  }
  console.error(`Gemini compatible request failed (${lastStatus || "network"}) for ${model}`);
  return null;
}

async function callGeminiNative(apiKey: string, model: string, prompt: string): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 1400 },
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
      }, REQUEST_TIMEOUT_MS);
      if (response.ok) {
        const json = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        return json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() || null;
      }
      if (response.status === 404) {
        console.error(`Gemini native model unavailable (${response.status}) for ${model}`);
        return null;
      }
      if (!RETRYABLE_STATUS.has(response.status) || attempt === 1) return null;
      await sleep(retryDelay(response, attempt));
    } catch (error) {
      if (attempt === 1) console.error(error instanceof Error && error.name === "AbortError" ? "Gemini native request timed out" : "Gemini native request failed");
      else await sleep(500);
    }
  }
  return null;
}

async function callGeminiWithFallback(apiKey: string, model: string, prompt: string): Promise<string | null> {
  const primary = await callGeminiNative(apiKey, model, prompt) || await callGeminiCompatible(apiKey, model, prompt);
  if (primary) return primary;
  if (model === VERIFIED_FALLBACK_MODEL) return null;
  console.warn(`Falling back from ${model} to ${VERIFIED_FALLBACK_MODEL}`);
  return await callGeminiNative(apiKey, VERIFIED_FALLBACK_MODEL, prompt) || await callGeminiCompatible(apiKey, VERIFIED_FALLBACK_MODEL, prompt);
}

export const askAi = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => chatInput.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
    const configuredModel = process.env.AI_MODEL?.trim() || process.env.GEMINI_MODEL?.trim() || "gemini-2.5-pro";
    if (!apiKey) return { mode: "local" as const, content: "" };

    const screenContext = `Current market context:\n${sanitizeContext({ symbol: data.symbol, ...data.context })}`;
    const history = data.messages.slice(-MAX_HISTORY_MESSAGES).map((message) => ({ role: message.role, content: clampText(message.content, MAX_HISTORY_MESSAGE_CHARS) }));
    const newsBrief = await withTimeout(fetchLatestNews(data.symbol), NEWS_TIMEOUT_MS);
    const newsContext = newsBrief ? `\n\nLatest verified news (recent):\n${newsBrief}` : "\n\nLatest verified news: temporarily unavailable. Do not guess.";
    const prompt = `${SYSTEM_PROMPT}\n\n${screenContext}${newsContext}\n\nConversation so far:\n${history.map((m) => `${m.role}: ${m.content}`).join("\n")}\n\nUser question: ${data.userMessage}`;

    const content = await callGeminiWithFallback(apiKey, configuredModel, prompt);
    if (content) {
      const bounded = content.length > MAX_REPLY_LENGTH ? `${content.slice(0, MAX_REPLY_LENGTH)}\n\n… (response truncated)` : content;
      return { mode: "ai" as const, content: bounded };
    }

    return { mode: "local" as const, content: "" };
  });
