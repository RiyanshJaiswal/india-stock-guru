import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bot, BrainCircuit, CheckCircle2, ChevronRight, Clock3, ExternalLink, FileText, Gauge, History, Newspaper, Search, SendHorizonal, ShieldCheck, Sparkles, TrendingDown, TrendingUp, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askAi } from "@/lib/ai.functions";
import { getAiNewsContext, type AiNewsContext } from "@/lib/ai-news-context.server";
import { quoteQuery, searchQuery } from "@/lib/market-queries";
import { num, signed, stripSuffix } from "@/lib/market-types";

type Message = { id: string; role: "user" | "assistant"; content: string };
type StoredThread = { updatedAt: number; messages: Message[] };

const HISTORY_KEY = "dalal-desk-ai-research-history-v1";
const HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const QUICK_STOCKS = [
  ["RELIANCE.NS", "Reliance"], ["TCS.NS", "TCS"], ["INFY.NS", "Infosys"], ["HDFCBANK.NS", "HDFC Bank"], ["ICICIBANK.NS", "ICICI Bank"],
] as const;

const QUICK_QUESTIONS = [
  "Give me a full research summary", "What is driving this stock today?", "Analyse the latest news and its impact", "What are the key risks and watch levels?",
];

function tone(value?: string) {
  const v = (value ?? "").toLowerCase();
  if (v.includes("bull") || v.includes("positive")) return "bull";
  if (v.includes("bear") || v.includes("negative")) return "bear";
  return "neutral";
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part);
}

function stripGeneratedSources(content: string): string {
  const lines = content.split(/\r?\n/);
  const sourceIndex = lines.findIndex((line) => /^#{1,3}\s*sources\s*$/i.test(line.trim()));
  return sourceIndex >= 0 ? lines.slice(0, sourceIndex).join("\n").trim() : content;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "Just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function VerifiedSources({ items }: { items: AiNewsContext[] }) {
  if (!items.length) return null;
  return <section className="mt-6 border-t border-border pt-5">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-black text-foreground">Sources</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">Verified news used for this research</p>
      </div>
      <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary">{items.length} sources</span>
    </div>
    <div className="mt-3 space-y-2">
      {items.map((item, index) => <a key={`${item.headline}-${item.publishedAt}-${index}`} href={item.url} target="_blank" rel="noreferrer" className="group block rounded-xl border border-border bg-background/45 p-3 transition hover:border-primary/35 hover:bg-surface-2" aria-label={`Open source: ${item.headline}`}>
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tone(item.sentiment) === "bull" ? "bg-bull/10 text-bull" : tone(item.sentiment) === "bear" ? "bg-bear/10 text-bear" : "bg-surface-2 text-muted-foreground"}`}>
            {tone(item.sentiment) === "bull" ? <TrendingUp className="h-4 w-4" /> : tone(item.sentiment) === "bear" ? <TrendingDown className="h-4 w-4" /> : <Newspaper className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="font-bold uppercase tracking-wider text-primary">Source {index + 1}</span>
              <span className="truncate">{item.source}</span>
              <span>·</span>
              <span className="shrink-0">{new Date(item.publishedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
            </div>
            <div className="mt-1 flex items-start gap-2">
              <h4 className="min-w-0 flex-1 text-xs font-bold leading-5 text-foreground group-hover:text-primary">{item.headline}</h4>
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition group-hover:text-primary" />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-surface-2 px-2 py-1 text-[10px] font-semibold">{item.sentiment}</span>
              <span className="rounded-full bg-surface-2 px-2 py-1 text-[10px] font-semibold">Impact {item.impactScore}/100</span>
              <span className="rounded-full bg-surface-2 px-2 py-1 text-[10px] font-semibold">{relativeTime(item.publishedAt)}</span>
            </div>
          </div>
        </div>
      </a>)}
    </div>
  </section>;
}

function AiMarkdown({ content }: { content: string }) {
  return <div className="space-y-2.5 text-[14px] leading-6">
    {content.split("\n").map((line, index) => {
      const value = line.trim();
      if (!value) return <div key={index} className="h-1" />;
      if (value.startsWith("### ")) return <h4 key={index} className="pt-2 text-sm font-bold text-foreground">{renderInline(value.slice(4))}</h4>;
      if (value.startsWith("## ")) return <h3 key={index} className="pt-3 text-base font-black tracking-tight text-foreground">{renderInline(value.slice(3))}</h3>;
      if (value.startsWith("# ")) return <h3 key={index} className="text-lg font-black text-foreground">{renderInline(value.slice(2))}</h3>;
      if (/^[-*]\s+/.test(value)) return <div key={index} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /><span>{renderInline(value.replace(/^[-*]\s+/, ""))}</span></div>;
      return <p key={index}>{renderInline(value)}</p>;
    })}
  </div>;
}

function readHistory(): Record<string, StoredThread> {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, StoredThread>;
    const cutoff = Date.now() - HISTORY_TTL_MS;
    const fresh = Object.fromEntries(Object.entries(parsed).filter(([, thread]) => thread && thread.updatedAt >= cutoff && Array.isArray(thread.messages)));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(fresh));
    return fresh;
  } catch { return {}; }
}

function loadThread(symbol: string): Message[] {
  return readHistory()[symbol]?.messages ?? [];
}

function saveThread(symbol: string, messages: Message[]): void {
  try {
    const history = readHistory();
    if (!messages.length) { delete history[symbol]; localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); return; }
    history[symbol] = { updatedAt: Date.now(), messages: messages.slice(-40) };
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch { /* localStorage may be unavailable */ }
}

function clearAllHistory(): void {
  try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
}

export function AiResearcherPro() {
  const [symbol, setSymbol] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [tab, setTab] = useState<"research" | "news">("research");
  const [showHistory, setShowHistory] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);

  const { data: quote } = useQuery({ ...quoteQuery(symbol ?? ""), enabled: Boolean(symbol) });
  const { data: news = [], isLoading: newsLoading, isError: newsError } = useQuery({
    queryKey: ["ai-researcher-pro-news", symbol],
    queryFn: () => getAiNewsContext({ data: { symbol: symbol! } }),
    enabled: Boolean(symbol),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: 2,
  });
  const { data: searchResults = [] } = useQuery({ ...searchQuery(search), enabled: search.trim().length >= 2 });

  const activeNews = news as AiNewsContext[];
  const leadNews = activeNews[0];
  const sentiment = leadNews?.sentiment ?? "Neutral";
  const sentimentTone = tone(sentiment);
  const avgConfidence = useMemo(() => activeNews.length ? Math.round(activeNews.reduce((sum, item) => sum + item.confidence, 0) / activeNews.length) : null, [activeNews]);
  const history = useMemo(() => readHistory(), [historyVersion, symbol, showHistory]);
  const historyItems = useMemo(() => Object.entries(history).sort((a, b) => b[1].updatedAt - a[1].updatedAt), [history]);

  useEffect(() => {
    if (symbol && messages.length) saveThread(symbol, messages);
  }, [symbol, messages]);

  const selectStock = (next: string) => {
    setSymbol(next);
    setSearch("");
    setMessages(loadThread(next));
    setInput("");
    setTab("research");
    setShowHistory(false);
  };

  const send = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || pending || !symbol) return;
    const historyMessages = messages.slice(-10);
    const userMessage: Message = { id: `${Date.now()}-u`, role: "user", content: prompt };
    setMessages((m) => [...m, userMessage]);
    setInput("");
    setPending(true);
    try {
      const result = await askAi({ data: { symbol, userMessage: prompt, messages: historyMessages, context: { quote, newsImpact: activeNews, screen: "ai-researcher-pro" } } });
      setMessages((m) => [...m, { id: `${Date.now()}-a`, role: "assistant", content: result.content || "## Research unavailable\n\nGemini did not return a response. Please try again." }]);
      setHistoryVersion((v) => v + 1);
    } catch {
      setMessages((m) => [...m, { id: `${Date.now()}-a`, role: "assistant", content: "## Research temporarily unavailable\n\nThe AI provider did not respond. Your market data is still available." }]);
    } finally { setPending(false); }
  };

  const clearCurrentHistory = () => {
    if (!symbol) return;
    const history = readHistory();
    delete history[symbol];
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch { /* ignore */ }
    setMessages([]);
    setHistoryVersion((v) => v + 1);
  };

  const clearHistory = () => {
    clearAllHistory();
    setMessages([]);
    setHistoryVersion((v) => v + 1);
  };

  if (!symbol) return <div className="min-h-screen">
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
        <Link to="/" className="rounded-xl border border-border bg-surface-2/60 p-2 text-muted-foreground hover:text-foreground" aria-label="Back to dashboard"><ArrowLeft className="h-4 w-4" /></Link>
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary"><BrainCircuit className="h-5 w-5" /></span>
        <div><h1 className="text-lg font-black sm:text-xl">AI Researcher</h1><p className="text-xs text-muted-foreground">Your stock research workspace</p></div>
        <button onClick={() => setShowHistory(true)} className="ml-auto inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-semibold hover:bg-surface-2"><History className="h-4 w-4" />History</button>
      </div>
    </header>
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <section className="relative overflow-hidden rounded-[28px] border border-border bg-surface-1 px-5 py-10 text-center shadow-2xl sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative mx-auto max-w-3xl">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary"><BrainCircuit className="h-8 w-8" /></div>
          <p className="mt-6 text-xs font-bold uppercase tracking-[.22em] text-primary">AI-powered Indian stock research</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">Understand the stock.<br className="hidden sm:block" /> Not just the headline.</h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">Combine market context, relevant news and AI analysis in one place. Your research conversations are kept for 7 days on this browser.</p>
          <div className="relative mx-auto mt-8 max-w-2xl text-left">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company or NSE symbol…" className="h-14 rounded-2xl bg-background/90 pl-12 text-base shadow-xl" />
            {search.trim() && <div className="absolute left-0 right-0 top-[62px] z-50 overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">{searchResults.length ? searchResults.slice(0, 6).map((item) => <button key={item.symbol} type="button" onClick={() => selectStock(item.symbol)} className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-surface-2"><span><span className="block font-semibold">{item.name}</span><span className="text-xs text-muted-foreground">{stripSuffix(item.symbol)} · NSE</span></span><ChevronRight className="h-4 w-4 text-muted-foreground" /></button>) : <div className="px-4 py-4 text-sm text-muted-foreground">No matching stock found.</div>}</div>}
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-2"><span className="mr-1 self-center text-xs text-muted-foreground">Try:</span>{QUICK_STOCKS.map(([value, label]) => <button key={value} onClick={() => selectStock(value)} className="rounded-full border border-border bg-surface-2/60 px-3.5 py-1.5 text-xs font-semibold hover:border-primary/50 hover:bg-primary/10 hover:text-primary">{label}</button>)}</div>
        </div>
        <div className="relative mx-auto mt-12 grid max-w-5xl gap-3 sm:grid-cols-3">{[{ icon: TrendingUp, title: "Market context", text: "Price and current move" }, { icon: Newspaper, title: "News intelligence", text: "Relevant headlines and impact" }, { icon: ShieldCheck, title: "Evidence-first AI", text: "Clear explanations and sources" }].map(({ icon: Icon, title, text }) => <div key={title} className="rounded-2xl border border-border bg-background/40 p-4 text-left"><span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span><p className="mt-3 text-sm font-bold">{title}</p><p className="mt-1 text-xs text-muted-foreground">{text}</p></div>)}</div>
      </section>
    </main>
    {showHistory && <HistoryDrawer items={historyItems} onClose={() => setShowHistory(false)} onSelect={selectStock} onClear={clearHistory} />}
  </div>;

  const displaySymbol = stripSuffix(symbol);
  return <div className="min-h-screen bg-background">
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/92 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-4 py-3 sm:px-6">
        <Link to="/" className="rounded-xl border border-border p-2 text-muted-foreground hover:text-foreground" aria-label="Back"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">AI Researcher</p><h1 className="truncate text-base font-black sm:text-lg">{quote?.name ?? displaySymbol}</h1></div>
        <button onClick={() => setShowHistory(true)} className="ml-auto inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-semibold hover:bg-surface-2"><History className="h-4 w-4" /><span className="hidden sm:inline">History</span></button>
        <div className="relative hidden w-64 sm:block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Switch stock…" className="h-9 rounded-xl pl-9" />{search.trim() && searchResults.length > 0 && <div className="absolute top-11 z-50 w-full overflow-hidden rounded-xl border border-border bg-background shadow-2xl">{searchResults.slice(0, 5).map((item) => <button key={item.symbol} onClick={() => selectStock(item.symbol)} className="flex w-full justify-between px-3 py-2 text-left text-xs hover:bg-surface-2"><span>{item.name}<span className="ml-2 text-muted-foreground">{stripSuffix(item.symbol)}</span></span><ChevronRight className="h-3.5 w-3.5" /></button>)}</div>}</div>
      </div>
    </header>

    <main className="mx-auto max-w-[1500px] px-4 py-4 sm:px-6 sm:py-6">
      <section className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><div className="flex items-center gap-2"><h2 className="text-2xl font-black tracking-tight">{displaySymbol}</h2><span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-bold text-muted-foreground">NSE</span></div><p className="mt-1 text-xs text-muted-foreground">{quote?.name ?? "Indian equity research"}</p></div>
          <div className="flex items-end gap-5"><div className="text-right"><p className="num text-2xl font-black">{quote?.price == null ? "—" : `₹${num(quote.price)}`}</p><p className={quote?.changePercent != null && quote.changePercent >= 0 ? "text-sm font-semibold text-bull" : "text-sm font-semibold text-bear"}>{quote?.changePercent == null ? "Live change unavailable" : `${signed(quote.changePercent)}% today`}</p></div><div className="hidden text-right sm:block"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">News confidence</p><p className="font-bold">{avgConfidence == null ? "—" : `${avgConfidence}%`}</p></div></div>
        </div>
        <div className="mt-4 flex gap-1 rounded-xl bg-surface-2/60 p-1 sm:w-fit"><button onClick={() => setTab("research")} className={`rounded-lg px-4 py-2 text-xs font-bold ${tab === "research" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>AI Research</button><button onClick={() => setTab("news")} className={`rounded-lg px-4 py-2 text-xs font-bold ${tab === "news" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>News & Evidence {activeNews.length > 0 ? `(${activeNews.length})` : ""}</button></div>
      </section>

      {tab === "research" ? <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="panel flex min-h-[620px] flex-col overflow-hidden p-0">
          <div className="border-b border-border px-4 py-4 sm:px-5"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary"><Bot className="h-5 w-5" /></span><div><h3 className="font-bold">Research with AI</h3><p className="text-xs text-muted-foreground">Ask in plain English. The answer uses live stock context and verified news.</p></div><span className="ml-auto hidden items-center gap-1 text-[10px] font-semibold text-muted-foreground sm:flex"><CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Evidence-aware</span></div></div>
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
            {messages.length === 0 && <div><div className="rounded-2xl border border-primary/15 bg-primary/5 p-4"><p className="font-bold">Start your research</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Choose a question below or ask your own. Your conversation will be available for 7 days.</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{QUICK_QUESTIONS.map((q) => <button key={q} onClick={() => void send(q)} className="group flex items-center justify-between rounded-xl border border-border bg-background/70 px-3 py-3 text-left text-xs font-semibold hover:border-primary/40 hover:bg-background"><span>{q}</span><ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5" /></button>)}</div></div></div>}
            {messages.map((m, index) => {
              const isLatestAssistant = m.role === "assistant" && !messages.slice(index + 1).some((next) => next.role === "assistant");
              return <article key={m.id} className={m.role === "user" ? "ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm text-primary-foreground" : "max-w-[96%] rounded-2xl border border-border bg-surface-2/45 px-4 py-4"}>
                {m.role === "assistant" ? <><AiMarkdown content={stripGeneratedSources(m.content)} />{isLatestAssistant && activeNews.length > 0 && <VerifiedSources items={activeNews} />}</> : m.content}
              </article>;
            })}
            {pending && <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="h-2 w-2 animate-pulse rounded-full bg-primary" /> Researching market context, news and evidence…</div>}
          </div>
          <form className="border-t border-border bg-background/70 p-3 sm:p-4" onSubmit={(e) => { e.preventDefault(); void send(input); }}><div className="flex items-center gap-2 rounded-xl border border-border bg-surface-1 p-1.5 focus-within:border-primary/40"><Input value={input} onChange={(e) => setInput(e.target.value)} disabled={pending} placeholder={`Ask about ${displaySymbol}…`} className="h-10 border-0 bg-transparent shadow-none focus-visible:ring-0" /><Button type="submit" disabled={pending || !input.trim()} className="h-10 rounded-lg px-4"><SendHorizonal className="mr-2 h-4 w-4" />Ask</Button></div><div className="mt-2 flex items-center justify-between px-1"><p className="text-[10px] text-muted-foreground">Research output is informational; verify important claims against sources.</p><button type="button" onClick={clearCurrentHistory} className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground hover:text-bear"><Trash2 className="h-3 w-3" />Clear chat</button></div></form>
        </section>

        <aside className="space-y-4">
          <section className="panel p-4"><div className="flex items-center gap-2"><Gauge className="h-4 w-4 text-primary" /><h3 className="font-bold">Signal snapshot</h3></div><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-xl bg-surface-2/60 p-3"><p className="text-[10px] uppercase text-muted-foreground">News tone</p><p className={`mt-1 font-bold ${sentimentTone === "bull" ? "text-bull" : sentimentTone === "bear" ? "text-bear" : ""}`}>{sentiment}</p></div><div className="rounded-xl bg-surface-2/60 p-3"><p className="text-[10px] uppercase text-muted-foreground">Impact</p><p className="mt-1 font-bold">{leadNews?.impactScore != null ? `${leadNews.impactScore}/100` : "—"}</p></div><div className="rounded-xl bg-surface-2/60 p-3"><p className="text-[10px] uppercase text-muted-foreground">Horizon</p><p className="mt-1 font-bold">{leadNews?.timeHorizon ?? "—"}</p></div><div className="rounded-xl bg-surface-2/60 p-3"><p className="text-[10px] uppercase text-muted-foreground">Confidence</p><p className="mt-1 font-bold">{leadNews?.confidence != null ? `${leadNews.confidence}%` : "—"}</p></div></div>{leadNews?.impactReason && <p className="mt-3 text-xs leading-5 text-muted-foreground">{leadNews.impactReason}</p>}</section>
          <section className="panel p-4"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Newspaper className="h-4 w-4 text-primary" /><h3 className="font-bold">Top news</h3></div><button onClick={() => setTab("news")} className="text-[11px] font-semibold text-primary">View all</button></div>{newsLoading ? <p className="mt-4 text-xs text-muted-foreground">Loading verified news…</p> : newsError ? <div className="mt-4 rounded-xl border border-bear/20 bg-bear/5 p-3"><p className="text-xs font-semibold">News feed temporarily unavailable</p><p className="mt-1 text-[10px] text-muted-foreground">Try refreshing in a moment. AI research can still use other market context.</p></div> : activeNews.slice(0, 3).map((item) => <button key={`${item.headline}-${item.publishedAt}`} onClick={() => setTab("news")} className="mt-3 block w-full rounded-xl border border-border p-3 text-left hover:bg-surface-2"><p className="line-clamp-2 text-xs font-semibold leading-5">{item.headline}</p><p className="mt-1 text-[10px] text-muted-foreground">{item.source} · {new Date(item.publishedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</p></button>)}{!newsLoading && !newsError && !activeNews.length && <p className="mt-4 text-xs text-muted-foreground">No verified stock-specific news found in the latest feed window.</p>}</section>
        </aside>
      </div> : <section className="mt-4 grid gap-4 lg:grid-cols-2">
        {activeNews.map((item, index) => <article key={`${item.headline}-${item.publishedAt}`} className="panel p-4"><div className="flex items-start gap-3"><span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tone(item.sentiment) === "bull" ? "bg-bull/10 text-bull" : tone(item.sentiment) === "bear" ? "bg-bear/10 text-bear" : "bg-surface-2 text-muted-foreground"}`}>{tone(item.sentiment) === "bull" ? <TrendingUp className="h-4 w-4" /> : tone(item.sentiment) === "bear" ? <TrendingDown className="h-4 w-4" /> : <FileText className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-bold uppercase tracking-wider text-primary">Source {index + 1}</span><span className="text-[10px] text-muted-foreground">{item.source}</span><span className="text-[10px] text-muted-foreground">{new Date(item.publishedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span></div><a href={item.url} target="_blank" rel="noreferrer" className="group mt-2 flex items-start gap-2 text-sm font-bold leading-5 hover:text-primary" aria-label={`Open source: ${item.headline}`}><span className="min-w-0 flex-1">{item.headline}</span><ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" /></a><div className="mt-3 flex flex-wrap gap-2"><span className="rounded-full bg-surface-2 px-2 py-1 text-[10px] font-semibold">{item.sentiment}</span><span className="rounded-full bg-surface-2 px-2 py-1 text-[10px] font-semibold">Impact {item.impactScore}/100</span><span className="rounded-full bg-surface-2 px-2 py-1 text-[10px] font-semibold">{item.timeHorizon}</span></div>{item.impactReason && <p className="mt-3 text-xs leading-5 text-muted-foreground">{item.impactReason}</p>}</div></div></article>)}{!activeNews.length && <div className="panel p-8 text-center text-sm text-muted-foreground">No verified stock-specific news found in the latest feed window.</div>}
      </section>}
    </main>
    {showHistory && <HistoryDrawer items={historyItems} onClose={() => setShowHistory(false)} onSelect={selectStock} onClear={clearHistory} />}
  </div>;
}

function HistoryDrawer({ items, onClose, onSelect, onClear }: { items: Array<[string, StoredThread]>; onClose: () => void; onSelect: (symbol: string) => void; onClear: () => void }) {
  return <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm" onClick={onClose}>
    <aside className="absolute right-0 top-0 h-full w-full max-w-md border-l border-border bg-background p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">AI Researcher</p><h2 className="mt-1 text-xl font-black">Research history</h2><p className="mt-1 text-xs text-muted-foreground">Conversations from the last 7 days.</p></div><button onClick={onClose} className="rounded-xl border border-border p-2 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button></div>
      <div className="mt-5 flex items-center justify-between rounded-xl border border-border bg-surface-1 p-3"><div className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-primary" /><span className="text-xs font-semibold">{items.length} stock conversation{items.length === 1 ? "" : "s"}</span></div><button onClick={onClear} disabled={!items.length} className="text-[11px] font-semibold text-bear disabled:opacity-40">Clear all</button></div>
      <div className="mt-4 space-y-2 overflow-y-auto" style={{ maxHeight: "calc(100vh - 180px)" }}>
        {items.length ? items.map(([threadSymbol, thread]) => { const firstUser = thread.messages.find((m) => m.role === "user")?.content ?? "Research conversation"; const age = Math.max(0, Math.round((Date.now() - thread.updatedAt) / 3_600_000)); return <button key={threadSymbol} onClick={() => onSelect(threadSymbol)} className="w-full rounded-xl border border-border bg-surface-1 p-3 text-left hover:border-primary/40 hover:bg-surface-2"><div className="flex items-center justify-between gap-3"><span className="font-bold">{stripSuffix(threadSymbol)}</span><span className="text-[10px] text-muted-foreground">{age < 1 ? "Just now" : age < 24 ? `${age}h ago` : `${Math.round(age / 24)}d ago`}</span></div><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{firstUser}</p><p className="mt-2 text-[10px] text-primary">{thread.messages.length} messages · Continue research →</p></button>; }) : <div className="rounded-2xl border border-dashed border-border p-8 text-center"><History className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 text-sm font-semibold">No saved research yet</p><p className="mt-1 text-xs text-muted-foreground">Your next stock conversation will appear here.</p></div>}
      </div>
    </aside>
  </div>;
}
