import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Clock, Receipt, RefreshCw, WifiOff, XCircle } from "lucide-react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { PageSpinner } from "@/components/ui/Spinner";
import EmptyState from "@/components/ui/EmptyState";
import { receiptsAPI, apiError } from "@/lib/api";
import { useCachedResource } from "@/lib/offline";
import { useAuthStore } from "@/stores/authStore";

/**
 * RECEIPTS (v2.15, Track 1).
 *
 * A vendor's own payment attempts, in provider order, with the one thing a
 * payment screen must never hide: what state the money is actually in.
 *
 * The rules this page follows, because the brief is explicit about them:
 *
 *   · pending and paid are different words, and only the provider can move a
 *     transaction from one to the other;
 *   · a receipt number appears only when the provider confirmed it, so its
 *     absence is information, not a bug;
 *   · a failure carries the provider's reason and a route to support — a dead
 *     end with an amount on it is the worst screen in a payments product.
 */

const STATE = {
  completed: { label: "Paid", variant: "brand", icon: CheckCircle2 },
  pending: { label: "Awaiting provider", variant: "amber", icon: Clock },
  failed: { label: "Failed", variant: "red", icon: XCircle },
  refunded: { label: "Refunded", variant: "gray", icon: Receipt },
  expired: { label: "Expired", variant: "gray", icon: XCircle },
};

const money = (n) => `KES ${Number(n || 0).toLocaleString("en-KE")}`;
const when = (iso) =>
  iso ? new Date(iso).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const KIND_LABEL = {
  stock_movement_payment: "Order payment",
  chama_deposit: "Chama deposit",
  chama_loan_repayment: "Chama repayment",
  murabaha_repayment: "Stock advance repayment",
  sacco_savings: "Sacco savings",
  pick_deposit: "Market run deposit",
  pick_full_payment: "Market run payment",
};

export default function ReceiptsPage() {
  const [filter, setFilter] = useState("all");
  const accountId = useAuthStore((state) => state.vendor?.id);

  const fetcher = useCallback(async () => {
    const { data } = await receiptsAPI.list();
    return data || [];
  }, []);

  const {
    data: rows, savedAt, fromCache, online, error, loading, reload: load,
  } = useCachedResource({
    name: "receipts",
    accountId,
    fetcher,
    errorFallback: (err) => apiError(err, "Could not load your receipts"),
  });

  // Stable identity: the hook returns a new array reference only when data changes.
  const receipts = useMemo(() => rows || [], [rows]);
  const offline = !online;

  const visible = useMemo(
    () => (filter === "all" ? receipts : receipts.filter((r) => r.status === filter)),
    [receipts, filter]
  );

  const totals = useMemo(() => {
    const paid = receipts.filter((r) => r.status === "completed");
    return {
      paidCount: paid.length,
      paidAmount: paid.reduce((sum, r) => sum + Number(r.amount_ksh || 0), 0),
      unsettled: receipts.filter((r) => r.status === "pending" || r.status === "failed").length,
    };
  }, [receipts]);

  if (loading && receipts.length === 0) return <PageSpinner label="Reading your payment records…" />;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-2xs uppercase tracking-wide text-ink-4">Money</p>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-1">Receipts</h1>
          <p className="text-sm text-ink-3 mt-0.5">
            Every payment attempt you made, and what the provider said about it.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={load}
          disabled={loading || offline}
          aria-label="Refresh receipts"
          title={offline ? "Reconnect to refresh" : undefined}
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </div>

      {offline && (
        <Card className="border-amber-300/70 dark:border-amber-500/40">
          <div className="flex items-start gap-2.5">
            <WifiOff size={18} className="text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-1">You are offline</p>
              <p className="text-2xs text-ink-3 mt-0.5 leading-relaxed">
                {receipts.length
                  ? `Showing receipts saved on this device${savedAt ? ` at ${new Date(savedAt).toLocaleString()}` : ""}. A payment can still settle while you are offline — check again when you reconnect.`
                  : "Nothing saved on this device yet. Reconnect to read your receipts."}
              </p>
            </div>
          </div>
        </Card>
      )}

      {error && !offline && (
        <Card className="border-rose-200 dark:border-rose-500/30">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={18} className="text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-1">Receipts could not be loaded</p>
              <p className="text-2xs text-ink-3 mt-0.5">{error}</p>
              <Button size="sm" variant="secondary" className="mt-2" onClick={load}>Try again</Button>
            </div>
          </div>
        </Card>
      )}

      {receipts.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <Card className="py-3">
            <p className="text-micro uppercase tracking-wide text-ink-4">Paid</p>
            <p className="text-base font-bold text-ink-1 mt-0.5">{money(totals.paidAmount)}</p>
            <p className="text-micro text-ink-4">{totals.paidCount} receipt{totals.paidCount === 1 ? "" : "s"}</p>
          </Card>
          <Card className="py-3">
            <p className="text-micro uppercase tracking-wide text-ink-4">Unsettled</p>
            <p className="text-base font-bold text-ink-1 mt-0.5">{totals.unsettled}</p>
            <p className="text-micro text-ink-4">pending or failed</p>
          </Card>
          <Card className="py-3">
            <p className="text-micro uppercase tracking-wide text-ink-4">Attempts</p>
            <p className="text-base font-bold text-ink-1 mt-0.5">{receipts.length}</p>
            <p className="text-micro text-ink-4">last 100</p>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {["all", "pending", "completed", "failed", "refunded"].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
            className={`rounded-full px-2.5 py-1 text-2xs font-semibold border ${
              filter === value
                ? "bg-brand-600 text-white border-brand-600"
                : "bg-surface-0 text-ink-3 border-edge-2 hover:text-ink-1"
            }`}
          >
            {value === "all" ? "All" : STATE[value]?.label || value}
          </button>
        ))}
      </div>

      {!loading && visible.length === 0 && (
        <Card>
          <EmptyState
            icon={Receipt}
            title={receipts.length ? "Nothing in this state" : "No payments yet"}
            description={
              receipts.length
                ? "Switch the filter to see your other payment attempts."
                : "When you pay for an order or a market run, the attempt appears here with its receipt."
            }
          />
        </Card>
      )}

      {visible.map((row) => {
        const state = STATE[row.status] || STATE.pending;
        const Icon = state.icon;
        return (
          <Card key={row.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-bold text-ink-1">{money(row.amount_ksh)}</p>
                  <Badge variant={state.variant}>{state.label}</Badge>
                  <span className="text-micro uppercase tracking-wide text-ink-4">
                    {KIND_LABEL[row.entity_type] || row.entity_type}
                  </span>
                </div>
                <p className="text-2xs text-ink-3 mt-0.5">
                  {row.provider} · started {when(row.created_at)}
                  {row.completed_at ? ` · settled ${when(row.completed_at)}` : ""}
                </p>
                <p className="text-micro text-ink-4 mt-1 font-mono break-all">
                  {row.mpesa_receipt
                    ? `Receipt ${row.mpesa_receipt}`
                    : row.status === "pending"
                    ? "No receipt yet — the provider has not confirmed"
                    : row.status === "failed"
                    ? "No receipt — the payment did not complete"
                    : `Reference ${row.psp_api_ref || row.id.slice(0, 8)}`}
                </p>
                {row.failure_reason ? (
                  <p className="text-2xs text-rose-600 dark:text-rose-400 mt-1">
                    {row.failure_reason}
                  </p>
                ) : null}
                {row.status === "pending" ? (
                  <p className="text-micro text-ink-4 mt-1">
                    The provider has not answered yet. Do not pay twice — a second attempt is blocked
                    while this one is open.
                  </p>
                ) : null}
              </div>
              <Icon size={18} className="text-ink-4 shrink-0 mt-0.5" aria-hidden="true" />
            </div>

            {(row.status === "failed" || row.status === "pending") && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Link
                  to="/activity?tab=support"
                  className="text-2xs font-semibold text-brand-700 dark:text-brand-300 underline"
                >
                  Get help with this payment
                </Link>
                <Link to="/legal" className="text-2xs text-ink-3 underline">
                  Refund and dispute policy
                </Link>
              </div>
            )}
          </Card>
        );
      })}

      <p className="text-micro text-ink-4 px-1 leading-relaxed">
        A payment becomes “Paid” only when the provider confirms it. This page reads records; it
        cannot move money.
        {fromCache && !offline ? " Showing a copy saved on this device while the network recovers." : ""}
      </p>
    </div>
  );
}
