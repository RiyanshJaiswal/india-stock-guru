/**
 * Mock market data layer.
 *
 * Every export here is shaped like the payload a FastAPI backend (or a
 * Supabase table) would return, so swapping `getX()` for a fetch/RPC call
 * later requires no component changes.
 */

export type Stock = {
  symbol: string;
  name: string;
  exchange: "NSE" | "BSE";
  sector: string;
  price: number;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
};

export type Holding = {
  symbol: string;
  name: string;
  quantity: number;
  avgPrice: number;
  ltp: number;
};

export type IndexQuote = {
  name: string;
  value: number;
  change: number;
  changePercent: number;
};

export type NewsItem = {
  id: string;
  headline: string;
  source: string;
  time: string;
  tickers: string[];
  sentiment: "positive" | "negative" | "neutral";
};

export const indices: IndexQuote[] = [
  { name: "NIFTY 50", value: 24812.35, change: 186.4, changePercent: 0.76 },
  { name: "SENSEX", value: 81437.9, change: 542.15, changePercent: 0.67 },
  { name: "BANK NIFTY", value: 54120.6, change: -212.85, changePercent: -0.39 },
  { name: "INDIA VIX", value: 12.84, change: -0.62, changePercent: -4.61 },
];

export const stocks: Stock[] = [
  { symbol: "RELIANCE", name: "Reliance Industries", exchange: "NSE", sector: "Energy", price: 2984.4, change: 32.1, changePercent: 1.09, dayHigh: 2996.0, dayLow: 2941.2 },
  { symbol: "TCS", name: "Tata Consultancy Services", exchange: "NSE", sector: "IT", price: 4126.75, change: -41.3, changePercent: -0.99, dayHigh: 4180.0, dayLow: 4110.5 },
  { symbol: "HDFCBANK", name: "HDFC Bank", exchange: "NSE", sector: "Banking", price: 1683.2, change: 12.65, changePercent: 0.76, dayHigh: 1691.0, dayLow: 1662.4 },
  { symbol: "INFY", name: "Infosys", exchange: "NSE", sector: "IT", price: 1872.9, change: 24.8, changePercent: 1.34, dayHigh: 1884.5, dayLow: 1841.0 },
  { symbol: "ICICIBANK", name: "ICICI Bank", exchange: "NSE", sector: "Banking", price: 1247.55, change: -6.4, changePercent: -0.51, dayHigh: 1259.9, dayLow: 1240.1 },
  { symbol: "TATAMOTORS", name: "Tata Motors", exchange: "NSE", sector: "Auto", price: 1012.35, change: 28.9, changePercent: 2.94, dayHigh: 1018.7, dayLow: 982.0 },
  { symbol: "ITC", name: "ITC Ltd", exchange: "NSE", sector: "FMCG", price: 462.15, change: 1.35, changePercent: 0.29, dayHigh: 465.0, dayLow: 458.6 },
  { symbol: "ADANIENT", name: "Adani Enterprises", exchange: "NSE", sector: "Conglomerate", price: 2761.0, change: -63.2, changePercent: -2.24, dayHigh: 2834.0, dayLow: 2748.5 },
  { symbol: "SBIN", name: "State Bank of India", exchange: "NSE", sector: "Banking", price: 812.4, change: 9.15, changePercent: 1.14, dayHigh: 816.0, dayLow: 800.3 },
  { symbol: "BHARTIARTL", name: "Bharti Airtel", exchange: "NSE", sector: "Telecom", price: 1596.8, change: 18.4, changePercent: 1.17, dayHigh: 1602.0, dayLow: 1571.2 },
  { symbol: "SUNPHARMA", name: "Sun Pharmaceutical", exchange: "NSE", sector: "Pharma", price: 1789.25, change: -12.05, changePercent: -0.67, dayHigh: 1806.0, dayLow: 1780.0 },
  { symbol: "LT", name: "Larsen & Toubro", exchange: "NSE", sector: "Infra", price: 3644.7, change: 41.9, changePercent: 1.16, dayHigh: 3658.0, dayLow: 3598.4 },
];

export const defaultWatchlist = ["RELIANCE", "INFY", "TATAMOTORS", "HDFCBANK", "ADANIENT"];

export const holdings: Holding[] = [
  { symbol: "RELIANCE", name: "Reliance Industries", quantity: 24, avgPrice: 2710.5, ltp: 2984.4 },
  { symbol: "INFY", name: "Infosys", quantity: 40, avgPrice: 1655.0, ltp: 1872.9 },
  { symbol: "HDFCBANK", name: "HDFC Bank", quantity: 30, avgPrice: 1742.8, ltp: 1683.2 },
  { symbol: "TATAMOTORS", name: "Tata Motors", quantity: 55, avgPrice: 845.25, ltp: 1012.35 },
  { symbol: "ITC", name: "ITC Ltd", quantity: 120, avgPrice: 441.6, ltp: 462.15 },
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

export const num = (value: number, fraction = 2) =>
  new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: fraction,
    minimumFractionDigits: fraction,
  }).format(value);

export const signed = (value: number, fraction = 2) =>
  `${value >= 0 ? "+" : ""}${num(value, fraction)}`;
