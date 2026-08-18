import { useMemo, useState } from "react";
import { SendHorizonal, Bot, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { askAi } from "@/lib/ai.functions";
import { quotesQuery } from "@/lib/market-queries";
import { num, signed, stripSuffix, type Quote } from "@/lib/market-types";

type Message = { id: string; role: "user" | "assistant"; content: string };

type Position = { symbol: string; quantity: number; avgPrice: number };
type Props = { activeSymbol: string; activeQuote?: Quote | null; portfolioPositions?: Position[] };

const SUMMARY_PREVIEW_LENGTH = 260;

function localReply(prompt: string, symbol: string, quote: Quote | null | undefined, portfolio: {
  invested: number;
  current: number | null;
  pnl: number | null;
  bankWeight: number;
}) {
  const lower = prompt.toLowerCase();
  const name = stripSuffix(symbol);
  if (lower.includes("portfolio") || lower.includes("p&l") || lower.includes("pnl")) {
    if (portfolio.current === null || portfolio.pnl === null) return "Portfolio prices are still loading. I don't want to guess your P&L.";
    return `Portfolio snapshot: invested ${new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(portfolio.invested)}, current value ${new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(portfolio.current)}, P&L ${portfolio.pnl >= 0 ? "+" : "−"}${new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Math.abs(portfolio.pnl))}. Banking concentration is about ${portfolio.bankWeight.toFixed(1)}% of invested capital.`;
  }
  if (!quote || quote.price === null) return `${name}: live quote is unavailable right now. I won't invent a number. Try again after the market data refreshes.`;
  const move = quote.changePercent === null ? "change unavailable" : `${signed(quote.changePercent)}% today`;
  if (lower.includes("buy") || lower.includes("sell") || lower.includes("worth")) return `${name} is at ₹${num(quote.price)} (${move}). The available data is not enough for a buy/sell call; the key risk is acting on a single-day move.`;
  if (lower.includes("why") || lower.includes("explain") || lower.includes("move") || lower.includes("spike") || lower.includes("fall")) return `${name} is at ₹${num(quote.price)} with ${move}. The quote feed alone does not contain a verified reason for the move, so I won't fabricate one.`;
  return `${name}: ₹${num(quote.price)}, ${move}. Day range ₹${num(quote.dayLow)}–₹${num(quote.dayHigh)}, 52-week range ₹${num(quote.fiftyTwoWeekLow)}–₹${num(quote.fiftyTwoWeekHigh)}.`;
}

export function AiAssistant({ activeSymbol, activeQuote, portfolioPositions = [] }: Props) {
  const { data: portfolioQuotes } = useQuery(quotesQuery(portfolioPositions.map((p) => p.symbol)));
  const [messages, setMessages] = useState<Message[]>([{ id: "seed", role: "assistant", content: `I'm tracking ${stripSuffix(activeSymbol)} and your portfolio context. Ask me about the current price, today's move, risk, or P&L.` }]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [selectedSummary, setSelectedSummary] = useState<string | null>(null);
  const portfolio = useMemo(() => {
    const rows = portfolioPositions.map((position) => {
      const price = portfolioQuotes?.find((q) => q.symbol === position.symbol)?.price ?? null;
      const invested = position.avgPrice * position.quantity;
      const current = price === null ? null : price * position.quantity;
      return { ...position, price, invested, current };
    });
    const invested = rows.reduce((sum, row) => sum + row.invested, 0);
    const current = rows.length > 0 && rows.every((row) => row.current !== null) ? rows.reduce((sum, row) => sum + (row.current ?? 0), 0) : null;
    const hdfcInvested = rows.find((row) => stripSuffix(row.symbol) === "HDFCBANK")?.invested ?? 0;
    return { invested, current, pnl: current === null ? null : current - invested, bankWeight: invested > 0 ? (hdfcInvested / invested) * 100 : 0 };
  }, [portfolioPositions, portfolioQuotes]);
  const suggestions = useMemo(() => [`${stripSuffix(activeSymbol)} today: what matters?`, "Is my portfolio too banking-heavy?", "Analyse my portfolio P&L"], [activeSymbol]);
  const send = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || pending) return;
    const userMessage: Message = { id: `${Date.now()}-u`, role: "user", content: prompt };
    const history = messages.slice(-10);
    setMessages((prev) => [...prev, userMessage]); setInput(""); setPending(true);
    try {
      const result = await askAi({ data: { symbol: activeSymbol, userMessage: prompt, messages: history, context: { quote: activeQuote, portfolio, screen: "market-dashboard" } } });
      const content = result.content || localReply(prompt, activeSymbol, activeQuote, portfolio);
      setMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "assistant", content }]);
    } catch {
      setMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "assistant", content: localReply(prompt, activeSymbol, activeQuote, portfolio) }]);
    } finally { setPending(false); }
  };

  return (
    <>
      <section className="panel flex h-full min-h-[340px] min-w-0 flex-col overflow-hidden p-4" aria-label="AI assistant">
        <header className="flex min-w-0 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary"><Bot className="h-4 w-4" /></span>
          <div className="min-w-0"><h2 className="truncate text-sm font-bold tracking-widest uppercase">AI Assistant</h2><p className="truncate text-xs text-muted-foreground">Market copilot · {stripSuffix(activeSymbol)} context</p></div>
          <Sparkles className="ml-auto h-4 w-4 shrink-0 text-primary/70" />
        </header>
        <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
          {messages.map((message) => {
            if (message.role === "user") {
              return <p key={message.id} className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">{message.content}</p>;
            }
            const isLong = message.content.length > SUMMARY_PREVIEW_LENGTH;
            const preview = isLong ? `${message.content.slice(0, SUMMARY_PREVIEW_LENGTH).trimEnd()}…` : message.content;
            return (
              <div key={message.id} className="rounded-xl bg-surface-2/45 p-2.5 text-sm leading-relaxed text-foreground/90">
                <p>{preview}</p>
                {isLong && (
                  <button type="button" onClick={() => setSelectedSummary(message.content)} className="mt-1 inline-flex text-xs font-semibold text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/40 rounded-sm">
                    More
                  </button>
                )}
              </div>
            );
          })}
          {pending && <p className="animate-pulse text-sm text-muted-foreground">Analysing live context…</p>}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">{suggestions.map((suggestion) => <button key={suggestion} type="button" disabled={pending} onClick={() => void send(suggestion)} className="rounded-full border border-border bg-surface-2/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50">{suggestion}</button>)}</div>
        <form className="mt-3 flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void send(input); }}>
          <label htmlFor="ai-input" className="sr-only">Ask the AI assistant</label>
          <Input id="ai-input" value={input} onChange={(event) => setInput(event.target.value)} placeholder={`Ask about ${stripSuffix(activeSymbol)}, your portfolio or P&L…`} className="h-10 rounded-xl border-border bg-surface-2/70 text-sm" disabled={pending} />
          <Button type="submit" size="icon" disabled={pending || !input.trim()} className="h-10 w-10 shrink-0 rounded-xl"><SendHorizonal className="h-4 w-4" /><span className="sr-only">Send</span></Button>
        </form>
      </section>

      <Dialog open={Boolean(selectedSummary)} onOpenChange={(open) => { if (!open) setSelectedSummary(null); }}>
        <DialogContent className="max-h-[80vh] overflow-y-auto border-border bg-background sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>AI Summary</DialogTitle>
            <DialogDescription>Full market and portfolio analysis</DialogDescription>
          </DialogHeader>
          <div className="whitespace-pre-wrap text-sm leading-7 text-foreground/90">
            {selectedSummary}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
