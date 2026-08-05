/**
 * NewsProvider adapter contract.
 *
 * An adapter fetches from exactly one source and returns raw-but-normalised
 * items. Deduplication, classification, ranking and scoring happen once in
 * the aggregation service, so adapters stay thin and swappable (a FastAPI
 * backend adapter implements the same interface).
 */

import type {
  CompanyEvent,
  CorporateAction,
  NewsArticle,
  NewsSource,
} from "./news-types";

export type NewsQuery = {
  /** Provider symbol, e.g. "RELIANCE.NS". Null for market-wide news. */
  symbol: string | null;
  /** Plain ticker without exchange suffix. */
  ticker: string | null;
  /** Company or free-text query used by text-search providers. */
  query: string | null;
  /** Max items an adapter should return. */
  limit: number;
  /** Only return items published on/after this ISO timestamp, when known. */
  since: string | null;
};

/**
 * Adapters return partially filled articles: the aggregation service owns
 * `id`, `importanceScore`, `reliabilityScore`, `eventTypes`,
 * `primaryEventType`, `canonicalUrl`, `duplicateSources` and `mergedUrls`.
 */
export type RawArticle = Omit<
  NewsArticle,
  | "id"
  | "canonicalUrl"
  | "eventTypes"
  | "primaryEventType"
  | "reliabilityScore"
  | "importanceScore"
  | "duplicateSources"
  | "mergedUrls"
> & { eventTypes?: never };

export type ProviderResult = {
  articles: RawArticle[];
  events: CompanyEvent[];
  corporateActions: CorporateAction[];
};

export const emptyProviderResult = (): ProviderResult => ({
  articles: [],
  events: [],
  corporateActions: [],
});

export type NewsProvider = {
  source: NewsSource;
  /** True when the adapter can answer market-wide (symbol-less) queries. */
  supportsMarketWide: boolean;
  fetchNews(query: NewsQuery): Promise<ProviderResult>;
};

/** Source registry — single place defining reliability weights. */
export const SOURCES = {
  nse: {
    id: "nse",
    name: "NSE Corporate Announcements",
    kind: "exchange",
    baseReliability: 1,
    homepage: "https://www.nseindia.com",
  },
  bse: {
    id: "bse",
    name: "BSE Corporate Announcements",
    kind: "exchange",
    baseReliability: 1,
    homepage: "https://www.bseindia.com",
  },
  "exchange-filings": {
    id: "exchange-filings",
    name: "Company Exchange Filings",
    kind: "filing",
    baseReliability: 1,
    homepage: null,
  },
  "investor-relations": {
    id: "investor-relations",
    name: "Company Investor Relations",
    kind: "investor-relations",
    baseReliability: 0.95,
    homepage: null,
  },
  reuters: {
    id: "reuters",
    name: "Reuters",
    kind: "wire",
    baseReliability: 0.92,
    homepage: "https://www.reuters.com",
  },
  moneycontrol: {
    id: "moneycontrol",
    name: "Moneycontrol",
    kind: "publisher",
    baseReliability: 0.82,
    homepage: "https://www.moneycontrol.com",
  },
  "economic-times": {
    id: "economic-times",
    name: "The Economic Times",
    kind: "publisher",
    baseReliability: 0.82,
    homepage: "https://economictimes.indiatimes.com",
  },
  "business-standard": {
    id: "business-standard",
    name: "Business Standard",
    kind: "publisher",
    baseReliability: 0.82,
    homepage: "https://www.business-standard.com",
  },
  livemint: {
    id: "livemint",
    name: "LiveMint",
    kind: "publisher",
    baseReliability: 0.8,
    homepage: "https://www.livemint.com",
  },
  "google-news": {
    id: "google-news",
    name: "Google News",
    kind: "aggregator",
    baseReliability: 0.6,
    homepage: "https://news.google.com",
  },
} as const satisfies Record<string, NewsSource>;

export type SourceId = keyof typeof SOURCES;
