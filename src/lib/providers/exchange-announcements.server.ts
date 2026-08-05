/**
 * Exchange adapters (server-only): NSE and BSE corporate announcements, and
 * the company exchange-filings view derived from the same feeds (items that
 * carry a filed attachment).
 *
 * Both exchanges gate their JSON APIs behind a browsing session, so each
 * adapter warms a cookie first. When an exchange blocks the request the
 * adapter throws and the aggregation service reports it as provider coverage
 * rather than substituting data.
 */

import type { NewsProvider, NewsQuery, ProviderResult, RawArticle } from "../news-provider";
import { SOURCES } from "../news-provider";
import type { CompanyEvent, CompanyRef, CorporateAction, NewsSource } from "../news-types";
import { classifyText, corporateActionKind } from "../news-classify";
import { detectLanguage, fetchJson, fetchText, stripTags, toIso } from "../news-http.server";

type NseAnnouncement = {
  symbol?: string;
  desc?: string;
  attchmntText?: string;
  attchmntFile?: string;
  smIndustry?: string;
  sm_name?: string;
  an_dt?: string;
  sort_date?: string;
};

type BseAnnouncement = {
  NEWSSUB?: string;
  HEADLINE?: string;
  MORE?: string;
  ATTACHMENTNAME?: string;
  NEWS_DT?: string;
  SLONGNAME?: string;
  SCRIP_CD?: number | string;
  NSURL?: string;
};

const NSE_HOME = "https://www.nseindia.com";
const BSE_API = "https://api.bseindia.com/BseIndiaAPI/api/AnnGetData/w";

let nseCookie: { value: string; at: number } | null = null;

async function nseSession(): Promise<string> {
  if (nseCookie && Date.now() - nseCookie.at < 10 * 60_000) return nseCookie.value;
  const response = await fetch(`${NSE_HOME}/get-quotes/equity`, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-IN,en;q=0.9",
    },
  });
  const cookie = response.headers.get("set-cookie") ?? "";
  const value = cookie
    .split(/,(?=[^;]+=)/)
    .map((part) => part.split(";")[0]!.trim())
    .filter(Boolean)
    .join("; ");
  nseCookie = { value, at: Date.now() };
  return value;
}

function ref(query: NewsQuery, name: string | null, exchange: "NSE" | "BSE"): CompanyRef {
  return {
    symbol: query.symbol,
    ticker: query.ticker,
    name: name ?? query.query,
    exchange,
  };
}

function toItems(
  source: NewsSource,
  company: CompanyRef,
  rows: {
    title: string;
    detail: string | null;
    url: string | null;
    attachment: string | null;
    publishedAt: string | null;
  }[],
  onlyFilings: boolean,
): ProviderResult {
  const articles: RawArticle[] = [];
  const events: CompanyEvent[] = [];
  const corporateActions: CorporateAction[] = [];

  for (const row of rows) {
    if (onlyFilings && !row.attachment) continue;
    const url = row.attachment ?? row.url;
    if (!url) continue;
    const { primaryEventType } = classifyText(row.title, row.detail);
    articles.push({
      title: row.title,
      summary: row.detail,
      url,
      source,
      publishedAt: row.publishedAt,
      company,
      language: detectLanguage(`${row.title} ${row.detail ?? ""}`),
      attachments: row.attachment ? [row.attachment] : [],
    });

    events.push({
      id: `${source.id}:${row.publishedAt ?? ""}:${row.title.slice(0, 60)}`,
      company,
      type: primaryEventType,
      title: row.title,
      detail: row.detail,
      eventDate: row.publishedAt,
      announcedAt: row.publishedAt,
      source,
      url,
    });

    const kind = corporateActionKind(primaryEventType);
    if (kind) {
      corporateActions.push({
        id: `${source.id}:ca:${row.publishedAt ?? ""}:${kind}`,
        company,
        kind,
        description: row.detail ?? row.title,
        value: parseAmount(`${row.title} ${row.detail ?? ""}`),
        ratio: parseRatio(`${row.title} ${row.detail ?? ""}`),
        exDate: null,
        recordDate: parseRecordDate(`${row.title} ${row.detail ?? ""}`),
        announcedAt: row.publishedAt,
        source,
        url,
      });
    }
  }
  return { articles, events, corporateActions };
}

function parseAmount(text: string): number | null {
  const match = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d+)?)/i.exec(text);
  if (!match) return null;
  const value = Number(match[1]!.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function parseRatio(text: string): string | null {
  const match = /\b(\d{1,3})\s*[:/]\s*(\d{1,3})\b/.exec(text);
  return match ? `${match[1]}:${match[2]}` : null;
}

function parseRecordDate(text: string): string | null {
  const match = /record\s+date[^\d]{0,20}(\d{1,2}[-/][A-Za-z0-9]{2,3}[-/]\d{2,4})/i.exec(text);
  return match ? toIso(match[1]!.replace(/\//g, "-")) : null;
}

async function fetchNse(query: NewsQuery, onlyFilings: boolean): Promise<ProviderResult> {
  if (!query.ticker) return { articles: [], events: [], corporateActions: [] };
  const cookie = await nseSession();
  const url = `${NSE_HOME}/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(query.ticker.toUpperCase())}`;
  const rows = await fetchJson<NseAnnouncement[]>(url, {
    headers: { cookie, referer: `${NSE_HOME}/get-quotes/equity?symbol=${query.ticker}` },
  });
  const company = ref(query, rows[0]?.sm_name ?? null, "NSE");
  return toItems(
    onlyFilings ? SOURCES["exchange-filings"] : SOURCES.nse,
    company,
    rows.slice(0, query.limit).map((row) => ({
      title: stripTags(row.desc ?? row.attchmntText ?? "Corporate announcement"),
      detail: row.attchmntText ? stripTags(row.attchmntText) : null,
      url: `${NSE_HOME}/companies-listing/corporate-filings-announcements`,
      attachment: row.attchmntFile ?? null,
      publishedAt: toIso(row.an_dt ?? row.sort_date ?? null),
    })),
    onlyFilings,
  );
}

async function fetchBse(query: NewsQuery, onlyFilings: boolean): Promise<ProviderResult> {
  if (!query.ticker) return { articles: [], events: [], corporateActions: [] };
  const today = new Date();
  const from = new Date(today.getTime() - 30 * 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const url =
    `${BSE_API}?pageno=1&strCat=-1&strPrevDate=${fmt(from)}&strScrip=${encodeURIComponent(query.ticker)}` +
    `&strSearch=P&strToDate=${fmt(today)}&strType=C&subcategory=-1`;
  const payload = await fetchJson<{ Table?: BseAnnouncement[] }>(url, {
    headers: { referer: "https://www.bseindia.com/", origin: "https://www.bseindia.com" },
  });
  const rows = payload.Table ?? [];
  const company = ref(query, rows[0]?.SLONGNAME ?? null, "BSE");
  return toItems(
    onlyFilings ? SOURCES["exchange-filings"] : SOURCES.bse,
    company,
    rows.slice(0, query.limit).map((row) => ({
      title: stripTags(row.HEADLINE ?? row.NEWSSUB ?? "Corporate announcement"),
      detail: row.MORE ? stripTags(row.MORE) : null,
      url: row.NSURL ?? "https://www.bseindia.com/corporates/ann.html",
      attachment: row.ATTACHMENTNAME
        ? `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${row.ATTACHMENTNAME}`
        : null,
      publishedAt: toIso(row.NEWS_DT ?? null),
    })),
    onlyFilings,
  );
}

export const nseAnnouncementsProvider: NewsProvider = {
  source: SOURCES.nse,
  supportsMarketWide: false,
  fetchNews: (query) => fetchNse(query, false),
};

export const bseAnnouncementsProvider: NewsProvider = {
  source: SOURCES.bse,
  supportsMarketWide: false,
  fetchNews: (query) => fetchBse(query, false),
};

/** Filing view: same exchange feeds, restricted to items with a filed document. */
export const exchangeFilingsProvider: NewsProvider = {
  source: SOURCES["exchange-filings"],
  supportsMarketWide: false,
  async fetchNews(query) {
    const results = await Promise.allSettled([fetchNse(query, true), fetchBse(query, true)]);
    const merged: ProviderResult = { articles: [], events: [], corporateActions: [] };
    let failures = 0;
    for (const result of results) {
      if (result.status === "fulfilled") {
        merged.articles.push(...result.value.articles);
        merged.events.push(...result.value.events);
        merged.corporateActions.push(...result.value.corporateActions);
      } else {
        failures += 1;
      }
    }
    if (failures === results.length) throw new Error("Both exchange filing feeds are unreachable.");
    return merged;
  },
};

/** Kept exported so an IR adapter can reuse the same session warm-up. */
export { fetchText as fetchExchangeText };
