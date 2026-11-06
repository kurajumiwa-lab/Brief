import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useTradeOverviewStore } from "@/stores/tradeOverviewStore";
import { currency, num } from "@/lib/formatters";

const SHOWN = 3;

/**
 * ACTIVITY — the three latest trades, from the same shared store the trade
 * overview used. Renders nothing when there are none, so a new shop does not
 * see an empty table.
 */
export default function ActivityList() {
  const data = useTradeOverviewStore((state) => state.data);
  const load = useTradeOverviewStore((state) => state.load);

  useEffect(() => {
    load().catch(() => {});
    const onOnline = () => load({ force: true }).catch(() => {});
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [load]);

  const items = (data?.items || []).slice(0, SHOWN);
  if (items.length === 0) return null;
  const needs = data?.summary?.needs_action || 0;

  return (
    <section aria-labelledby="activity-heading" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="activity-heading" className="text-sm font-bold text-ink-1">
          Activity{needs > 0 ? ` · ${num(needs)} need${needs === 1 ? "s" : ""} you` : ""}
        </h2>
        <Link to={needs > 0 ? "/orders?needs=me" : "/orders/records"} className="inline-flex items-center gap-1 text-micro font-bold text-brand-700 dark:text-brand-400 hover:underline underline-offset-2">
          All trades <ArrowRight size={12} aria-hidden="true" />
        </Link>
      </div>
      <ul className="divide-y divide-edge-1 rounded-2xl border border-edge-1 bg-surface-0">
        {items.map((t) => (
          <li key={t.id}>
            <Link to={`/orders/${t.id}`} className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-surface-1">
              <span className="min-w-0 truncate text-xs font-semibold text-ink-1">{t.item}</span>
              <span className="shrink-0 text-micro font-bold text-ink-2 tabular-nums">{currency(t.total_kes)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
