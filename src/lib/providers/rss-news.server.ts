/**
 * RSS-based news adapters (server-only).
 *
 * Google News RSS is the transport for the aggregator adapter and for the
 * per-publisher adapters (each scoped with a `site:` filter), because none of
 * Reuters / Moneycontrol / ET / BS / Mint expose a stable public per-company
 * feed. Each adapter still reports its own source identity and reliability,
 * so swapping in a direct publisher API or the FastAPI backend later means
 * replacing one adapter, not the model.
 */

import type { NewsProvider, NewsQuery, ProviderResult, RawArticle } from "../news-provider";
import { SOURCES } from "../news-provider";
import type { CompanyRef, NewsSource } from "../news-types";
import {
  detectLanguage,
  fetchText,
  parseFeed,
  unwrapGoogleLink,
} from "../news-http.server";

const GOOGLE_NEWS = "https://news.google.com/rss/search";

function buildQuery(query: NewsQuery, site: string | null): string {
  const name = query.query ?? query.ticker;
  // Phrase-quote the company so publisher-scoped feeds stay on-topic.
  const base = name
    ? query.ticker && !name.toUpperCase().includes(query.ticker)
      ? `(\"${name}\" OR \"${query.ticker}\")`
      : `\"${name}\"`
    : "Indian stock market";
  return site ? `${base} site:${site}` : `${base} when:14d`;
}

/**
 * Google News is intentionally fuzzy: for example a search for "reliance"
 * can return an article containing "reliant" or an article whose body merely
 * mentions Reliance. That is useful for general web search, but wrong for a
 * stock-news page. Keep only articles whose headline contains an exact
 * company/ticker token. This also prevents unrelated results such as an
 * ICICI Bank headline from appearing in a RELIANCE search.
 */
function headlineMatchesCompany(title: string, query: NewsQuery): boolean {
  const headline = title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!headline) return false;

  const candidates = [
    query.ticker,
    query.query,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLocaleLowerCase().replace(/\.(ns|bo)$/i, "").replace(/[^a-z0-9]+/g, " ").trim())
    .filter((value) => value.length >= 2);

  return candidates.some((candidate) => {
    const pattern = new RegExp(`(?:^| )${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$| )`, "i");
    return pattern.test(headline);
  });
}

function companyRef(query: NewsQuery, name: string | null): CompanyRef {
  return {
    symbol: query.symbol,
    ticker: query.ticker,
    name: name ?? query.query,
    exchange: query.symbol
      ? query.symbol.toUpperCase().endsWith(".BO")
        ? "BSE"
        : "NSE"
      : null,
  };
}

async function fetchGoogleNews(
  source: NewsSource,
  query: NewsQuery,
  site: string | null,
): Promise<ProviderResult> {
  const url = `${GOOGLE_NEWS}?q=${encodeURIComponent(buildQuery(query, site))}&hl=en-IN&gl=IN&ceid=IN:en`;
  const xml = await fetchText(url);
  const since = query.since ? Date.parse(query.since) : null;

  const articles: RawArticle[] = [];
  for (const item of parseFeed(xml)) {
    const publishedAt = item.publishedAt;
    if (since && publishedAt && Date.parse(publishedAt) < since) continue;
    const link = unwrapGoogleLink(item.link);
    if (site && !linkMatchesSite(link, item.sourceName, site)) continue;

    // For a company/ticker search, do not trust Google's fuzzy ranking alone.
    // The headline must explicitly identify the requested company/ticker.
    if ((query.symbol || query.query) && !headlineMatchesCompany(item.title, query)) continue;

    articles.push({
      title: item.title,
      summary: item.description,
      url: link,
      source,
      publishedAt,
      company: companyRef(query, null),
      language: detectLanguage(`${item.title} ${item.description ?? ""}`),
      attachments: [],
    });
    if (articles.length >= query.limit) break;
  }
  return { articles, events: [], corporateActions: [] };
}

function linkMatchesSite(link: string, sourceName: string | null, site: string): boolean {
  const host = safeHost(link);
  if (host && host.endsWith(site.replace(/^www\./, ""))) return true;
  // Google sometimes keeps its redirect host; fall back to the declared source.
  if (!host || host.endsWith("news.google.com")) {
    return Boolean(sourceName);
  }
  return false;
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function rssProvider(source: NewsSource, site: string | null): NewsProvider {
  return {
    source,
    supportsMarketWide: true,
    fetchNews: (query) => fetchGoogleNews(source, query, site),
  };
}

export const googleNewsProvider = rssProvider(SOURCES["google-news"], null);
export const reutersProvider = rssProvider(SOURCES.reuters, "reuters.com");
export const moneycontrolProvider = rssProvider(SOURCES.moneycontrol, "moneycontrol.com");
export const economicTimesProvider = rssProvider(
  SOURCES["economic-times"],
  "economictimes.indiatimes.com",
);
export const businessStandardProvider = rssProvider(
  SOURCES["business-standard"],
  "business-standard.com",
);
export const livemintProvider = rssProvider(SOURCES.livemint, "livemint.com");
