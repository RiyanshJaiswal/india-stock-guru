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
function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function matchesCompany(item: MarketNewsItem, ticker: string, aliases: string[]): boolean {
  const title = normalize(item.headline);
  const itemTickers = item.tickers.map(cleanTicker);
  if (itemTickers.includes(ticker)) return true;
  return aliases.some((alias) => {
    const a = normalize(alias);
    return Boolean(a) && (title === a || title.includes(` ${a} `) || title.startsWith(`${a} `) || title.endsWith(` ${a}`));
  });
}
function toContext(items: MarketNewsItem[]): AiNewsContext[] {
  return items
    .sort((a, b) => (b.impactScore - a.impactScore) || (new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()))
    .slice(0, 12)
    .map(({ headline, source, publishedAt, tickers, sentiment, primaryEventType, impactDirection, impactLevel, impactScore, timeHorizon, confidence, impactReason }) => ({ headline, source, publishedAt, tickers, sentiment, primaryEventType, impactDirection, impactLevel, impactScore, timeHorizon, confidence, impactReason }));
}

async function fetchGoogleNews(symbol: string, aliases: string[]): Promise<MarketNewsItem[]> {
  const query = `${aliases.find((alias) => /[a-z]/i.test(alias)) ?? symbol} stock India`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const response = await fetch(url, { headers: { accept: "application/rss+xml, application/xml, text/xml", "user-agent": "India-Stock-Guru/1.0" }, signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return [];
    const xml = await response.text();
    const blocks = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
    return blocks.map((block, index) => {
      const value = (tag: string) => block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim() ?? "";
      const headline = value("title");
      const publishedAt = value("pubDate");
      const articleUrl = value("link");
      const source = value("source") || "Google News";
      if (!headline || !publishedAt || !articleUrl) return null;
      return { id: `google-news-${symbol}-${index}-${publishedAt}-${headline}`, headline, source, publishedAt, url: articleUrl, tickers: [symbol], sentiment: "neutral", primaryEventType: "general", eventTypes: ["general"], impactDirection: "neutral", impactLevel: "low", impactScore: 1, timeHorizon: "1-5 days", confidence: 45, impactReason: "Stock-specific headline retrieved from a live news feed; directional impact requires AI/evidence analysis." } satisfies MarketNewsItem;
    }).filter((item): item is MarketNewsItem => item !== null);
  } catch { return []; }
}

export const getAiNewsContext = createServerFn({ method: "GET" })
  .inputValidator(inputSchema)
  .handler(async ({ data }): Promise<AiNewsContext[]> => {
    const ticker = cleanTicker(data.symbol);
    const aliases = COMPANY_ALIASES[ticker] ?? [ticker];
    try {
      // Primary path: preserve the existing structured multi-provider news engine.
      const providerResults = await Promise.all(aliases.map((search) => getMarketNews({ data: { limit: 50, search } }).catch(() => [] as MarketNewsItem[])));
      const merged = new Map<string, MarketNewsItem>();
      for (const batch of providerResults) for (const item of batch) {
        if (matchesCompany(item, ticker, aliases)) merged.set(item.id, item);
      }

      // Fallback path: the existing providers can legitimately return zero items
      // because their stock-search window is only ~24h or because a feed omits
      // structured ticker metadata. Google News gives us a current stock-specific
      // RSS feed without introducing another API key or changing the main engine.
      if (merged.size < 3) {
        const fallback = await fetchGoogleNews(ticker, aliases);
        for (const item of fallback) merged.set(item.id, item);
      }

      return toContext([...merged.values()]);
    } catch {
      return toContext(await fetchGoogleNews(ticker, aliases));
    }
  });
