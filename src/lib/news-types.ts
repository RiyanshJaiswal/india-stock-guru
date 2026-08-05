/**
 * News Intelligence & Corporate Filings — shared DTOs (client-safe).
 *
 * Every provider adapter normalises into these models, so the UI and any
 * future AI reasoning layer only ever sees one shape. Values are nullable
 * rather than defaulted: unknown data stays unknown, never a placeholder.
 */

/** Where an item came from. Filings sources rank above aggregators. */
export type NewsSourceKind =
  | "exchange" // NSE / BSE announcements, exchange notices
  | "filing" // company exchange filings (PDF/attachments)
  | "investor-relations" // company IR page/feed
  | "wire" // Reuters and other wire services
  | "publisher" // Moneycontrol, ET, BS, LiveMint
  | "aggregator"; // Google News RSS

export type NewsSource = {
  /** Stable adapter id, e.g. "nse", "bse", "reuters", "google-news". */
  id: string;
  name: string;
  kind: NewsSourceKind;
  /** 0-1 editorial reliability weight of the source itself. */
  baseReliability: number;
  homepage: string | null;
};

/** Classified corporate/market event carried by an article or filing. */
export type EventType =
  | "earnings"
  | "guidance"
  | "promoter-activity"
  | "fii-dii-flow"
  | "dividend"
  | "bonus-issue"
  | "stock-split"
  | "rights-issue"
  | "buyback"
  | "merger"
  | "acquisition"
  | "regulatory"
  | "exchange-notice"
  | "credit-rating"
  | "management-change"
  | "order-win"
  | "board-meeting"
  | "agm-egm"
  | "general";

export type Language = "en" | "hi" | "other";

export type CompanyRef = {
  /** Provider symbol used across the app, e.g. "RELIANCE.NS". */
  symbol: string | null;
  /** Plain ticker, e.g. "RELIANCE". */
  ticker: string | null;
  name: string | null;
  exchange: "NSE" | "BSE" | null;
};

export type NewsArticle = {
  /** Deterministic id derived from canonical URL + title. */
  id: string;
  title: string;
  /** Provider-supplied summary text only; never generated. */
  summary: string | null;
  url: string;
  /** URL stripped of tracking params, used for duplicate detection. */
  canonicalUrl: string;
  source: NewsSource;
  /** ISO-8601 UTC. Null when the provider states no date. */
  publishedAt: string | null;
  company: CompanyRef;
  eventTypes: EventType[];
  /** Highest-weight event type, or "general". */
  primaryEventType: EventType;
  language: Language;
  /** 0-1: source reliability adjusted for corroboration and metadata quality. */
  reliabilityScore: number;
  /** 0-100 ranked importance. */
  importanceScore: number;
  /** Other source ids that reported the same story (post-merge). */
  duplicateSources: string[];
  /** Canonical URLs merged into this article. */
  mergedUrls: string[];
  /** Attachment links (filing PDFs) when the provider exposes them. */
  attachments: string[];
};

/** A dated company event extracted from exchange/IR sources. */
export type CompanyEvent = {
  id: string;
  company: CompanyRef;
  type: EventType;
  title: string;
  detail: string | null;
  /** ISO-8601 of the event itself (board meeting date, result date). */
  eventDate: string | null;
  announcedAt: string | null;
  source: NewsSource;
  url: string | null;
};

export type CorporateActionKind =
  | "dividend"
  | "bonus"
  | "split"
  | "rights"
  | "buyback"
  | "merger"
  | "demerger"
  | "amalgamation";

export type CorporateAction = {
  id: string;
  company: CompanyRef;
  kind: CorporateActionKind;
  /** Raw purpose/description exactly as the exchange stated it. */
  description: string;
  /** Dividend amount per share, split/bonus ratio etc. — parsed, else null. */
  value: number | null;
  ratio: string | null;
  exDate: string | null;
  recordDate: string | null;
  announcedAt: string | null;
  source: NewsSource;
  url: string | null;
};

export type ProviderCoverage = {
  providerId: string;
  ok: boolean;
  itemCount: number;
  /** Present when the provider failed or returned nothing. */
  message: string | null;
};

export type NewsFeed = {
  symbol: string | null;
  query: string | null;
  fetchedAt: string;
  articles: NewsArticle[];
  events: CompanyEvent[];
  corporateActions: CorporateAction[];
  coverage: ProviderCoverage[];
};

export type NewsErrorCode =
  | "NO_NEWS"
  | "ALL_PROVIDERS_FAILED"
  | "INVALID_REQUEST"
  | "PROVIDER_ERROR";

export type NewsError = {
  code: NewsErrorCode;
  message: string;
  symbol: string | null;
  coverage: ProviderCoverage[];
};

export type NewsFeedResult =
  | { ok: true; data: NewsFeed }
  | { ok: false; error: NewsError };
