import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";

import { quotesQuery } from "@/lib/market-queries";
import { num, stripSuffix, exchangeOf } from "@/lib/market-types";
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
  onSelect: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}) {
  const { data } = useQuery(quotesQuery(symbols));

  return (
    <section className="panel flex flex-col p-4" aria-label="Watchlist">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <h2 className="truncate text-sm font-bold tracking-widest uppercase">Watchlist</h2>
        <span className="num shrink-0 rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground">
          {symbols.length}
        </span>
      </header>

      <ul className="mt-3 space-y-1">
        {symbols.map((symbol) => {
          const quote = data?.find((item) => item.symbol === symbol);
          return (
            <li key={symbol}>
              <div
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-transparent px-2.5 py-2 transition-colors hover:bg-surface-2",
                  activeSymbol === symbol && "border-primary/40 bg-surface-2",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(symbol)}
                  className="min-w-0 text-left"
                >
                  <p className="truncate text-sm font-semibold">{stripSuffix(symbol)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {quote?.name ?? exchangeOf(symbol)}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right">
                    <p className="num text-sm font-semibold">{num(quote?.price ?? null)}</p>
                    <Delta changePercent={quote?.changePercent ?? null} showIcon={false} />
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${stripSuffix(symbol)} from watchlist`}
                    onClick={() => onRemove(symbol)}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-bear/15 hover:text-bear"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
        {symbols.length === 0 && (
          <li className="py-6 text-center text-sm text-muted-foreground">
            Search a stock above to start tracking it.
          </li>
        )}
      </ul>

      {activeSymbol && (
        <Link
          to="/stock/$symbol"
          params={{ symbol: activeSymbol }}
          className="mt-3 rounded-xl bg-surface-2/70 py-2 text-center text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          Open {stripSuffix(activeSymbol)} details
        </Link>
      )}
    </section>
  );
}
