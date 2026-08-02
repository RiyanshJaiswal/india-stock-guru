/**
 * Shared market types (client-safe).
 *
 * These are the DTOs every UI component consumes. When the FastAPI backend
 * lands, only the fetchers in `market.functions.ts` change — components and
 * these types stay exactly the same.
 */

export type SearchResult = {
  /** Provider symbol, e.g. "RELIANCE.NS" */
  symbol: string;
  /** Plain ticker without the exchange suffix, e.g. "RELIANCE" */
  ticker: string;
  name: string;
  exchange: "NSE" | "BSE";
};

export type Quote = {
  symbol: string;
  ticker: string;
  name: string;
  exchange: string;
  currency: string;
  marketState: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  volume: number | null;
  marketCap: number | null;
};

export const stripSuffix = (symbol: string) => symbol.replace(/\.(NS|BO)$/i, "");

export const exchangeOf = (symbol: string): "NSE" | "BSE" =>
  symbol.toUpperCase().endsWith(".BO") ? "BSE" : "NSE";

export const INDEX_SYMBOLS = ["^NSEI", "^BSESN", "^NSEBANK", "^INDIAVIX"] as const;

export const INDEX_LABELS: Record<string, string> = {
  "^NSEI": "NIFTY 50",
  "^BSESN": "SENSEX",
  "^NSEBANK": "BANK NIFTY",
  "^INDIAVIX": "INDIA VIX",
};

export const num = (value: number | null | undefined, fraction = 2) =>
  value === null || value === undefined || Number.isNaN(value)
    ? "—"
    : new Intl.NumberFormat("en-IN", {
        maximumFractionDigits: fraction,
        minimumFractionDigits: fraction,
      }).format(value);

export const signed = (value: number | null | undefined, fraction = 2) =>
  value === null || value === undefined || Number.isNaN(value)
    ? "—"
    : `${value >= 0 ? "+" : ""}${num(value, fraction)}`;

export const compactInr = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `₹${(value / 1e12).toFixed(2)} L Cr`;
  if (abs >= 1e7) return `₹${(value / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(value / 1e5).toFixed(2)} L`;
  return `₹${num(value, 0)}`;
};

export const compactVolume = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value >= 1e7) return `${(value / 1e7).toFixed(2)} Cr`;
  if (value >= 1e5) return `${(value / 1e5).toFixed(2)} L`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)} K`;
  return String(value);
};
