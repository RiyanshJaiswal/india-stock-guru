/**
 * IntentClassifier — deterministic, rule-based intent detection.
 *
 * No model call happens here: routing must stay cheap, testable and
 * explainable. Each intent owns a weighted keyword set; the highest scoring
 * intent wins, ties break by the declared priority order.
 */

import { AI_INTENTS, type AIIntent, type IntentClassification } from "./ai-types";

type Rule = { intent: AIIntent; weight: number; pattern: RegExp };

const RULES: Rule[] = [
  { intent: "why-fall", weight: 4, pattern: /\b(fall|fell|falling|down|drop|dropped|declin\w*|crash\w*|slump\w*|tank\w*|lower|red)\b/i },
  { intent: "why-rise", weight: 4, pattern: /\b(ris\w*|rose|rally\w*|rallied|up|gain\w*|surge\w*|jump\w*|spike\w*|higher|green)\b/i },
  { intent: "why-fall", weight: 3, pattern: /\bwhy\b/i },
  { intent: "why-rise", weight: 3, pattern: /\bwhy\b/i },
  { intent: "explain-movement", weight: 5, pattern: /\b(today'?s? (move|movement|action)|explain (the )?(move|movement)|what happened|intraday|day'?s move)\b/i },
  { intent: "technical-analysis", weight: 5, pattern: /\b(technical|chart|rsi|macd|ema|sma|moving average|bollinger|supertrend|adx|atr|vwap|fibonacci|pivot|support|resistance|breakout|trend)\b/i },
  { intent: "fundamental-analysis", weight: 5, pattern: /\b(fundamental|valuation|pe ratio|p\/e|pb|price to book|eps|roe|roce|roa|margin|debt to equity|balance sheet|cash flow|revenue|profit|earnings quality|book value)\b/i },
  { intent: "news-analysis", weight: 5, pattern: /\b(news|headline|media|article|report(ed|s)?|coverage|announcement)\b/i },
  { intent: "corporate-actions", weight: 6, pattern: /\b(corporate action|dividend|bonus issue|stock split|split|buyback|rights issue|merger|amalgamation|acquisition|demerger|agm|record date)\b/i },
  { intent: "compare-stocks", weight: 6, pattern: /\b(compare|comparison|versus|vs\.?|better than|which is better|against)\b/i },
  { intent: "buy-or-wait", weight: 6, pattern: /\b(buy or wait|should i buy|worth buying|entry now|good time to (buy|enter)|accumulate|add more)\b/i },
  { intent: "swing-trade", weight: 6, pattern: /\b(swing|short term trade|few days|positional|intraday trade|trade setup|stop ?loss|target price)\b/i },
  { intent: "long-term", weight: 6, pattern: /\b(long ?term|multi ?year|invest for|hold for|5 years|10 years|sip|wealth creation|compounding)\b/i },
  { intent: "risk-analysis", weight: 6, pattern: /\b(risk|risky|downside|volatility|drawdown|safe|danger|red flag|leverage concern)\b/i },
  { intent: "portfolio", weight: 6, pattern: /\b(my portfolio|my holdings|my positions|p&l|pnl|allocation|too (heavy|concentrated)|diversif\w*)\b/i },
  { intent: "general-market", weight: 5, pattern: /\b(nifty|sensex|bank ?nifty|market (today|overall|outlook)|indices|broader market|fii|dii)\b/i },
];

/** Ticker-ish tokens: RELIANCE, TCS.NS, INFY.BO */
const SYMBOL_PATTERN = /\b[A-Z][A-Z0-9&-]{1,19}(?:\.(?:NS|BO))?\b/g;

const STOPWORDS = new Set([
  "AI", "I", "A", "THE", "PE", "PB", "EPS", "ROE", "ROCE", "ROA", "RSI", "MACD",
  "EMA", "SMA", "ADX", "ATR", "VWAP", "FII", "DII", "IPO", "AGM", "NSE", "BSE",
  "CEO", "CFO", "USD", "INR", "OK", "VS", "AND", "OR", "IS", "IT", "MY", "TO",
  "P&L", "PNL", "SIP", "NIFTY", "SENSEX",
]);

export function extractSymbols(question: string): string[] {
  const out: string[] = [];
  for (const match of question.match(SYMBOL_PATTERN) ?? []) {
    const token = match.toUpperCase();
    if (STOPWORDS.has(token)) continue;
    if (token.length < 2) continue;
    if (!out.includes(token)) out.push(token);
  }
  return out;
}

export function classifyIntent(
  question: string,
  hintedSymbols: string[] = [],
): IntentClassification {
  const text = question.trim();
  const scores = new Map<AIIntent, number>();
  const matched: string[] = [];

  for (const rule of RULES) {
    const hit = text.match(rule.pattern);
    if (!hit) continue;
    scores.set(rule.intent, (scores.get(rule.intent) ?? 0) + rule.weight);
    if (hit[0]) matched.push(hit[0].toLowerCase());
  }

  const symbols = [...new Set([...extractSymbols(text), ...hintedSymbols.map((s) => s.toUpperCase())])];

  // Two distinct symbols in a "compare"-flavoured question strengthens compare.
  if (symbols.length >= 2) {
    scores.set("compare-stocks", (scores.get("compare-stocks") ?? 0) + 3);
  }
  // A "why" question with a direction word should not collapse to the other side.
  if (/\bwhy\b/i.test(text) && !scores.has("why-fall") && !scores.has("why-rise")) {
    scores.set("explain-movement", (scores.get("explain-movement") ?? 0) + 2);
  }
  if (symbols.length === 0 && !scores.has("portfolio")) {
    scores.set("general-market", (scores.get("general-market") ?? 0) + 2);
  }

  const ranked = AI_INTENTS.map((intent) => ({ intent, score: scores.get(intent) ?? 0 })).sort(
    (a, b) => b.score - a.score,
  );

  const top = ranked[0];
  const runner = ranked[1];
  if (!top || top.score === 0) {
    return {
      intent: symbols.length > 0 ? "explain-movement" : "general-market",
      confidence: 0.3,
      symbols,
      matched,
      alternatives: ranked.slice(0, 3),
    };
  }

  const total = ranked.reduce((sum, entry) => sum + entry.score, 0) || 1;
  const margin = (top.score - (runner?.score ?? 0)) / top.score;
  const confidence = Math.min(0.99, 0.4 + 0.4 * (top.score / total) + 0.3 * margin);

  return {
    intent: top.intent,
    confidence: Number(confidence.toFixed(2)),
    symbols,
    matched: [...new Set(matched)],
    alternatives: ranked.slice(1, 4).filter((entry) => entry.score > 0),
  };
}
