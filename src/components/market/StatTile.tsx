import { cn } from "@/lib/utils";

/** Reusable label/value tile used by the chart panel, stat rows and detail page. */
export function StatTile({
  label,
  value,
  tone,
  className,
}: {
  label: string;
  value: string;
  tone?: "bull" | "bear";
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl bg-surface-2/60 p-3", className)}>
      <p className="text-[11px] tracking-wider text-muted-foreground uppercase">{label}</p>
      <p
        className={cn(
          "num mt-1 truncate text-sm font-semibold sm:text-base",
          tone === "bull" && "text-bull",
          tone === "bear" && "text-bear",
        )}
      >
        {value}
      </p>
    </div>
  );
}
