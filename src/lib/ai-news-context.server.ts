import { getMarketNews, type MarketNewsItem } from "./market-news.functions";

export type AiNewsContext = Pick<MarketNewsItem, "headline" | "source" | "publishedAt" | "tickers" | "sentiment" | "primaryEventType" | "impactDirection" | "impactLevel" | "impactScore" | "timeHorizon" | "confidence" | "impactReason">;

/**
 * Returns the same structured news-impact signals shown on Market News,
 * filtered to the active stock. This keeps the AI assistant grounded in the
 * app's existing news engine instead of creating a second, inconsistent model.
 */
export async function getAiNewsContext(symbol: string): Promise<AiNewsContext[]> {
  const ticker = symbol.replace(/\.(NS|BO)$/i, "").toUpperCase();
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
}
