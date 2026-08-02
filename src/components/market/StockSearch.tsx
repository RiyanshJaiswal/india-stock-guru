import { useMemo, useState } from "react";
import { Search, Plus, Check } from "lucide-react";
import { stocks, type Stock, num } from "@/data/market";
import { Delta } from "./Delta";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function StockSearch({
  watchlist,
  onToggle,
  onSelect,
}: {
  watchlist: string[];
  onToggle: (symbol: string) => void;
  onSelect: (stock: Stock) => void;
}) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return stocks
      .filter(
        (s) =>
          s.symbol.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.sector.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [query]);

  return (
    <div className="relative">
      <label htmlFor="stock-search" className="sr-only">
        Search Indian stocks
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id="stock-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search NSE / BSE — try RELIANCE, banking, Infosys"
        className="h-11 rounded-xl border-border bg-surface-2/70 pl-9 text-sm"
      />

      {results.length > 0 && (
        <ul className="panel absolute z-30 mt-2 max-h-80 w-full overflow-auto p-1.5">
          {results.map((stock) => {
            const inList = watchlist.includes(stock.symbol);
            return (
              <li key={stock.symbol}>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2">
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(stock);
                      setQuery("");
                    }}
                    className="min-w-0 text-left"
                  >
                    <p className="truncate text-sm font-semibold">
                      {stock.symbol}
                      <span className="ml-2 text-[10px] font-medium text-muted-foreground">
                        {stock.exchange}
                      </span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{stock.name}</p>
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="text-right">
                      <p className="num text-sm font-semibold">{num(stock.price)}</p>
                      <Delta changePercent={stock.changePercent} showIcon={false} />
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      aria-label={inList ? `Remove ${stock.symbol}` : `Add ${stock.symbol}`}
                      onClick={() => onToggle(stock.symbol)}
                      className="h-8 w-8 rounded-lg"
                    >
                      {inList ? <Check className="h-4 w-4 text-bull" /> : <Plus className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
