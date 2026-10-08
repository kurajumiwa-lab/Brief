import { useState } from "react";
import { HeartHandshake, Check, X, Reply, Truck } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";
import { useChatStore } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";
import { DELIVERY_TERMS, PAYMENT_TERMS, DEAL_STATUS_BADGE } from "@/config/constants";
import { apiError } from "@/lib/api";
import { currency, num } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const label = (list, v) => list.find((o) => o.value === v)?.label || v || "—";

/**
 * Structured deal terms carried in `message.deal_data` (v2.1 §4.1) with the
 * Accept / Counter / Decline actions for the party that did not propose.
 */
export default function DealProposalCard({ message, mine }) {
  const deal = message?.deal_data;
  const me = useAuthStore((s) => s.vendor);
  const { acceptDeal, counterDeal, declineDeal } = useChatStore();
  const [countering, setCountering] = useState(false);
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState({ quantity: "", price: "", delivery_terms: "", payment_terms: "", notes: "" });
  if (!deal) return null;

  const status = deal.status || "proposed";
  const open = status === "proposed";
  const isProposer = deal.proposed_by ? deal.proposed_by === me?.id : mine;
  const canAct = open && !isProposer;
  const total = deal.total ?? (deal.quantity && deal.proposed_price_per_unit != null ? Number(deal.quantity) * Number(deal.proposed_price_per_unit) : null);

  const run = async (kind, fn) => {
    setBusy(kind);
    try {
      await fn();
    } catch (err) {
      toast.error(apiError(err, `Couldn't ${kind} the deal`));
    } finally {
      setBusy("");
    }
  };

  const submitCounter = async (e) => {
    e.preventDefault();
    if (form.price === "" || Number(form.price) < 0) return toast.error("Name your price per unit");
    await run("counter", async () => {
      await counterDeal(message.id, {
        proposed_price_per_unit: Number(form.price),
        quantity: form.quantity ? Number(form.quantity) : deal.quantity,
        delivery_terms: form.delivery_terms || deal.delivery_terms || "pickup",
        payment_terms: form.payment_terms || deal.payment_terms || "on_delivery",
        notes: form.notes.trim() || null,
      });
      setCountering(false);
      toast.success("Counter-offer sent");
    });
  };

  return (
    <div className={cn("mt-1.5 rounded-lg border p-2.5 min-w-[15rem]", status === "accepted" ? "border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-500/15" : status === "declined" ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-500/15" : status === "countered" ? "border-edge-2 bg-surface-2/60" : "border-accent-200 dark:border-accent-800 bg-accent-50 dark:bg-accent-500/15")} data-testid="deal-card" data-status={status}>
      <div className="flex items-center gap-2 text-accent-600 dark:text-accent-400">
        <HeartHandshake size={13} />
        <span className="text-xs font-semibold">{deal.round > 1 ? `Counter-offer · round ${deal.round}` : "Deal proposal"}</span>
        <Badge variant={DEAL_STATUS_BADGE[status] || "gray"} size="xs" className="ml-auto">
          {status}
        </Badge>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-2xs">
        {deal.stock_name && (
          <>
            <dt className="text-ink-4">Item</dt>
            <dd className="text-ink-1 truncate">{deal.stock_name}</dd>
          </>
        )}
        <dt className="text-ink-4">Quantity</dt>
        <dd className="font-mono text-ink-1">
          {num(deal.quantity)} {deal.unit_of_measure || ""}
        </dd>
        <dt className="text-ink-4">Price / unit</dt>
        <dd className="font-mono text-ink-1">{deal.proposed_price_per_unit != null ? currency(deal.proposed_price_per_unit) : "—"}</dd>
        {total != null && (
          <>
            <dt className="text-ink-4">Total</dt>
            <dd className="font-mono text-accent-600 dark:text-accent-400 font-semibold">{currency(total)}</dd>
          </>
        )}
        <dt className="text-ink-4">Delivery</dt>
        <dd className="text-ink-1">{label(DELIVERY_TERMS, deal.delivery_terms)}</dd>
        <dt className="text-ink-4">Payment</dt>
        <dd className="text-ink-1">{label(PAYMENT_TERMS, deal.payment_terms)}</dd>
      </dl>
      {deal.notes && <p className="mt-2 text-2xs text-ink-3 italic">{deal.notes}</p>}

      {status === "accepted" && deal.movement_id && (
        <p className="mt-2 inline-flex items-center gap-1 text-2xs text-brand-600 dark:text-brand-400">
          <Truck size={11} /> Movement confirmed — track it under Stock → Movements
        </p>
      )}
      {status === "countered" && <p className="mt-2 text-2xs text-ink-4">Answered with a counter-offer below.</p>}
      {open && isProposer && <p className="mt-2 text-2xs text-ink-4">Waiting for the other side.</p>}

      {canAct && !countering && (
        <div className="mt-2.5 flex items-center gap-1.5">
          <Button size="xs" icon={Check} loading={busy === "accept"} onClick={() => run("accept", async () => { await acceptDeal(message.id); toast.success("Deal accepted — stock reserved"); })}>
            Accept
          </Button>
          <Button size="xs" variant="secondary" icon={Reply} onClick={() => setCountering(true)}>
            Counter
          </Button>
          <Button size="xs" variant="dangerGhost" icon={X} loading={busy === "decline"} onClick={() => run("decline", () => declineDeal(message.id))}>
            Decline
          </Button>
        </div>
      )}

      {canAct && countering && (
        <form onSubmit={submitCounter} className="mt-2.5 space-y-2" aria-label="Counter-offer">
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" min="0" step="any" placeholder={`Price (was ${deal.proposed_price_per_unit})`} prefix="KES" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} aria-label="Counter price per unit" autoFocus />
            <Input type="number" min="1" step="1" placeholder={`Qty (${deal.quantity})`} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} aria-label="Counter quantity" />
            <Select value={form.delivery_terms || deal.delivery_terms || "pickup"} onChange={(e) => setForm({ ...form, delivery_terms: e.target.value })} options={DELIVERY_TERMS} aria-label="Delivery terms" />
            <Select value={form.payment_terms || deal.payment_terms || "on_delivery"} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} options={PAYMENT_TERMS} aria-label="Payment terms" />
          </div>
          <Input placeholder="Note (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div className="flex items-center justify-end gap-1.5">
            <Button size="xs" variant="ghost" onClick={() => setCountering(false)}>
              Cancel
            </Button>
            <Button size="xs" type="submit" loading={busy === "counter"}>
              Send counter
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
