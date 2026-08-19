import { createServerFn } from "@tanstack/react-start";
import { getMarketNews, type MarketNewsItem } from "./market-news.functions";

export type AiNewsContext = Pick<MarketNewsItem, "headline" | "source" | "publishedAt" | "tickers" | "sentiment" | "primaryEventType" | "impactDirection" | "impactLevel" | "impactScore" | "timeHorizon" | "confidence" | "impactReason">;

const inputSchema = (data: unknown): { symbol: string } => {
  if (!data || typeof data !== "object" || typeof (data as { symbol?: unknown }).symbol !== "string") {
    throw new Error("Invalid AI news context request");
  }
  const symbol = (data as { symbol: string }).symbol.trim();
  if (!symbol || symbol.length > 32) throw new Error("Invalid stock symbol");
  return { symbol };
};

/** Returns the structured Market News impact signals for the active stock. */
export const getAiNewsContext = createServerFn({ method: "GET" })
  .inputValidator(inputSchema)
  .handler(async ({ data }): Promise<AiNewsContext[]> => {
    const ticker = data.symbol.replace(/\.(NS|BO)$/i, "").toUpperCase();
    if (!ticker) return [];
    try {
      const items = await getMarketNews({ data: { limit: 50, search: "" } });
      return items
        .filter((item) => item.tickers.some((value) => value.toUpperCase() === ticker))
        .sort((a, b) => {
          const score = b.impactScore - a.impactScore;
          return score !== 0 ? score : new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
        })
        .slice(0, 6)
        .map(({ headline, source, publishedAt, tickers, sentiment, primaryEventType, impactDirection, impactLevel, impactScore, timeHorizon, confidence, impactReason }) => ({
          headline,
          source,
          publishedAt,
          tickers,
          sentiment,
          primaryEventType,
          impactDirection,
          impactLevel,
          impactScore,
          timeHorizon,
          confidence,
          impactReason,
        }));
    } catch {
      return [];
    }
  });
