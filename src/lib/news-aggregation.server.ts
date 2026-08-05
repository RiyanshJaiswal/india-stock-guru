/**
 * NewsAggregationService (server-only).
 *
 * Fans out to every registered adapter in parallel, merges duplicates,
 * classifies events, scores reliability and importance, and returns one
 * structured feed with per-provider coverage. Provider failures degrade
 * coverage; they never fabricate content. If nothing at all came back the
 * service returns a structured error.
 */

import { classifyText, importanceScore, reliabilityScore } from "./news-classify";
import { articleId, canonicalizeUrl, clusterArticles, sortFeed } from "./news-dedupe";
import type { NewsProvider, NewsQuery, RawArticle } from "./news-provider";
import type {
  CompanyEvent,
  CorporateAction,
  NewsArticle,
  NewsFeedResult,
  ProviderCoverage,
} from "./news-types";
import {
  businessStandardProvider,
  economicTimesProvider,
  googleNewsProvider,
  livemintProvider,
  moneycontrolProvider,
  reutersProvider,
} from "./providers/rss-news.server";
import {
  bseAnnouncementsProvider,
  exchangeFilingsProvider,
  nseAnnouncementsProvider,
} from "./providers/exchange-announcements.server";
import { investorRelationsProvider } from "./providers/investor-relations.server";

/** Adapter registry — add a FastAPI adapter here and nothing else changes. */
export const NEWS_PROVIDERS: NewsProvider[] = [
  nseAnnouncementsProvider,
  bseAnnouncementsProvider,
  exchangeFilingsProvider,
  investorRelationsProvider,
  reutersProvider,
  moneycontrolProvider,
  economicTimesProvider,
  businessStandardProvider,
  livemintProvider,
  googleNewsProvider,
];

export type AggregationRequest = {
  symbol: string | null;
  query: string | null;
  limit: number;
  sinceDays: number;
  /** Restrict the fan-out to these adapter ids. */
  providerIds?: string[];
};

const stripSuffix = (symbol: string) => symbol.replace(/\.(NS|BO)$/i, "");

export async function aggregateNews(request: AggregationRequest): Promise<NewsFeedResult> {
  const symbol = request.symbol?.trim() || null;
  const ticker = symbol ? stripSuffix(symbol).toUpperCase() : null;
  const query: NewsQuery = {
    symbol,
    ticker,
    query: request.query?.trim() || ticker,
    limit: Math.max(5, Math.min(request.limit, 100)),
    since: new Date(Date.now() - request.sinceDays * 86_400_000).toISOString(),
  };

  const selected = NEWS_PROVIDERS.filter(
    (provider) =>
      (!request.providerIds || request.providerIds.includes(provider.source.id)) &&
      (symbol !== null || provider.supportsMarketWide),
  );

  const coverage: ProviderCoverage[] = [];
  const rawArticles: RawArticle[] = [];
  const events: CompanyEvent[] = [];
  const corporateActions: CorporateAction[] = [];

  const settled = await Promise.allSettled(
    selected.map((provider) => provider.fetchNews(query)),
  );

  settled.forEach((result, index) => {
    const provider = selected[index]!;
    if (result.status === "rejected") {
      coverage.push({
        providerId: provider.source.id,
        ok: false,
        itemCount: 0,
        message:
          result.reason instanceof Error ? result.reason.message : "Provider request failed.",
      });
      return;
    }
    rawArticles.push(...result.value.articles);
    events.push(...result.value.events);
    corporateActions.push(...result.value.corporateActions);
    coverage.push({
      providerId: provider.source.id,
      ok: true,
      itemCount: result.value.articles.length,
      message: result.value.articles.length === 0 ? "Provider returned no items." : null,
    });
  });

  const now = Date.now();
  const articles: NewsArticle[] = clusterArticles(rawArticles).map((cluster) => {
    const primary = cluster.primary;
    const classification = classifyText(
      primary.title,
      primary.summary,
      ...cluster.members.map((m) => m.title),
    );
    const duplicateSources = cluster.sources.filter((id) => id !== primary.source.id);
    return {
      id: articleId(cluster.canonicalUrl, primary.title),
      title: primary.title,
      summary: primary.summary,
      url: primary.url,
      canonicalUrl: cluster.canonicalUrl || canonicalizeUrl(primary.url),
      source: primary.source,
      publishedAt: primary.publishedAt,
      company: primary.company,
      eventTypes: classification.eventTypes,
      primaryEventType: classification.primaryEventType,
      language: primary.language,
      reliabilityScore: reliabilityScore({
        baseReliability: primary.source.baseReliability,
        kind: primary.source.kind,
        corroboratingSources: duplicateSources.length,
        hasPublishedAt: Boolean(primary.publishedAt),
        hasUrl: Boolean(primary.url),
      }),
      importanceScore: importanceScore({
        eventTypes: classification.eventTypes,
        kind: primary.source.kind,
        publishedAt: primary.publishedAt,
        duplicateCount: duplicateSources.length,
        now,
      }),
      duplicateSources,
      mergedUrls: cluster.urls,
      attachments: [...new Set(cluster.members.flatMap((m) => m.attachments))],
    };
  });

  const anyOk = coverage.some((entry) => entry.ok);
  if (articles.length === 0) {
    return {
      ok: false,
      error: {
        code: anyOk ? "NO_NEWS" : "ALL_PROVIDERS_FAILED",
        symbol,
        message: anyOk
          ? `No news or filings found for ${symbol ?? "the requested query"}.`
          : "Every news provider failed for this request.",
        coverage,
      },
    };
  }

  return {
    ok: true,
    data: {
      symbol,
      query: query.query,
      fetchedAt: new Date().toISOString(),
      articles: sortFeed(articles).slice(0, query.limit),
      events: dedupeById(events),
      corporateActions: dedupeById(corporateActions),
      coverage,
    },
  };
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) if (!seen.has(item.id)) seen.set(item.id, item);
  return [...seen.values()];
}
