import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Bot, BrainCircuit, ChevronRight, Newspaper, Search, SendHorizonal, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askAi } from "@/lib/ai.functions";
import { getAiNewsContext } from "@/lib/ai-news-context.server";
import { quoteQuery, searchQuery } from "@/lib/market-queries";
import { num, signed, stripSuffix } from "@/lib/market-types";

type Message = { id: string; role: "user" | "assistant"; content: string };
type Impact = { symbol?: string; sentiment?: string; impactScore?: number; impactLevel?: string; horizon?: string; confidence?: number; eventType?: string; reason?: string; headline?: string };

const QUICK_STOCKS = [
  { symbol: "RELIANCE.NS", label: "Reliance" },
  { symbol: "TCS.NS", label: "TCS" },
  { symbol: "INFY.NS", label: "Infosys" },
  { symbol: "HDFCBANK.NS", label: "HDFC Bank" },
  { symbol: "ICICIBANK.NS", label: "ICICI Bank" },
];

function impactTone(value: string | undefined) {
  const v = (value ?? "").toLowerCase();
  if (v.includes("bull") || v.includes("positive")) return "bull";
  if (v.includes("bear") || v.includes("negative")) return "bear";
  return "neutral";
}

export function AiResearcher() {
  const [symbol, setSymbol] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);

  const { data: quote } = useQuery({ ...quoteQuery(symbol ?? ""), enabled: Boolean(symbol) });
  const { data: newsImpact = [], isLoading: newsLoading } = useQuery({
    queryKey: ["ai-researcher-news-impact", symbol],
    queryFn: () => getAiNewsContext({ data: { symbol: symbol! } }),
    enabled: Boolean(symbol),
    staleTime: 2 * 60_000,
    refetchOnWindowFocus: false,
  });
  const { data: searchResults = [] } = useQuery({ ...searchQuery(search), enabled: search.trim().length >= 2 });

  const activeImpact = (newsImpact as Impact[])[0];
  const selectStock = (nextSymbol: string) => {
    setSymbol(nextSymbol);
    setSearch("");
    setMessages([]);
    setInput("");
  };

  const send = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || pending || !symbol) return;
    const history = messages.slice(-10);
    setMessages((m) => [...m, { id: `${Date.now()}-u`, role: "user", content: prompt }]);
    setInput(""); setPending(true);
    try {
      const result = await askAi({ data: { symbol, userMessage: prompt, messages: history, context: { quote, newsImpact, screen: "ai-researcher" } } });
      setMessages((m) => [...m, { id: `${Date.now()}-a`, role: "assistant", content: result.content || "I couldn't produce a reliable answer from the available data." }]);
    } catch {
      setMessages((m) => [...m, { id: `${Date.now()}-a`, role: "assistant", content: "AI research is temporarily unavailable. Please try again in a moment." }]);
    } finally { setPending(false); }
  };

  const tone = impactTone(activeImpact?.sentiment);
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/" className="rounded-xl border border-border bg-surface-2/60 p-2 text-muted-foreground hover:text-foreground" aria-label="Back to dashboard"><ArrowLeft className="h-4 w-4" /></Link>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary"><BrainCircuit className="h-5 w-5" /></span>
            <div className="min-w-0"><h1 className="truncate text-lg font-black sm:text-xl">AI Researcher</h1><p className="truncate text-xs text-muted-foreground">Research, explain and connect the dots</p></div>
          </div>
          <div className="relative hidden w-full max-w-sm sm:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search a stock to research…" className="h-10 rounded-xl pl-9" />
            {search.trim() && searchResults.length > 0 && <div className="absolute top-12 z-50 w-full overflow-hidden rounded-xl border border-border bg-background shadow-2xl">{searchResults.slice(0, 6).map((item) => <button key={item.symbol} type="button" onClick={() => selectStock(item.symbol)} className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-surface-2"><span><span className="block text-sm font-semibold">{item.name}</span><span className="text-[11px] text-muted-foreground">{stripSuffix(item.symbol)}</span></span><ChevronRight className="h-4 w-4 text-muted-foreground" /></button>)}</div>}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-7">
        {!symbol ? (
          <section className="relative overflow-hidden rounded-3xl border border-border bg-surface-1 px-5 py-8 shadow-2xl sm:px-10 sm:py-12 lg:px-16 lg:py-14">
            <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-32 -left-20 h-72 w-72 rounded-full bg-cyan-500/5 blur-3xl" />
            <div className="relative mx-auto max-w-4xl text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary shadow-lg shadow-primary/5"><BrainCircuit className="h-8 w-8" /></div>
              <p className="mt-6 text-xs font-bold uppercase tracking-[0.22em] text-primary">AI-powered stock research</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">Research any Indian stock<br className="hidden sm:block" /> in one conversation.</h2>
              <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">Get live price context, relevant market news, AI impact analysis, risks and clear explanations — all in one research workspace.</p>

              <div className="relative mx-auto mt-8 max-w-2xl text-left">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company name or NSE symbol…" className="h-14 rounded-2xl border-primary/30 bg-background/80 pl-12 pr-4 text-base shadow-xl focus-visible:ring-primary/30" aria-label="Search a stock to research" />
                {search.trim() && searchResults.length > 0 && <div className="absolute left-0 right-0 top-[62px] z-50 overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">{searchResults.slice(0, 6).map((item) => <button key={item.symbol} type="button" onClick={() => selectStock(item.symbol)} className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-surface-2"><span><span className="block font-semibold">{item.name}</span><span className="text-xs text-muted-foreground">{stripSuffix(item.symbol)} · NSE</span></span><ArrowRight className="h-4 w-4 text-muted-foreground" /></button>)}</div>}
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <span className="mr-1 text-xs text-muted-foreground">Popular research:</span>
                {QUICK_STOCKS.map((stock) => <button key={stock.symbol} type="button" onClick={() => selectStock(stock.symbol)} className="rounded-full border border-border bg-surface-2/60 px-3.5 py-1.5 text-xs font-semibold transition hover:border-primary/50 hover:bg-primary/10 hover:text-primary">{stock.label}</button>)}
              </div>
            </div>

            <div className="relative mx-auto mt-12 grid max-w-5xl gap-3 sm:grid-cols-3">
              {[
                { icon: TrendingUp, title: "Live market context", text: "Price, daily move and current market state." },
                { icon: Newspaper, title: "News that matters", text: "Relevant headlines with stock-specific impact." },
                { icon: ShieldCheck, title: "Research with context", text: "AI explanations, risks, horizon and confidence." },
              ].map(({ icon: Icon, title, text }) => <div key={title} className="rounded-2xl border border-border bg-background/35 p-4 text-left"><span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span><h3 className="mt-3 text-sm font-bold">{title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p></div>)}
            </div>

            <div className="relative mx-auto mt-8 flex max-w-5xl flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-primary" /> Ask questions in plain English</span><span className="hidden h-1 w-1 rounded-full bg-border sm:block" /><span>Built for NSE stocks</span><span className="hidden h-1 w-1 rounded-full bg-border sm:block" /><span>Research, not guaranteed predictions</span></div>
          </section>
        ) : (
          <>
            <section className="rounded-2xl border border-border bg-surface-1 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Research workspace</p><h2 className="mt-1 text-2xl font-black">{stripSuffix(symbol)}</h2><p className="mt-1 text-sm text-muted-foreground">{quote?.name ?? "Live market research"}</p></div>
                <div className="text-right"><p className="num text-2xl font-bold">{quote?.price == null ? "—" : `₹${num(quote.price)}`}</p><p className={quote?.changePercent != null && quote.changePercent >= 0 ? "text-bull" : "text-bear"}>{quote?.changePercent == null ? "Change unavailable" : `${signed(quote.changePercent)}% today`}</p></div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl bg-surface-2/60 p-3"><p className="text-xs text-muted-foreground">AI view</p><p className="mt-1 font-bold">{activeImpact?.sentiment ?? "Analysing"}</p></div>
                <div className="rounded-xl bg-surface-2/60 p-3"><p className="text-xs text-muted-foreground">Impact</p><p className="mt-1 font-bold">{activeImpact?.impactScore != null ? `${activeImpact.impactScore}/100 · ${activeImpact.impactLevel ?? ""}` : "Analysing"}</p></div>
                <div className="rounded-xl bg-surface-2/60 p-3"><p className="text-xs text-muted-foreground">Horizon</p><p className="mt-1 font-bold">{activeImpact?.horizon ?? "—"}</p></div>
                <div className="rounded-xl bg-surface-2/60 p-3"><p className="text-xs text-muted-foreground">Confidence</p><p className="mt-1 font-bold">{activeImpact?.confidence != null ? `${activeImpact.confidence}%` : "—"}</p></div>
              </div>
            </section>

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
              <section className="panel flex min-h-[560px] flex-col p-4 sm:p-5">
                <header className="flex items-center gap-3 border-b border-border pb-4"><span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary"><Bot className="h-5 w-5" /></span><div><h2 className="font-bold">Ask AI Researcher</h2><p className="text-xs text-muted-foreground">Answers are grounded in live quote and verified news context.</p></div><Sparkles className="ml-auto h-4 w-4 text-primary" /></header>
                <div className="flex-1 space-y-3 overflow-y-auto py-4" aria-live="polite">
                  {messages.length === 0 && <div className="rounded-2xl bg-surface-2/50 p-4"><p className="font-semibold">What would you like to know?</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{[`Give me a full ${stripSuffix(symbol)} summary`, `What does the latest news mean for ${stripSuffix(symbol)}?`, `Is the current move supported by news?`, `What are the key risks for ${stripSuffix(symbol)}?`].map((q) => <button key={q} type="button" onClick={() => void send(q)} className="rounded-xl border border-border px-3 py-2.5 text-left text-sm hover:border-primary/50 hover:bg-surface-2">{q}</button>)}</div></div>}
                  {messages.map((m) => <div key={m.id} className={m.role === "user" ? "ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm text-primary-foreground" : "max-w-[92%] rounded-2xl bg-surface-2/60 px-4 py-3 text-sm leading-7"}>{m.content}</div>)}
                  {pending && <p className="animate-pulse text-sm text-muted-foreground">Researching live context…</p>}
                </div>
                <form className="flex gap-2 border-t border-border pt-4" onSubmit={(e) => { e.preventDefault(); void send(input); }}><Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything about this stock…" disabled={pending} className="h-11 rounded-xl" /><Button type="submit" disabled={pending || !input.trim()} className="h-11 rounded-xl px-4"><SendHorizonal className="mr-2 h-4 w-4" />Ask</Button></form>
              </section>

              <aside className="space-y-4">
                <section className="panel p-4"><div className="flex items-center justify-between"><h2 className="font-bold">Latest AI impact</h2><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone === "bull" ? "bg-bull/12 text-bull" : tone === "bear" ? "bg-bear/12 text-bear" : "bg-surface-2 text-muted-foreground"}`}>{activeImpact?.sentiment ?? "Analysing"}</span></div>{newsLoading ? <p className="mt-4 text-sm text-muted-foreground">Analysing latest news…</p> : activeImpact ? <div className="mt-4 space-y-3"><p className="text-sm font-semibold">{activeImpact.headline ?? "Latest relevant market news"}</p><p className="text-sm leading-6 text-muted-foreground">{activeImpact.reason ?? "The news impact is being evaluated from available market context."}</p><div className="grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-surface-2/60 p-2"><span className="text-muted-foreground">Event</span><b className="mt-1 block">{activeImpact.eventType ?? "—"}</b></div><div className="rounded-lg bg-surface-2/60 p-2"><span className="text-muted-foreground">Horizon</span><b className="mt-1 block">{activeImpact.horizon ?? "—"}</b></div></div></div> : <p className="mt-4 text-sm text-muted-foreground">No verified stock-specific impact available yet.</p>}</section>
                <section className="panel p-4"><h2 className="font-bold">Research checklist</h2><div className="mt-3 space-y-2 text-sm text-muted-foreground"><p>✓ Live price & daily move</p><p>✓ Latest relevant news</p><p>✓ AI impact & confidence</p><p>✓ Risks and key questions</p></div></section>
                <Link to={`/stock/${symbol}`} className="flex items-center justify-between rounded-xl border border-border bg-surface-2/50 p-3 text-sm font-semibold hover:border-primary/50"><span>Open full stock page</span><ChevronRight className="h-4 w-4" /></Link>
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
