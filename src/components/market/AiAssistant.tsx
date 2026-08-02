import { useState } from "react";
import { SendHorizonal, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Message = { id: string; role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Summarise today's Nifty move",
  "Is my portfolio too banking-heavy?",
  "Explain the Tata Motors spike",
];

/**
 * AI Assistant panel — UI shell with local mock replies.
 * Swap `respond()` for a POST to the FastAPI `/ai/chat` endpoint (streaming
 * or JSON) once the backend is wired; the message contract stays the same.
 */
export function AiAssistant({ activeSymbol }: { activeSymbol: string }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "seed",
      role: "assistant",
      content:
        "Good evening. Nifty closed 0.76% higher on broad-based buying, with autos leading and IT lagging. Ask me anything about your holdings or the tape.",
    },
  ]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);

  const send = (text: string) => {
    const prompt = text.trim();
    if (!prompt || pending) return;
    setMessages((prev) => [...prev, { id: `${Date.now()}-u`, role: "user", content: prompt }]);
    setInput("");
    setPending(true);
    window.setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-a`,
          role: "assistant",
          content: `Here's my read on “${prompt}”. Focus name: ${activeSymbol}. Momentum is constructive but the risk-reward tightens near the day's high — connect the FastAPI backend to get live model-generated analysis here.`,
        },
      ]);
      setPending(false);
    }, 650);
  };

  return (
    <section className="panel flex h-full flex-col p-4" aria-label="AI assistant">
      <header className="flex min-w-0 items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
          <Bot className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-bold tracking-widest uppercase">AI Assistant</h2>
          <p className="truncate text-xs text-muted-foreground">Market copilot · demo mode</p>
        </div>
      </header>

      <div className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1 lg:max-h-72">
        {messages.map((message) =>
          message.role === "assistant" ? (
            <p key={message.id} className="text-sm leading-relaxed text-foreground/90">
              {message.content}
            </p>
          ) : (
            <p
              key={message.id}
              className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              {message.content}
            </p>
          ),
        )}
        {pending && <p className="animate-pulse text-sm text-muted-foreground">Thinking…</p>}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => send(suggestion)}
            className="rounded-full border border-border bg-surface-2/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            {suggestion}
          </button>
        ))}
      </div>

      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
      >
        <label htmlFor="ai-input" className="sr-only">
          Ask the AI assistant
        </label>
        <Input
          id="ai-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask about a stock, sector or your P&L…"
          className="h-10 rounded-xl border-border bg-surface-2/70 text-sm"
        />
        <Button type="submit" size="icon" disabled={pending} className="h-10 w-10 shrink-0 rounded-xl">
          <SendHorizonal className="h-4 w-4" />
          <span className="sr-only">Send</span>
        </Button>
      </form>
    </section>
  );
}
