import { indices, num } from "@/data/market";
import { Delta } from "./Delta";

export function MarketOverview() {
  return (
    <section aria-label="Index overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {indices.map((index) => (
        <article key={index.name} className="panel p-4">
          <p className="truncate text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            {index.name}
          </p>
          <p className="num mt-2 text-xl font-bold sm:text-2xl">{num(index.value)}</p>
          <Delta className="mt-2" change={index.change} changePercent={index.changePercent} />
        </article>
      ))}
    </section>
  );
}
