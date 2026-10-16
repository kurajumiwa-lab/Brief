import { Users, Target, Clock, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function GroupBuyProgress({ current, target, minSize, interested, className }) {
  const qty = current || 0;
  const tgt = target || minSize || 10;
  const pct = tgt > 0 ? Math.min(100, Math.round((qty / tgt) * 100)) : 0;
  const remaining = Math.max(0, tgt - qty);
  const isReady = pct >= 100 || (minSize && (interested || 0) >= minSize);

  return (
    <div className={cn("space-y-2.5", className)}>
      <div className="flex items-center justify-between text-2xs">
        <span className="inline-flex items-center gap-1.5 text-ink-4">
          <Users size={12} /> {interested || 0} interested buyers
        </span>
        <span className={cn("font-bold", isReady ? "text-emerald-600 dark:text-emerald-400" : "text-ink-2")}>
          {qty} / {tgt} units
        </span>
      </div>

      <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", isReady ? "bg-emerald-500" : "bg-brand-500")}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-2xs text-ink-4">
          {isReady ? (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
              <CheckCircle2 size={12} /> Ready to negotiate group price
            </span>
          ) : remaining > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Target size={12} /> {remaining} more to unlock group price
            </span>
          ) : (
            "Gathering interest"
          )}
        </p>
        <span className="text-2xs font-mono text-ink-4">{pct}%</span>
      </div>
    </div>
  );
}

export function MiniProgress({ current, target }) {
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden max-w-[6rem]">
        <div className="h-full bg-brand-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-2xs text-ink-4">{current}/{target}</span>
    </div>
  );
}
