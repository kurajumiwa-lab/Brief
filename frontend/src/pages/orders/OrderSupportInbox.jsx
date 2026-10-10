import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Textarea from "@/components/ui/Textarea";
import { toast } from "@/components/ui/Toast";
import { apiError, ordersAPI } from "@/lib/api";
import { currency, parseApiDate } from "@/lib/formatters";
import { titleCase } from "@/lib/utils";

const money = (amount) => amount == null ? "Not recorded" : currency(amount);
const dateTime = (value) => {
  if (!value) return "Time not recorded";
  const date = parseApiDate(value);
  return date ? date.toLocaleString() : value;
};

export default function OrderSupportInbox() {
  const [cases, setCases] = useState([]);
  const [notes, setNotes] = useState({});
  const [outcomes, setOutcomes] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await ordersAPI.supportDisputes({ status: "active" });
      setCases(data || []);
    } catch (err) {
      setError(apiError(err, "Support cases could not be loaded"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const resolve = async (event, entry) => {
    event.preventDefault();
    const note = (notes[entry.id] || "").trim();
    if (note.length < 4) {
      toast.error("Add a short resolution note before closing the case.");
      return;
    }
    const outcome = outcomes[entry.id] || "release";
    setBusy(entry.id);
    try {
      const { data } = await ordersAPI.resolveDispute(entry.movement_id, entry.id, {
        outcome,
        resolution_note: note,
      });
      if (outcome === "refund") {
        toast.success(`Refund request sent for ${money(data.refund_amount_ksh)}. The order updates after provider verification.`);
      } else {
        toast.success("Support case closed without a refund.");
      }
      await load();
    } catch (err) {
      toast.error(apiError(err, "Support case could not be resolved"));
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="rounded-2xl border border-edge-1 bg-surface-0 p-4 sm:p-5" aria-labelledby="order-support-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-700"><ShieldCheck size={17} aria-hidden="true" /></span>
          <div>
            <h2 id="order-support-heading" className="text-sm font-bold text-ink-1">Marketplace support cases</h2>
            <p className="mt-1 max-w-2xl text-2xs leading-relaxed text-ink-3">Review the recorded order and provider state. Closing a case does not move money; refund requests remain pending until the payment provider confirms them.</p>
          </div>
        </div>
        <Button size="xs" variant="outline" icon={RefreshCw} onClick={load} loading={loading}>Refresh</Button>
      </div>

      {error ? <div className="mt-4"><ErrorState description={error} onRetry={load} /></div> : loading && cases.length === 0 ? <p role="status" className="py-8 text-center text-xs text-ink-4">Loading active cases…</p> : cases.length === 0 ? <div className="mt-4"><EmptyState icon={ShieldCheck} title="No active order cases" description="New customer, supplier or selected-provider reports will appear here." /></div> : (
        <div className="mt-4 space-y-3">
          {cases.map((entry) => {
            const payment = entry.payment || {};
            const order = entry.order || {};
            const canRefund = ["completed", "refunded"].includes(payment.status) && payment.remaining_refundable_ksh > 0 && !entry.payout_started;
            const refundPending = entry.status === "in_review" && entry.outcome === "refund_pending";
            const outcome = outcomes[entry.id] || "release";
            return (
              <article key={entry.id} className="rounded-xl border border-edge-1 bg-surface-1 p-3.5 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-ink-1">{order.stock_name || "Marketplace order"} · {order.quantity} {order.unit_of_measure}</p>
                    <p className="mt-0.5 text-micro text-ink-4">Order {entry.movement_id} · reported by @{entry.opened_by?.handle || "vendor"} · {dateTime(entry.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2"><Badge size="xs" variant={entry.status === "in_review" ? "amber" : "blue"}>{titleCase(entry.status.replaceAll("_", " "))}</Badge><Badge size="xs" variant="gray">{titleCase(entry.category.replaceAll("_", " "))}</Badge></div>
                </div>

                <p className="mt-3 rounded-lg border border-edge-1 bg-surface-0 px-3 py-2 text-xs leading-relaxed text-ink-2">{entry.description}</p>

                <dl className="mt-3 grid gap-2 text-2xs sm:grid-cols-2 lg:grid-cols-4">
                  <Info label="Buyer" value={`${order.buyer?.business_name || "Buyer"} · @${order.buyer?.handle || "—"}`} />
                  <Info label="Supplier" value={`${order.supplier?.business_name || "Supplier"} · @${order.supplier?.handle || "—"}`} />
                  <Info label="Recorded order total" value={money(order.total_amount_ksh)} />
                  <Info label="Movement status" value={titleCase((order.status || "unknown").replaceAll("_", " "))} />
                  <Info label="Payment status" value={titleCase((payment.status || "unpaid").replaceAll("_", " "))} />
                  <Info label="Provider-verified amount" value={payment.status === "completed" || payment.status === "refunded" ? money(payment.amount_ksh) : "No completed payment"} />
                  <Info label="Refunds recorded" value={money(payment.refunded_amount_ksh || 0)} />
                  <Info label="Remaining refundable" value={money(payment.remaining_refundable_ksh || 0)} />
                  <Info label="Settlement" value={titleCase((order.settlement_status || "not_started").replaceAll("_", " "))} />
                  <Info label="Payout reference" value={payment.reference || "Not recorded"} mono />
                </dl>

                {refundPending ? (
                  <p role="status" className="mt-3 flex items-start gap-2 rounded-lg bg-accent-50 px-3 py-2 text-2xs text-accent-800"><AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />A provider refund is processing. Keep this case open until a verified callback updates the order.</p>
                ) : (
                  <form onSubmit={(event) => resolve(event, entry)} className="mt-4 grid gap-3 border-t border-edge-1 pt-3 sm:grid-cols-2">
                    <label className="block text-2xs font-semibold text-ink-2">Resolution
                      <select value={outcome} onChange={(event) => setOutcomes((current) => ({ ...current, [entry.id]: event.target.value }))} className="mt-1 h-10 w-full rounded-xl border border-edge-2 bg-surface-0 px-3 text-sm text-ink-1">
                        <option value="release">Close case without refund</option>
                        {canRefund && <option value="refund">Refund remaining verified payment ({money(payment.remaining_refundable_ksh)})</option>}
                      </select>
                    </label>
                    <Textarea label="Resolution note" required minLength={4} maxLength={2000} rows={2} value={notes[entry.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [entry.id]: event.target.value }))} hint="Visible to the order participants." wrapperClassName="sm:row-span-2" />
                    {outcome === "refund" && <p className="flex items-start gap-2 rounded-lg bg-accent-50 px-3 py-2 text-2xs text-accent-800 sm:col-span-2"><AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />This requests the full remaining refund through the provider. No client-side action marks it refunded.</p>}
                    {entry.payout_started && <p className="text-micro text-ink-4 sm:col-span-2">A supplier or delivery payout has started; provider reconciliation is required before a refund can be requested.</p>}
                    <div className="sm:col-span-2"><Button size="sm" type="submit" loading={busy === entry.id} disabled={outcome === "refund" && !canRefund}>{outcome === "refund" ? "Request provider refund" : "Close support case"}</Button></div>
                  </form>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Info({ label, value, mono = false }) {
  return <div className="min-w-0 rounded-lg bg-surface-0 px-2.5 py-2"><dt className="text-micro text-ink-4">{label}</dt><dd className={`mt-0.5 break-words text-2xs text-ink-2${mono ? " font-mono" : ""}`}>{value}</dd></div>;
}
