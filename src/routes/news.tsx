import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, Clock3, ExternalLink, Minus, RefreshCw, Search, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";

import { marketNewsArchiveQuery } from "@/lib/market-queries";
import { cn } from "@/lib/utils";

const toneClass = {
  positive: "bg-bull/12 text-bull",
  negative: "bg-bear/12 text-bear",
  neutral: "bg-surface-2 text-muted-foreground",
} as const;

const impactClass = {
  bullish: "border-bull/25 bg-bull/10 text-bull",
  bearish: "border-bear/25 bg-bear/10 text-bear",
  neutral: "border-border bg-surface-2/70 text-muted-foreground",
} as const;

function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }).format(date);
}

function relative(value: string): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function impactFor(direction: "bullish" | "bearish" | "neutral") {
  if (direction === "bullish") return { label: "Bullish bias", icon: TrendingUp };
  if (direction === "bearish") return { label: "Bearish bias", icon: TrendingDown };
  return { label: "Neutral / watch", icon: Minus };
}

function prettyEvent(value: string): string {
  return value === "general" ? "Market / company news" : value.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export const Route = createFileRoute("/news")({
  head: () => ({ meta: [{ title: "Market News — Dalal Desk" }, { name: "description", content: "Indian stock market news with event and stock-impact intelligence." }] }),
  component: NewsPage,
});

function NewsPage() {
  const [date, setDate] = useState(todayIST);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const { data: news = [], isLoading, isFetching, isError, refetch } = useQuery(marketNewsArchiveQuery(date, search));
  const submitSearch = () => setSearch(searchInput.trim());

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border bg-surface-2/70 px-3 py-2 text-sm font-semibold hover:bg-surface-2"><ArrowLeft className="h-4 w-4" />Dashboard</Link>
          <div className="min-w-0"><h1 className="truncate text-lg font-black sm:text-xl">Market News</h1><p className="truncate text-xs text-muted-foreground">Indian market news · event & stock-impact intelligence</p></div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-5 sm:px-6 sm:py-6">
        <section className="panel p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <label className="flex-1">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Search share / company</span>
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submitSearch(); }} placeholder="e.g. Reliance, TCS, SPML Infra…" className="w-full rounded-xl border border-border bg-surface-2/70 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary" /></div>
                <button type="button" onClick={submitSearch} className="cursor-pointer rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">Search</button>
              </div>
            </label>
            <label className="lg:w-48"><span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">News date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="w-full rounded-xl border border-border bg-surface-2/70 px-3 py-2.5 text-sm outline-none focus:border-primary" /></label>
            <button type="button" aria-label="Refresh news" title="Refresh news" onClick={() => void refetch()} disabled={isFetching} className="cursor-pointer rounded-xl border border-border bg-surface-2/70 p-2.5 text-muted-foreground hover:text-foreground disabled:opacity-60"><RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} /></button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{search ? `Showing results for “${search}”` : "Showing all available market news"}</span><span>·</span><span>{date}</span>{search && <button type="button" onClick={() => { setSearchInput(""); setSearch(""); }} className="font-semibold text-primary hover:underline">Clear search</button>}</div>
        </section>

        <section className="panel overflow-hidden">
          <div className="border-b border-border px-4 py-4 sm:px-5"><h2 className="text-sm font-bold tracking-widest uppercase">{search ? `News for ${search}` : "All Market News"}</h2><p className="mt-1 text-xs text-muted-foreground">{news.length} articles found · sorted newest first</p></div>

          {isLoading ? <p className="px-4 py-8 text-sm text-muted-foreground sm:px-5">Loading news…</p> : isError ? (
            <div className="flex items-center justify-between gap-3 px-4 py-8 text-sm text-muted-foreground sm:px-5"><span>News is temporarily unavailable.</span><button type="button" onClick={() => void refetch()} className="font-semibold text-foreground hover:underline">Retry</button></div>
          ) : news.length === 0 ? (
            <div className="px-4 py-10 text-center sm:px-5"><p className="text-sm font-semibold">No matching news found.</p><p className="mt-1 text-xs text-muted-foreground">Try the company name, NSE symbol, or another date.</p></div>
          ) : (
            <ul className="divide-y divide-border">
              {news.map((item) => {
                const impact = impactFor(item.impactDirection);
                const ImpactIcon = impact.icon;
                return (
                  <li key={item.id} className="px-4 py-4 transition-colors hover:bg-surface-2/30 sm:px-5">
                    <div className="flex items-start justify-between gap-3"><a href={item.url} target="_blank" rel="noreferrer" className="min-w-0 text-sm font-semibold leading-snug hover:text-primary hover:underline sm:text-[15px]">{item.headline}</a><span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase", toneClass[item.sentiment])}>{item.sentiment}</span></div>

                    {item.tickers.length > 0 && (
                      <div className={cn("mt-3 rounded-xl border p-3", impactClass[item.impactDirection])}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2"><ImpactIcon className="h-4 w-4" /><span className="text-xs font-bold uppercase tracking-wider">Potential stock impact</span></div>
                          <span className="text-xs font-black">{impact.label}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">{item.tickers.map((ticker) => <Link key={ticker} to="/stock/$symbol" params={{ symbol: `${ticker}.NS` }} className="rounded-lg bg-background/50 px-2.5 py-1.5 text-xs font-black hover:underline">{ticker}</Link>)}</div>
                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <div className="rounded-lg bg-background/40 p-2"><div className="flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-70"><BarChart3 className="h-3 w-3" />Impact</div><p className="mt-0.5 text-xs font-black">{item.impactLevel} · {item.impactScore}/100</p></div>
                          <div className="rounded-lg bg-background/40 p-2"><div className="flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-70"><Clock3 className="h-3 w-3" />Horizon</div><p className="mt-0.5 text-xs font-black">{item.timeHorizon}</p></div>
                          <div className="rounded-lg bg-background/40 p-2"><div className="flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-70"><ShieldCheck className="h-3 w-3" />Confidence</div><p className="mt-0.5 text-xs font-black">{item.confidence}%</p></div>
                          <div className="rounded-lg bg-background/40 p-2"><div className="text-[10px] uppercase tracking-wider opacity-70">Event</div><p className="mt-0.5 truncate text-xs font-black">{prettyEvent(item.primaryEventType)}</p></div>
                        </div>
                        <p className="mt-2 text-[11px] opacity-80">{item.impactReason}</p>
                        <p className="mt-1 text-[10px] opacity-60">Rule-based news signal — not a guaranteed price prediction or investment advice.</p>
                      </div>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"><span>{item.source}</span><span aria-hidden>·</span><time title={formatDate(item.publishedAt)}>{formatDate(item.publishedAt)} · {relative(item.publishedAt)}</time>{item.eventTypes.filter((type) => type !== "general").slice(0, 2).map((type) => <span key={type} className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase">{type.replace(/-/g, " ")}</span>)}<a href={item.url} target="_blank" rel="noreferrer" aria-label="Open article" className="ml-auto inline-flex items-center gap-1 font-semibold text-primary hover:underline">Open <ExternalLink className="h-3 w-3" /></a></div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
