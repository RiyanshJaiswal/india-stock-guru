/**
 * Server-side ResearchCollector implementations.
 *
 * Each collector calls exactly one existing engine and never mutates it.
 * To move onto FastAPI, swap the engine import inside a collector for a
 * `fetch` to the corresponding endpoint — `CollectorOutput` stays the same.
 */

import { exchangeOf, stripSuffix } from "./market-types";
import type { ResearchCollector, CollectorOutput } from "./research-collector";
import { emptyOutput, toIso } from "./research-collector";
import { mapFundamental, mapMarketQuote, mapNews, mapTechnical } from "./research-evidence";
import { analyzeCandles } from "./technical-analysis";

const failure = (error: unknown, fallback: string): CollectorOutput =>
  emptyOutput(error instanceof Error ? error.message : fallback, false);

export const marketCollector: ResearchCollector = {
  id: "market-collector",
  domain: "market",
  async collect(request) {
    try {
      const { providerQuotes } = await import("./market-data.server");
      const quotes = await providerQuotes([request.symbol]);
      const quote = quotes[0];
      if (!quote) return emptyOutput(`No quote available for ${request.symbol}.`);
      const mapped = mapMarketQuote(quote, new Date().toISOString());
      return {
        ...mapped,
        identity: {
          companyName: quote.name,
          currency: quote.currency,
          exchange: exchangeOf(quote.symbol),
        },
        ok: true,
        message: null,
      };
    } catch (error) {
      return failure(error, "Market data collector failed.");
    }
  },
};

export const technicalCollector: ResearchCollector = {
  id: "technical-collector",
  domain: "technical",
  async collect(request) {
    try {
      const { providerHistory } = await import("./market-data.server");
      const candles = await providerHistory(request.symbol, request.interval, request.range);
      const result = analyzeCandles(request.symbol, candles, request.interval, request.range);
      if (!result.ok) return emptyOutput(result.error.message);
      const mapped = mapTechnical(result.data);
      return { ...mapped, ok: true, message: null };
    } catch (error) {
      return failure(error, "Technical analysis collector failed.");
    }
  },
};

export const fundamentalCollector: ResearchCollector = {
  id: "fundamental-collector",
  domain: "fundamental",
  async collect(request) {
    try {
      const { runFundamentalAnalysis } = await import("./fundamental-service.server");
      const result = await runFundamentalAnalysis(
        request.symbol,
        request.quarters,
        request.years,
      );
      if (!result.ok) return emptyOutput(result.error.message);
      const mapped = mapFundamental(result.data);
      return {
        ...mapped,
        identity: {
          companyName: result.data.profile.name,
          currency: result.data.profile.currency,
        },
        ok: true,
        message: null,
      };
    } catch (error) {
      return failure(error, "Fundamental analysis collector failed.");
    }
  },
};

export const newsCollector: ResearchCollector = {
  id: "news-collector",
  domain: "news",
  async collect(request) {
    try {
      const { aggregateNews } = await import("./news-aggregation.server");
      const result = await aggregateNews({
        symbol: request.symbol,
        query: null,
        limit: request.newsLimit,
        sinceDays: request.newsSinceDays,
      });
      if (!result.ok) return emptyOutput(result.error.message);
      const mapped = mapNews(result.data);
      const named = result.data.articles.find((article) => article.company.name);
      return {
        ...mapped,
        identity: {
          companyName: named?.company.name ?? null,
          exchange: named?.company.exchange ?? null,
        },
        ok: mapped.evidence.length > 0,
        message:
          mapped.evidence.length > 0
            ? null
            : `No news items for ${request.symbol} in the last ${request.newsSinceDays} days.`,
      };
    } catch (error) {
      return failure(error, "News intelligence collector failed.");
    }
  },
};

export const RESEARCH_COLLECTORS: ResearchCollector[] = [
  marketCollector,
  technicalCollector,
  fundamentalCollector,
  newsCollector,
];

export const collectorFor = (domain: string) =>
  RESEARCH_COLLECTORS.find((collector) => collector.domain === domain) ?? null;

export const tickerOf = (symbol: string) => stripSuffix(symbol);

export const nowIso = () => toIso(Date.now()) as string;
