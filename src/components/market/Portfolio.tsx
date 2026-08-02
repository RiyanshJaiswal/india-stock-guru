import { useQuery } from "@tanstack/react-query";

import { positions, inr } from "@/data/market";
import { quotesQuery } from "@/lib/market-queries";
import { num, signed, stripSuffix } from "@/lib/market-types";
import { Delta } from "./Delta";
import { StatTile } from "./StatTile";
import { cn } from "@/lib/utils";

export function Portfolio() {
  const symbols = positions.map((p) => p.symbol);
  const { data } = useQuery(quotesQuery(symbols));

  const rows = positions.map((position) => {
    const ltp = data?.find((q) => q.symbol === position.symbol)?.price ?? null;
    const invested = position.avgPrice * position.quantity;
    const current = ltp === null ? null : ltp * position.quantity;
    return {
      ...position,
      ltp,
      invested,
      current,
      gain: current === null ? null : current - invested,
      gainPct: ltp === null ? null : ((ltp - position.avgPrice) / position.avgPrice) * 100,
    };
  });

  const invested = rows.reduce((sum, r) => sum + r.invested, 0);
  const priced = rows.every((r) => r.current !== null);
  const current = priced ? rows.reduce((sum, r) => sum + (r.current ?? 0), 0) : null;
  const pnl = current === null ? null : current - invested;
  const pnlPercent = pnl === null ? null : (pnl / invested) * 100;

  return (
    <section className="panel p-4 sm:p-5" aria-label="Portfolio">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <h2 className="truncate text-sm font-bold tracking-widest uppercase">Portfolio</h2>
        <Delta className="shrink-0" changePercent={pnlPercent} />
      </header>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Current value" value={current === null ? "—" : inr(current, 0)} />
        <StatTile label="Invested" value={inr(invested, 0)} />
        <StatTile
          label="Overall P&L"
          value={pnl === null ? "—" : `${pnl >= 0 ? "+" : "−"}${inr(Math.abs(pnl), 0)}`}
          tone={pnl === null ? undefined : pnl >= 0 ? "bull" : "bear"}
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
            {rows.map((row) => (
              <tr key={row.symbol} className="bg-surface-2/50">
                <td className="rounded-l-lg px-3 py-2.5">
                  <p className="font-semibold">{stripSuffix(row.symbol)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {data?.find((q) => q.symbol === row.symbol)?.name ?? "—"}
                  </p>
                </td>
                <td className="num px-2 text-right">{row.quantity}</td>
                <td className="num px-2 text-right text-muted-foreground">{num(row.avgPrice)}</td>
                <td className="num px-2 text-right">{num(row.ltp)}</td>
                <td
                  className={cn(
                    "num rounded-r-lg px-3 text-right font-semibold",
                    row.gain === null ? "text-muted-foreground" : row.gain >= 0 ? "text-bull" : "text-bear",
                  )}
                >
                  {signed(row.gain, 0)}
                  <span className="block text-[11px] font-medium opacity-80">
                    {row.gainPct === null ? "" : `${signed(row.gainPct)}%`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
