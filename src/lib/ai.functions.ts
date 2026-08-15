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
When the user asks about news, what's happening, why a stock moved, or wants "latest updates" or "deep research", ground your answer in the "Recent verified news" list: summarise the relevant headlines, name the source and how recent each one is, and note if they seem to explain the recent price move. If that list is empty or nothing in it is relevant to the question, say plainly that no recent verified news was found instead of guessing or relying on older training knowledge.
If a required datum is missing, say that it is unavailable instead of guessing.
Interpret NSE/BSE symbols correctly. Explain in simple language and use INR formatting.
For trading questions, distinguish observation from inference and always mention the main risk/invalidating condition.
Do not promise profits or certainty. This is research assistance, not personalized financial advice.
Prefer a useful answer in 4-8 short bullets or a compact paragraph.`;

/**
 * Pulls a short, source-attributed news brief for the symbol using the
 * existing news research pipeline (Google News RSS + exchange/IR adapters,
 * see research-context.server.ts). This runs on every chat turn so the AI
 * always has real, dated, linkable news to ground its answer in — it never
 * has to invent headlines.
 */
async function fetchNewsBrief(symbol: string): Promise<string> {
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
    if (!result.ok) return "";

    const items = result.data.evidence
      .filter((item) => item.domain === "news")
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 8);
    if (items.length === 0) return "";

    return items
      .map((item, index) => {
        const when = item.observedAt ? new Date(item.observedAt).toISOString().slice(0, 10) : "date unknown";
        const headline = item.value.kind === "text" ? item.value.value : item.label;
        const link = item.url ? ` (${item.url})` : "";
        return `${index + 1}. ${headline} — ${item.sourceName}, ${when}${link}`;
      })
      .join("\n");
  } catch {
    // News lookup is best-effort. If it fails, the AI still has quote and
    // portfolio context from the screen and will say news is unavailable.
    return "";
  }
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Gemini (and other providers) return 503 "model overloaded" fairly often
 * under free-tier/high-demand conditions — this is a transient, server-side
 * capacity issue, not a bad request. Retry a couple of times with backoff
 * before giving up and falling back to the local reply.
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
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) return response;
      lastResponse = response;

      if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts - 1) {
        return response;
      }
    } catch {
      if (attempt === attempts - 1) return null;
    }

    // Backoff: ~500ms, ~1200ms before the next attempt.
    await sleep(500 + attempt * 700);
  }

  return lastResponse;
}

export const askAi = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => chatInput.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY;
    const baseUrl = (process.env.AI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const model = process.env.AI_MODEL ?? process.env.OPENAI_MODEL;

    if (!apiKey || !model) return { mode: "local" as const, content: "" };

    const newsBrief = await fetchNewsBrief(data.symbol);

    try {
      const response = await callChatCompletions(baseUrl, apiKey, {
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "system",
            content: `Current screen context (JSON):\n${JSON.stringify({ symbol: data.symbol, ...data.context })}`,
          },
          {
            role: "system",
            content: newsBrief
              ? `Recent verified news for ${data.symbol} (last 14 days, via Google News / exchange feeds):\n${newsBrief}`
              : `Recent verified news for ${data.symbol}: none found in the last 14 days.`,
          },
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

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content?.trim();
      return content ? { mode: "ai" as const, content } : { mode: "local" as const, content: "" };
    } catch {
      return { mode: "local" as const, content: "" };
    }
  });