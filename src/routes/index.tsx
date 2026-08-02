import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { MarketOverview } from "@/components/market/MarketOverview";
import { StockSearch } from "@/components/market/StockSearch";
import { Watchlist } from "@/components/market/Watchlist";
import { Portfolio } from "@/components/market/Portfolio";
import { AiAssistant } from "@/components/market/AiAssistant";
import { NewsFeed } from "@/components/market/NewsFeed";
import { ChartPanel } from "@/components/market/ChartPanel";
import { defaultWatchlist } from "@/data/market";
import { quoteQuery } from "@/lib/market-queries";
import { stripSuffix } from "@/lib/market-types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dalal Desk — AI Indian Stock Market Dashboard" },
      {
        name: "description",
        content:
          "Search every NSE and BSE listed stock, track your watchlist, portfolio P&L, market news and an AI market copilot in one dark dashboard.",
      },
      { property: "og:title", content: "Dalal Desk — AI Indian Stock Market Dashboard" },
      {
        property: "og:description",
        content:
          "Live NSE/BSE stock search, watchlist, portfolio P&L, market news and an AI copilot in one dark dashboard.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const queryClient = useQueryClient();
  const [watchlist, setWatchlist] = useState<string[]>(defaultWatchlist);
  const [activeSymbol, setActiveSymbol] = useState(defaultWatchlist[0]!);

  const { data: activeQuote, isLoading } = useQuery(quoteQuery(activeSymbol));

  const toggleWatch = (symbol: string) =>
    setWatchlist((prev) =>
      prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol],
    );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
              <Activity className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-black sm:text-xl">Dalal Desk</h1>
              <p className="truncate text-xs text-muted-foreground">
                NSE · BSE — AI market terminal
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full bg-bull/12 px-2.5 py-1 text-xs font-semibold text-bull sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-bull" />
              {activeQuote?.marketState === "REGULAR" ? "Market open" : "Market closed"}
            </span>
            <button
              type="button"
              aria-label="Refresh data"
              onClick={() => queryClient.invalidateQueries()}
              className="rounded-xl border border-border bg-surface-2/70 p-2 text-muted-foreground transition-colors hover:text-foreground"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6 sm:py-6">
        <StockSearch watchlist={watchlist} onToggle={toggleWatch} />

        <MarketOverview />

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <ChartPanel quote={activeQuote} symbol={activeSymbol} isLoading={isLoading} />
            <Portfolio />
          </div>
          <div className="space-y-4">
            <Watchlist
              symbols={watchlist}
              activeSymbol={activeSymbol}
              onSelect={setActiveSymbol}
              onRemove={toggleWatch}
            />
            <AiAssistant activeSymbol={stripSuffix(activeSymbol)} />
          </div>
        </div>

        <NewsFeed />

        <p className="pb-6 text-center text-xs text-muted-foreground">
          Quotes are delayed and provided for personal research. Swap the market service for your
          FastAPI backend to change the data source.
        </p>
      </main>
    </div>
  );
}
