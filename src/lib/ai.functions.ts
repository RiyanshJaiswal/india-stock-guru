import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const messageSchema = z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(6000) });
const chatInput = z.object({
  symbol: z.string().min(1).max(32),
  userMessage: z.string().trim().min(1).max(2000),
  messages: z.array(messageSchema).max(20),
  context: z.record(z.string(), z.unknown()).default({}),
});

const SYSTEM_PROMPT = `You are Dalal Desk AI, a concise Indian stock-market copilot.
Use ONLY the supplied market context for factual numbers, and ONLY the "Recent verified news" list for news/events. Never invent a price, P&L, volume, market cap, news item, indicator, or event.
When the user asks about news, what's happening, why a stock moved, or wants latest updates/deep research, use the supplied "Recent verified news" list. Every news-based claim must end with (Source Name, DD Mon YYYY), using only supplied source/date values. If evidence is missing, say so.
At the very end of every answer add: Confidence: NN% — <one short reason>
Calibrate confidence to the supplied evidence. If a required datum is missing, say unavailable instead of guessing.
Interpret NSE/BSE symbols correctly. Explain simply and use INR formatting. For trading questions, distinguish observation from inference and mention the main risk/invalidating condition. Do not promise profits or certainty. This is research assistance, not personalized financial advice.
Prefer 4-8 short bullets or a compact paragraph.`;

const NEWS_CACHE_TTL_MS = 5 * 60_000;
const newsBriefCache = new Map<string, { value: string; expiresAt: number }>();
const MAX_CONTEXT_CHARS = 18_000;
const MAX_NEWS_CHARS = 7_000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_MESSAGE_CHARS = 3_000;
const MAX_REPLY_LENGTH = 8_000;
const NEWS_TIMEOUT_MS = 2_500;

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
function clampText(value: string, maxChars: number): string { return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n… (context truncated)`; }
function sanitizeContext(context: Record<string, unknown>): string { try { return clampText(JSON.stringify(context), MAX_CONTEXT_CHARS); } catch { return "{}"; } }

async function fetchNewsBrief(symbol: string): Promise<string> {
  const cached = getCachedNewsBrief(symbol);
  if (cached !== undefined) return cached;
  try {
    const { runResearchContext } = await import("./research-context.server");
    const result = await runResearchContext({ symbol, domains: ["news"], interval: "1d", range: "1y", quarters: 12, years: 10, newsLimit: 8, newsSinceDays: 14 });
    if (!result.ok) { setCachedNewsBrief(symbol, ""); return ""; }
    const items = result.data.evidence.filter((item) => item.domain === "news").sort((a, b) => b.importance - a.importance).slice(0, 8);
    if (!items.length) { setCachedNewsBrief(symbol, ""); return ""; }
    const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
    const brief = items.map((item, index) => {
      const when = item.observedAt ? dateFormatter.format(new Date(item.observedAt)) : "date unknown";
      const headline = item.value.kind === "text" ? item.value.value : item.label;
      const link = item.url ? ` (${item.url})` : "";
      return `${index + 1}. ${headline} — ${item.sourceName}, ${when}${link}`;
    }).join("\n");
    const bounded = clampText(brief, MAX_NEWS_CHARS);
    setCachedNewsBrief(symbol, bounded);
    return bounded;
  } catch { return ""; }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))]);
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const REQUEST_TIMEOUT_MS = 8_000;
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); } finally { clearTimeout(timeout); }
}
function retryDelay(response: Response | null, attempt: number): number {
  const seconds = Number(response?.headers.get("retry-after"));
  const serverDelay = Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 4_000) : 0;
  return Math.max(serverDelay, Math.min(500 * 2 ** attempt, 2_000)) + Math.floor(Math.random() * 250);
}
async function callChatCompletions(baseUrl: string, apiKey: string, payload: Record<string, unknown>): Promise<Response | null> {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify(payload) }, REQUEST_TIMEOUT_MS);
      if (response.ok) return response;
      lastResponse = response;
      if (!RETRYABLE_STATUS.has(response.status) || attempt === 2) return response;
    } catch (error) {
      if (attempt === 2) { if (error instanceof Error && error.name === "AbortError") console.error("AI provider request timed out"); return null; }
    }
    await sleep(retryDelay(lastResponse, attempt));
  }
  return lastResponse;
}
function extractAiContent(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices.length) return null;
  const message = (choices[0] as { message?: unknown })?.message;
  const content = message && typeof message === "object" ? (message as { content?: unknown }).content : null;
  return typeof content === "string" && content.trim() ? content.trim() : null;
}

export const askAi = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => chatInput.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.AI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
    const baseUrl = (process.env.AI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
    const model = process.env.AI_MODEL?.trim() || process.env.OPENAI_MODEL?.trim();
    if (!apiKey || !model) return { mode: "local" as const, content: "" };

    const screenContext = `Current screen context (JSON):\n${sanitizeContext({ symbol: data.symbol, ...data.context })}`;
    const baseSystemMessage = `${SYSTEM_PROMPT}\n\n${screenContext}`;
    const history = data.messages.slice(-MAX_HISTORY_MESSAGES).map((message) => ({ role: message.role, content: clampText(message.content, MAX_HISTORY_MESSAGE_CHARS) }));

    // Start research immediately, but never let slow news research block the AI call.
    const newsPromise = fetchNewsBrief(data.symbol);
    const newsBrief = await withTimeout(newsPromise, NEWS_TIMEOUT_MS);
    const newsContext = newsBrief ? `\n\nRecent verified news for ${data.symbol}:\n${newsBrief}` : "\n\nRecent verified news: unavailable right now. Do not guess news.";

    try {
      const response = await callChatCompletions(baseUrl, apiKey, { model, temperature: 0.2, messages: [{ role: "system", content: `${baseSystemMessage}${newsContext}` }, ...history, { role: "user", content: data.userMessage }] });
      if (!response || !response.ok) { if (response) console.error(`AI provider request failed (${response.status})`); return { mode: "local" as const, content: "" }; }
      let body: unknown;
      try { body = await response.json(); } catch { console.error("AI provider returned a non-JSON response body"); return { mode: "local" as const, content: "" }; }
      const rawContent = extractAiContent(body);
      if (!rawContent) { console.error("AI provider returned an invalid or empty completion"); return { mode: "local" as const, content: "" }; }
      const content = rawContent.length > MAX_REPLY_LENGTH ? `${rawContent.slice(0, MAX_REPLY_LENGTH)}\n\n… (response truncated)` : rawContent;
      return { mode: "ai" as const, content };
    } catch { return { mode: "local" as const, content: "" }; }
  });