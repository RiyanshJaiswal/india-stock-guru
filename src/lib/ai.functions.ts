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
Return a polished, easy-to-scan research answer in Markdown.
Formatting rules:
- Start with a clear headline using ##.
- Give a 1-3 sentence executive summary immediately below it.
- Use ## for major sections and ### only for sub-sections.
- Use short bullet points; never put an entire answer into one paragraph.
- Bold important metrics, company names, risks and conclusions.
- Keep each bullet concise and readable.
- Add a final section called ## Sources when sources are available.
- In Sources, list each source as a separate bullet with publisher, date and headline/title when available. Use only sources supplied by the application; never invent URLs or citations.
- Clearly distinguish FACT from INFERENCE. Mark inference bullets with *Inference*.
- For news claims, include the supplied source name and date in the sentence where useful.
- If current evidence is unavailable, say so clearly in a short note.
- You may synthesize technical, fundamental and news context supplied by the application.
- For trading questions, mention the main risk or invalidating condition.
- No profit guarantees or certainty about future prices.`;

const NEWS_CACHE_TTL_MS = 5 * 60_000;
const newsBriefCache = new Map<string, { value: string; expiresAt: number }>();
const MAX_CONTEXT_CHARS = 20_000;
const MAX_NEWS_CHARS = 8_000;
const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_MESSAGE_CHARS = 2_000;
const MAX_REPLY_LENGTH = 5_000;
const NEWS_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 25_000;
// Stable model: Google documents this as the 2.5 Flash endpoint and recommends
// specific stable model IDs for production rather than a moving "latest" alias.
const VERIFIED_MODEL = "gemini-2.5-flash";

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
    const result = await runResearchContext({ symbol, domains: ["news"], interval: "1d", range: "7d", quarters: 0, years: 0, newsLimit: 8, newsSinceDays: 7 });
    if (!result.ok) { setCachedNewsBrief(symbol, ""); return ""; }
    const items = result.data.evidence.filter((item) => item.domain === "news").sort((a, b) => b.importance - a.importance).slice(0, 8);
    if (!items.length) { setCachedNewsBrief(symbol, ""); return ""; }
    const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
    const brief = items.map((item, index) => {
      const when = item.observedAt ? dateFormatter.format(new Date(item.observedAt)) : "date unknown";
      const headline = item.value.kind === "text" ? item.value.value : item.label;
      const url = typeof item.url === "string" ? item.url : "";
      return `${index + 1}. ${headline} — ${item.sourceName}, ${when}${url ? ` — ${url}` : ""}`;
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

function extractGeminiContent(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const candidates = (body as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || !candidates.length) return null;
  const first = candidates[0] as { content?: unknown; finishReason?: unknown; text?: unknown };
  if (typeof first.text === "string" && first.text.trim()) return first.text.trim();
  const content = first.content;
  const parts = content && typeof content === "object" ? (content as { parts?: unknown }).parts : null;
  if (!Array.isArray(parts)) return null;
  const text = parts.map((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "").join("").trim();
  return text || null;
}

function buildPrompt(symbol: string, userMessage: string, history: Array<{ role: string; content: string }>, context: Record<string, unknown>, newsContext: string): string {
  return `${SYSTEM_PROMPT}\n\nStock symbol: ${symbol}\n\nCurrent application evidence:\n${sanitizeContext(context)}\n\n${newsContext || "Latest verified news: temporarily unavailable. Do not guess."}\n\nConversation so far:\n${history.map((m) => `${m.role}: ${m.content}`).join("\n")}\n\nUser question:\n${userMessage}`;
}

async function callGeminiNative(apiKey: string, prompt: string): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${VERIFIED_MODEL}:generateContent`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 2200 },
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
      }, REQUEST_TIMEOUT_MS);
      if (response.ok) {
        const json = await response.json();
        const content = extractGeminiContent(json);
        if (!content) console.error("Gemini returned no text content", JSON.stringify(json).slice(0, 1200));
        return content;
      }
      const errorBody = await response.text();
      console.error(`Gemini HTTP ${response.status} for ${VERIFIED_MODEL}: ${errorBody.slice(0, 1200)}`);
      if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 1) return null;
      await sleep(700 * (attempt + 1));
    } catch (error) {
      console.error(`Gemini request error: ${error instanceof Error ? error.message : String(error)}`);
      if (attempt === 1) return null;
      await sleep(700);
    }
  }
  return null;
}

export const askAi = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => chatInput.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) return { mode: "local" as const, content: "## AI Research unavailable\n\nGemini is not configured on the server." };

    const history = data.messages.slice(-MAX_HISTORY_MESSAGES).map((message) => ({ role: message.role, content: clampText(message.content, MAX_HISTORY_MESSAGE_CHARS) }));
    const newsBrief = await withTimeout(fetchLatestNews(data.symbol), NEWS_TIMEOUT_MS);
    const newsContext = newsBrief ? `Latest verified news:\n${newsBrief}` : "Latest verified news: temporarily unavailable.";
    const prompt = buildPrompt(data.symbol, data.userMessage, history, { symbol: data.symbol, ...data.context }, newsContext);
    const content = await callGeminiNative(apiKey, prompt);
    if (content) return { mode: "ai" as const, content: content.length > MAX_REPLY_LENGTH ? `${content.slice(0, MAX_REPLY_LENGTH)}\n\n… (response truncated)` : content };
    return { mode: "local" as const, content: "## AI Research temporarily unavailable\n\nGemini did not return a response. Your live market data is still available." };
  });
