import { news } from "@/data/market";
import { cn } from "@/lib/utils";

const toneClass = {
  positive: "bg-bull/12 text-bull",
  negative: "bg-bear/12 text-bear",
  neutral: "bg-surface-2 text-muted-foreground",
} as const;

export function NewsFeed() {
  return (
    <section className="panel p-4" aria-label="Market news">
      <h2 className="text-sm font-bold tracking-widest uppercase">Market News</h2>
      <ul className="mt-3 divide-y divide-border">
        {news.map((item) => (
          <li key={item.id} className="py-3 first:pt-1">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <p className="min-w-0 text-sm leading-snug font-medium">{item.headline}</p>
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
              <span>{item.time}</span>
              {item.tickers.map((ticker) => (
                <span key={ticker} className="num rounded bg-surface-2 px-1.5 py-0.5 text-[10px]">
                  {ticker}
                </span>
              ))}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
