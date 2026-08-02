import { CandlestickChart } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { compactInr, compactVolume, num, stripSuffix, type Quote } from "@/lib/market-types";
import { Delta } from "./Delta";
import { StatTile } from "./StatTile";
import { cn } from "@/lib/utils";

const RANGES = ["1D", "1W", "1M", "6M", "1Y", "5Y"];

/**
 * Quote header + TradingView chart placeholder.
 * Replace the dashed block with the TradingView Advanced Chart widget using
 * `${exchange}:${ticker}` once the widget script is embedded.
 */
export function ChartPanel({
  quote,
  symbol,
  isLoading,
  linkToDetails = true,
}: {
  quote: Quote | null | undefined;
  symbol: string;
  isLoading?: boolean;
  linkToDetails?: boolean;
}) {
  const ticker = quote?.ticker ?? stripSuffix(symbol);
  const exchange = quote?.exchange ?? (symbol.endsWith(".BO") ? "BSE" : "NSE");

  return (
    <section className="panel p-4 sm:p-5" aria-label={`${ticker} chart`}>
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-lg font-bold sm:text-xl">{ticker}</h2>
            <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {exchange}
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {isLoading ? "Fetching latest quote…" : (quote?.name ?? symbol)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="num text-lg font-bold sm:text-2xl">{num(quote?.price ?? null)}</p>
          <Delta change={quote?.change ?? null} changePercent={quote?.changePercent ?? null} />
        </div>
      </header>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {RANGES.map((range, index) => (
          <button
            key={range}
            type="button"
            className={cn(
              "num rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
              index === 0
                ? "bg-primary text-primary-foreground"
                : "bg-surface-2/70 text-muted-foreground hover:text-foreground",
            )}
          >
            {range}
          </button>
        ))}
      </div>

      <div className="mt-4 grid h-56 place-items-center rounded-xl border border-dashed border-border bg-surface-2/40 sm:h-72">
        <div className="px-6 text-center">
          <CandlestickChart className="mx-auto h-8 w-8 text-primary" />
          <p className="mt-2 text-sm font-semibold">TradingView chart placeholder</p>
          <p className="num mt-1 text-xs text-muted-foreground">
            {exchange}:{ticker}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Day high" value={num(quote?.dayHigh ?? null)} />
        <StatTile label="Day low" value={num(quote?.dayLow ?? null)} />
        <StatTile label="Volume" value={compactVolume(quote?.volume ?? null)} />
        <StatTile label="Market cap" value={compactInr(quote?.marketCap ?? null)} />
      </dl>

      {linkToDetails && (
        <Link
          to="/stock/$symbol"
          params={{ symbol }}
          className="mt-4 block rounded-xl bg-surface-2/70 py-2 text-center text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          View full details
        </Link>
      )}
    </section>
  );
}
