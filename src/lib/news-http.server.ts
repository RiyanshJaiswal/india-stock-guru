/**
 * Shared HTTP + XML helpers for news adapters (server-only).
 *
 * Worker-safe: no DOMParser, no Node-only modules. RSS/Atom parsing is done
 * with tolerant regex extraction because the feeds are simple and the Worker
 * runtime has no XML parser.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export async function fetchText(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<string> {
  const { timeoutMs = 12_000, headers, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8",
        "accept-language": "en-IN,en;q=0.9",
        ...(headers as Record<string, string> | undefined),
      },
    });
    if (!response.ok) throw new Error(`${new URL(url).host} responded ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const text = await fetchText(url, {
    ...init,
    headers: { accept: "application/json, text/plain, */*", ...(init.headers as Record<string, string> | undefined) },
  });
  return JSON.parse(text) as T;
}

export function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .trim();
}

export function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function tagValue(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  return match ? decodeEntities(match[1]!) : null;
}

export type RssItem = {
  title: string;
  link: string;
  description: string | null;
  publishedAt: string | null;
  sourceName: string | null;
};

/** Parses RSS 2.0 and Atom feeds into a common item shape. */
export function parseFeed(xml: string): RssItem[] {
  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ].map((m) => m[1]!);

  const items: RssItem[] = [];
  for (const block of blocks) {
    const title = tagValue(block, "title");
    const link =
      tagValue(block, "link") ??
      /<link[^>]*href="([^"]+)"/i.exec(block)?.[1] ??
      tagValue(block, "guid");
    if (!title || !link) continue;
    const rawDate =
      tagValue(block, "pubDate") ?? tagValue(block, "updated") ?? tagValue(block, "published");
    items.push({
      title: stripTags(title),
      link: decodeEntities(link),
      description: tagValue(block, "description")
        ? stripTags(tagValue(block, "description")!)
        : tagValue(block, "summary")
          ? stripTags(tagValue(block, "summary")!)
          : null,
      publishedAt: toIso(rawDate),
      sourceName: tagValue(block, "source"),
    });
  }
  return items;
}

export function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const direct = Date.parse(trimmed);
  if (!Number.isNaN(direct)) return new Date(direct).toISOString();
  // Exchange formats: "05-Aug-2026 14:32:10" / "2026-08-05 14:32:10"
  const dm = /^(\d{2})-([A-Za-z]{3})-(\d{4})[ T]?([\d:]+)?$/.exec(trimmed);
  if (dm) {
    const parsed = Date.parse(`${dm[1]} ${dm[2]} ${dm[3]} ${dm[4] ?? "00:00:00"} GMT+0530`);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  const sqlLike = Date.parse(trimmed.replace(" ", "T") + "+05:30");
  return Number.isNaN(sqlLike) ? null : new Date(sqlLike).toISOString();
}

/** Google News wraps publisher links; unwrap when the real URL is exposed. */
export function unwrapGoogleLink(url: string): string {
  try {
    const parsed = new URL(url);
    const inner = parsed.searchParams.get("url");
    return inner ?? url;
  } catch {
    return url;
  }
}

/** Detects the language actually declared/observable, never guessed beyond script. */
export function detectLanguage(text: string): "en" | "hi" | "other" {
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  if (/[A-Za-z]/.test(text)) return "en";
  return "other";
}
