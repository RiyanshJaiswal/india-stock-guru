import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link } from "@tanstack/react-router";

import { getHistory } from "@/lib/technical.functions";
import { compactInr, compactVolume, num, stripSuffix, type Quote } from "@/lib/market-types";
import { Delta } from "./Delta";
import { StatTile } from "./StatTile";
import { cn } from "@/lib/utils";

const RANGES = [
  { label: "1M", range: "1mo" },
  { label: "3M", range: "3mo" },
  { label: "6M", range: "6mo" },
  { label: "1Y", range: "1y" },
  { label: "2Y", range: "2y" },
  { label: "5Y", range: "5y" },
] as const;

type RangeValue = (typeof RANGES)[number]["range"];

type ChartPoint = {
  time: number;
  close: number;
  volume: number;
  label: string;
};

function formatDate(timestamp: number, range: RangeValue) {
  const date = new Date(timestamp);
  if (range === "5y" || range === "2y") {
    return date.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
  }
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function formatTooltipDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function ChartPanel({
  quote,
  symbol,
  isLoading,
  linkToDetails = true,
}: {
  quote: Quote | null | undefined;
  symbol: string;
  isLoading?: boolean;
  linkToDetails?: boolean;
}) {
  const ticker = quote?.ticker ?? stripSuffix(symbol);
  const exchange = quote?.exchange ?? (symbol.endsWith(".BO") ? "BSE" : "NSE");
  const [selectedRange, setSelectedRange] = useState<RangeValue>("1y");
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);

    getHistory({
      data: {
        symbol,
        interval: "1d",
        range: selectedRange,
      },
    })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setPoints([]);
          setHistoryError(result.error.message);
          return;
        }
        setPoints(
          result.candles.map((candle) => ({
            time: candle.time,
            close: candle.close,
            volume: candle.volume,
            label: formatDate(candle.time, selectedRange),
          })),
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setPoints([]);
        setHistoryError(error instanceof Error ? error.message : "Unable to load chart data.");
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [symbol, selectedRange]);

  const chartData = useMemo(() => {
    if (points.length <= 180) return points;
    const step = Math.ceil(points.length / 180);
    return points.filter((_, index) => index % step === 0 || index === points.length - 1);
  }, [points]);

  const latestClose = points.at(-1)?.close ?? quote?.price ?? null;
  const firstClose = points[0]?.close ?? latestClose;
  const periodChange =
    latestClose !== null && firstClose !== null && firstClose !== 0
      ? ((latestClose - firstClose) / firstClose) * 100
      : null;

  return (
    <section className="panel p-4 sm:p-5" aria-label={`${ticker} chart`}>
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-lg font-bold sm:text-xl">{ticker}</h2>
            <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {exchange}
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {isLoading ? "Fetching latest quote…" : (quote?.name ?? symbol)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="num text-lg font-bold sm:text-2xl">{num(quote?.price ?? latestClose)}</p>
          <Delta change={quote?.change ?? null} changePercent={quote?.changePercent ?? periodChange} />
        </div>
      </header>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {RANGES.map(({ label, range }) => (
          <button
            key={range}
            type="button"
            onClick={() => setSelectedRange(range)}
            className={cn(
              "num rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
              selectedRange === range
                ? "bg-primary text-primary-foreground"
                : "bg-surface-2/70 text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 h-56 rounded-xl border border-border bg-surface-2/40 p-2 sm:h-72">
        {historyLoading ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            Loading historical prices…
          </div>
        ) : historyError ? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <p className="text-sm font-semibold">Chart data unavailable</p>
              <p className="mt-1 text-xs text-muted-foreground">{historyError}</p>
            </div>
          </div>
        ) : chartData.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            No historical data available.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
              <XAxis
                dataKey="time"
                tickFormatter={(value) => formatDate(Number(value), selectedRange)}
                tick={{ fontSize: 10 }}
                minTickGap={28}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                yAxisId="price"
                domain={["auto", "auto"]}
                tick={{ fontSize: 10 }}
                tickFormatter={(value) => `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
                width={58}
                axisLine={false}
                tickLine={false}
              />
              <YAxis yAxisId="volume" orientation="right" hide domain={[0, "auto"]} />
              <Tooltip
                labelFormatter={(value) => formatTooltipDate(Number(value))}
                formatter={(value, name) => [
                  name === "close"
                    ? `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
                    : compactVolume(Number(value)),
                  name === "close" ? "Close" : "Volume",
                ]}
                contentStyle={{
                  borderRadius: 10,
                  border: "1px solid hsl(var(--border))",
                  background: "hsl(var(--background))",
                  fontSize: 12,
                }}
              />
              <Bar
                yAxisId="volume"
                dataKey="volume"
                fill="currentColor"
                className="text-primary/15"
                barSize={3}
                isAnimationActive={false}
              />
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="close"
                stroke="currentColor"
                className="text-primary"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Day high" value={num(quote?.dayHigh ?? null)} />
        <StatTile label="Day low" value={num(quote?.dayLow ?? null)} />
        <StatTile label="Volume" value={compactVolume(quote?.volume ?? null)} />
        <StatTile label="Market cap" value={compactInr(quote?.marketCap ?? null)} />
      </dl>

      {linkToDetails && (
        <Link
          to="/stock/$symbol"
          params={{ symbol }}
          className="mt-4 block rounded-xl bg-surface-2/70 py-2 text-center text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          View full details
        </Link>
      )}
    </section>
  );
}
