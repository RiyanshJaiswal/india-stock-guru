import { holdings, inr, num, signed } from "@/data/market";
import { Delta } from "./Delta";
import { cn } from "@/lib/utils";

export function Portfolio() {
  const invested = holdings.reduce((sum, h) => sum + h.avgPrice * h.quantity, 0);
  const current = holdings.reduce((sum, h) => sum + h.ltp * h.quantity, 0);
  const pnl = current - invested;
  const pnlPercent = (pnl / invested) * 100;

  return (
    <section className="panel p-4 sm:p-5" aria-label="Portfolio">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <h2 className="truncate text-sm font-bold tracking-widest uppercase">Portfolio</h2>
        <Delta className="shrink-0" changePercent={pnlPercent} />
      </header>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Current value" value={inr(current, 0)} />
        <Stat label="Invested" value={inr(invested, 0)} />
        <Stat
          label="Overall P&L"
          value={`${pnl >= 0 ? "+" : "−"}${inr(Math.abs(pnl), 0)}`}
          tone={pnl >= 0 ? "bull" : "bear"}
        />
      </div>

      <div className="mt-4 -mx-1 overflow-x-auto">
        <table className="w-full min-w-[34rem] border-separate border-spacing-y-1 px-1 text-sm">
          <thead>
            <tr className="text-left text-[11px] tracking-wider text-muted-foreground uppercase">
              <th className="font-medium">Stock</th>
              <th className="text-right font-medium">Qty</th>
              <th className="text-right font-medium">Avg</th>
              <th className="text-right font-medium">LTP</th>
              <th className="text-right font-medium">P&L</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => {
              const gain = (h.ltp - h.avgPrice) * h.quantity;
              const gainPct = ((h.ltp - h.avgPrice) / h.avgPrice) * 100;
              return (
                <tr key={h.symbol} className="bg-surface-2/50">
                  <td className="rounded-l-lg px-3 py-2.5">
                    <p className="font-semibold">{h.symbol}</p>
                    <p className="truncate text-xs text-muted-foreground">{h.name}</p>
                  </td>
                  <td className="num px-2 text-right">{h.quantity}</td>
                  <td className="num px-2 text-right text-muted-foreground">{num(h.avgPrice)}</td>
                  <td className="num px-2 text-right">{num(h.ltp)}</td>
                  <td
                    className={cn(
                      "num rounded-r-lg px-3 text-right font-semibold",
                      gain >= 0 ? "text-bull" : "text-bear",
                    )}
                  >
                    {signed(gain, 0)}
                    <span className="block text-[11px] font-medium opacity-80">
                      {signed(gainPct)}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "bull" | "bear";
}) {
  return (
    <div className="rounded-xl bg-surface-2/60 p-3">
      <p className="text-[11px] tracking-wider text-muted-foreground uppercase">{label}</p>
      <p
        className={cn(
          "num mt-1 truncate text-base font-bold sm:text-lg",
          tone === "bull" && "text-bull",
          tone === "bear" && "text-bear",
        )}
      >
        {value}
      </p>
    </div>
  );
}
