import { X } from "lucide-react";
import { stocks, num, type Stock } from "@/data/market";
import { Delta } from "./Delta";
import { cn } from "@/lib/utils";

export function Watchlist({
  symbols,
  activeSymbol,
  onSelect,
  onRemove,
}: {
  symbols: string[];
  activeSymbol: string;
  onSelect: (stock: Stock) => void;
  onRemove: (symbol: string) => void;
}) {
  const rows = symbols
    .map((symbol) => stocks.find((s) => s.symbol === symbol))
    .filter((s): s is Stock => Boolean(s));

  return (
    <section className="panel flex flex-col p-4" aria-label="Watchlist">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <h2 className="truncate text-sm font-bold tracking-widest uppercase">Watchlist</h2>
        <span className="num shrink-0 rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground">
          {rows.length}
        </span>
      </header>

      <ul className="mt-3 space-y-1">
        {rows.map((stock) => (
          <li key={stock.symbol}>
            <div
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-transparent px-2.5 py-2 transition-colors hover:bg-surface-2",
                activeSymbol === stock.symbol && "border-primary/40 bg-surface-2",
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(stock)}
                className="min-w-0 text-left"
              >
                <p className="truncate text-sm font-semibold">{stock.symbol}</p>
                <p className="truncate text-xs text-muted-foreground">{stock.sector}</p>
              </button>
              <div className="flex shrink-0 items-center gap-2">
                <div className="text-right">
                  <p className="num text-sm font-semibold">{num(stock.price)}</p>
                  <Delta changePercent={stock.changePercent} showIcon={false} />
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${stock.symbol} from watchlist`}
                  onClick={() => onRemove(stock.symbol)}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-bear/15 hover:text-bear"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="py-6 text-center text-sm text-muted-foreground">
            Search a stock above to start tracking it.
          </li>
        )}
      </ul>
    </section>
  );
}
