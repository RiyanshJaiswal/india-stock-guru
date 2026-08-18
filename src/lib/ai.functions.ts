import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(6000),
});

const chatInput = z.object({
  symbol: z.string().min(1).max(32),
  userMessage: z.string().trim().min(1).max(2000),
  messages: z.array(messageSchema).max(20),
  context: z.record(z.string(), z.unknown()).default({}),
});

const SYSTEM_PROMPT = `You are Dalal Desk AI, a concise Indian stock-market copilot.
Use ONLY the supplied market context for factual numbers, and ONLY the "Recent verified news" list for news/events. Never invent a price, P&L, volume, market cap, news item, indicator, or event.

When the user asks about news, what's happening, why a stock moved, or wants "latest updates" or "deep research", ground your answer in the "Recent verified news" list. Formatting rules for this case:
- Every news-based bullet or claim MUST end with its citation in this exact format: (Source Name, DD Mon YYYY). Use the source and date exactly as given in the "Recent verified news" list — never invent, guess, or omit them.
- If the same fact is unsupported by any item in the list, say so instead of stating it as fact.
- If the list is empty or nothing in it is relevant, say plainly that no recent verified news was found instead of guessing or relying on older training knowledge — do not fabricate a citation to satisfy the format.

At the very end of every answer, on its own line, add a confidence line in this exact format:
Confidence: NN% — <one short reason>
Calibrate NN using the evidence actually used in the answer, not general certainty about the topic:
- 85-100%: multiple verified items, or an official/primary source (company press release, exchange filing, regulator), with clear recent dates.
- 55-84%: verified news items from reputable outlets, but fewer sources, older, or partly indirect.
- 25-54%: only one weak/indirect verified item, or the answer leans partly on general market knowledge beyond the verified list.
- 0-24% (or "N/A"): no relevant verified evidence was found and the answer is general knowledge only, or the question needs live data that wasn't available.

If a required datum is missing, say that it is unavailable instead of guessing.
Interpret NSE/BSE symbols correctly. Explain in simple language and use INR formatting.
For trading questions, distinguish observation from inference and always mention the main risk/invalidating condition.
Do not promise profits or certainty. This is research assistance, not personalized financial advice.
Prefer a useful answer in 4-8 short bullets or a compact paragraph, followed by the Confidence line.`;

const NEWS_CACHE_TTL_MS = 5 * 60_000;
const newsBriefCache = new Map<string, { value: string; expiresAt: number }>();
const MAX_CONTEXT_CHARS = 18_000;
const MAX_NEWS_CHARS = 7_000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_MESSAGE_CHARS = 3_000;
const MAX_REPLY_LENGTH = 8_000;

function getCachedNewsBrief(symbol: string): string | undefined {
  const entry = newsBriefCache.get(symbol);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    newsBriefCache.delete(symbol);
    return undefined;
  }
  return entry.value;
}

function setCachedNewsBrief(symbol: string, value: string): void {
  if (newsBriefCache.size > 200) {
    const keys = [...newsBriefCache.keys()].slice(0, 100);
    for (const key of keys) newsBriefCache.delete(key);
  }
  newsBriefCache.set(symbol, { value, expiresAt: Date.now() + NEWS_CACHE_TTL_MS });
}

function clampText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n… (context truncated)`;
}

function sanitizeContext(context: Record<string, unknown>): string {
  try {
    const serialized = JSON.stringify(context);
    return clampText(serialized, MAX_CONTEXT_CHARS);
  } catch {
    return "{}";
  }
}

async function fetchNewsBrief(symbol: string): Promise<string> {
  const cached = getCachedNewsBrief(symbol);
  if (cached !== undefined) return cached;

  try {
    const { runResearchContext } = await import("./research-context.server");
    const result = await runResearchContext({
      symbol,
      domains: ["news"],
      interval: "1d",
      range: "1y",
      quarters: 12,
      years: 10,
      newsLimit: 8,
      newsSinceDays: 14,
    });
    if (!result.ok) {
      setCachedNewsBrief(symbol, "");
      return "";
    }

    const items = result.data.evidence
      .filter((item) => item.domain === "news")
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 8);
    if (items.length === 0) {
      setCachedNewsBrief(symbol, "");
      return "";
    }

    const dateFormatter = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    });

    const brief = items
      .map((item, index) => {
        const when = item.observedAt ? dateFormatter.format(new Date(item.observedAt)) : "date unknown";
        const headline = item.value.kind === "text" ? item.value.value : item.label;
        const link = item.url ? ` (${item.url})` : "";
        return `${index + 1}. ${headline} — ${item.sourceName}, ${when}${link}`;
      })
      .join("\n");

    const bounded = clampText(brief, MAX_NEWS_CHARS);
    setCachedNewsBrief(symbol, bounded);
    return bounded;
  } catch {
    return "";
  }
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const REQUEST_TIMEOUT_MS = 8_000;

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

function retryDelay(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  const serverDelay = Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 4_000) : 0;
  const exponential = Math.min(500 * 2 ** attempt, 2_000);
  const jitter = Math.floor(Math.random() * 250);
  return Math.max(serverDelay, exponential) + jitter;
}

async function callChatCompletions(
  baseUrl: string,
  apiKey: string,
  payload: Record<string, unknown>,
): Promise<Response | null> {
  const attempts = 3;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        `${baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(payload),
        },
        REQUEST_TIMEOUT_MS,
      );

      if (response.ok) return response;
      lastResponse = response;

      if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts - 1) return response;
    } catch (error) {
      if (attempt === attempts - 1) {
        if (error instanceof Error && error.name === "AbortError") console.error("AI provider request timed out");
        return null;
      }
    }

    await sleep(retryDelay(lastResponse, attempt));
  }

  return lastResponse;
}

function extractAiContent(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!first || typeof first !== "object") return null;
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string") return null;
  const trimmed = content.trim();
  return trimmed || null;
}

export const askAi = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => chatInput.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.AI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
    const baseUrl = (process.env.AI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
    const model = process.env.AI_MODEL?.trim() || process.env.OPENAI_MODEL?.trim();

    if (!apiKey || !model) return { mode: "local" as const, content: "" };

    const newsBrief = await fetchNewsBrief(data.symbol);
    const screenContext = `Current screen context (JSON):\n${sanitizeContext({ symbol: data.symbol, ...data.context })}`;
    const newsContext = newsBrief
      ? `Recent verified news for ${data.symbol} (last 14 days, via Google News / exchange feeds):\n${newsBrief}`
      : `Recent verified news for ${data.symbol}: none found in the last 14 days.`;

    const history = data.messages
      .slice(-MAX_HISTORY_MESSAGES)
      .map((message) => ({
        role: message.role,
        content: clampText(message.content, MAX_HISTORY_MESSAGE_CHARS),
      }));

    const combinedSystemMessage = `${SYSTEM_PROMPT}\n\n${screenContext}\n\n${newsContext}`;

    try {
      const response = await callChatCompletions(baseUrl, apiKey, {
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: combinedSystemMessage },
          ...history,
          { role: "user", content: data.userMessage },
        ],
      });

      if (!response || !response.ok) {
        if (response) console.error(`AI provider request failed (${response.status})`);
        return { mode: "local" as const, content: "" };
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        console.error("AI provider returned a non-JSON response body");
        return { mode: "local" as const, content: "" };
      }

      const rawContent = extractAiContent(body);
      if (!rawContent) {
        console.error("AI provider returned an invalid or empty completion");
        return { mode: "local" as const, content: "" };
      }

      const content = rawContent.length > MAX_REPLY_LENGTH
        ? `${rawContent.slice(0, MAX_REPLY_LENGTH)}\n\n… (response truncated)`
        : rawContent;

      return { mode: "ai" as const, content };
    } catch {
      return { mode: "local" as const, content: "" };
    }
  });