/**
 * Static market configuration only. User portfolio holdings are stored locally
 * in the browser and are managed by the Portfolio component.
 */

export type Position = {
  symbol: string;
  quantity: number;
  avgPrice: number;
};

export type NewsItem = {
  id: string;
  headline: string;
  source: string;
  time: string;
  tickers: string[];
  sentiment: "positive" | "negative" | "neutral";
};

export const defaultWatchlist = [
  "RELIANCE.NS",
  "INFY.NS",
  "TATAMOTORS.NS",
  "HDFCBANK.NS",
  "ADANIENT.NS",
];

export const inr = (value: number, fraction = 2) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: fraction,
    minimumFractionDigits: fraction,
  }).format(value);
