import { useQuery } from "@tanstack/react-query";
import { INDEX_LABELS, INDEX_SYMBOLS, num } from "@/lib/market-types";
import { quotesQuery } from "@/lib/market-queries";
import { Delta } from "./Delta";

export function MarketOverview() {
  const { data, isLoading } = useQuery(quotesQuery([...INDEX_SYMBOLS]));

  return (
    <section aria-label="Index overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {INDEX_SYMBOLS.map((symbol) => {
        const quote = data?.find((item) => item.symbol === symbol);
        return (
          <article key={symbol} className="panel p-4">
            <p className="truncate text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              {INDEX_LABELS[symbol]}
            </p>
            <p className="num mt-2 text-xl font-bold sm:text-2xl">
              {isLoading ? "…" : num(quote?.price ?? null)}
            </p>
            <Delta
              className="mt-2"
              change={quote?.change ?? null}
              changePercent={quote?.changePercent ?? null}
            />
          </article>
        );
      })}
    </section>
  );
}
