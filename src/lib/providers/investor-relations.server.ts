/**
 * Company Investor Relations adapter (server-only).
 *
 * IR pages have no common standard, so this adapter reads a registry of
 * per-company IR feed URLs (RSS/Atom). The registry is supplied through the
 * `INVESTOR_RELATIONS_FEEDS` env var as JSON `{ "TICKER": "https://…/rss" }`,
 * which keeps the adapter data-driven and lets the future FastAPI backend own
 * the mapping. Unmapped companies throw, and the aggregation service reports
 * that as coverage — never as empty-but-fine.
 */

import type { NewsProvider, NewsQuery, ProviderResult, RawArticle } from "../news-provider";
import { SOURCES } from "../news-provider";
import { detectLanguage, fetchText, parseFeed } from "../news-http.server";

function registry(): Record<string, string> {
  const raw = process.env["INVESTOR_RELATIONS_FEEDS"];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key.toUpperCase(), value]),
    );
  } catch {
    return {};
  }
}

async function fetchIr(query: NewsQuery): Promise<ProviderResult> {
  const ticker = query.ticker?.toUpperCase();
  if (!ticker) throw new Error("Investor relations feeds are company-specific.");
  const feedUrl = registry()[ticker];
  if (!feedUrl) {
    throw new Error(
      `No investor relations feed registered for ${ticker}. Add it to INVESTOR_RELATIONS_FEEDS.`,
    );
  }
  const xml = await fetchText(feedUrl);
  const since = query.since ? Date.parse(query.since) : null;
  const articles: RawArticle[] = [];
  for (const item of parseFeed(xml)) {
    if (since && item.publishedAt && Date.parse(item.publishedAt) < since) continue;
    articles.push({
      title: item.title,
      summary: item.description,
      url: item.link,
      source: SOURCES["investor-relations"],
      publishedAt: item.publishedAt,
      company: {
        symbol: query.symbol,
        ticker,
        name: query.query,
        exchange: query.symbol?.toUpperCase().endsWith(".BO") ? "BSE" : "NSE",
      },
      language: detectLanguage(`${item.title} ${item.description ?? ""}`),
      attachments: /\.pdf($|\?)/i.test(item.link) ? [item.link] : [],
    });
    if (articles.length >= query.limit) break;
  }
  return { articles, events: [], corporateActions: [] };
}

export const investorRelationsProvider: NewsProvider = {
  source: SOURCES["investor-relations"],
  supportsMarketWide: false,
  fetchNews: fetchIr,
};
