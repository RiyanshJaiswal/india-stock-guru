import { createServerFn } from "@tanstack/react-start";
import { getMarketNews, type MarketNewsItem } from "./market-news.functions";

export type AiNewsContext = Pick<MarketNewsItem, "headline" | "source" | "publishedAt" | "tickers" | "sentiment" | "primaryEventType" | "impactDirection" | "impactLevel" | "impactScore" | "timeHorizon" | "confidence" | "impactReason">;

const inputSchema = (data: unknown): { symbol: string } => {
  if (!data || typeof data !== "object" || typeof (data as { symbol?: unknown }).symbol !== "string") throw new Error("Invalid AI news context request");
  const symbol = (data as { symbol: string }).symbol.trim();
  if (!symbol || symbol.length > 32) throw new Error("Invalid stock symbol");
  return { symbol };
};

const COMPANY_ALIASES: Record<string, string[]> = {
  RELIANCE: ["RELIANCE", "Reliance Industries"], TCS: ["TCS", "Tata Consultancy Services"], INFY: ["INFY", "Infosys"], HDFCBANK: ["HDFCBANK", "HDFC Bank"], ICICIBANK: ["ICICIBANK", "ICICI Bank"], SBIN: ["SBIN", "State Bank of India", "SBI"], BHARTIARTL: ["BHARTIARTL", "Bharti Airtel", "Airtel"], ITC: ["ITC"], LT: ["LT", "Larsen & Toubro", "L&T"], ADANIENT: ["ADANIENT", "Adani Enterprises"], ADANIPORTS: ["ADANIPORTS", "Adani Ports"], TATAMOTORS: ["TATAMOTORS", "Tata Motors"], TATASTEEL: ["TATASTEEL", "Tata Steel"], TATAPOWER: ["TATAPOWER", "Tata Power"], MARUTI: ["MARUTI", "Maruti Suzuki"], SUNPHARMA: ["SUNPHARMA", "Sun Pharma"], ASIANPAINT: ["ASIANPAINT", "Asian Paints"], BAJFINANCE: ["BAJFINANCE", "Bajaj Finance"], KOTAKBANK: ["KOTAKBANK", "Kotak Mahindra Bank"], AXISBANK: ["AXISBANK", "Axis Bank"], WIPRO: ["WIPRO"], HCLTECH: ["HCLTECH", "HCL Technologies"], ONGC: ["ONGC"], NTPC: ["NTPC"], POWERGRID: ["POWERGRID", "Power Grid"], HINDALCO: ["HINDALCO"], JSWSTEEL: ["JSWSTEEL", "JSW Steel"], NESTLEIND: ["NESTLEIND", "Nestle India"], ETERNAL: ["ETERNAL", "Eternal"],
};

function cleanTicker(symbol: string): string { return symbol.replace(/\.(NS|BO)$/i, "").toUpperCase(); }
function toContext(items: MarketNewsItem[]): AiNewsContext[] {
  return items.sort((a, b) => (b.impactScore - a.impactScore) || (new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())).slice(0, 8).map(({ headline, source, publishedAt, tickers, sentiment, primaryEventType, impactDirection, impactLevel, impactScore, timeHorizon, confidence, impactReason }) => ({ headline, source, publishedAt, tickers, sentiment, primaryEventType, impactDirection, impactLevel, impactScore, timeHorizon, confidence, impactReason }));
}

export const getAiNewsContext = createServerFn({ method: "GET" })
  .inputValidator(inputSchema)
  .handler(async ({ data }): Promise<AiNewsContext[]> => {
    const ticker = cleanTicker(data.symbol);
    const aliases = COMPANY_ALIASES[ticker] ?? [ticker];
    try {
      const results = await Promise.all(aliases.map((search) => getMarketNews({ data: { limit: 50, search } }).catch(() => [] as MarketNewsItem[])));
      const merged = new Map<string, MarketNewsItem>();
      for (const batch of results) for (const item of batch) {
        const title = item.headline.toLowerCase();
        const matchesTicker = item.tickers.some((value) => cleanTicker(value) === ticker);
        const matchesAlias = aliases.some((alias) => title.includes(alias.toLowerCase()));
        if (matchesTicker || matchesAlias) merged.set(item.id, item);
      }
      return toContext([...merged.values()]);
    } catch { return []; }
  });
