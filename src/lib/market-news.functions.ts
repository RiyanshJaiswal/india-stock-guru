import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const MARKET_AUX_URL = "https://api.marketaux.com/v1/news/all";
const NEWS_API_URL = "https://newsapi.org/v2/everything";
const GNEWS_URL = "https://gnews.io/api/v4/search";

const INDIAN_STOCK_NEWS_FEEDS: Record<string, string> = {
  "Moneycontrol Top": "https://www.moneycontrol.com/rss/MCtopnews.xml",
  "Moneycontrol Markets": "https://www.moneycontrol.com/rss/results.xml",
  "Economic Times Markets": "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
  "Economic Times Companies": "https://economictimes.indiatimes.com/news/company/rssfeeds/2143429.cms",
  "Livemint Markets": "https://www.livemint.com/rss/markets",
  "Business Standard": "https://www.business-standard.com/rss/markets-106.rss",
  "Financial Express": "https://www.financialexpress.com/market/feed/",
  "Zee Business": "https://www.zeebiz.com/markets/rss",
  "CNBC TV18": "https://www.cnbctv18.com/common/rss/market.xml",
  "NDTV Profit": "https://www.ndtvprofit.com/feeds/latest.rss",
  "Investing.com India": "https://in.investing.com/rss/news_25.rss",
  "Google News Indian Market": "https://news.google.com/rss/search?q=indian+stock+market&hl=en-IN&gl=IN&ceid=IN:en",
};

const newsInput = z.object({
  limit: z.number().int().min(1).max(50).default(6),
  search: z.string().trim().max(100).optional().default(""),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const NEWS_CACHE_TTL_MS = 30_000;
const NEWS_TIMEOUT_MS = 4_000;

export type MarketNewsItem = {
  id: string;
  headline: string;
  source: string;
  publishedAt: string;
  url: string;
  tickers: string[];
  sentiment: "positive" | "negative" | "neutral";
};

type MarketauxEntity = { symbol?: unknown; sentiment_score?: unknown };
type MarketauxArticle = { uuid?: unknown; title?: unknown; source?: unknown; published_at?: unknown; url?: unknown; entities?: unknown };
type MarketauxResponse = { data?: unknown };
type NewsApiArticle = { title?: unknown; source?: { name?: unknown } | null; publishedAt?: unknown; url?: unknown };
type NewsApiResponse = { articles?: unknown };
type GNewsArticle = { title?: unknown; source?: { name?: unknown } | null; publishedAt?: unknown; url?: unknown };
type GNewsResponse = { articles?: unknown };

const newsCache = new Map<string, { value: MarketNewsItem[]; expiresAt: number }>();
const inFlightNews = new Map<string, Promise<MarketNewsItem[]>>();

function sentimentFor(entities: unknown): MarketNewsItem["sentiment"] {
  if (!Array.isArray(entities)) return "neutral";
  const scores = entities.map((entity) => Number((entity as MarketauxEntity).sentiment_score)).filter(Number.isFinite);
  if (!scores.length) return "neutral";
  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  if (average > 0.1) return "positive";
  if (average < -0.1) return "negative";
  return "neutral";
}

function tickersFor(entities: unknown): string[] {
  if (!Array.isArray(entities)) return [];
  return [...new Set(entities.map((entity) => String((entity as MarketauxEntity).symbol ?? "").trim()).filter(Boolean).map((symbol) => symbol.replace(/\.NS$|\.BO$/i, "")))].slice(0, 5);
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isValidArticle(item: MarketNewsItem): boolean {
  return Boolean(item.headline && item.publishedAt && item.url);
}

function escapeXml(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function tagValue(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? escapeXml(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1").trim()) : "";
}

function parseFeed(xml: string, source: string): MarketNewsItem[] {
  const blocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) ?? [];
  return blocks.map((block, index) => {
    const headline = tagValue(block, "title");
    const publishedAt = tagValue(block, "pubDate") || tagValue(block, "published") || tagValue(block, "updated");
    let url = tagValue(block, "link");
    if (!url) {
      const href = block.match(/<link[^>]+href=["']([^"']+)["']/i);
      url = href?.[1] ?? "";
    }
    return {
      id: `rss-${source}-${index}-${publishedAt}-${headline}`,
      headline,
      source,
      publishedAt,
      url,
      tickers: [],
      sentiment: "neutral" as const,
    };
  }).filter(isValidArticle);
}

function dayBoundsUtc(date?: string): { after?: string; before?: string } {
  if (!date) return {};
  // User-facing news days are India (IST) calendar days; API timestamps are UTC.
  const start = new Date(`${date}T00:00:00+05:30`);
  const end = new Date(`${date}T23:59:59.999+05:30`);
  return { after: start.toISOString(), before: end.toISOString() };
}

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NEWS_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/rss+xml, application/xml, text/xml, application/json", "user-agent": "India-Stock-Guru/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NEWS_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function searchTerms(search: string): string {
  return search ? `"${search.replace(/"/g, "")}"` : "Indian stock market";
}

async function fetchMarketauxNews(limit: number, search: string, date?: string): Promise<MarketNewsItem[]> {
  const apiToken = process.env.MARKETAUX_API_TOKEN?.trim();
  if (!apiToken) return [];
  const bounds = dayBoundsUtc(date);
  const params = new URLSearchParams({ api_token: apiToken, countries: "in", language: "en", filter_entities: "true", must_have_entities: "true", sort: "published_at", limit: String(Math.min(Math.max(limit, 10), 50)) });
  if (search) params.set("search", search);
  if (bounds.after) params.set("published_after", bounds.after);
  if (bounds.before) params.set("published_before", bounds.before);
  if (!date) params.set("published_after", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  const body = (await fetchJson(`${MARKET_AUX_URL}?${params}`)) as MarketauxResponse | null;
  if (!body || !Array.isArray(body.data)) return [];
  return body.data.map((raw): MarketNewsItem | null => {
    const article = raw as MarketauxArticle;
    const headline = typeof article.title === "string" ? article.title.trim() : "";
    const publishedAt = typeof article.published_at === "string" ? article.published_at : "";
    const url = typeof article.url === "string" ? article.url : "";
    if (!headline || !publishedAt || !url) return null;
    return { id: typeof article.uuid === "string" ? article.uuid : `${publishedAt}-${headline}`, headline, source: typeof article.source === "string" ? article.source : "Marketaux", publishedAt, url, tickers: tickersFor(article.entities), sentiment: sentimentFor(article.entities) };
  }).filter((item): item is MarketNewsItem => item !== null);
}

async function fetchNewsApiNews(limit: number, search: string, date?: string): Promise<MarketNewsItem[]> {
  const apiToken = process.env.NEWSAPI_API_KEY?.trim();
  if (!apiToken) return [];
  const bounds = dayBoundsUtc(date);
  const params = new URLSearchParams({ q: searchTerms(search), searchIn: search ? "title,description" : "title,description,content", language: "en", sortBy: "publishedAt", pageSize: String(Math.min(Math.max(limit, 10), 50)), apiKey: apiToken });
  if (bounds.after) params.set("from", bounds.after);
  if (bounds.before) params.set("to", bounds.before);
  if (!date) params.set("from", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  const body = (await fetchJson(`${NEWS_API_URL}?${params}`)) as NewsApiResponse | null;
  if (!body || !Array.isArray(body.articles)) return [];
  return body.articles.map((raw): MarketNewsItem | null => {
    const article = raw as NewsApiArticle;
    const headline = typeof article.title === "string" ? article.title.trim() : "";
    const publishedAt = typeof article.publishedAt === "string" ? article.publishedAt : "";
    const url = typeof article.url === "string" ? article.url : "";
    const source = typeof article.source?.name === "string" ? article.source.name : "NewsAPI";
    if (!headline || !publishedAt || !url) return null;
    return { id: `newsapi-${url}`, headline, source, publishedAt, url, tickers: [], sentiment: "neutral" };
  }).filter((item): item is MarketNewsItem => item !== null);
}

async function fetchGNews(limit: number, search: string, date?: string): Promise<MarketNewsItem[]> {
  const apiToken = process.env.GNEWS_API_KEY?.trim();
  if (!apiToken) return [];
  const bounds = dayBoundsUtc(date);
  const params = new URLSearchParams({ q: searchTerms(search), country: "in", lang: "en", max: String(Math.min(Math.max(limit, 10), 10)), apikey: apiToken });
  if (bounds.after) params.set("from", bounds.after);
  if (bounds.before) params.set("to", bounds.before);
  if (!date) params.set("from", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  const body = (await fetchJson(`${GNEWS_URL}?${params}`)) as GNewsResponse | null;
  if (!body || !Array.isArray(body.articles)) return [];
  return body.articles.map((raw): MarketNewsItem | null => {
    const article = raw as GNewsArticle;
    const headline = typeof article.title === "string" ? article.title.trim() : "";
    const publishedAt = typeof article.publishedAt === "string" ? article.publishedAt : "";
    const url = typeof article.url === "string" ? article.url : "";
    const source = typeof article.source?.name === "string" ? article.source.name : "GNews";
    if (!headline || !publishedAt || !url) return null;
    return { id: `gnews-${url}`, headline, source, publishedAt, url, tickers: [], sentiment: "neutral" };
  }).filter((item): item is MarketNewsItem => item !== null);
}

async function fetchAllRssNews(search: string, date?: string): Promise<MarketNewsItem[]> {
  const feeds = await Promise.all(Object.entries(INDIAN_STOCK_NEWS_FEEDS).map(async ([source, url]) => {
    const xml = await fetchText(url);
    return xml ? parseFeed(xml, source) : [];
  }));
  const bounds = dayBoundsUtc(date);
  const after = bounds.after ? new Date(bounds.after).getTime() : Date.now() - 24 * 60 * 60 * 1000;
  const before = bounds.before ? new Date(bounds.before).getTime() : Date.now();
  const needle = search.toLowerCase();
  return feeds.flat().filter((item) => {
    const time = new Date(item.publishedAt).getTime();
    const inRange = Number.isFinite(time) && time >= after && time <= before;
    const matches = !needle || item.headline.toLowerCase().includes(needle);
    return inRange && matches;
  });
}

async function fetchCombinedIndianStockNews(limit: number, search: string, date?: string): Promise<MarketNewsItem[]> {
  const [marketaux, newsApi, gnews, rss] = await Promise.all([
    fetchMarketauxNews(limit, search, date),
    fetchNewsApiNews(limit, search, date),
    fetchGNews(limit, search, date),
    fetchAllRssNews(search, date),
  ]);
  const merged = [...marketaux, ...newsApi, ...gnews, ...rss].filter(isValidArticle).sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  const seen = new Set<string>();
  const unique: MarketNewsItem[] = [];
  for (const item of merged) {
    const key = normalizeTitle(item.headline);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique.slice(0, Math.min(limit, 50));
}

export const getMarketNews = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => newsInput.parse(data))
  .handler(async ({ data }): Promise<MarketNewsItem[]> => {
    const cacheKey = `${data.date ?? "24h"}|${data.search.toLowerCase()}|${data.limit}`;
    const cached = newsCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.value;

    let request = inFlightNews.get(cacheKey);
    if (!request) {
      request = fetchCombinedIndianStockNews(data.limit, data.search, data.date)
        .then((items) => {
          if (items.length) newsCache.set(cacheKey, { value: items, expiresAt: Date.now() + NEWS_CACHE_TTL_MS });
          return items;
        })
        .finally(() => inFlightNews.delete(cacheKey));
      inFlightNews.set(cacheKey, request);
    }
    return request;
  });
