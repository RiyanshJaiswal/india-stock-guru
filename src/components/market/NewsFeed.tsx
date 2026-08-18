import { RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { marketNewsQuery } from "@/lib/market-queries";
import { cn } from "@/lib/utils";

const toneClass = {
  positive: "bg-bull/12 text-bull",
  negative: "bg-bear/12 text-bear",
  neutral: "bg-surface-2 text-muted-foreground",
} as const;

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatRelative(value: string): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NewsFeed() {
  const { data: news = [], isLoading, isFetching, isError, refetch } = useQuery(marketNewsQuery());

  return (
    <section className="panel p-4" aria-label="Market news">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold tracking-widest uppercase">Market News</h2>
          <p className="mt-1 text-xs text-muted-foreground">Latest Indian market news · past 24 hours</p>
        </div>
        <button
          type="button"
          aria-label="Refresh market news"
          title="Refresh market news"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="cursor-pointer rounded-xl border border-border bg-surface-2/70 p-2 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
        </button>
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading latest market news…</p>
      ) : isError ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted-foreground">
          <span>Market news is temporarily unavailable.</span>
          <button type="button" onClick={() => void refetch()} className="font-semibold text-foreground hover:underline">
            Retry
          </button>
        </div>
      ) : news.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No recent market news available.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {news.map((item) => (
            <li key={item.id} className="py-3 first:pt-1">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 text-sm leading-snug font-medium hover:underline"
                >
                  {item.headline}
                </a>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
                    toneClass[item.sentiment],
                  )}
                >
                  {item.sentiment}
                </span>
              </div>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>{item.source}</span>
                <span aria-hidden>·</span>
                <time dateTime={item.publishedAt} title={formatDate(item.publishedAt)}>
                  {formatDate(item.publishedAt)} · {formatRelative(item.publishedAt)}
                </time>
                {item.tickers.map((ticker) => (
                  <span key={ticker} className="num rounded bg-surface-2 px-1.5 py-0.5 text-[10px]">
                    {ticker}
                  </span>
                ))}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
