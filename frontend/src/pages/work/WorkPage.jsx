import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ClipboardList, Megaphone, Receipt, ListChecks, Lock, CalendarDays, Truck,
  ChevronRight, CheckCircle2,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Breadcrumbs from "@/components/ui/Breadcrumbs";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import RequestComposer from "@/components/requests/RequestComposer";
import RequestCard from "@/components/requests/RequestCard";
import { requestsAPI, apiError } from "@/lib/api";
import { useStockStore, needsMyAction } from "@/stores/stockStore";
import { num } from "@/lib/formatters";

// ─────────────────────────────────────────────────────────────────────────────
// WORK — orders, requests, bookings, rentals and jobs.
//
// Not a new database: an agenda. The tab answers one question — "what is in
// flight for my business today?" — by aggregating the screens that already own
// each flow and never duplicating them. The one thing it owns outright is the
// request loop, because accepting an offer IS closing work.
// ─────────────────────────────────────────────────────────────────────────────

export default function WorkPage() {
  const navigate = useNavigate();
  const movements = useStockStore((s) => s.movements);
  const [mine, setMine] = useState(null);
  const [error, setError] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);

  const load = useCallback(() => {
    setError("");
    return requestsAPI.list({ scope: "mine", limit: 30 })
      .then((r) => setMine(r.data))
      .catch((e) => setError(apiError(e, "Your requests could not be loaded")));
  }, []);

  useEffect(() => { load(); }, [load]);

  const awaiting = movements.filter(needsMyAction).length;
  const openRequests = (mine || []).filter((r) => r.status === "open");
  const offersWaiting = openRequests.reduce((total, r) => total + (r.offers_count || 0), 0);

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Work" }]} />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-1 tracking-tight">Work</h1>
          <p className="text-2xs text-ink-3 mt-1">
            Everything in flight — what you owe, what is owed to you, and what is waiting on your word.
          </p>
        </div>
        <Button size="sm" icon={Megaphone} onClick={() => setComposerOpen(true)}>
          Post a request
        </Button>
      </header>

      {/* ── the agenda: links into the flows that already own them ─────── */}
      <nav aria-label="Work areas" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <WorkLink to="/orders" icon={Receipt} label="Orders & movements"
          sub={awaiting ? `${num(awaiting)} need your action` : "Stock deals and movements"}
          badge={awaiting || null} />
        <WorkLink to="/tasks" icon={ListChecks} label="Tasks & jobs"
          sub="Hustle contracts and job calls" />
        <WorkLink to="/locks" icon={Lock} label="Market locks"
          sub="Daily group-buy windows" />
        <WorkLink to="/tools" icon={Truck} label="Rentals & delivery"
          sub="Bookings, couriers, shipments" />
        <WorkLink to="/events" icon={CalendarDays} label="Events"
          sub="Trade days and registrations" />
        <WorkLink to="/lists" icon={ClipboardList} label="Saved partners"
          sub="Trusted vendors and lists" />
      </nav>

      {/* ── my requests: the loop this tab owns ────────────────────────── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink-1">My requests</h2>
          {openRequests.length > 0 && (
            <Badge variant={offersWaiting ? "brand" : "gray"} size="xs">
              {offersWaiting ? `${num(offersWaiting)} offer${offersWaiting === 1 ? "" : "s"} waiting` : `${num(openRequests.length)} open`}
            </Badge>
          )}
        </div>
        {error ? (
          <p className="text-2xs text-red-600 dark:text-red-400">{error}</p>
        ) : !mine ? (
          <PageSpinner label="Reading your requests…" />
        ) : mine.length === 0 ? (
          <EmptyState icon={ClipboardList} tone="brand" title="No requests yet"
            description="When the shelves cannot answer, ask the network: post what you need and compare the offers that come back."
            action={<Button size="sm" icon={Megaphone} onClick={() => setComposerOpen(true)}>Post your first request</Button>} />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {mine.map((r) => <RequestCard key={r.id} request={r} mode="mine" onChange={load} />)}
          </div>
        )}
      </section>

      <RequestComposer open={composerOpen} onClose={() => setComposerOpen(false)} onPosted={load} />
    </div>
  );
}

function WorkLink({ to, icon: Icon, label, sub, badge }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}
      className="glass glass-hover rounded-2xl p-3 flex items-center gap-3 text-left cursor-pointer">
      <span className="w-9 h-9 rounded-xl bg-surface-2 text-ink-2 flex items-center justify-center shrink-0">
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-ink-1 truncate">{label}</span>
          {badge ? (
            <span className="min-w-4 h-4 px-1 rounded-full bg-brand-700 text-white text-micro font-bold grid place-items-center tabular-nums">
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
        </span>
        <span className="block text-2xs text-ink-4 truncate">{sub}</span>
      </span>
      <ChevronRight size={14} className="text-ink-4 shrink-0" />
    </button>
  );
}
