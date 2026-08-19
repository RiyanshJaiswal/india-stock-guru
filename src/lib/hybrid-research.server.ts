import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getMarketNews, type MarketNewsItem } from "./market-news.functions";
import { runResearchContext } from "./research-context.server";
import type { ResearchEvidence } from "./research-types";

const inputSchema = z.object({ symbol: z.string().trim().min(1).max(32) });
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_EVIDENCE = 42;

type HybridAiReport = {
  executiveSummary: string;
  newsView: string;
  technicalView: string;
  fundamentalView: string;
  hybridVerdict: string;
  actionFramework: string;
  hiddenInsights: string[];
  risks: string[];
  watchLevels: string[];
  confidence: number;
};

export type HybridResearchResult = {
  ok: boolean;
  symbol: string;
  context: ReturnType<typeof buildClientContext>;
  marketNews: Pick<MarketNewsItem, "headline" | "source" | "publishedAt" | "tickers" | "sentiment" | "primaryEventType" | "impactDirection" | "impactLevel" | "impactScore" | "timeHorizon" | "confidence" | "impactReason" | "url">>[];
  ai: HybridAiReport | null;
  error?: string;
};

function valueOf(evidence: ResearchEvidence): unknown {
  return evidence.value.kind === "number" || evidence.value.kind === "text" || evidence.value.kind === "boolean"
    ? evidence.value.value
    : null;
}

function buildClientContext(context: Awaited<ReturnType<typeof runResearchContext>> extends infer R
  ? R extends { ok: true; data: infer D } ? D : never
  : never) {
  const evidence = context.evidence
    .sort((a, b) => b.importance - a.importance)
    .slice(0, MAX_EVIDENCE)
    .map((item) => ({
      key: item.key,
      domain: item.domain,
      label: item.label,
      value: valueOf(item),
      unit: item.value.kind === "number" ? item.value.unit : "none",
      direction: item.direction,
      importance: item.importance,
      reliability: Math.round(item.reliability * 100),
      source: item.sourceName,
      observedAt: item.observedAt,
      note: item.note,
    }));

  return {
    symbol: context.symbol,
    ticker: context.ticker,
    exchange: context.exchange,
    companyName: context.companyName,
    currency: context.currency,
    builtAt: context.builtAt,
    quality: context.quality,
    coverage: context.coverage,
    conflicts: context.conflicts,
    gaps: context.gaps,
    evidence,
  };
}

function fallbackReport(evidence: ReturnType<typeof buildClientContext>["evidence"]): HybridAiReport {
  const find = (key: string) => evidence.find((item) => item.key === key)?.value;
  const trend = String(find("technical.trend") ?? "sideways");
  const rsi = find("technical.rsi");
  const ema50 = find("technical.ema50");
  const ema200 = find("technical.ema200");
  const support = String(find("technical.support") ?? "not available");
  const resistance = String(find("technical.resistance") ?? "not available");
  const news = evidence.filter((item) => item.domain === "news").slice(0, 3);
  const newsDirection = news.some((item) => item.direction === "bullish") ? "positive" : news.some((item) => item.direction === "bearish") ? "negative" : "mixed/neutral";
  return {
    executiveSummary: `Current evidence is ${newsDirection} on news with a ${trend} technical structure. Treat the setup as evidence-led research rather than a guaranteed price prediction.`,
    newsView: news.length ? `Recent news evidence is ${newsDirection}; verify the underlying filing/headline before acting.` : "No sufficiently recent stock-specific news evidence is available.",
    technicalView: `Trend: ${trend}. RSI: ${rsi ?? "unavailable"}. EMA 50: ${ema50 ?? "unavailable"}; EMA 200: ${ema200 ?? "unavailable"}.`,
    fundamentalView: "Fundamental evidence was collected where available; use the detailed metrics below for valuation, profitability, growth and leverage context.",
    hybridVerdict: "Use confirmation from both news and technical structure; conflicting signals call for caution.",
    actionFramework: `Watch support ${support} and resistance ${resistance}; avoid chasing a move when momentum is stretched.`,
    hiddenInsights: ["Compare the direction of fresh news with the technical trend before interpreting the move."],
    risks: ["Data gaps, delayed provider updates and conflicting signals can reduce confidence.", "Technical levels are dynamic and can fail during material news events."],
    watchLevels: [support !== "not available" ? `Support: ${support}` : "Support: unavailable", resistance !== "not available" ? `Resistance: ${resistance}` : "Resistance: unavailable"],
    confidence: 55,
  };
}

function extractJson(text: string): HybridAiReport | null {
  try {
    const parsed = JSON.parse(text) as Partial<HybridAiReport>;
    if (typeof parsed.executiveSummary !== "string" || typeof parsed.hybridVerdict !== "string") return null;
    return {
      executiveSummary: parsed.executiveSummary,
      newsView: parsed.newsView ?? "",
      technicalView: parsed.technicalView ?? "",
      fundamentalView: parsed.fundamentalView ?? "",
      hybridVerdict: parsed.hybridVerdict,
      actionFramework: parsed.actionFramework ?? "",
      hiddenInsights: Array.isArray(parsed.hiddenInsights) ? parsed.hiddenInsights.filter((v): v is string => typeof v === "string").slice(0, 4) : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks.filter((v): v is string => typeof v === "string").slice(0, 5) : [],
      watchLevels: Array.isArray(parsed.watchLevels) ? parsed.watchLevels.filter((v): v is string => typeof v === "string").slice(0, 6) : [],
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
    };
  } catch {
    return null;
  }
}

async function callHybridAi(symbol: string, context: ReturnType<typeof buildClientContext>, marketNews: HybridResearchResult["marketNews"]): Promise<HybridAiReport | null> {
  const apiKey = process.env.AI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  const baseUrl = (process.env.AI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.AI_MODEL?.trim() || process.env.OPENAI_MODEL?.trim();
  if (!apiKey || !model) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const prompt = `You are an Indian stock-market research analyst. Combine the supplied quantitative evidence and qualitative news into one balanced hybrid research report for ${symbol}.

Hard rules:
- Use ONLY supplied evidence. Never invent a number, event, price target or company fact.
- Explicitly reconcile news direction with technical trend/momentum. If they conflict, say so.
- Treat RSI >70 as potentially overbought and <30 as potentially oversold, but do not treat either as a standalone signal.
- Compare price with EMA20/50/200, MACD, ADX, Supertrend, VWAP and support/resistance when available.
- Use fundamentals for valuation, profitability, growth and leverage context when supplied.
- Identify 1-3 non-obvious insights from the evidence.
- Give a research/action framework using confirmation, support/resistance and risk controls; do not promise returns or certainty.
- Confidence must reflect evidence quality, freshness and conflicts.
- Return ONLY valid JSON with exactly these keys: executiveSummary, newsView, technicalView, fundamentalView, hybridVerdict, actionFramework, hiddenInsights, risks, watchLevels, confidence.
- hiddenInsights, risks and watchLevels must be arrays of short strings. confidence must be an integer 0-100.

EVIDENCE QUALITY:
${JSON.stringify(context.quality)}

RESEARCH EVIDENCE:
${JSON.stringify(context.evidence)}

MARKET NEWS IMPACT ENGINE:
${JSON.stringify(marketNews)}

GAPS / CONFLICTS:
${JSON.stringify({ gaps: context.gaps, conflicts: context.conflicts })}`;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: 0.1, max_tokens: 1400, response_format: { type: "json_object" }, messages: [{ role: "system", content: "Return reliable structured financial research JSON." }, { role: "user", content: prompt }] }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = body.choices?.[0]?.message?.content;
    return typeof content === "string" ? extractJson(content) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export const getHybridResearch = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }): Promise<HybridResearchResult> => {
    const symbol = data.symbol.toUpperCase().endsWith(".NS") || data.symbol.toUpperCase().endsWith(".BO") ? data.symbol.toUpperCase() : `${data.symbol.toUpperCase()}.NS`;
    try {
      const [researchResult, newsResult] = await Promise.all([
        runResearchContext({ symbol, domains: ["market", "technical", "fundamental", "news"], interval: "1d", range: "6mo", quarters: 4, years: 3, newsLimit: 8, newsSinceDays: 7 }),
        getMarketNews({ data: { limit: 50, search: "" } }),
      ]);
      if (!researchResult.ok) return { ok: false, symbol, context: { symbol, ticker: symbol.replace(/\.(NS|BO)$/i, ""), exchange: "NSE", companyName: null, currency: "INR", builtAt: new Date().toISOString(), quality: null, coverage: researchResult.error.coverage, conflicts: [], gaps: [], evidence: [] }, marketNews: [], ai: null, error: researchResult.error.message };

      const context = buildClientContext(researchResult.data);
      const ticker = context.ticker.toUpperCase();
      const marketNews = newsResult.filter((item) => item.tickers.some((value) => value.toUpperCase() === ticker)).slice(0, 8).map(({ headline, source, publishedAt, tickers, sentiment, primaryEventType, impactDirection, impactLevel, impactScore, timeHorizon, confidence, impactReason, url }) => ({ headline, source, publishedAt, tickers, sentiment, primaryEventType, impactDirection, impactLevel, impactScore, timeHorizon, confidence, impactReason, url }));
      const ai = (await callHybridAi(symbol, context, marketNews)) ?? fallbackReport(context.evidence);
      return { ok: true, symbol, context, marketNews, ai };
    } catch (error) {
      return { ok: false, symbol, context: { symbol, ticker: symbol.replace(/\.(NS|BO)$/i, ""), exchange: "NSE", companyName: null, currency: "INR", builtAt: new Date().toISOString(), quality: null, coverage: [], conflicts: [], gaps: [], evidence: [] }, marketNews: [], ai: null, error: error instanceof Error ? error.message : "Hybrid research failed." };
    }
  });
