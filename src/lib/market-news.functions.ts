import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const MARKET_AUX_URL = "https://api.marketaux.com/v1/news/all";
const NEWS_API_URL = "https://newsapi.org/v2/everything";
const GNEWS_URL = "https://gnews.io/api/v4/search";

const newsInput = z.object({ limit: z.number().int().min(1).max(10).default(6) });
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

type MarketauxEntity = {
  symbol?: unknown;
  sentiment_score?: unknown;
};

type MarketauxArticle = {
  uuid?: unknown;
  title?: unknown;
  source?: unknown;
  published_at?: unknown;
  url?: unknown;
  entities?: unknown;
};

type MarketauxResponse = { data?: unknown };
type NewsApiArticle = {
  title?: unknown;
  source?: { name?: unknown } | null;
  publishedAt?: unknown;
  url?: unknown;
};
type NewsApiResponse = { articles?: unknown };
type GNewsArticle = {
  title?: unknown;
  source?: { name?: unknown } | null;
  publishedAt?: unknown;
  url?: unknown;
};
type GNewsResponse = { articles?: unknown };

let newsCache: { value: MarketNewsItem[]; expiresAt: number } | null = null;
let inFlightNews: Promise<MarketNewsItem[]> | null = null;

function sentimentFor(entities: unknown): MarketNewsItem["sentiment"] {
  if (!Array.isArray(entities)) return "neutral";
  const scores = entities
    .map((entity) => Number((entity as MarketauxEntity).sentiment_score))
    .filter((score): score is number => Number.isFinite(score));
  if (!scores.length) return "neutral";
  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  if (average > 0.1) return "positive";
  if (average < -0.1) return "negative";
  return "neutral";
}

function tickersFor(entities: unknown): string[] {
  if (!Array.isArray(entities)) return [];
  return [...new Set(
    entities
      .map((entity) => String((entity as MarketauxEntity).symbol ?? "").trim())
      .filter(Boolean)
      .map((symbol) => symbol.replace(/\.NS$|\.BO$/i, "")),
  )].slice(0, 5);
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isValidArticle(item: MarketNewsItem): boolean {
  return Boolean(item.headline && item.publishedAt && item.url);
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NEWS_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error(`News request failed (${response.status})`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error("News request error", error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchMarketauxNews(limit: number): Promise<MarketNewsItem[]> {
  const apiToken = process.env.MARKETAUX_API_TOKEN?.trim();
  if (!apiToken) return [];

  const publishedAfter = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 19);
  const params = new URLSearchParams({
    api_token: apiToken,
    countries: "in",
    language: "en",
    filter_entities: "true",
    sort: "published_at",
    limit: String(Math.min(limit, 10)),
    published_after: publishedAfter,
  });

  const body = (await fetchJson(`${MARKET_AUX_URL}?${params.toString()}`)) as MarketauxResponse | null;
  if (!body || !Array.isArray(body.data)) return [];

  return body.data
    .map((raw): MarketNewsItem | null => {
      const article = raw as MarketauxArticle;
      const headline = typeof article.title === "string" ? article.title.trim() : "";
      const publishedAt = typeof article.published_at === "string" ? article.published_at : "";
      const url = typeof article.url === "string" ? article.url : "";
      if (!headline || !publishedAt || !url) return null;
      return {
        id: typeof article.uuid === "string" ? article.uuid : `${publishedAt}-${headline}`,
        headline,
        source: typeof article.source === "string" ? article.source : "Marketaux",
        publishedAt,
        url,
        tickers: tickersFor(article.entities),
        sentiment: sentimentFor(article.entities),
      };
    })
    .filter((item): item is MarketNewsItem => item !== null);
}

async function fetchNewsApiNews(limit: number): Promise<MarketNewsItem[]> {
  const apiToken = process.env.NEWSAPI_API_KEY?.trim();
  if (!apiToken) return [];

  const params = new URLSearchParams({
    q: "Indian stock market OR NSE OR BSE",
    language: "en",
    sortBy: "publishedAt",
    pageSize: String(Math.min(limit, 10)),
    apiKey: apiToken,
  });

  const body = (await fetchJson(`${NEWS_API_URL}?${params.toString()}`)) as NewsApiResponse | null;
  if (!body || !Array.isArray(body.articles)) return [];

  return body.articles
    .map((raw): MarketNewsItem | null => {
      const article = raw as NewsApiArticle;
      const headline = typeof article.title === "string" ? article.title.trim() : "";
      const publishedAt = typeof article.publishedAt === "string" ? article.publishedAt : "";
      const url = typeof article.url === "string" ? article.url : "";
      const source = typeof article.source?.name === "string" ? article.source.name : "NewsAPI";
      if (!headline || !publishedAt || !url) return null;
      return {
        id: `newsapi-${url}`,
        headline,
        source,
        publishedAt,
        url,
        tickers: [],
        sentiment: "neutral",
      };
    })
    .filter((item): item is MarketNewsItem => item !== null);
}

async function fetchGNews(limit: number): Promise<MarketNewsItem[]> {
  const apiToken = process.env.GNEWS_API_KEY?.trim();
  if (!apiToken) return [];

  const params = new URLSearchParams({
    q: "Indian stock market",
    country: "in",
    lang: "en",
    max: String(Math.min(limit, 10)),
    apikey: apiToken,
  });

  const body = (await fetchJson(`${GNEWS_URL}?${params.toString()}`)) as GNewsResponse | null;
  if (!body || !Array.isArray(body.articles)) return [];

  return body.articles
    .map((raw): MarketNewsItem | null => {
      const article = raw as GNewsArticle;
      const headline = typeof article.title === "string" ? article.title.trim() : "";
      const publishedAt = typeof article.publishedAt === "string" ? article.publishedAt : "";
      const url = typeof article.url === "string" ? article.url : "";
      const source = typeof article.source?.name === "string" ? article.source.name : "GNews";
      if (!headline || !publishedAt || !url) return null;
      return {
        id: `gnews-${url}`,
        headline,
        source,
        publishedAt,
        url,
        tickers: [],
        sentiment: "neutral",
      };
    })
    .filter((item): item is MarketNewsItem => item !== null);
}

async function fetchCombinedIndianStockNews(limit: number): Promise<MarketNewsItem[]> {
  const [marketaux, newsApi, gnews] = await Promise.all([
    fetchMarketauxNews(limit),
    fetchNewsApiNews(limit),
    fetchGNews(limit),
  ]);

  const merged = [...marketaux, ...newsApi, ...gnews]
    .filter(isValidArticle)
    .sort((a, b) => {
      const aTime = new Date(a.publishedAt).getTime();
      const bTime = new Date(b.publishedAt).getTime();
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });

  const seen = new Set<string>();
  const unique: MarketNewsItem[] = [];
  for (const item of merged) {
    const key = normalizeTitle(item.headline);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  return unique.slice(0, Math.min(limit, 10));
}

export const getMarketNews = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => newsInput.parse(data))
  .handler(async ({ data }): Promise<MarketNewsItem[]> => {
    if (newsCache && Date.now() < newsCache.expiresAt) {
      return newsCache.value.slice(0, data.limit);
    }

    if (!inFlightNews) {
      inFlightNews = fetchCombinedIndianStockNews(data.limit)
        .then((items) => {
          if (items.length) {
            newsCache = { value: items, expiresAt: Date.now() + NEWS_CACHE_TTL_MS };
          }
          return items;
        })
        .finally(() => {
          inFlightNews = null;
        });
    }

    return inFlightNews;
  });
