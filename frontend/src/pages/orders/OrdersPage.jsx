import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeftRight, Bell, LayoutGrid, Receipt } from "lucide-react";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import Stat from "@/components/ui/Stat";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Breadcrumbs from "@/components/ui/Breadcrumbs";
import { SkeletonRows } from "@/components/ui/Skeleton";
import MovementRow from "@/components/stock/MovementRow";
import { useStockStore, needsMyAction } from "@/stores/stockStore";
import { apiError } from "@/lib/api";
import { currency, num } from "@/lib/formatters";

/* ═══════════════════════════════════════════════════════════════════════════
   ORDERS — movements, promoted out of a tab.
   ---------------------------------------------------------------------------
   WHAT CHANGED   `/stock?tab=movements` becomes `/orders`. The old URL still
                  resolves and redirects.
   WHY            Orders are a marketplace primitive and the second half of the
                  core loop; they were the third tab of the seller's shelf
                  screen, which is the one place a buyer never goes.
   PRESERVED      Same `stockAPI.movements({ direction })` call, same
                  `MovementRow` actions, same role-gated state machine. The
                  "needs your action" rule is the store's existing predicate.
   ═══════════════════════════════════════════════════════════════════════════ */

const FILTERS = [
  { value: "", label: "All orders" },
  { value: "incoming", label: "Incoming · I'm sourcing" },
  { value: "outgoing", label: "Outgoing · I'm supplying" },
];

export default function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const direction = FILTERS.some((f) => f.value === params.get("direction")) ? params.get("direction") : "";
  const onlyActionable = params.get("needs") === "me";

  const { movements, fetchMovements } = useStockStore();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const setParam = useCallback(
    (patch) => {
      const next = new URLSearchParams(params);
      Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
      setParams(next, { replace: true });
    },
    [params, setParams]
  );

  const load = useCallback(() => {
    setError("");
    setLoading(true);
    return fetchMovements({ direction })
      .catch((e) => setError(apiError(e, "Orders could not be loaded")))
      .finally(() => setLoading(false));
  }, [fetchMovements, direction]);

  useEffect(() => {
    load();
  }, [load]);

  const pending = useMemo(() => movements.filter(needsMyAction), [movements]);
  const rows = useMemo(() => {
    const list = onlyActionable ? pending : movements;
    return [...list].sort((a, b) => Number(needsMyAction(b)) - Number(needsMyAction(a)) || new Date(b.created_at) - new Date(a.created_at));
  }, [movements, pending, onlyActionable]);

  const open = movements.filter((m) => ["pending", "confirmed", "shipped"].includes(m.status));
  const value = open.reduce((n, m) => n + Number(m.total_value || 0), 0);
  const received = movements.filter((m) => m.status === "received").length;

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Orders" }]} />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-1 tracking-tight">Orders</h1>
          <p className="text-2xs text-ink-3 mt-1 max-w-xl">
            Every sourcing request is a movement: requested → confirmed → shipped → received. Only a received movement scores either side.
          </p>
        </div>
        <Button size="sm" variant="secondary" icon={LayoutGrid} onClick={() => navigate("/browse")}>
          Browse stock
        </Button>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Needs your action" value={num(pending.length)} tone={pending.length ? "brand" : "default"} icon={Bell} hint="Confirm, ship or receive" />
        <Stat label="Open movements" value={num(open.length)} hint="not yet received or cancelled" />
        <Stat label="Value in flight" value={currency(value)} hint="sum of open movements" />
        <Stat label="Completed" value={num(received)} hint="received — these are the ones that score" />
      </div>

      <div className="flex flex-wrap items-center gap-2 py-2 border-y border-edge-1">
        {FILTERS.map((f) => (
          <Chip key={f.value} size="sm" active={direction === f.value} onClick={() => setParam({ direction: f.value })}>
            {f.label}
          </Chip>
        ))}
        <Chip size="sm" active={onlyActionable} onClick={() => setParam({ needs: onlyActionable ? "" : "me" })} count={pending.length || undefined}>
          Needs me
        </Chip>
      </div>

      {error ? (
        <ErrorState description={error} onRetry={load} />
      ) : loading && !movements.length ? (
        <SkeletonRows count={4} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={onlyActionable ? Receipt : ArrowLeftRight}
          tone="brand"
          title={onlyActionable ? "Nothing is waiting on you" : "No movements yet"}
          description={
            onlyActionable
              ? "Every open order is with the other side. They will land back here when it is your turn."
              : "A movement is created when you source from a vendor, or when they source from you. Find something worth having and the loop starts."
          }
          action={
            onlyActionable ? (
              <Button size="sm" variant="secondary" onClick={() => setParam({ needs: "" })}>
                Show all orders
              </Button>
            ) : (
              <Button size="sm" icon={LayoutGrid} onClick={() => navigate("/browse")}>
                Browse the network
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-3">
          {rows.map((m) => (
            <MovementRow key={m.id} movement={m} actionable={needsMyAction(m)} />
          ))}
        </div>
      )}
    </div>
  );
}
