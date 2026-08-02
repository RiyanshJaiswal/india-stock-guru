/**
 * Personal + editorial data that has no market feed yet.
 *
 * Portfolio positions are user-entered (quantity + average price) and will
 * move to Lovable Cloud; live prices for them come from the market API.
 * News is placeholder editorial content until a news API is connected.
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

export const positions: Position[] = [
  { symbol: "RELIANCE.NS", quantity: 24, avgPrice: 2710.5 },
  { symbol: "INFY.NS", quantity: 40, avgPrice: 1655.0 },
  { symbol: "HDFCBANK.NS", quantity: 30, avgPrice: 1742.8 },
  { symbol: "TATAMOTORS.NS", quantity: 55, avgPrice: 845.25 },
  { symbol: "ITC.NS", quantity: 120, avgPrice: 441.6 },
];

export const news: NewsItem[] = [
  { id: "n1", headline: "RBI holds repo rate at 6.5%, flags easing inflation trajectory", source: "Mint", time: "18m ago", tickers: ["HDFCBANK", "SBIN"], sentiment: "positive" },
  { id: "n2", headline: "Tata Motors JLR volumes beat estimates on strong EV mix", source: "Economic Times", time: "42m ago", tickers: ["TATAMOTORS"], sentiment: "positive" },
  { id: "n3", headline: "IT majors guide cautious on FY discretionary spend", source: "Business Standard", time: "1h ago", tickers: ["TCS", "INFY"], sentiment: "negative" },
  { id: "n4", headline: "FIIs turn net buyers with ₹3,240 cr inflow in cash segment", source: "Moneycontrol", time: "2h ago", tickers: [], sentiment: "positive" },
  { id: "n5", headline: "Adani Enterprises slips as block deal chatter hits the counter", source: "CNBC-TV18", time: "3h ago", tickers: ["ADANIENT"], sentiment: "negative" },
  { id: "n6", headline: "Reliance retail arm to expand quick-commerce to 20 more cities", source: "Reuters", time: "4h ago", tickers: ["RELIANCE"], sentiment: "neutral" },
];

export const inr = (value: number, fraction = 2) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: fraction,
    minimumFractionDigits: fraction,
  }).format(value);
