const YAHOO_BASE = "https://query2.finance.yahoo.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

/** Recover only a missing opening price; never replace the primary quote. */
export async function fetchYahooOpenPrice(symbol: string): Promise<number | null> {
  const upper = symbol.toUpperCase();
  const normalized = upper.endsWith(".NS") || upper.endsWith(".BO") || upper.startsWith("^") ? symbol : `${symbol}.NS`;
  const url = `${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(normalized)}?interval=1d&range=5d&includePrePost=false&events=div%2Csplits`;
  try {
    const response = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      chart?: { result?: Array<{ meta?: { regularMarketOpen?: number | null } }> };
    };
    const value = body.chart?.result?.[0]?.meta?.regularMarketOpen;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}