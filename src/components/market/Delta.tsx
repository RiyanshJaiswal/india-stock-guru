import { cn } from "@/lib/utils";
import { signed } from "@/lib/market-types";
import { TrendingDown, TrendingUp } from "lucide-react";

export function Delta({
  change,
  changePercent,
  className,
  showIcon = true,
}: {
  change?: number | null;
  changePercent: number | null | undefined;
  className?: string;
  showIcon?: boolean;
}) {
  if (changePercent === null || changePercent === undefined) {
    return <span className={cn("num text-xs text-muted-foreground", className)}>—</span>;
  }

  const up = changePercent >= 0;
  const Icon = up ? TrendingUp : TrendingDown;

  return (
    <span
      className={cn(
        "num inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold",
        up ? "bg-bull/12 text-bull" : "bg-bear/12 text-bear",
        className,
      )}
    >
      {showIcon && <Icon className="h-3.5 w-3.5 shrink-0" />}
      {change !== undefined && change !== null && <span>{signed(change)}</span>}
      <span>({signed(changePercent)}%)</span>
    </span>
  );
}
