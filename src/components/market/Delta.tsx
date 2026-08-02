import { cn } from "@/lib/utils";
import { signed } from "@/data/market";
import { TrendingDown, TrendingUp } from "lucide-react";

export function Delta({
  change,
  changePercent,
  className,
  showIcon = true,
}: {
  change?: number;
  changePercent: number;
  className?: string;
  showIcon?: boolean;
}) {
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
      {change !== undefined && <span>{signed(change)}</span>}
      <span>({signed(changePercent)}%)</span>
    </span>
  );
}
