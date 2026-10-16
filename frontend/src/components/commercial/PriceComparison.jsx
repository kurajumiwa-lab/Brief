import { PiggyBank, TrendingDown, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { currency } from "@/lib/formatters";

export default function PriceComparison({ individual, group, savings, savingsPct, currencyCode = "KES", compact = false }) {
  if (individual == null && group == null) return null;

  const hasSavings = savings != null && savings > 0;
  const hasGroup = group != null && individual != null && group < individual;

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {individual != null && (
          <span className={cn("text-xs", hasGroup ? "line-through text-ink-4" : "font-semibold text-ink-1")}>
            {currency(individual)}
          </span>
        )}
        {hasGroup && (
          <span className="text-sm font-bold text-brand-700 dark:text-brand-300">
            {currency(group)}
          </span>
        )}
        {hasSavings && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-2xs font-bold text-emerald-700 dark:text-emerald-300">
            <PiggyBank size={10} /> Save {currency(savings)}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-surface-1 border border-edge-1 p-3 space-y-2.5">
      <div className="flex gap-3">
        <div className="flex-1">
          <p className="text-2xs text-ink-4">Individual price</p>
          <p className={cn("text-base font-semibold", hasGroup ? "line-through text-ink-4" : "text-ink-1")}>
            {individual != null ? currency(individual) : "—"}
          </p>
        </div>
        <div className="flex-1">
          <p className="text-2xs text-ink-4">Group price</p>
          <p className="text-base font-bold text-brand-700 dark:text-brand-300">
            {group != null ? currency(group) : "—"}
          </p>
        </div>
      </div>

      {hasSavings && (
        <>
          <div className="h-px bg-edge-1" />
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
              <PiggyBank size={14} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                Save {currency(savings)} per unit {savingsPct ? `· ${savingsPct}% less` : ""}
              </p>
              <p className="text-2xs text-ink-4">
                {savingsPct ? `${savingsPct}% savings when supplier confirms group price` : "Group price saves money"}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function SavingsBadge({ amount, pct, className }) {
  if (!amount && !pct) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-2xs font-bold text-emerald-700 dark:text-emerald-300", className)}>
      <TrendingDown size={12} />
      {pct ? `${pct}% off` : `Save ${currency(amount)}`}
    </span>
  );
}

export function GroupBuyBadge({ count, target, className }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2.5 py-1 text-2xs font-bold text-blue-700 dark:text-blue-300", className)}>
      <Users size={12} />
      {count} interested{target ? ` / ${target} needed` : ""}
    </span>
  );
}
