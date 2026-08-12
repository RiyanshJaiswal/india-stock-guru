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

const pythonBin = process.env.NSE_PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");
const servicePath = path.resolve(process.cwd(), "backend/services/nse_service.py");

function runPython(payload: string): Promise<NseServiceResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, [servicePath], {
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

    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error("NSE data service timed out"));
    }, 20_000);

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
        if (code !== 0 && (!parsed.quotes || parsed.quotes.length === 0)) {
          finish(new Error(parsed.errors?.[0]?.error || stderr.trim() || "NSE data service failed"));
          return;
        }
        finish(undefined, parsed);
      } catch {
        finish(new Error(stderr.trim() || "NSE data service returned invalid JSON"));
      }
    });

    child.stdin.write(payload);
    child.stdin.end();
  });
}

export async function fetchNseLiveQuotes(symbols: string[]): Promise<{
  quotes: NseLiveQuote[];
  errors: Array<{ symbol?: string; error?: string }>;
}> {
  const normalized = [...new Set(symbols.map((symbol) => symbol.replace(/\.(NS|BO)$/i, "").trim().toUpperCase()).filter(Boolean))];
  if (normalized.length === 0) return { quotes: [], errors: [] };

  return runPython(JSON.stringify(normalized)).then((result) => ({
    quotes: result.quotes ?? [],
    errors: result.errors ?? [],
  }));
}
