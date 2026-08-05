/**
 * Duplicate detection and merging.
 *
 * Two items are the same story when they share a canonical URL, or when
 * their normalised headlines are near-identical (token Jaccard + stripped
 * publisher suffixes). Merging keeps the most authoritative source as the
 * primary record and records every other source that carried it.
 */

import type { NewsArticle } from "./news-types";
import type { RawArticle } from "./news-provider";

const TRACKING_PARAM = /^(utm_|fbclid|gclid|igshid|ref|ref_src|oc$|cmpid|src)/i;

/** Strips tracking params, fragments and trailing slashes for comparison. */
export function canonicalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    }
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.host.replace(/^www\./, "")}${path}${url.search}`.toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "on", "for", "to", "at", "by", "with", "and",
  "as", "is", "are", "its", "after", "from", "over", "amid", "says", "said",
]);

/** Headline → comparable token set (publisher suffix and punctuation removed). */
export function normalizeHeadline(title: string): string[] {
  return title
    .replace(/\s+[-–—|]\s+[^-–—|]{2,40}$/u, "") // " - Moneycontrol"
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s%]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function headlineSimilarity(a: string, b: string): number {
  const setA = new Set(normalizeHeadline(a));
  const setB = new Set(normalizeHeadline(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared += 1;
  return shared / (setA.size + setB.size - shared);
}

export const DUPLICATE_THRESHOLD = 0.72;

/** Stable id: canonical URL when present, else normalised headline. */
export function articleId(canonicalUrl: string, title: string): string {
  const basis = canonicalUrl || normalizeHeadline(title).join("-");
  let hash = 2166136261;
  for (let i = 0; i < basis.length; i += 1) {
    hash ^= basis.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** Higher wins when picking the primary record of a duplicate cluster. */
function authority(article: RawArticle): number {
  const kindRank: Record<string, number> = {
    exchange: 6,
    filing: 6,
    "investor-relations": 5,
    wire: 4,
    publisher: 3,
    aggregator: 1,
  };
  return (kindRank[article.source.kind] ?? 0) * 10 + article.source.baseReliability * 5;
}

export type Cluster = {
  primary: RawArticle;
  members: RawArticle[];
  canonicalUrl: string;
  sources: string[];
  urls: string[];
};

/** Groups raw articles into duplicate clusters. O(n·k) over recent buckets. */
export function clusterArticles(articles: RawArticle[]): Cluster[] {
  const clusters: Cluster[] = [];
  const byUrl = new Map<string, Cluster>();

  for (const article of articles) {
    const canonical = canonicalizeUrl(article.url);
    const existing = byUrl.get(canonical);
    if (existing) {
      addToCluster(existing, article, canonical);
      continue;
    }
    const similar = clusters.find(
      (cluster) => headlineSimilarity(cluster.primary.title, article.title) >= DUPLICATE_THRESHOLD,
    );
    if (similar) {
      addToCluster(similar, article, canonical);
      byUrl.set(canonical, similar);
      continue;
    }
    const cluster: Cluster = {
      primary: article,
      members: [article],
      canonicalUrl: canonical,
      sources: [article.source.id],
      urls: [canonical],
    };
    clusters.push(cluster);
    byUrl.set(canonical, cluster);
  }
  return clusters;
}

function addToCluster(cluster: Cluster, article: RawArticle, canonical: string) {
  cluster.members.push(article);
  if (!cluster.sources.includes(article.source.id)) cluster.sources.push(article.source.id);
  if (!cluster.urls.includes(canonical)) cluster.urls.push(canonical);
  if (authority(article) > authority(cluster.primary)) {
    cluster.primary = article;
    cluster.canonicalUrl = canonical;
  }
}

/** Sort order for the final feed: importance first, then recency. */
export function sortFeed(articles: NewsArticle[]): NewsArticle[] {
  return [...articles].sort((a, b) => {
    if (b.importanceScore !== a.importanceScore) return b.importanceScore - a.importanceScore;
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });
}
