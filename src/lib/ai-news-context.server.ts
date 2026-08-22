import { createServerFn } from "@tanstack/react-start";
import { getMarketNews, type MarketNewsItem } from "./market-news.functions";

export type AiNewsContext = Pick<MarketNewsItem, "headline" | "source" | "publishedAt" | "url" | "tickers" | "sentiment" | "primaryEventType" | "impactDirection" | "impactLevel" | "impactScore" | "timeHorizon" | "confidence" | "impactReason"> & {
  evidenceStatus: "FACT" | "INFERENCE" | "UNKNOWN";
  evidenceBasis: string;
};

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

function evidenceMeta(item: MarketNewsItem): { evidenceStatus: "FACT" | "INFERENCE" | "UNKNOWN"; evidenceBasis: string } {
  const hasSource = typeof item.source === "string" && item.source.trim().length > 0;
  const hasDate = typeof item.publishedAt === "string" && !Number.isNaN(Date.parse(item.publishedAt));
  const hasHeadline = typeof item.headline === "string" && item.headline.trim().length > 0;
  if (hasHeadline && hasSource && hasDate) return { evidenceStatus: "FACT", evidenceBasis: "Headline is directly attributed to a named source with a published timestamp." };
  return { evidenceStatus: "UNKNOWN", evidenceBasis: "Source/date evidence is incomplete; do not treat this item as a verified current fact." };
}

function toContext(items: MarketNewsItem[]): AiNewsContext[] {
  return items
    .sort((a, b) => (b.impactScore - a.impactScore) || (new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()))
    .slice(0, 8)
    .map((item) => ({
      headline: item.headline,
      source: item.source,
      publishedAt: item.publishedAt,
      url: item.url,
      tickers: item.tickers,
      sentiment: item.sentiment,
      primaryEventType: item.primaryEventType,
      impactDirection: item.impactDirection,
      impactLevel: item.impactLevel,
      impactScore: item.impactScore,
      timeHorizon: item.timeHorizon,
      confidence: item.confidence,
      impactReason: item.impactReason,
      ...evidenceMeta(item),
    }));
}

function xmlValue(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match) return "";
  return match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim();
}

function headlineSentiment(headline: string): "positive" | "negative" | "neutral" {
  const positive = /\b(beat|beats|surge|surges|jump|jumps|rise|rises|raised|raises|upgrade|upgraded|strong|growth|profit|order|wins|acquire|acquisition|buyback|dividend|approval|approved|expansion|record|outperform)\b/i.test(headline);
  const negative = /\b(miss|misses|fall|falls|drop|drops|cut|cuts|downgrade|downgraded|weak|loss|losses|probe|investigation|penalty|resign|resignation|default|fraud|delay|decline|declined|warning|suspend|suspended|pledge)\b/i.test(headline);
  if (positive && !negative) return "positive";
  if (negative && !positive) return "negative";
  return "neutral";
}

async function fetchGoogleNewsFallback(aliases: string[], ticker: string): Promise<MarketNewsItem[]> {
  const queries = aliases.filter((alias) => alias.length >= 3 && !/^[A-Z]+$/.test(alias)).slice(0, 3);
  const results = await Promise.all(queries.map(async (alias) => {
    const query = encodeURIComponent(`"${alias}" when:7d`);
    const url = `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch(url, { headers: { accept: "application/rss+xml, application/xml, text/xml", "user-agent": "India-Stock-Guru/1.0" }, signal: controller.signal });
      if (!response.ok) return [] as MarketNewsItem[];
      const xml = await response.text();
      const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
      return blocks.map((block, index): MarketNewsItem | null => {
        const headline = xmlValue(block, "title");
        const publishedAt = xmlValue(block, "pubDate");
        const itemUrl = xmlValue(block, "link");
        const source = xmlValue(block, "source") || "Google News";
        if (!headline || !publishedAt || !itemUrl) return null;
        const normalizedHeadline = headline.toLowerCase();
        const matchesAlias = aliases.some((value) => normalizedHeadline.includes(value.toLowerCase()));
        if (!matchesAlias) return null;
        const sentiment = headlineSentiment(headline);
        const direction = sentiment === "positive" ? "bullish" : sentiment === "negative" ? "bearish" : "neutral";
        return {
          id: `google-news-${ticker}-${index}-${publishedAt}-${headline}`,
          headline,
          source,
          publishedAt,
          url: itemUrl,
          tickers: [ticker],
          sentiment,
          primaryEventType: "general",
          eventTypes: ["general"],
          impactDirection: direction,
          impactLevel: "low",
          impactScore: sentiment === "neutral" ? 35 : 45,
          timeHorizon: "1-5 days",
          confidence: 55,
          impactReason: "Headline-level directional signal; detailed company impact requires source verification.",
        };
      }).filter((item): item is MarketNewsItem => item !== null);
    } catch { return []; }
    finally { clearTimeout(timeout); }
  }));
  const unique = new Map<string, MarketNewsItem>();
  for (const item of results.flat()) unique.set(item.headline.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), item);
  return [...unique.values()];
}

export const getAiNewsContext = createServerFn({ method: "GET" })
  .inputValidator(inputSchema)
  .handler(async ({ data }): Promise<AiNewsContext[]> => {
    const ticker = cleanTicker(data.symbol);
    const aliases = COMPANY_ALIASES[ticker] ?? [ticker];
    try {
      const batches = await Promise.all(aliases.map((search) => getMarketNews({ data: { limit: 50, search } }).catch(() => [] as MarketNewsItem[])));
      const merged = new Map<string, MarketNewsItem>();
      for (const batch of batches) for (const item of batch) {
        const title = item.headline.toLowerCase();
        const matchesTicker = item.tickers.some((value) => cleanTicker(value) === ticker);
        const matchesAlias = aliases.some((alias) => title.includes(alias.toLowerCase()));
        if (matchesTicker || matchesAlias) merged.set(item.id, item);
      }

      // The normal provider pipeline currently has a 24-hour feed window. AI Researcher
      // needs a wider stock-specific window so that a company with no fresh headline does
      // not incorrectly render an empty News & Evidence state. Google News RSS supports
      // stock-specific search queries with a `when:7d` freshness operator.
      if (merged.size < 3) {
        const fallback = await fetchGoogleNewsFallback(aliases, ticker);
        for (const item of fallback) merged.set(item.id, item);
      }

      return toContext([...merged.values()]);
    } catch {
      return [];
    }
  });
