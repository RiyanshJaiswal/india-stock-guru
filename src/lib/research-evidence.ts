/**
 * Pure evidence mappers: engine model -> ResearchEvidence / timeline / gaps.
 *
 * No I/O, no randomness, no clock reads beyond what the caller passes in, so
 * these run identically on the server, in the browser, or in tests.
 */

import type { Quote } from "./market-types";
import type { TechnicalAnalysis } from "./technical-types";
import type { FundamentalAnalysis } from "./fundamental-types";
import type { NewsFeed } from "./news-types";
import {
  clamp,
  clamp01,
  directionFromRange,
  makeEvidence,
  metricOrGap,
  numberValue,
  textValue,
  toIso,
} from "./research-collector";
import type {
  EvidenceDirection,
  ResearchEvidence,
  ResearchGap,
  ResearchTimelineEntry,
} from "./research-types";

type Bucket = {
  evidence: ResearchEvidence[];
  gaps: ResearchGap[];
  timeline: ResearchTimelineEntry[];
};

const bucket = (): Bucket => ({ evidence: [], gaps: [], timeline: [] });

const ratio = (resolved: number, expected: number) =>
  expected === 0 ? 0 : clamp01(resolved / expected);

/* ------------------------------------------------------------------ market */

export function mapMarketQuote(quote: Quote, asOf: string) {
  const out = bucket();
  const src = { sourceId: "market-engine", sourceName: "Market Data Engine" };
  let resolved = 0;
  const expected = 8;

  const push = (
    key: string,
    label: string,
    value: number | null,
    unit: Parameters<typeof numberValue>[1],
    importance: number,
    direction: EvidenceDirection = "neutral",
    tags: string[] = [],
  ) => {
    const ok = metricOrGap(out, value, {
      domain: "market",
      key,
      label,
      unit,
      importance,
      reliability: 0.95,
      direction,
      observedAt: asOf,
      tags: ["market", ...tags],
      ...src,
    });
    if (ok) resolved += 1;
  };

  push("market.price", "Last traded price", quote.price, "price", 85);
  push(
    "market.changePercent",
    "Day change %",
    quote.changePercent,
    "percent",
    80,
    quote.changePercent === null
      ? "neutral"
      : directionFromRange(quote.changePercent, 0.25, -0.25),
    ["momentum"],
  );
  push("market.dayHigh", "Day high", quote.dayHigh, "price", 45);
  push("market.dayLow", "Day low", quote.dayLow, "price", 45);
  push("market.fiftyTwoWeekHigh", "52 week high", quote.fiftyTwoWeekHigh, "price", 55);
  push("market.fiftyTwoWeekLow", "52 week low", quote.fiftyTwoWeekLow, "price", 55);
  push("market.volume", "Volume", quote.volume, "count", 50, "neutral", ["liquidity"]);
  push("market.marketCap", "Market capitalisation", quote.marketCap, "currency", 60, "neutral", [
    "valuation",
  ]);

  if (
    quote.price !== null &&
    quote.fiftyTwoWeekHigh !== null &&
    quote.fiftyTwoWeekLow !== null &&
    quote.fiftyTwoWeekHigh > quote.fiftyTwoWeekLow
  ) {
    const position =
      ((quote.price - quote.fiftyTwoWeekLow) /
        (quote.fiftyTwoWeekHigh - quote.fiftyTwoWeekLow)) *
      100;
    out.evidence.push(
      makeEvidence({
        domain: "market",
        key: "market.rangePosition",
        label: "Position in 52 week range",
        value: numberValue(Math.round(position * 100) / 100, "percent"),
        importance: 55,
        reliability: 0.9,
        origin: "computed",
        direction: directionFromRange(position, 70, 30),
        observedAt: asOf,
        tags: ["market", "momentum"],
        ...src,
      }),
    );
  }

  out.evidence.push(
    makeEvidence({
      domain: "market",
      key: "market.state",
      label: "Market state",
      value: textValue(quote.marketState),
      importance: 20,
      reliability: 0.95,
      observedAt: asOf,
      tags: ["market"],
      ...src,
    }),
  );

  return { ...out, completeness: ratio(resolved, expected) };
}

/* --------------------------------------------------------------- technical */

export function mapTechnical(analysis: TechnicalAnalysis) {
  const out = bucket();
  const src = { sourceId: "technical-engine", sourceName: "Technical Analysis Engine" };
  const asOf = toIso(analysis.asOf);
  const ind = analysis.indicators;
  const price = analysis.lastClose;
  let resolved = 0;
  const expected = 10;

  const push = (
    key: string,
    label: string,
    value: number | null,
    unit: Parameters<typeof numberValue>[1],
    importance: number,
    direction: EvidenceDirection,
    tags: string[] = [],
    note: string | null = null,
  ) => {
    const ok = metricOrGap(out, value, {
      domain: "technical",
      key,
      label,
      unit,
      importance,
      reliability: 0.85,
      origin: "computed",
      direction,
      observedAt: asOf,
      note,
      tags: ["technical", ...tags],
      ...src,
    });
    if (ok) resolved += 1;
  };

  for (const period of [20, 50, 100, 200] as const) {
    const value = ind.movingAverages.ema[period] ?? null;
    push(
      `technical.ema${period}`,
      `EMA ${period}`,
      value,
      "price",
      period >= 100 ? 60 : 50,
      value === null ? "neutral" : price > value ? "bullish" : "bearish",
      ["trend", "moving-average"],
    );
  }

  push(
    "technical.rsi",
    "RSI (14)",
    ind.rsi,
    "score",
    70,
    ind.rsi === null ? "neutral" : directionFromRange(ind.rsi, 55, 45),
    ["momentum"],
    ind.rsi !== null && (ind.rsi > 70 || ind.rsi < 30)
      ? ind.rsi > 70
        ? "Overbought territory."
        : "Oversold territory."
      : null,
  );
  push(
    "technical.macdHistogram",
    "MACD histogram",
    ind.macd.histogram,
    "ratio",
    70,
    ind.macd.histogram === null ? "neutral" : directionFromRange(ind.macd.histogram, 0, 0),
    ["momentum"],
  );
  push(
    "technical.percentB",
    "Bollinger %B",
    ind.bollingerBands.percentB,
    "ratio",
    45,
    ind.bollingerBands.percentB === null
      ? "neutral"
      : directionFromRange(ind.bollingerBands.percentB, 0.6, 0.4),
    ["volatility"],
  );
  push("technical.atr", "ATR (14)", ind.atr, "price", 40, "neutral", ["volatility"]);
  push(
    "technical.adx",
    "ADX",
    ind.adx.adx,
    "score",
    60,
    ind.adx.plusDi === null || ind.adx.minusDi === null
      ? "neutral"
      : ind.adx.plusDi > ind.adx.minusDi
        ? "bullish"
        : "bearish",
    ["trend"],
  );
  push(
    "technical.supertrend",
    "Supertrend",
    ind.supertrend.value,
    "price",
    65,
    ind.supertrend.direction === null
      ? "neutral"
      : ind.supertrend.direction === "bullish"
        ? "bullish"
        : "bearish",
    ["trend"],
  );
  push("technical.vwap", "VWAP", ind.vwap, "price", 40, ind.vwap === null
    ? "neutral"
    : price > ind.vwap
      ? "bullish"
      : "bearish", ["momentum"]);

  out.evidence.push(
    makeEvidence({
      domain: "technical",
      key: "technical.trend",
      label: "Detected trend",
      value: textValue(ind.trend.trend),
      importance: 90,
      reliability: 0.8,
      origin: "computed",
      direction:
        ind.trend.bias === "bullish"
          ? "bullish"
          : ind.trend.bias === "bearish"
            ? "bearish"
            : "neutral",
      observedAt: asOf,
      note: ind.trend.reasons.join("; ") || null,
      tags: ["technical", "trend"],
      ...src,
    }),
  );
  out.evidence.push(
    makeEvidence({
      domain: "technical",
      key: "technical.trendStrength",
      label: "Trend strength",
      value: numberValue(ind.trend.strength, "score"),
      importance: 60,
      reliability: 0.8,
      origin: "computed",
      observedAt: asOf,
      tags: ["technical", "trend"],
      ...src,
    }),
  );

  if (ind.supportResistance.support.length > 0) {
    out.evidence.push(
      makeEvidence({
        domain: "technical",
        key: "technical.support",
        label: "Support levels",
        value: textValue(ind.supportResistance.support.join(", ")),
        importance: 50,
        reliability: 0.7,
        origin: "computed",
        observedAt: asOf,
        tags: ["technical", "levels"],
        ...src,
      }),
    );
  } else {
    out.gaps.push({
      domain: "technical",
      key: "technical.support",
      label: "Support levels",
      reason: "No qualifying swing lows in the requested window.",
    });
  }
  if (ind.supportResistance.resistance.length > 0) {
    out.evidence.push(
      makeEvidence({
        domain: "technical",
        key: "technical.resistance",
        label: "Resistance levels",
        value: textValue(ind.supportResistance.resistance.join(", ")),
        importance: 50,
        reliability: 0.7,
        origin: "computed",
        observedAt: asOf,
        tags: ["technical", "levels"],
        ...src,
      }),
    );
  } else {
    out.gaps.push({
      domain: "technical",
      key: "technical.resistance",
      label: "Resistance levels",
      reason: "No qualifying swing highs in the requested window.",
    });
  }

  return { ...out, completeness: ratio(resolved, expected) };
}

/* ------------------------------------------------------------- fundamental */

export function mapFundamental(analysis: FundamentalAnalysis) {
  const out = bucket();
  const src = {
    sourceId: `fundamental:${analysis.provider}`,
    sourceName: "Fundamental Analysis Engine",
  };
  const asOf = toIso(analysis.fetchedAt);
  let resolved = 0;

  const specs: {
    key: string;
    label: string;
    value: number | null;
    unit: Parameters<typeof numberValue>[1];
    importance: number;
    direction: EvidenceDirection;
    tags: string[];
  }[] = [
    valuation("valuation.marketCap", "Market capitalisation", analysis.valuation.marketCap, "currency", 55),
    valuation("valuation.enterpriseValue", "Enterprise value", analysis.valuation.enterpriseValue, "currency", 45),
    valuation("valuation.peRatioTTM", "PE ratio (TTM)", analysis.valuation.peRatioTTM, "multiple", 80),
    valuation("valuation.forwardPE", "Forward PE", analysis.valuation.forwardPE, "multiple", 60),
    valuation("valuation.pbRatio", "PB ratio", analysis.valuation.pbRatio, "multiple", 60),
    valuation("valuation.priceToSalesTTM", "Price to sales (TTM)", analysis.valuation.priceToSalesTTM, "multiple", 45),
    valuation("valuation.evToEbitda", "EV / EBITDA", analysis.valuation.evToEbitda, "multiple", 55),
    valuation("valuation.bookValuePerShare", "Book value per share", analysis.valuation.bookValuePerShare, "currency", 40),
    valuation("valuation.epsDilutedTTM", "Diluted EPS (TTM)", analysis.valuation.epsDilutedTTM, "currency", 55),
    signal("profitability.roe", "ROE", analysis.profitability.roe, "percent", 80, 15, 8),
    signal("profitability.roce", "ROCE", analysis.profitability.roce, "percent", 75, 15, 8),
    signal("profitability.roa", "ROA", analysis.profitability.roa, "percent", 55, 8, 3),
    signal("profitability.grossMargin", "Gross margin", analysis.profitability.grossMargin, "percent", 50, 40, 15),
    signal("profitability.operatingMargin", "Operating margin", analysis.profitability.operatingMargin, "percent", 65, 15, 5),
    signal("profitability.netProfitMargin", "Net profit margin", analysis.profitability.netProfitMargin, "percent", 70, 10, 3),
    signal("profitability.ebitdaMargin", "EBITDA margin", analysis.profitability.ebitdaMargin, "percent", 55, 18, 8),
    signal("leverage.debtToEquity", "Debt to equity", analysis.leverage.debtToEquity, "ratio", 70, 1.5, 0.5, true),
    signal("leverage.currentRatio", "Current ratio", analysis.leverage.currentRatio, "ratio", 55, 1.5, 1),
    signal("leverage.quickRatio", "Quick ratio", analysis.leverage.quickRatio, "ratio", 45, 1.2, 0.8),
    signal("leverage.interestCoverage", "Interest coverage", analysis.leverage.interestCoverage, "ratio", 60, 4, 1.5),
    signal("growth.revenueGrowthYoY", "Revenue growth YoY", analysis.growth.revenueGrowthYoY, "percent", 80, 8, 0),
    signal("growth.revenueCagr3Y", "Revenue CAGR 3Y", analysis.growth.revenueCagr3Y, "percent", 65, 8, 0),
    signal("growth.revenueCagr5Y", "Revenue CAGR 5Y", analysis.growth.revenueCagr5Y, "percent", 60, 8, 0),
    signal("growth.epsGrowthYoY", "EPS growth YoY", analysis.growth.epsGrowthYoY, "percent", 75, 8, 0),
    signal("growth.epsCagr3Y", "EPS CAGR 3Y", analysis.growth.epsCagr3Y, "percent", 60, 8, 0),
    signal("growth.netIncomeGrowthYoY", "Net income growth YoY", analysis.growth.netIncomeGrowthYoY, "percent", 70, 8, 0),
    signal("cashflow.operatingCashFlow", "Operating cash flow", analysis.cashFlow.operatingCashFlow, "currency", 65, 0, 0),
    signal("cashflow.freeCashFlow", "Free cash flow", analysis.cashFlow.freeCashFlow, "currency", 70, 0, 0),
    valuation("cashflow.capitalExpenditure", "Capital expenditure", analysis.cashFlow.capitalExpenditure, "currency", 40),
    signal("cashflow.fcfMargin", "FCF margin", analysis.cashFlow.fcfMargin, "percent", 55, 8, 0),
    signal("dividend.dividendYield", "Dividend yield", analysis.dividends.dividendYield, "percent", 50, 1.5, 0),
    signal("dividend.payoutRatio", "Payout ratio", analysis.dividends.payoutRatio, "percent", 40, 0, 90, true),
  ];

  for (const spec of specs) {
    const ok = metricOrGap(out, spec.value, {
      domain: "fundamental",
      key: spec.key,
      label: spec.label,
      unit: spec.unit,
      importance: spec.importance,
      reliability: 0.85,
      direction: spec.direction,
      observedAt: asOf,
      tags: ["fundamental", ...spec.tags],
      ...src,
    });
    if (ok) resolved += 1;
  }

  // Shareholding pattern — explicitly unavailable categories become gaps.
  for (const category of analysis.shareholding.unavailable) {
    out.gaps.push({
      domain: "fundamental",
      key: `shareholding.${category}`,
      label: `${category} holding`,
      reason: `Provider "${analysis.provider}" does not expose ${category} shareholding.`,
    });
  }
  const latest = analysis.shareholding.latest;
  if (latest) {
    for (const slice of latest.slices) {
      metricOrGap(out, slice.percent, {
        domain: "fundamental",
        key: `shareholding.${slice.category}`,
        label: `${slice.category} holding`,
        unit: "percent",
        importance: 55,
        reliability: 0.8,
        observedAt: toIso(latest.asOfDate),
        tags: ["fundamental", "shareholding"],
        ...src,
      });
    }
  }

  // Reported periods become timeline entries (chronological evidence).
  for (const quarter of analysis.quarterlyResults.slice(0, 12)) {
    const at = toIso(quarter.asOfDate);
    if (!at) continue;
    const growth = quarter.revenueGrowthYoY;
    const id = `fundamental:quarter:${quarter.asOfDate}`;
    out.evidence.push(
      makeEvidence({
        domain: "fundamental",
        key: "results.quarterly",
        label: `Quarterly result ${quarter.asOfDate}`,
        value: numberValue(quarter.revenue ?? Number.NaN, "currency"),
        importance: 65,
        reliability: 0.9,
        observedAt: at,
        discriminator: quarter.asOfDate,
        tags: ["fundamental", "results", "quarterly"],
        direction:
          growth === null ? "neutral" : directionFromRange(growth, 5, 0),
        ...src,
      }),
    );
    out.timeline.push({
      id,
      at,
      domain: "fundamental",
      title: `Quarterly results (${quarter.asOfDate})`,
      detail:
        growth === null
          ? "Revenue growth YoY not reported."
          : `Revenue growth YoY ${growth}%.`,
      importance: 65,
      direction: growth === null ? "neutral" : directionFromRange(growth, 5, 0),
      sourceId: src.sourceId,
      url: null,
      evidenceIds: [`fundamental:results.quarterly:${quarter.asOfDate}`],
    });
  }
  for (const year of analysis.annualResults.slice(0, 10)) {
    const at = toIso(year.asOfDate);
    if (!at) continue;
    const growth = year.revenueGrowthYoY;
    out.timeline.push({
      id: `fundamental:annual:${year.asOfDate}`,
      at,
      domain: "fundamental",
      title: `Annual results (${year.asOfDate})`,
      detail:
        growth === null ? "Revenue growth YoY not reported." : `Revenue growth YoY ${growth}%.`,
      importance: 60,
      direction: growth === null ? "neutral" : directionFromRange(growth, 5, 0),
      sourceId: src.sourceId,
      url: null,
      evidenceIds: [],
    });
  }
  for (const event of analysis.dividends.history.slice(0, 12)) {
    const at = toIso(event.date);
    if (!at) continue;
    out.timeline.push({
      id: `fundamental:dividend:${event.date}`,
      at,
      domain: "corporate-action",
      title: `Dividend ${event.amount} per share`,
      detail: null,
      importance: 45,
      direction: "neutral",
      sourceId: src.sourceId,
      url: null,
      evidenceIds: [],
    });
  }

  // Coverage notes from the fundamental engine become gaps when empty.
  for (const entry of analysis.coverage) {
    if (entry.availablePeriods === 0) {
      out.gaps.push({
        domain: "fundamental",
        key: `coverage.${entry.dataset}`,
        label: entry.dataset,
        reason:
          entry.note ??
          `No periods returned for ${entry.dataset} (requested ${entry.requestedPeriods}).`,
      });
    }
  }

  return { ...out, completeness: ratio(resolved, specs.length) };
}

function valuation(
  key: string,
  label: string,
  value: number | null,
  unit: Parameters<typeof numberValue>[1],
  importance: number,
) {
  return { key, label, value, unit, importance, direction: "neutral" as EvidenceDirection, tags: [key.split(".")[0] ?? "fundamental"] };
}

function signal(
  key: string,
  label: string,
  value: number | null,
  unit: Parameters<typeof numberValue>[1],
  importance: number,
  bullishAbove: number,
  bearishBelow: number,
  invert = false,
) {
  return {
    key,
    label,
    value,
    unit,
    importance,
    direction:
      value === null || !Number.isFinite(value)
        ? ("neutral" as EvidenceDirection)
        : directionFromRange(value, bullishAbove, bearishBelow, invert),
    tags: [key.split(".")[0] ?? "fundamental"],
  };
}

/* -------------------------------------------------------------------- news */

export function mapNews(feed: NewsFeed) {
  const out = bucket();

  for (const article of feed.articles) {
    const at = toIso(article.publishedAt);
    out.evidence.push(
      makeEvidence({
        domain: "news",
        key: `news.${article.primaryEventType}`,
        label: article.title,
        value: textValue(article.summary ?? article.title),
        importance: clamp(article.importanceScore),
        reliability: clamp01(article.reliabilityScore),
        observedAt: at,
        url: article.url,
        sourceId: article.source.id,
        sourceName: article.source.name,
        discriminator: article.id,
        note:
          article.duplicateSources.length > 0
            ? `Corroborated by ${article.duplicateSources.length} other source(s).`
            : null,
        tags: ["news", article.primaryEventType, article.language, ...article.eventTypes],
        ...src(article.source.kind),
      }),
    );
    if (at) {
      out.timeline.push({
        id: `news:${article.id}`,
        at,
        domain: "news",
        title: article.title,
        detail: article.summary,
        importance: clamp(article.importanceScore),
        direction: "neutral",
        sourceId: article.source.id,
        url: article.url,
        evidenceIds: [`news:news.${article.primaryEventType}:${article.id}`],
      });
    } else {
      out.gaps.push({
        domain: "news",
        key: `news.publishedAt.${article.id}`,
        label: "Published date",
        reason: `${article.source.name} did not state a publish date for "${article.title}".`,
      });
    }
  }

  for (const event of feed.events) {
    const at = toIso(event.eventDate ?? event.announcedAt);
    if (!at) continue;
    out.timeline.push({
      id: `event:${event.id}`,
      at,
      domain: "event",
      title: event.title,
      detail: event.detail,
      importance: 70,
      direction: "neutral",
      sourceId: event.source.id,
      url: event.url,
      evidenceIds: [],
    });
  }

  for (const action of feed.corporateActions) {
    const at = toIso(action.exDate ?? action.recordDate ?? action.announcedAt);
    out.evidence.push(
      makeEvidence({
        domain: "corporate-action",
        key: `corporateAction.${action.kind}`,
        label: action.description,
        value:
          action.value === null
            ? textValue(action.ratio ?? action.description)
            : numberValue(action.value, "currency"),
        importance: 75,
        reliability: 0.95,
        observedAt: at,
        url: action.url,
        sourceId: action.source.id,
        sourceName: action.source.name,
        discriminator: action.id,
        tags: ["corporate-action", action.kind],
      }),
    );
    if (at) {
      out.timeline.push({
        id: `action:${action.id}`,
        at,
        domain: "corporate-action",
        title: action.description,
        detail: action.ratio,
        importance: 75,
        direction: "neutral",
        sourceId: action.source.id,
        url: action.url,
        evidenceIds: [`corporate-action:corporateAction.${action.kind}:${action.id}`],
      });
    }
  }

  const okProviders = feed.coverage.filter((entry) => entry.ok).length;
  for (const entry of feed.coverage) {
    if (!entry.ok || entry.itemCount === 0) {
      out.gaps.push({
        domain: "news",
        key: `news.provider.${entry.providerId}`,
        label: `${entry.providerId} coverage`,
        reason: entry.message ?? `${entry.providerId} returned no items.`,
      });
    }
  }

  return {
    ...out,
    completeness: feed.coverage.length === 0 ? 0 : ratio(okProviders, feed.coverage.length),
  };
}

const src = (_kind: string) => ({}) as Record<string, never>;
