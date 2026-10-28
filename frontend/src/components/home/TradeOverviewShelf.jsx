import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, BookOpen, PackageCheck, RotateCcw, ClipboardCheck } from "lucide-react";
import ErrorState from "@/components/ui/ErrorState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useTradeOverviewStore } from "@/stores/tradeOverviewStore";
import { currency, num, relativeTime } from "@/lib/formatters";

/**
 * TRADE OVERVIEW SHELF — Compact summary replacing oversized cards (v3.3).
 *
 * One shelf that shows:
 *   - Pending actions prominently (primary)
 *   - Total recorded orders secondarily
 *   - Direct link to trade/order screen
 *   - Recent orders and repeat-order as compact secondary links
 *
 * Uses real database records and existing order-status rules.
 * Supports loading, errors, zero orders, and zero pending actions.
 * Reduces vertical space substantially without removing functionality.
 */
export default function TradeOverviewShelf() {
  const navigate = useNavigate();
  // The overview is a shared fact: the business pulse reads the same store, so
  // this page makes one request and shows one failure, not two cards apologising
  // for the same broken endpoint.
  const data = useTradeOverviewStore((state) => state.data);
  const error = useTradeOverviewStore((state) => state.error);
  const stale = useTradeOverviewStore((state) => state.stale);
  const loadedAtRaw = useTradeOverviewStore((state) => state.at);
  const load = useTradeOverviewStore((state) => state.load);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [now, setNow] = useState(Date.now());
  const loadedAt = loadedAtRaw ? new Date(loadedAtRaw) : null;

  useEffect(() => {
    load().catch(() => {});
    const refresh = window.setInterval(() => {
      setNow(Date.now());
      if (navigator.onLine && !document.hidden) load({ force: true }).catch(() => {});
    }, 60000);
    const onOnline = () => { setOnline(true); load({ force: true }).catch(() => {}); };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearInterval(refresh);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [load]);

  const count = data?.summary;
  const items = data?.items || [];
  const latest = items[0];
  const hasPending = (count?.needs_action || 0) > 0;
  const hasOrders = (count?.recorded || 0) > 0;

  if (!data) {
    return error ? (
      <ErrorState
        title="Overview unavailable"
        description={error}
        onRetry={() => useTradeOverviewStore.getState().retry()}
        compact
      />
    ) : (
      <div className="rounded-2xl border border-edge-1 bg-surface-0 p-4">
        <SkeletonRows count={2} />
      </div>
    );
  }

  // First trade - show onboarding
  if (!hasOrders) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-1 p-3">
        <div>
          <p className="text-sm font-bold text-ink-1">Record your first trade</p>
          <p className="text-2xs text-ink-3">Find stock, agree with the supplier and confirm the handover together.</p>
        </div>
        <Link 
          to="/browse?type=goods" 
          className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700"
        >
          Find stock
        </Link>
      </div>
    );
  }

  return (
    <section 
      aria-label="Trade overview" 
      className="rounded-2xl border border-edge-1 bg-surface-0 p-3 space-y-2"
    >
      {/* Status indicator */}
      <p role="status" className="flex items-center gap-1.5 text-micro text-ink-4">
        <span className={`h-2 w-2 rounded-full ${!online ? "bg-red-500" : error || (loadedAt && now - loadedAt.getTime() > 60000) ? "bg-accent-500" : "bg-brand-500"}`} aria-hidden="true" />
        {!online
          ? "Offline · last loaded view"
          : error || stale
            ? "Couldn't refresh · showing the last numbers read"
            : !loadedAt
              ? "Connecting…"
              : now - loadedAt.getTime() > 60000
                ? `Updated ${relativeTime(loadedAt)}`
                : "Live from your records"}
      </p>

      {/* Primary: Pending actions */}
      <Link
        to="/orders?needs=me"
        className="flex items-center gap-3 rounded-xl border border-brand-500/40 bg-brand-50 px-3 py-2.5 font-semibold text-brand-800 dark:bg-brand-500/10 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-500/20 transition-colors"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-500/20 text-brand-700 dark:text-brand-300">
          <ClipboardCheck size={16} aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-bold text-ink-1">
            {hasPending ? (
              count.needs_action === 1 ? "1 trade needs your action" : `${num(count.needs_action)} trades need your action`
            ) : "No pending actions"}
          </span>
          <span className="block text-micro text-ink-4">
            {hasPending ? "Confirm, dispatch or check a handover" : "All orders are up to date"}
          </span>
        </span>
        <ArrowRight size={14} className="shrink-0 text-ink-4" aria-hidden="true" />
      </Link>

      {/* Secondary: Order summary and quick actions */}
      <div className="flex flex-wrap gap-2">
        <Link 
          to="/orders/records"
          className="flex items-center gap-2 rounded-xl border border-edge-1 px-3 py-2 text-micro font-medium text-ink-2 hover:bg-surface-1 transition-colors"
        >
          <BookOpen size={14} aria-hidden="true" />
          {num(count.recorded)} orders recorded
          {count.received && ` · ${num(count.received)} handover${count.received === 1 ? "" : "s"} confirmed`}
        </Link>
        
        {latest && (
          <Link 
            to={`/orders/${latest.id}`}
            className="flex items-center gap-2 rounded-xl border border-edge-1 px-3 py-2 text-micro text-ink-2 hover:bg-surface-1 transition-colors"
          >
            <PackageCheck size={14} aria-hidden="true" />
            <span className="truncate">Recent: {latest.item} · {currency(latest.total_kes)}</span>
          </Link>
        )}
        
        <Link 
          to="/orders/repeat"
          className="flex items-center gap-2 rounded-xl border border-brand-500/40 bg-brand-50 px-3 py-2 text-micro font-medium text-brand-800 dark:bg-brand-500/10 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-500/20 transition-colors"
        >
          <RotateCcw size={14} aria-hidden="true" />
          Repeat an order
        </Link>
      </div>
    </section>
  );
}
