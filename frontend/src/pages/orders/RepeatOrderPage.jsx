import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, RotateCcw } from "lucide-react";
import Breadcrumbs from "@/components/ui/Breadcrumbs";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { toast } from "@/components/ui/Toast";
import { apiError, ordersAPI } from "@/lib/api";
import { preciseCurrency, num, shortDate } from "@/lib/formatters";

function newKey() {
  // A retry uses the same key, even if the first response never reached us.
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function RepeatOrderPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [candidates, setCandidates] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [key, setKey] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await ordersAPI.repeatable();
      setCandidates(data);
    } catch (err) {
      setError(apiError(err, "Could not load past orders"));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = (row) => {
    setSelected(row);
    setQuantity(String(row.quantity));
    setPrice(String(row.last_unit_price_kes));
    setKey(newKey());
    setAttempted(false);
    setSubmitError("");
  };

  const qty = Number(quantity);
  const unitPrice = Number(price);
  const totalCents = qty * Math.round(unitPrice * 100);
  const valid = selected && !selected.unavailable_reason && Number.isSafeInteger(qty) && qty >= selected.min_order_quantity &&
    qty <= Math.min(selected.available, 1_000_000) && Number.isFinite(unitPrice) &&
    unitPrice >= 0 && unitPrice <= 100_000_000 && /^\d+(\.\d{1,2})?$/.test(price) &&
    Number.isSafeInteger(totalCents) && totalCents <= 200_000_000_000;
  const total = valid ? Math.floor((totalCents + 50) / 100) : null;

  const submit = async (event) => {
    event.preventDefault();
    if (!valid || busy) return;
    if (!attempted && !(await confirm({
      title: "Request this stock again?",
      message: `Ask @${selected.supplier_handle} for ${qty} ${selected.unit} of ${selected.item} at a proposed ${preciseCurrency(unitPrice)} each (${preciseCurrency(total)} recorded product amount)? The supplier must confirm; this does not take payment.`,
      confirmLabel: "Send request",
    }))) return;
    setBusy(true);
    setSubmitError("");
    setAttempted(true);
    try {
      const { data } = await ordersAPI.repeat({
        source_movement_id: selected.source_movement_id, quantity: qty, proposed_price: unitPrice,
      }, key);
      toast.success(data.replayed ? "Your earlier request was found" : "Request recorded — supplier confirmation is next");
      navigate(`/orders/${data.movement_id}`);
    } catch (err) {
      // A definitive validation/conflict response cannot have committed this
      // proposal: allow the vendor to correct it and use a fresh key. A lost
      // response or server failure may have committed it; freeze the fields
      // and keep the same key for a safe retry instead.
      if (err.response && [400, 403, 404, 409, 422].includes(err.response.status)) {
        setAttempted(false);
        setKey(newKey());
      }
      setSubmitError(apiError(err, "This request was not confirmed by the server"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-10">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Orders", to: "/orders" }, { label: "Repeat an order" }]} />
      <header className="space-y-2">
        <p className="text-micro font-bold uppercase tracking-widest text-brand-700 dark:text-brand-300">Trade with your known supplier</p>
        <h1 className="text-2xl font-bold text-ink-1">Repeat a previous order</h1>
        <p className="text-sm text-ink-3 max-w-2xl">Use your completed trades as a starting point. Last recorded prices are not proof of payment or a current quote. Check the supplier’s stock before submitting; they still need to confirm.</p>
      </header>
      {error ? <ErrorState description={error} onRetry={load} /> : candidates === null ? (
        <SkeletonRows count={3} />
      ) : candidates.length === 0 ? (
        <EmptyState icon={RotateCcw} tone="brand" title="No completed orders to repeat yet"
          description="Find a supplier and record your first trade. Once handover is confirmed by both sides, it will be available here."
          action={<Link to="/browse?type=goods"><Button size="sm">Find stock</Button></Link>} />
      ) : (
        <ul className="space-y-2">
          {candidates.map((row) => (
            <li key={row.source_movement_id} className="rounded-2xl border border-edge-1 bg-surface-0 p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="font-bold text-sm text-ink-1">{row.item} <span className="text-2xs font-normal text-ink-4">· {row.sku || "No SKU"}</span></p>
                <p className="text-xs text-ink-2">@{row.supplier_handle} · {num(row.quantity)} {row.unit} · last recorded {preciseCurrency(row.last_unit_price_kes)}/{row.unit}</p>
                <p className="text-2xs text-ink-4">{shortDate(row.last_ordered_at)} · {preciseCurrency(row.last_total_kes)} product amount · supplier states {num(row.available)} available now</p>
                {row.unavailable_reason && <p className="text-2xs text-red-700 dark:text-red-400">{row.unavailable_reason}</p>}
                {!row.unavailable_reason && row.available < row.quantity && <p className="text-2xs text-accent-700 dark:text-accent-300">Less stock now; choose a smaller quantity.</p>}
              </div>
              <Button size="sm" variant={row.unavailable_reason ? "secondary" : "primary"} disabled={!!row.unavailable_reason} onClick={() => open(row)}>
                Review repeat <ArrowRight size={14} aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Modal open={!!selected} onClose={() => !busy && setSelected(null)} title="Review repeat request" size="sm"
        description="This is a proposed new order, not an automatic purchase. No payment is taken.">
        {selected && <form onSubmit={submit} className="space-y-4">
          <div className="rounded-xl bg-surface-1 p-3 text-sm text-ink-2">
            <strong className="text-ink-1">{selected.item}</strong> from @{selected.supplier_handle}
            <p className="mt-1 text-2xs">Last recorded order: {num(selected.quantity)} {selected.unit} at {preciseCurrency(selected.last_unit_price_kes)} each.</p>
          </div>
          {selected.current_unit_price_kes !== selected.last_unit_price_kes && <p role="status" className="rounded-xl border border-accent-500/40 bg-accent-50 p-3 text-xs text-accent-900 dark:bg-accent-500/10 dark:text-accent-200">
            Last recorded {preciseCurrency(selected.last_unit_price_kes)}/{selected.unit} · supplier’s current posted price {preciseCurrency(selected.current_unit_price_kes)}/{selected.unit}. You are proposing the old price; the supplier can accept or ask to renegotiate.
          </p>}
          <div className="grid grid-cols-2 gap-3">
            <Input label="Quantity" type="number" min={selected.min_order_quantity} max={Math.min(selected.available, 1_000_000)} step="1" required disabled={attempted} value={quantity} onChange={(e) => setQuantity(e.target.value)} hint={`Available now: ${num(selected.available)} · minimum ${selected.min_order_quantity}`} />
            <Input label="Proposed KES per unit" type="number" min="0" max="100000000" step="0.01" required disabled={attempted} value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="rounded-xl border border-edge-1 p-3 text-xs text-ink-3 flex justify-between gap-2"><span>Proposed product amount</span><strong className="text-ink-1 tabular-nums">{total === null ? "—" : preciseCurrency(total)}</strong></div>
          {submitError && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{submitError}{attempted ? ". The request may already have reached the server; retry here with the same key, or check Orders before starting over." : ". Review and adjust the proposal before sending a new request."}</p>}
          <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setSelected(null)}>Cancel</Button><Button type="submit" size="sm" disabled={!valid || busy} loading={busy}>{attempted ? "Retry same request" : "Review & send"}</Button></div>
        </form>}
      </Modal>
    </div>
  );
}
