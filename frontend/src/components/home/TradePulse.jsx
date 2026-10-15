import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, BookOpen, PackageCheck, RotateCcw } from "lucide-react";
import Stat from "@/components/ui/Stat";
import ErrorState from "@/components/ui/ErrorState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { apiError, ordersAPI } from "@/lib/api";
import { currency, num, relativeTime } from "@/lib/formatters";

/** Home is an agenda, not a marketplace promise. Counts are from all of this
    vendor's recorded movements, not the capped Orders list or example data. */
export default function TradePulse() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [now, setNow] = useState(Date.now());
  const load = useCallback(async () => {
    try {
      const { data: next } = await ordersAPI.records({ limit: 1 });
      setData(next);
      setLoadedAt(new Date());
      setError("");
    } catch (err) {
      setError(apiError(err, "Could not read your trade overview"));
    }
  }, []);

  useEffect(() => {
    load();
    const refresh = window.setInterval(() => {
      setNow(Date.now());
      if (navigator.onLine && !document.hidden) load();
    }, 60000);
    const onOnline = () => { setOnline(true); load(); };
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
  const latest = data?.items?.[0];
  return (
    <section aria-label="My trade overview" className="rounded-3xl border border-edge-1 bg-surface-0 p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-micro font-bold uppercase tracking-widest text-brand-700 dark:text-brand-300">My shop</p><h2 className="text-base font-bold text-ink-1">Trade overview</h2></div>
        <p role="status" className="flex items-center gap-1.5 text-micro text-ink-4">
          <span className={`h-2 w-2 rounded-full ${!online ? "bg-red-500" : error || loadedAt && now - loadedAt.getTime() > 60000 ? "bg-accent-500" : "bg-brand-500"}`} aria-hidden="true" />
          {!online ? "Offline · last loaded view" : error ? "Connection interrupted · last loaded view" : !loadedAt ? "Connecting…" : now - loadedAt.getTime() > 60000 ? `Updated ${relativeTime(loadedAt)}` : "Live from your records"}
        </p>
      </div>
      {error && data && <p role="alert" className="text-2xs text-red-700 dark:text-red-400">{error} — last loaded view. <button type="button" className="underline" onClick={load}>Retry</button></p>}
      {!data ? error ? <ErrorState title="Overview unavailable" description={error} onRetry={load} compact /> : <SkeletonRows count={2} /> : count?.recorded ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <Stat label="Needs your action" value={num(count.needs_action)} tone={count.needs_action ? "brand" : "default"} onClick={() => navigate("/orders?needs=me")} hint="Confirm, dispatch or check a handover" />
            <Stat label="Orders recorded" value={num(count.recorded)} hint={`${num(count.received)} handover${count.received === 1 ? "" : "s"} confirmed`} onClick={() => navigate("/orders/records")} />
          </div>
          <div className="grid gap-2 sm:grid-cols-3 text-xs">
            <Link to="/orders/repeat" className="flex items-center gap-2 rounded-xl border border-brand-500/40 bg-brand-50 px-3 py-3 font-semibold text-brand-800 dark:bg-brand-500/10 dark:text-brand-300"><RotateCcw size={16} aria-hidden="true" /> Repeat an order <ArrowRight size={13} className="ml-auto" aria-hidden="true" /></Link>
            {latest && <Link to={`/orders/${latest.id}`} className="flex items-center gap-2 rounded-xl border border-edge-1 px-3 py-3 text-ink-2"><PackageCheck size={16} aria-hidden="true" /><span className="truncate">Recent: {latest.item} · {currency(latest.total_kes)}</span><ArrowRight size={13} className="ml-auto shrink-0" aria-hidden="true" /></Link>}
            <Link to="/orders/records" className="flex items-center gap-2 rounded-xl border border-edge-1 px-3 py-3 font-semibold text-ink-2"><BookOpen size={16} aria-hidden="true" /> My records <ArrowRight size={13} className="ml-auto" aria-hidden="true" /></Link>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-1 p-3">
          <div><p className="text-sm font-bold text-ink-1">Record your first trade</p><p className="text-2xs text-ink-3">Find stock, agree with the supplier and confirm the handover together. No payment is taken here.</p></div>
          <Link to="/browse?type=goods" className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700">Find stock</Link>
        </div>
      )}
    </section>
  );
}
