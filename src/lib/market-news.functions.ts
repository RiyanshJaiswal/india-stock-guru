import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const NEWS_URL = "https://api.marketaux.com/v1/news/all";
const newsInput = z.object({ limit: z.number().int().min(1).max(10).default(6) });

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

function sentimentFor(entities: unknown): MarketNewsItem["sentiment"] {
  if (!Array.isArray(entities)) return "neutral";
  const scores = entities
    .map((entity) => {
      const score = Number((entity as MarketauxEntity).sentiment_score);
      return Number.isFinite(score) ? score : null;
    })
    .filter((score): score is number => score !== null);
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

export const getMarketNews = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => newsInput.parse(data))
  .handler(async ({ data }): Promise<MarketNewsItem[]> => {
    const apiToken = process.env.MARKETAUX_API_TOKEN?.trim();
    if (!apiToken) {
      console.error("MARKETAUX_API_TOKEN is not configured");
      return [];
    }

    const publishedAfter = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 19);
    const params = new URLSearchParams({
      api_token: apiToken,
      countries: "in",
      language: "en",
      filter_entities: "true",
      must_have_entities: "true",
      sort: "published_at",
      limit: String(data.limit),
      published_after: publishedAfter,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(`${NEWS_URL}?${params.toString()}`, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        console.error(`Marketaux request failed (${response.status})`);
        return [];
      }
      const body = (await response.json()) as MarketauxResponse;
      if (!Array.isArray(body.data)) return [];

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
    } catch (error) {
      console.error("Marketaux request error", error instanceof Error ? error.message : error);
      return [];
    } finally {
      clearTimeout(timeout);
    }
  });