import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";

import { ChartPanel } from "@/components/market/ChartPanel";
import { StatTile } from "@/components/market/StatTile";
import { Delta } from "@/components/market/Delta";
import { quoteQuery } from "@/lib/market-queries";
import { compactInr, compactVolume, exchangeOf, num, stripSuffix } from "@/lib/market-types";

export const Route = createFileRoute("/stock/$symbol")({
  head: ({ params }) => {
    const ticker = stripSuffix(params.symbol);
    return {
      meta: [
        { title: `${ticker} share price, day range & market cap — Dalal Desk` },
        {
          name: "description",
          content: `Latest available ${ticker} quote: current price, change, day high/low, 52 week range, volume and market cap from NSE/BSE.`,
        },
        { property: "og:title", content: `${ticker} — live quote on Dalal Desk` },
        {
          property: "og:description",
          content: `${ticker} price, day range, 52 week range, volume and market cap.`,
        },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: StockDetails,
  errorComponent: ({ error }) => (
    <Shell>
      <p role="alert" className="panel p-6 text-sm text-bear">
        {error.message}
      </p>
    </Shell>
  ),
  notFoundComponent: () => (
    <Shell>
      <p className="panel p-6 text-sm text-muted-foreground">That symbol isn't listed.</p>
    </Shell>
  ),
});

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2/70 px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6 sm:py-6">{children}</main>
    </div>
  );
}

function StockDetails() {
  const { symbol } = Route.useParams();
  const { data: quote, isLoading, isError, refetch, isFetching } = useQuery(quoteQuery(symbol));
  const [chartOpen, setChartOpen] = useState<number | null>(null);
  const fallbackExchange = exchangeOf(symbol);
  const effectiveOpen = quote?.open ?? chartOpen;

  return (
    <Shell>
      {isError && (
        <div className="panel grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-4">
          <p className="min-w-0 text-sm text-bear">
            Couldn't load the latest quote for {stripSuffix(symbol)}.
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-xs font-semibold"
          >
            <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Retry
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartPanel
            quote={quote}
            symbol={symbol}
            isLoading={isLoading}
            linkToDetails={false}
            onLatestOpen={setChartOpen}
          />
        </div>

        <section className="panel p-4 sm:p-5" aria-label="Key statistics">
          <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <h2 className="truncate text-sm font-bold tracking-widest uppercase">Key stats</h2>
            <Delta className="shrink-0" changePercent={quote?.changePercent ?? null} />
          </header>

          <dl className="mt-4 grid grid-cols-2 gap-3">
            <StatTile label="Current price" value={num(quote?.price ?? null)} />
            <StatTile
              label="Price change"
              value={
                quote?.change === null || quote?.change === undefined
                  ? "—"
                  : `${quote.change >= 0 ? "+" : ""}${num(quote.change)}`
              }
              tone={
                quote?.change === null || quote?.change === undefined
                  ? undefined
                  : quote.change >= 0
                    ? "bull"
                    : "bear"
              }
            />
            <StatTile label="Day high" value={num(quote?.dayHigh ?? null)} />
            <StatTile label="Day low" value={num(quote?.dayLow ?? null)} />
            <StatTile label="52 week high" value={num(quote?.fiftyTwoWeekHigh ?? null)} />
            <StatTile label="52 week low" value={num(quote?.fiftyTwoWeekLow ?? null)} />
            <StatTile label="Volume" value={compactVolume(quote?.volume ?? null)} />
            <StatTile label="Market cap" value={compactInr(quote?.marketCap ?? null)} />
            <StatTile label="Prev close" value={num(quote?.previousClose ?? null)} />
            <StatTile label="Open" value={num(effectiveOpen)} />
          </dl>

          <p className="mt-4 text-xs text-muted-foreground">
            {quote?.exchange ?? fallbackExchange} · {quote?.currency ?? "INR"} ·{" "}
            {quote?.marketState === "REGULAR" ? "live session" : "last traded values"}
          </p>
        </section>
      </div>
    </Shell>
  );
}
