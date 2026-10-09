import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Package, Users, Truck, Wrench, Footprints, HeartHandshake, MapPin, Check, Clock3, X,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { requestsAPI, apiError } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { toast } from "@/components/ui/Toast";
import { num, relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// RequestCard — a business request, whichever side of it you are on.
//
//   mine  — the offers are a negotiation you preside over: read them, accept
//           one, close the loop. Fulfilled requests stay visible because
//           completed trade is the trust record.
//   open  — someone else's need is your lead: answer with what you can do,
//           at what price, how fast. One offer per business; your latest
//           words replace the earlier ones.
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_ICONS = {
  stock: Package, worker: Users, delivery: Truck,
  rental: Wrench, errand: Footprints, service: HeartHandshake,
};

const TYPE_LABELS = {
  stock: "Stock", worker: "Worker", delivery: "Delivery",
  rental: "Rental", errand: "Errand", service: "Service",
};

const NEEDED_BY = {
  today: "Today", tomorrow: "Tomorrow", this_week: "This week", flexible: "Flexible",
};

const STATUS_BADGES = {
  open: { variant: "brand", label: "Open" },
  fulfilled: { variant: "blue", label: "Fulfilled" },
  cancelled: { variant: "gray", label: "Cancelled" },
};

export default function RequestCard({ request, mode = "open", onChange }) {
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.vendor);
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [offering, setOffering] = useState(false);
  const [note, setNote] = useState("");
  const [price, setPrice] = useState("");
  const [lead, setLead] = useState("");

  const Icon = TYPE_ICONS[request.request_type] || HeartHandshake;
  const status = STATUS_BADGES[request.status] || STATUS_BADGES.open;
  const isMine = request.is_mine ?? mode === "mine";
  const open = request.status === "open";

  const sendOffer = async (e) => {
    e?.preventDefault();
    setBusy(true);
    try {
      await requestsAPI.offer(request.id, {
        note,
        price_kes: price ? Number(price.replace(/[^\d]/g, "")) || null : null,
        lead_time: lead || null,
      });
      toast.success("Offer sent — the requester will compare and confirm");
      setOffering(false);
      setNote(""); setPrice(""); setLead("");
      onChange?.();
    } catch (err) {
      toast.error(apiError(err, "The offer was refused"));
    } finally {
      setBusy(false);
    }
  };

  const accept = async (offer) => {
    if (!(await confirm({
      title: `Accept ${offer.price_kes ? `KSh ${num(offer.price_kes)}` : "this"} offer?`,
      message: "The request closes as fulfilled and the other offers are declined. You coordinate next steps in the inbox.",
      confirmLabel: "Accept offer",
    }))) return;
    setBusy(true);
    try {
      await requestsAPI.accept(request.id, offer.id);
      toast.success("Deal closed — this request is fulfilled");
      onChange?.();
    } catch (err) {
      toast.error(apiError(err, "The offer could not be accepted"));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!(await confirm({
      title: "Withdraw this request?",
      message: "Businesses can no longer respond to it. This cannot be undone.",
      confirmLabel: "Withdraw",
    }))) return;
    setBusy(true);
    try {
      await requestsAPI.cancel(request.id);
      toast.success("Request withdrawn");
      onChange?.();
    } catch (err) {
      toast.error(apiError(err, "The request could not be withdrawn"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="glass rounded-2xl p-3.5 space-y-2">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl bg-surface-2 text-ink-2 flex items-center justify-center shrink-0">
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" size="xs">{TYPE_LABELS[request.request_type] || "Request"}</Badge>
            <Badge variant={status.variant} size="xs">{status.label}</Badge>
            <span className="text-2xs text-ink-4 inline-flex items-center gap-1">
              <Clock3 size={10} /> {NEEDED_BY[request.needed_by] || "Flexible"}
            </span>
          </div>
          <p className="text-sm text-ink-1 mt-1.5">{request.description}</p>
          <p className="text-2xs text-ink-4 mt-1 flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1"><MapPin size={10} /> {request.location}</span>
            {typeof request.distance_km === "number" && <span>· {request.distance_km} km away</span>}
            {request.budget_kes ? <span>· budget ≈ KSh {num(request.budget_kes)}</span> : <span>· open to quotes</span>}
            <span>· posted {relativeTime(request.created_at)}</span>
          </p>
        </div>
      </div>

      {/* ── my request: preside over the offers ─────────────────────────── */}
      {isMine && open && (
        <div className="rounded-xl bg-surface-1 border border-edge-1 divide-y divide-edge-1">
          <p className="px-3 pt-2 pb-1 text-2xs font-semibold text-ink-3">
            {request.offers_count
              ? `${num(request.offers_count)} offer${request.offers_count === 1 ? "" : "s"} — compare and accept one`
              : "Waiting for offers — nearby businesses see this in their request feed"}
          </p>
          {(request.offers || []).map((offer) => (
            <div key={offer.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-ink-1 truncate">
                  {offer.price_kes ? <strong className="tabular-nums">KSh {num(offer.price_kes)}</strong> : "Price on call"}
                  {offer.lead_time ? ` · ${offer.lead_time}` : ""}
                </p>
                <p className="text-2xs text-ink-4 truncate">{offer.note}</p>
              </div>
              <Button size="sm" variant="secondary" icon={Check} loading={busy} onClick={() => accept(offer)}>
                Accept
              </Button>
            </div>
          ))}
        </div>
      )}

      {isMine && request.status === "fulfilled" && (
        <p className="text-2xs text-brand-700 dark:text-brand-300 bg-brand-500/10 rounded-xl px-3 py-2">
          Fulfilled — the accepted offer stays on the record as completed trade.
        </p>
      )}

      {/* ── someone else's request: answer it ───────────────────────────── */}
      {!isMine && open && (
        <>
          {!offering && !request.my_offer && (
            <Button size="sm" variant="secondary" block onClick={() => setOffering(true)}>
              Offer to help
            </Button>
          )}
          {!offering && request.my_offer && (
            <div className="rounded-xl bg-surface-1 border border-edge-1 px-3 py-2 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-2xs font-semibold text-ink-3">Your offer</p>
                <p className="text-xs text-ink-1 truncate">
                  {request.my_offer.price_kes ? `KSh ${num(request.my_offer.price_kes)} — ` : ""}
                  {request.my_offer.note}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setOffering(true)}>Update</Button>
            </div>
          )}
          {offering && (
            <form onSubmit={sendOffer} className="rounded-xl bg-surface-1 border border-edge-1 p-3 space-y-2">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} required minLength={4}
                placeholder="What exactly are you offering?"
                className="w-full rounded-lg border border-edge-2 bg-surface-0 px-2.5 py-2 text-xs text-ink-1 placeholder:text-ink-4 focus:outline-none focus:border-brand-500" />
              <div className="flex gap-2">
                <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric"
                  placeholder="Price KSh (optional)"
                  className="flex-1 h-8 rounded-lg border border-edge-2 bg-surface-0 px-2.5 text-xs text-ink-1 placeholder:text-ink-4 focus:outline-none focus:border-brand-500" />
                <input value={lead} onChange={(e) => setLead(e.target.value)}
                  placeholder="How fast? e.g. ready now"
                  className="flex-1 h-8 rounded-lg border border-edge-2 bg-surface-0 px-2.5 text-xs text-ink-1 placeholder:text-ink-4 focus:outline-none focus:border-brand-500" />
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={busy} disabled={busy || note.trim().length < 4}>Send offer</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setOffering(false)}>Cancel</Button>
              </div>
            </form>
          )}
        </>
      )}

      {isMine && open && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" icon={X} loading={busy} onClick={cancel}>
            Withdraw
          </Button>
        </div>
      )}
    </article>
  );
}
