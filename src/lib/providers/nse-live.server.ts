/**
 * NSE live quote bridge.
 *
 * The application is TypeScript/TanStack Start, while jugaad-data is a
 * Python package. This small server-only bridge keeps the Python dependency
 * isolated and returns normalized JSON to the TypeScript market provider.
 */
import { spawn } from "node:child_process";
import path from "node:path";

export type NseLiveQuote = {
  symbol: string;
  companyName: string;
  lastPrice: number;
  change: number | null;
  pChange: number | null;
  timestamp: string;
  previousClose: number | null;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  volume: number | null;
  marketCap: number | null;
  marketState: string;
};

type NseServiceResponse = {
  quotes?: NseLiveQuote[];
  errors?: Array<{ symbol?: string; error?: string }>;
};

// NSE renamed some equity tickers after corporate actions (e.g. the Tata
// Motors demerger into TMPV / TMCV). The rest of the app still refers to
// stocks by their original/legacy ticker (e.g. "TATAMOTORS"), so requests
// are translated to the current NSE ticker here, and responses are mapped
// back to the original ticker before returning to the caller.
const NSE_LEGACY_TICKER_MAP: Record<string, string> = {
  TATAMOTORS: "TMCV",
};
function nseProviderTicker(ticker: string): string {
  return NSE_LEGACY_TICKER_MAP[ticker] ?? ticker;
}

const configuredPythonBin = process.env.NSE_PYTHON_BIN?.trim();
const pythonBins = configuredPythonBin
  ? [configuredPythonBin]
  : process.platform === "win32"
    ? ["python", "py", "python3"]
    : ["python3", "python"];
const servicePath = path.resolve(process.cwd(), "backend/services/nse_service.py");

function runPythonWithExecutable(payload: string, executable: string): Promise<NseServiceResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [servicePath], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (error?: Error, result?: NseServiceResponse) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(result ?? { quotes: [], errors: [] });
    };

    // Bound cloud/NSE stalls so the existing Yahoo recovery path can engage.
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error("NSE data service timed out"));
    }, 7_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timeout);
      finish(new Error(`NSE data service could not start: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (settled) return;
      if (!stdout.trim()) {
        finish(new Error(stderr.trim() || `NSE data service exited with code ${code ?? "unknown"}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as NseServiceResponse;
        const quotes = Array.isArray(parsed.quotes) ? parsed.quotes : [];
        const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
        if (code !== 0 || quotes.length === 0) {
          const detail = errors
            .map((item) => [item.symbol, item.error].filter(Boolean).join(": "))
            .filter(Boolean)
            .join("; ");
          finish(new Error(detail || stderr.trim() || "NSE data service returned no quotes"));
          return;
        }
        finish(undefined, { quotes, errors });
      } catch {
        finish(new Error(stderr.trim() || "NSE data service returned invalid JSON"));
      }
    });

    child.stdin.write(payload);
    child.stdin.end();
  });
}

async function runPython(payload: string): Promise<NseServiceResponse> {
  let lastError: Error | null = null;
  for (const executable of pythonBins) {
    try {
      return await runPythonWithExecutable(payload, executable);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("No usable Python executable found for NSE data service");
}

export async function fetchNseLiveQuotes(symbols: string[]): Promise<{
  quotes: NseLiveQuote[];
  errors: Array<{ symbol?: string; error?: string }>;
}> {
  const strippedTickers = [
    ...new Set(symbols.map((symbol) => symbol.replace(/\.(NS|BO)$/i, "").trim().toUpperCase()).filter(Boolean)),
  ];
  if (strippedTickers.length === 0) return { quotes: [], errors: [] };

  const providerTickers = strippedTickers.map(nseProviderTicker);
  const providerToOriginal = new Map(providerTickers.map((provider, index) => [provider, strippedTickers[index]]));

  const result = await runPython(JSON.stringify(providerTickers));
  const quotes = (result.quotes ?? []).map((quote) => ({
    ...quote,
    symbol: providerToOriginal.get(quote.symbol) ?? quote.symbol,
  }));
  const errors = (result.errors ?? []).map((error) => ({
    ...error,
    symbol: error.symbol ? (providerToOriginal.get(error.symbol) ?? error.symbol) : error.symbol,
  }));

  return { quotes, errors };
}

/** Live index quotes (e.g. "^NSEI", "^NSEBANK", "^INDIAVIX") via NSE's allIndices feed. */
export async function fetchNseLiveIndices(indexSymbols: string[]): Promise<{
  quotes: NseLiveQuote[];
  errors: Array<{ symbol?: string; error?: string }>;
}> {
  const unique = [...new Set(indexSymbols.map((symbol) => symbol.trim()).filter(Boolean))];
  if (unique.length === 0) return { quotes: [], errors: [] };

  const payload = JSON.stringify({ mode: "indices", symbols: unique });
  const result = await runPython(payload);
  return {
    quotes: result.quotes ?? [],
    errors: result.errors ?? [],
  };
}
