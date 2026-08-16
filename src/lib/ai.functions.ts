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

// --- News brief (with a short in-memory cache) -----------------------------
//
// RSS/news lookups are relatively slow and the same symbol is often asked
// about repeatedly within a short window (follow-up questions in the same
// chat, multiple users looking at the same stock, etc). Caching for a few
// minutes cuts latency and load on the news pipeline without meaningfully
// hurting freshness — news moves in hours, not seconds.
const NEWS_CACHE_TTL_MS = 5 * 60_000;
const newsBriefCache = new Map<string, { value: string; expiresAt: number }>();

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
  // Simple unbounded-growth guard: if the cache gets unexpectedly large
  // (e.g. many distinct symbols over a long-running dev/prod process),
  // drop the oldest half rather than growing forever.
  if (newsBriefCache.size > 200) {
    const keys = [...newsBriefCache.keys()].slice(0, 100);
    for (const key of keys) newsBriefCache.delete(key);
  }
  newsBriefCache.set(symbol, { value, expiresAt: Date.now() + NEWS_CACHE_TTL_MS });
}

/**
 * Pulls a short, source-attributed news brief for the symbol using the
 * existing news research pipeline (Google News RSS + exchange/IR adapters,
 * see research-context.server.ts). This runs on every chat turn so the AI
 * always has real, dated, linkable news to ground its answer in — it never
 * has to invent headlines.
 */
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
        // Kept as "Source, DD Mon YYYY" so the model can copy this exact
        // "(Source, date)" pair into its citation per the system prompt.
        return `${index + 1}. ${headline} — ${item.sourceName}, ${when}${link}`;
      })
      .join("\n");

    setCachedNewsBrief(symbol, brief);
    return brief;
  } catch {
    // News lookup is best-effort. If it fails, the AI still has quote and
    // portfolio context from the screen and will say news is unavailable.
    // Deliberately NOT cached — a transient failure shouldn't lock the
    // symbol out of news for the full TTL; the next turn can retry.
    return "";
  }
}

// --- Chat completion call, with timeout + retry -----------------------------

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const REQUEST_TIMEOUT_MS = 20_000;

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

/**
 * Gemini (and other providers) return 503 "model overloaded" fairly often
 * under free-tier/high-demand conditions — this is a transient, server-side
 * capacity issue, not a bad request. Retry a couple of times with backoff
 * before giving up and falling back to the local reply. Each attempt also
 * has its own timeout so a hung connection can't stall the whole request
 * (and can't eat the retry budget waiting forever on one attempt).
 */
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

      if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts - 1) {
        return response;
      }
    } catch (error) {
      // Includes network errors and our own timeout abort.
      if (attempt === attempts - 1) {
        if (error instanceof Error && error.name === "AbortError") {
          console.error("AI provider request timed out");
        }
        return null;
      }
    }

    // Backoff: ~500ms, ~1200ms before the next attempt.
    await sleep(500 + attempt * 700);
  }

  return lastResponse;
}

const MAX_REPLY_LENGTH = 8_000;

export const askAi = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => chatInput.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.AI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
    const baseUrl = (process.env.AI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
    const model = process.env.AI_MODEL?.trim() || process.env.OPENAI_MODEL?.trim();

    if (!apiKey || !model) return { mode: "local" as const, content: "" };

    const newsBrief = await fetchNewsBrief(data.symbol);
    const screenContext = `Current screen context (JSON):\n${JSON.stringify({ symbol: data.symbol, ...data.context })}`;
    const newsContext = newsBrief
      ? `Recent verified news for ${data.symbol} (last 14 days, via Google News / exchange feeds):\n${newsBrief}`
      : `Recent verified news for ${data.symbol}: none found in the last 14 days.`;

    // Some OpenAI-compatible providers (Gemini's compat layer included) do
    // not reliably honor multiple separate `system` role messages. Combine
    // everything into one system message to avoid that class of bug.
    const combinedSystemMessage = `${SYSTEM_PROMPT}\n\n${screenContext}\n\n${newsContext}`;

    try {
      const response = await callChatCompletions(baseUrl, apiKey, {
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: combinedSystemMessage },
          ...data.messages,
          { role: "user", content: data.userMessage },
        ],
      });

      if (!response || !response.ok) {
        if (response) {
          console.error(`AI provider request failed (${response.status})`);
        }
        return { mode: "local" as const, content: "" };
      }

      let body: { choices?: Array<{ message?: { content?: string } }> };
      try {
        body = await response.json();
      } catch {
        console.error("AI provider returned a non-JSON response body");
        return { mode: "local" as const, content: "" };
      }

      const rawContent = body.choices?.[0]?.message?.content?.trim();
      if (!rawContent) return { mode: "local" as const, content: "" };

      // Defensive cap: an unexpectedly huge reply (bad provider response, a
      // degenerate generation, etc.) shouldn't get rendered as-is.
      const content =
        rawContent.length > MAX_REPLY_LENGTH
          ? `${rawContent.slice(0, MAX_REPLY_LENGTH)}\n\n… (response truncated)`
          : rawContent;

      return { mode: "ai" as const, content };
    } catch {
      return { mode: "local" as const, content: "" };
    }
  });