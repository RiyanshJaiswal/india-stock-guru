import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Search, Plus, Check, Loader2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { searchQuery } from "@/lib/market-queries";
import type { SearchResult } from "@/lib/market-types";

/** Live NSE/BSE symbol search. Debounced, cached, keyboard-friendly. */
export function StockSearch({
  watchlist,
  onToggle,
}: {
  watchlist: string[];
  onToggle: (symbol: string) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(id);
  }, [query]);

  const { data, isFetching, isError } = useQuery(searchQuery(debounced));
  const results = useMemo<SearchResult[]>(() => data ?? [], [data]);
  const open = debounced.length >= 2 && query.trim().length >= 2;

  const openStock = (symbol: string) => {
    setQuery("");
    setDebounced("");
    navigate({ to: "/stock/$symbol", params: { symbol } });
  };

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
        placeholder="Search NSE / BSE — try RELIANCE, Infosys, Tata"
        className="h-11 rounded-xl border-border bg-surface-2/70 pl-9 text-sm"
        autoComplete="off"
      />
      {isFetching && open && (
        <Loader2 className="absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}

      {open && (
        <div className="panel absolute z-30 mt-2 max-h-80 w-full overflow-auto p-1.5">
          {isError && (
            <p className="px-3 py-4 text-sm text-bear">
              Couldn't reach the market data service. Try again.
            </p>
          )}
          {!isError && results.length === 0 && !isFetching && (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              No listed stock matches “{debounced}”.
            </p>
          )}
          <ul>
            {results.map((result) => {
              const inList = watchlist.includes(result.symbol);
              return (
                <li key={result.symbol}>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2">
                    <button
                      type="button"
                      onClick={() => openStock(result.symbol)}
                      className="min-w-0 text-left"
                    >
                      <p className="truncate text-sm font-semibold">
                        {result.ticker}
                        <span className="ml-2 text-[10px] font-medium text-muted-foreground">
                          {result.exchange}
                        </span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{result.name}</p>
                    </button>
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      aria-label={
                        inList
                          ? `Remove ${result.ticker} from watchlist`
                          : `Add ${result.ticker} to watchlist`
                      }
                      onClick={() => onToggle(result.symbol)}
                      className="h-8 w-8 shrink-0 rounded-lg"
                    >
                      {inList ? <Check className="h-4 w-4 text-bull" /> : <Plus className="h-4 w-4" />}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
