import { CandlestickChart } from "lucide-react";
import { num, type Stock } from "@/data/market";
import { Delta } from "./Delta";
import { cn } from "@/lib/utils";

const RANGES = ["1D", "1W", "1M", "6M", "1Y", "5Y"];

/**
 * TradingView chart placeholder.
 * Replace the inner panel with the TradingView Advanced Chart widget
 * (symbol: `${stock.exchange}:${stock.symbol}`) once the script is embedded.
 */
export function ChartPanel({ stock }: { stock: Stock }) {
  return (
    <section className="panel p-4 sm:p-5" aria-label={`${stock.symbol} chart`}>
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-lg font-bold sm:text-xl">{stock.symbol}</h2>
            <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {stock.exchange}
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {stock.name} · {stock.sector}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="num text-lg font-bold sm:text-2xl">{num(stock.price)}</p>
          <Delta change={stock.change} changePercent={stock.changePercent} />
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
            {stock.exchange}:{stock.symbol}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Day high", num(stock.dayHigh)],
          ["Day low", num(stock.dayLow)],
          ["Prev close", num(stock.price - stock.change)],
          ["Sector", stock.sector],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-surface-2/60 p-3">
            <dt className="text-[11px] tracking-wider text-muted-foreground uppercase">{label}</dt>
            <dd className="num mt-1 truncate text-sm font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
