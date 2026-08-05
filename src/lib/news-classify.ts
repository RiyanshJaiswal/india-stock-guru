/**
 * Event classification, importance ranking and reliability scoring.
 *
 * Pure and provider-independent: rule-driven keyword matching over the text
 * the provider actually published. No AI, no sentiment, no invented values.
 * A future AI reasoning layer consumes these labels rather than replacing
 * them.
 */

import type {
  CorporateActionKind,
  EventType,
  NewsSourceKind,
} from "./news-types";

type Rule = { type: EventType; patterns: RegExp[] };

/** Ordered by specificity — earlier rules win ties in `primaryEventType`. */
const RULES: Rule[] = [
  {
    type: "earnings",
    patterns: [
      /\b(q[1-4]\s*(fy)?\s*\d{2,4})\b/i,
      /\b(quarterly|annual)\s+result/i,
      /\bunaudited\s+financial\s+results?\b/i,
      /\bnet\s+profit\b/i,
      /\bearnings\b/i,
      /\bebitda\b/i,
      /\brevenue\s+(rose|fell|up|down|grew|declined)\b/i,
      /\bfinancial\s+results?\b/i,
    ],
  },
  {
    type: "guidance",
    patterns: [
      /\bguidance\b/i,
      /\boutlook\s+(raised|cut|lowered|maintained|revised)\b/i,
      /\b(raises|cuts|lowers|revises)\s+(its\s+)?(fy\d{2,4}\s+)?(revenue|margin|growth|profit)\b/i,
      /\bforecasts?\b/i,
    ],
  },
  {
    type: "promoter-activity",
    patterns: [
      /\bpromoter(s)?\b/i,
      /\bpledge(d|s)?\b/i,
      /\bencumbrance\b/i,
      /\b(sebi\s+)?sast\b/i,
      /\binsider\s+trading\s+(disclosure|regulation)/i,
      /\bstake\s+(sale|purchase|hike|increase|reduction)\b/i,
      /\bblock\s+deal\b/i,
    ],
  },
  {
    type: "fii-dii-flow",
    patterns: [
      /\bfii(s)?\b/i,
      /\bdii(s)?\b/i,
      /\bfpi(s)?\b/i,
      /\bforeign\s+(institutional|portfolio)\s+investor/i,
      /\bdomestic\s+institutional\s+investor/i,
      /\bmutual\s+fund\s+(buying|selling|inflow|outflow)/i,
    ],
  },
  {
    type: "dividend",
    patterns: [
      /\bdividend\b/i,
      /\bpayout\s+ratio\b/i,
      /\brecord\s+date\b.*\bdividend\b/i,
      /\binterim\s+dividend\b/i,
    ],
  },
  {
    type: "bonus-issue",
    patterns: [/\bbonus\s+(issue|share|equity)/i, /\bbonus\s+ratio\b/i],
  },
  {
    type: "stock-split",
    patterns: [
      /\bstock\s+split\b/i,
      /\bshare\s+split\b/i,
      /\bsub-?division\s+of\s+(equity\s+)?shares?\b/i,
      /\bface\s+value\s+split\b/i,
    ],
  },
  { type: "rights-issue", patterns: [/\brights\s+issue\b/i, /\brights\s+entitlement\b/i] },
  { type: "buyback", patterns: [/\bbuy-?back\b/i, /\brepurchase\s+of\s+(equity\s+)?shares?\b/i] },
  {
    type: "merger",
    patterns: [/\bmerger\b/i, /\bamalgamation\b/i, /\bdemerger\b/i, /\bscheme\s+of\s+arrangement\b/i],
  },
  {
    type: "acquisition",
    patterns: [
      /\bacquisitions?\b/i,
      /\bacquires?\b/i,
      /\bacquired\b/i,
      /\btakeover\b/i,
      /\bto\s+buy\s+(a\s+)?\d+(\.\d+)?%\s+stake\b/i,
    ],
  },
  {
    type: "regulatory",
    patterns: [
      /\bsebi\b/i,
      /\brbi\b/i,
      /\bcci\b/i,
      /\bnclt\b/i,
      /\bnclat\b/i,
      /\benforcement\s+directorate\b/i,
      /\bshow\s+cause\s+notice\b/i,
      /\bpenalt(y|ies)\b/i,
      /\bregulator(y|s)?\b/i,
      /\bcompliance\s+certificate\b/i,
    ],
  },
  {
    type: "exchange-notice",
    patterns: [
      /\bexchange\s+notice\b/i,
      /\bcircular\b/i,
      /\bsurveillance\s+measure\b/i,
      /\basm\b/i,
      /\bgsm\b/i,
      /\btrading\s+(halt|suspension|window)\b/i,
      /\bcircuit\s+limit\b/i,
    ],
  },
  {
    type: "credit-rating",
    patterns: [/\bcredit\s+rating\b/i, /\b(crisil|icra|care\s+ratings|india\s+ratings)\b/i, /\bratings?\s+(upgrade|downgrade|reaffirm)/i],
  },
  {
    type: "management-change",
    patterns: [
      /\bresignation\b/i,
      /\bappointment\s+of\b/i,
      /\b(ceo|cfo|managing\s+director|chairman|whole-?time\s+director)\b/i,
      /\bsteps?\s+down\b/i,
    ],
  },
  {
    type: "order-win",
    patterns: [/\border\s+win\b/i, /\bbags?\s+(an?\s+)?(order|contract|deal)\b/i, /\bwins?\s+(an?\s+)?(order|contract|tender)\b/i, /\bletter\s+of\s+intent\b/i],
  },
  {
    type: "board-meeting",
    patterns: [/\bboard\s+meeting\b/i, /\bintimation\s+of\s+board\s+meeting\b/i, /\boutcome\s+of\s+board\s+meeting\b/i],
  },
  { type: "agm-egm", patterns: [/\b(agm|egm|extra-?ordinary\s+general\s+meeting|annual\s+general\s+meeting)\b/i] },
];


export type Classification = {
  eventTypes: EventType[];
  primaryEventType: EventType;
};

export function classifyText(...parts: (string | null | undefined)[]): Classification {
  const text = parts.filter(Boolean).join(" \u2022 ");
  const matched: EventType[] = [];
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) matched.push(rule.type);
  }
  if (matched.length === 0) return { eventTypes: ["general"], primaryEventType: "general" };
  return { eventTypes: matched, primaryEventType: matched[0]! };
}

/** Maps a classified event to a corporate action kind, when it is one. */
export function corporateActionKind(type: EventType): CorporateActionKind | null {
  switch (type) {
    case "dividend":
      return "dividend";
    case "bonus-issue":
      return "bonus";
    case "stock-split":
      return "split";
    case "rights-issue":
      return "rights";
    case "buyback":
      return "buyback";
    case "merger":
      return "merger";
    default:
      return null;
  }
}

const SOURCE_KIND_WEIGHT: Record<NewsSourceKind, number> = {
  exchange: 1,
  filing: 1,
  "investor-relations": 0.9,
  wire: 0.85,
  publisher: 0.7,
  aggregator: 0.55,
};

/**
 * Reliability = source trust, lifted by independent corroboration and by
 * complete metadata (dated, linked). Always clamped to 0-1.
 */
export function reliabilityScore(input: {
  baseReliability: number;
  kind: NewsSourceKind;
  corroboratingSources: number;
  hasPublishedAt: boolean;
  hasUrl: boolean;
}): number {
  const base = 0.7 * input.baseReliability + 0.3 * SOURCE_KIND_WEIGHT[input.kind];
  const corroboration = Math.min(input.corroboratingSources, 3) * 0.05;
  const metadata = (input.hasPublishedAt ? 0.03 : -0.08) + (input.hasUrl ? 0.02 : -0.1);
  return clamp01(base + corroboration + metadata);
}

/**
 * Importance 0-100 from event weight, source kind, recency and how many
 * independent sources carried the story.
 */
export function importanceScore(input: {
  eventTypes: EventType[];
  kind: NewsSourceKind;
  publishedAt: string | null;
  duplicateCount: number;
  now?: number;
}): number {
  const weight = Math.max(...input.eventTypes.map((t) => EVENT_WEIGHTS[t] ?? 0.3));
  const eventPart = weight * 55;
  const sourcePart = SOURCE_KIND_WEIGHT[input.kind] * 20;
  const now = input.now ?? Date.now();
  const ageHours = input.publishedAt
    ? Math.max(0, (now - Date.parse(input.publishedAt)) / 3_600_000)
    : 72;
  const recencyPart = Number.isNaN(ageHours) ? 5 : 15 * Math.exp(-ageHours / 48);
  const corroborationPart = Math.min(input.duplicateCount, 4) * 2.5;
  return Math.round(clamp(eventPart + sourcePart + recencyPart + corroborationPart, 0, 100));
}

export const EVENT_WEIGHTS: Record<EventType, number> = {
  earnings: 1,
  merger: 0.95,
  acquisition: 0.92,
  guidance: 0.9,
  regulatory: 0.85,
  "promoter-activity": 0.82,
  buyback: 0.8,
  "stock-split": 0.78,
  "bonus-issue": 0.78,
  dividend: 0.75,
  "rights-issue": 0.72,
  "credit-rating": 0.68,
  "order-win": 0.65,
  "exchange-notice": 0.62,
  "fii-dii-flow": 0.6,
  "management-change": 0.58,
  "board-meeting": 0.5,
  "agm-egm": 0.4,
  general: 0.3,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
