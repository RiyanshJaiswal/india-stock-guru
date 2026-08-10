import { useEffect, useMemo, useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "@tanstack/react-router";
import { getHistory } from "@/lib/technical.functions";
import { compactInr, compactVolume, num, stripSuffix, type Quote } from "@/lib/market-types";
import { Delta } from "./Delta";
import { StatTile } from "./StatTile";
import { cn } from "@/lib/utils";

const RANGES = [
  { label: "1M", range: "1mo" }, { label: "3M", range: "3mo" }, { label: "6M", range: "6mo" },
  { label: "1Y", range: "1y" }, { label: "2Y", range: "2y" }, { label: "5Y", range: "5y" },
] as const;
const SMA20_COLOR = "#f59e0b";
const SMA50_COLOR = "#38bdf8";
const EMA20_COLOR = "#a78bfa";
const EMA50_COLOR = "#34d399";
const RSI_COLOR = "#f97316";
const MACD_COLOR = "#ec4899";
const MACD_SIGNAL_COLOR = "#8b5cf6";
const MACD_HISTOGRAM_POSITIVE_COLOR = "#22c55e";
const MACD_HISTOGRAM_NEGATIVE_COLOR = "#ef4444";
const SUPPORT_RESISTANCE_COLOR = "#facc15";

type RangeValue = (typeof RANGES)[number]["range"];
type ChartPoint = {
  time: number; open: number; high: number; low: number; close: number; volume: number; label: string;
  sma20: number | null; sma50: number | null; ema20: number | null; ema50: number | null;
  rsi: number | null; macd: number | null; macdSignal: number | null; macdHistogram: number | null;
};

function formatDate(timestamp: number, range: RangeValue) {
  const date = new Date(timestamp);
  return date.toLocaleDateString("en-IN", range === "5y" || range === "2y" ? { month: "short", year: "2-digit" } : { day: "2-digit", month: "short" });
}
function formatTooltipDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function sma(values: number[], index: number, period: number) {
  if (index < period - 1) return null;
  const slice = values.slice(index - period + 1, index + 1);
  return slice.reduce((sum, value) => sum + value, 0) / period;
}
function emaSeries(values: number[], period: number) {
  const result: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period) return result;
  let previous = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = previous;
  const multiplier = 2 / (period + 1);
  for (let i = period; i < values.length; i += 1) {
    previous = (values[i] - previous) * multiplier + previous;
    result[i] = previous;
  }
  return result;
}
function rsiSeries(values: number[], period = 14) {
  const result: Array<number | null> = Array(values.length).fill(null);
  if (values.length <= period) return result;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i += 1) { const change = values[i] - values[i - 1]; if (change >= 0) gains += change; else losses -= change; }
  let averageGain = gains / period, averageLoss = losses / period;
  result[period] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    result[i] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  }
  return result;
}

export function ChartPanel({ quote, symbol, isLoading, linkToDetails = true }: { quote: Quote | null | undefined; symbol: string; isLoading?: boolean; linkToDetails?: boolean }) {
  const ticker = quote?.ticker ?? stripSuffix(symbol);
  const exchange = quote?.exchange ?? (symbol.endsWith(".BO") ? "BSE" : "NSE");
  const [selectedRange, setSelectedRange] = useState<RangeValue>("1y");
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [showSma20, setShowSma20] = useState(true), [showSma50, setShowSma50] = useState(false), [showEma20, setShowEma20] = useState(false), [showEma50, setShowEma50] = useState(false);
  const [showRsi, setShowRsi] = useState(false), [showMacd, setShowMacd] = useState(false), [showSupportResistance, setShowSupportResistance] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true); setHistoryError(null);
    getHistory({ data: { symbol, interval: "1d", range: selectedRange } }).then((result) => {
      if (cancelled) return;
      if (!result.ok) { setPoints([]); setHistoryError(result.error.message); return; }
      const candles = result.candles, closes = candles.map((c) => c.close);
      const ema20 = emaSeries(closes, 20), ema50 = emaSeries(closes, 50), rsi = rsiSeries(closes, 14);
      const fast = emaSeries(closes, 12), slow = emaSeries(closes, 26);
      const macd = closes.map((_, i) => fast[i] !== null && slow[i] !== null ? fast[i]! - slow[i]! : null);
      const signal = emaSeries(macd.map((v) => v ?? 0), 9).map((v, i) => macd[i] === null ? null : v);
      setPoints(candles.map((c, i) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, label: formatDate(c.time, selectedRange), sma20: sma(closes, i, 20), sma50: sma(closes, i, 50), ema20: ema20[i], ema50: ema50[i], rsi: rsi[i], macd: macd[i], macdSignal: signal[i], macdHistogram: macd[i] !== null && signal[i] !== null ? macd[i]! - signal[i]! : null })));
    }).catch((error) => { if (!cancelled) { setPoints([]); setHistoryError(error instanceof Error ? error.message : "Unable to load chart data."); } }).finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, selectedRange]);

  const chartData = useMemo(() => {
    if (points.length <= 180) return points;
    const step = Math.ceil(points.length / 180);
    return points.filter((_, i) => i % step === 0 || i === points.length - 1);
  }, [points]);
  const macdCrossovers = useMemo(() => chartData.flatMap((point, index) => {
    const previous = chartData[index - 1];
    if (!previous || point.macd === null || point.macdSignal === null || previous.macd === null || previous.macdSignal === null) return [];
    const bullish = previous.macd <= previous.macdSignal && point.macd > point.macdSignal;
    const bearish = previous.macd >= previous.macdSignal && point.macd < point.macdSignal;
    return bullish || bearish ? [{ point, bullish }] : [];
  }), [chartData]);
  const supportResistance = useMemo(() => {
    const recentPoints = points.slice(-20);
    if (recentPoints.length === 0) return null;
    return {
      support: Math.min(...recentPoints.map((point) => point.low)),
      resistance: Math.max(...recentPoints.map((point) => point.high)),
    };
  }, [points]);
  const latestClose = points.at(-1)?.close ?? quote?.price ?? null;
  const firstClose = points[0]?.close ?? latestClose;
  const periodChange = latestClose !== null && firstClose !== null && firstClose !== 0 ? ((latestClose - firstClose) / firstClose) * 100 : null;
  const overlays = [
    { key: "sma20", label: "SMA 20", active: showSma20, setActive: setShowSma20, color: SMA20_COLOR },
    { key: "sma50", label: "SMA 50", active: showSma50, setActive: setShowSma50, color: SMA50_COLOR },
    { key: "ema20", label: "EMA 20", active: showEma20, setActive: setShowEma20, color: EMA20_COLOR },
    { key: "ema50", label: "EMA 50", active: showEma50, setActive: setShowEma50, color: EMA50_COLOR },
    { key: "rsi", label: "RSI 14", active: showRsi, setActive: setShowRsi, color: RSI_COLOR },
    { key: "macd", label: "MACD", active: showMacd, setActive: setShowMacd, color: MACD_COLOR },
    { key: "supportResistance", label: "S/R 20", active: showSupportResistance, setActive: setShowSupportResistance, color: SUPPORT_RESISTANCE_COLOR },
  ] as const;

  return <section className="panel p-4 sm:p-5" aria-label={`${ticker} chart`}>
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:items-center sm:justify-between">
      <div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><h2 className="truncate text-lg font-bold sm:text-xl">{ticker}</h2><span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{exchange}</span></div><p className="truncate text-xs text-muted-foreground">{isLoading ? "Fetching latest quote…" : (quote?.name ?? symbol)}</p></div>
      <div className="shrink-0 text-right"><p className="num text-lg font-bold sm:text-2xl">{num(quote?.price ?? latestClose)}</p><Delta change={quote?.change ?? null} changePercent={quote?.changePercent ?? periodChange} /></div>
    </header>
    <div className="mt-4 flex flex-wrap gap-1.5">{RANGES.map(({ label, range }) => <button key={range} type="button" onClick={() => setSelectedRange(range)} className={cn("num rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors", selectedRange === range ? "bg-primary text-primary-foreground" : "bg-surface-2/70 text-muted-foreground hover:text-foreground")}>{label}</button>)}</div>
    <div className="mt-2 flex flex-wrap gap-1.5">{overlays.map(({ key, label, active, setActive, color }) => <button key={key} type="button" onClick={() => setActive(!active)} style={{ color, borderColor: color }} className={cn("rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors", active ? "bg-primary/10" : "bg-surface-2/50 hover:text-foreground")}>{label}</button>)}</div>
    <div className="mt-3 h-56 rounded-xl border border-border bg-surface-2/40 p-2 sm:h-72">
      {historyLoading ? <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading historical prices…</div> : historyError ? <div className="grid h-full place-items-center px-6 text-center"><div><p className="text-sm font-semibold">Chart data unavailable</p><p className="mt-1 text-xs text-muted-foreground">{historyError}</p></div></div> : chartData.length === 0 ? <div className="grid h-full place-items-center text-sm text-muted-foreground">No historical data available.</div> : <ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" className="stroke-border/50" /><XAxis dataKey="time" tickFormatter={(v) => formatDate(Number(v), selectedRange)} tick={{ fontSize: 10 }} minTickGap={28} axisLine={false} tickLine={false} /><YAxis yAxisId="price" domain={["auto", "auto"]} tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} width={58} axisLine={false} tickLine={false} /><YAxis yAxisId="volume" orientation="right" hide domain={[0, "auto"]} /><Tooltip labelFormatter={(v) => formatTooltipDate(Number(v))} formatter={(value, name) => [name === "close" || String(name).startsWith("sma") || String(name).startsWith("ema") ? `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : compactVolume(Number(value)), name === "close" ? "Close" : String(name).toUpperCase()]} contentStyle={{ borderRadius: 10, border: "1px solid hsl(var(--border))", background: "hsl(var(--background))", fontSize: 12 }} /><Bar yAxisId="volume" dataKey="volume" fill="currentColor" className="text-primary/15" barSize={3} isAnimationActive={false} /><Line yAxisId="price" type="monotone" dataKey="close" stroke="currentColor" className="text-foreground" strokeWidth={2} dot={false} isAnimationActive={false} />{showSupportResistance && supportResistance && <><ReferenceLine yAxisId="price" y={supportResistance.support} stroke={MACD_HISTOGRAM_POSITIVE_COLOR} strokeWidth={2} strokeDasharray="8 4" ifOverflow="extendDomain" label={{ value: "Support", position: "insideBottomLeft", fill: MACD_HISTOGRAM_POSITIVE_COLOR, fontSize: 10 }} /><ReferenceLine yAxisId="price" y={supportResistance.resistance} stroke={MACD_HISTOGRAM_NEGATIVE_COLOR} strokeWidth={2} strokeDasharray="8 4" ifOverflow="extendDomain" label={{ value: "Resistance", position: "insideTopLeft", fill: MACD_HISTOGRAM_NEGATIVE_COLOR, fontSize: 10 }} /></>}{showSma20 && <Line yAxisId="price" type="monotone" dataKey="sma20" stroke={SMA20_COLOR} strokeWidth={1.5} dot={false} isAnimationActive={false} />}{showSma50 && <Line yAxisId="price" type="monotone" dataKey="sma50" stroke={SMA50_COLOR} strokeWidth={1.5} dot={false} isAnimationActive={false} />}{showEma20 && <Line yAxisId="price" type="monotone" dataKey="ema20" stroke={EMA20_COLOR} strokeWidth={1.5} dot={false} isAnimationActive={false} />}{showEma50 && <Line yAxisId="price" type="monotone" dataKey="ema50" stroke={EMA50_COLOR} strokeWidth={1.5} dot={false} isAnimationActive={false} />}</ComposedChart></ResponsiveContainer>}
    </div>
    {showRsi && <div className="mt-3 h-36 rounded-xl border border-border bg-surface-2/40 p-2"><p className="px-2 py-1 text-xs font-semibold" style={{ color: RSI_COLOR }}>RSI (14)</p><ResponsiveContainer width="100%" height="85%"><ComposedChart data={chartData}><CartesianGrid strokeDasharray="3 3" className="stroke-border/50" /><XAxis dataKey="time" hide /><YAxis domain={[0, 100]} ticks={[30, 50, 70]} tick={{ fontSize: 9 }} width={28} axisLine={false} tickLine={false} /><ReferenceLine y={70} stroke="currentColor" strokeDasharray="4 4" className="text-red-400/60" /><ReferenceLine y={30} stroke="currentColor" strokeDasharray="4 4" className="text-green-400/60" /><Line type="monotone" dataKey="rsi" stroke={RSI_COLOR} strokeWidth={1.5} dot={false} isAnimationActive={false} /><Tooltip formatter={(v) => [Number(v).toFixed(2), "RSI"]} labelFormatter={(v) => formatTooltipDate(Number(v))} /></ComposedChart></ResponsiveContainer></div>}
    {showMacd && <div className="mt-3 h-36 rounded-xl border border-border bg-surface-2/40 p-2"><p className="px-2 py-1 text-xs font-semibold" style={{ color: MACD_COLOR }}>MACD (12, 26, 9)</p><ResponsiveContainer width="100%" height="85%"><ComposedChart data={chartData}><CartesianGrid strokeDasharray="3 3" className="stroke-border/50" /><XAxis dataKey="time" hide /><YAxis tick={{ fontSize: 9 }} width={48} axisLine={false} tickLine={false} /><ReferenceLine y={0} stroke="currentColor" strokeDasharray="4 4" className="text-muted-foreground/60" /><Bar dataKey="macdHistogram" isAnimationActive={false}>{chartData.map((point) => <Cell key={point.time} fill={point.macdHistogram !== null && point.macdHistogram >= 0 ? MACD_HISTOGRAM_POSITIVE_COLOR : MACD_HISTOGRAM_NEGATIVE_COLOR} />)}</Bar><Line type="monotone" dataKey="macd" stroke={MACD_COLOR} strokeWidth={1.5} dot={false} isAnimationActive={false} /><Line type="monotone" dataKey="macdSignal" stroke={MACD_SIGNAL_COLOR} strokeWidth={1.5} dot={false} isAnimationActive={false} />{macdCrossovers.map(({ point, bullish }) => <ReferenceDot key={point.time} x={point.time} y={point.macd!} r={3} fill={bullish ? MACD_HISTOGRAM_POSITIVE_COLOR : MACD_HISTOGRAM_NEGATIVE_COLOR} stroke="none" />)}<Tooltip formatter={(v, n) => [Number(v).toFixed(2), String(n).toUpperCase()]} labelFormatter={(v) => formatTooltipDate(Number(v))} /></ComposedChart></ResponsiveContainer></div>}
    <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><StatTile label="Day high" value={num(quote?.dayHigh ?? null)} /><StatTile label="Day low" value={num(quote?.dayLow ?? null)} /><StatTile label="Volume" value={compactVolume(quote?.volume ?? null)} /><StatTile label="Market cap" value={compactInr(quote?.marketCap ?? null)} /></dl>
    {linkToDetails && <Link to="/stock/$symbol" params={{ symbol }} className="mt-4 block rounded-xl bg-surface-2/70 py-2 text-center text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">View full details</Link>}
  </section>;
}
