import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Truck, Star, ChevronRight, Search } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Modal from "@/components/ui/Modal";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { toolAPI, vendorAPI, stockAPI, apiError } from "@/lib/api";
import { SHIPMENT_STATUSES } from "@/config/constants";
import { currency, num, relativeTime, shortDateTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const meta = (s) => SHIPMENT_STATUSES.find((x) => x.value === s) || { label: s, variant: "gray" };
const ORDER = SHIPMENT_STATUSES.map((s) => s.value);
const NEXT = { picked_up: ["in_transit", "out_for_delivery", "delivered", "failed"], in_transit: ["out_for_delivery", "delivered", "failed"], out_for_delivery: ["delivered", "failed"] };

/** Shipments I sent, receive or carry (v2.1 §6.1) with status updates, tracking and ratings. */
export default function ShipmentPanel() {
  const [role, setRole] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [track, setTrack] = useState("");

  const load = () => {
    setLoading(true);
    return toolAPI
      .shipments(role || undefined)
      .then(({ data }) => setRows(data))
      .catch((e) => toast.error(apiError(e)))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  const lookup = async (e) => {
    e.preventDefault();
    if (!track.trim()) return;
    try {
      const { data } = await toolAPI.track(track.trim());
      setRows((r) => (r.some((s) => s.id === data.id) ? r : [data, ...r]));
      toast.success(`${data.tracking_number}: ${meta(data.status).label}`);
    } catch (err) {
      toast.error(apiError(err, "No shipment with that number"));
    }
  };

  return (
    <div className="space-y-3" data-testid="shipment-panel">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="flex items-center gap-1.5">
          {[
            ["", "All"],
            ["sent", "Sent"],
            ["received", "Receiving"],
            ["courier", "I carry"],
          ].map(([v, l]) => (
            <button key={v} onClick={() => setRole(v)} className={cn("shrink-0 rounded-full border px-2.5 h-7 text-xs transition-colors", role === v ? "border-brand-700 bg-brand-950 text-brand-200" : "border-edge-1 bg-surface-1 text-ink-3 hover:border-edge-2 hover:text-ink-1")}>
              {l}
            </button>
          ))}
        </div>
        <form onSubmit={lookup} className="sm:ml-auto flex gap-2">
          <Input value={track} onChange={(e) => setTrack(e.target.value)} placeholder="Track BRF-…" className="font-mono uppercase" wrapperClassName="w-44" aria-label="Tracking number" />
          <Button size="sm" variant="secondary" icon={Search} type="submit">
            Track
          </Button>
        </form>
      </div>

      {loading && rows.length === 0 ? (
        <PageSpinner />
      ) : rows.length === 0 ? (
        <EmptyState icon={Truck} title="No shipments yet" description="Book a courier from the Couriers tab — the receiver and the courier are notified, and every status change lands in your bell." />
      ) : (
        <div className="grid lg:grid-cols-2 gap-3">
          {rows.map((s) => (
            <ShipmentCard key={s.id} shipment={s} onChange={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function ShipmentCard({ shipment: s, onChange }) {
  const [busy, setBusy] = useState("");
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState("");
  const m = meta(s.status);
  const idx = ORDER.indexOf(s.status);
  const done = s.status === "delivered" || s.status === "failed";
  const canAdvance = s.my_role === "courier" && !done;
  const canConfirm = s.my_role === "receiver" && !done;
  const canRate = done && s.my_role !== "courier" && s.rating == null;

  const setStatus = async (status) => {
    setBusy(status);
    try {
      await toolAPI.shipmentStatus(s.id, status);
      toast.success(`Marked ${meta(status).label.toLowerCase()}`);
      await onChange?.();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy("");
    }
  };
  const rate = async () => {
    if (!rating) return toast.error("Pick a star rating");
    setBusy("rate");
    try {
      await toolAPI.rateShipment(s.id, { rating, review: review.trim() || null });
      toast.success("Thanks — the courier's rating moved");
      await onChange?.();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <Card className="flex flex-col gap-3" padding="p-4" data-testid="shipment-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold font-mono text-ink-1">{s.tracking_number}</p>
          <p className="text-2xs text-ink-4 truncate">
            <Link to={`/@${s.sender_handle}`} className="font-mono hover:text-brand-300">@{s.sender_handle}</Link> → <Link to={`/@${s.receiver_handle}`} className="font-mono hover:text-brand-300">@{s.receiver_handle}</Link> · via {s.courier_name}
          </p>
        </div>
        <Badge variant={m.variant} size="xs">
          {m.label}
        </Badge>
      </div>

      <ol className="flex items-center gap-1" aria-label="Progress">
        {SHIPMENT_STATUSES.filter((x) => x.value !== "failed").map((x, i) => (
          <li key={x.value} className={cn("h-1.5 flex-1 rounded-full", s.status === "failed" ? "bg-red-900/60" : i <= idx ? "bg-brand-500" : "bg-surface-3")} title={x.label} />
        ))}
      </ol>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-2xs">
        {(s.origin || s.destination) && (
          <>
            <dt className="text-ink-4">Route</dt>
            <dd className="text-ink-1 truncate">{[s.origin, s.destination].filter(Boolean).join(" → ")}</dd>
          </>
        )}
        {(s.weight_kg != null || s.cost != null) && (
          <>
            <dt className="text-ink-4">Load</dt>
            <dd className="font-mono text-ink-1">{[s.weight_kg != null ? `${num(s.weight_kg)} kg` : null, s.cost != null ? currency(s.cost) : null].filter(Boolean).join(" · ")}</dd>
          </>
        )}
        <dt className="text-ink-4">Booked</dt>
        <dd className="text-ink-1">{shortDateTime(s.created_at)}</dd>
        {s.delivered_at && (
          <>
            <dt className="text-ink-4">Delivered</dt>
            <dd className="text-ink-1">{shortDateTime(s.delivered_at)}</dd>
          </>
        )}
      </dl>
      {s.notes && <p className="text-2xs text-ink-3 italic">{s.notes}</p>}

      {s.status_history?.length > 1 && (
        <ul className="text-2xs text-ink-4 space-y-0.5">
          {s.status_history.slice(-4).map((h, i) => (
            <li key={i}>
              {meta(h.status).label} · {relativeTime(h.at)} by <span className="font-mono">@{h.by}</span>
              {h.note && <span className="text-ink-3"> — {h.note}</span>}
            </li>
          ))}
        </ul>
      )}

      {(canAdvance || canConfirm) && (
        <div className="flex flex-wrap gap-1.5">
          {canAdvance &&
            (NEXT[s.status] || []).map((next) => (
              <Button key={next} size="xs" variant={next === "failed" ? "dangerGhost" : next === "delivered" ? "primary" : "secondary"} icon={next === "failed" ? undefined : ChevronRight} loading={busy === next} onClick={() => setStatus(next)}>
                {meta(next).label}
              </Button>
            ))}
          {canConfirm && (
            <Button size="xs" loading={busy === "delivered"} onClick={() => setStatus("delivered")}>
              Confirm delivered
            </Button>
          )}
        </div>
      )}

      {s.rating != null ? (
        <p className="text-2xs text-amber-300 inline-flex items-center gap-1">
          <Star size={11} /> {s.rating}/5{s.review ? <span className="text-ink-3"> — {s.review}</span> : null}
        </p>
      ) : (
        canRate && (
          <div className="rounded-lg border border-edge-1 bg-surface-2 p-2.5 space-y-2" aria-label="Rate this delivery">
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} star${n === 1 ? "" : "s"}`} className={cn("p-0.5", n <= rating ? "text-amber-400" : "text-ink-4 hover:text-amber-300")}>
                  <Star size={16} fill={n <= rating ? "currentColor" : "none"} />
                </button>
              ))}
              <span className="text-2xs text-ink-4 ml-1">rate the courier</span>
            </div>
            <div className="flex gap-2">
              <Input value={review} onChange={(e) => setReview(e.target.value)} placeholder="A line for other vendors (optional)" wrapperClassName="flex-1" />
              <Button size="sm" loading={busy === "rate"} onClick={rate}>
                Rate
              </Button>
            </div>
          </div>
        )
      )}
    </Card>
  );
}

/** Book a courier for a parcel to another vendor (optionally tied to a movement). */
export function BookShipmentModal({ courier, open, onClose, onDone }) {
  const [connections, setConnections] = useState([]);
  const [movements, setMovements] = useState([]);
  const [form, setForm] = useState({ receiver_vendor_id: "", movement_id: "", origin: "", destination: "", weight_kg: "", cost: "", notes: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ receiver_vendor_id: "", movement_id: "", origin: "", destination: "", weight_kg: "", cost: courier?.base_rate ?? "", notes: "" });
    vendorAPI.connections().then(({ data }) => setConnections(data)).catch(() => setConnections([]));
    stockAPI.movements({ direction: "outgoing" }).then(({ data }) => setMovements(data.filter((m) => m.status === "confirmed" || m.status === "shipped"))).catch(() => setMovements([]));
  }, [open, courier]);

  if (!courier) return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const weight = Number(form.weight_kg || 0);
  const estimate = courier.price_per_kg != null && weight ? Number(courier.base_rate || 0) + weight * Number(courier.price_per_kg) : null;

  const submit = async (e) => {
    e.preventDefault();
    if (!form.receiver_vendor_id) return toast.error("Who receives it?");
    setBusy(true);
    try {
      const { data } = await toolAPI.bookShipment(courier.id, {
        receiver_vendor_id: form.receiver_vendor_id,
        movement_id: form.movement_id || null,
        origin: form.origin.trim() || null,
        destination: form.destination.trim() || null,
        weight_kg: form.weight_kg === "" ? null : Number(form.weight_kg),
        cost: form.cost === "" ? estimate : Number(form.cost),
        notes: form.notes.trim() || null,
      });
      toast.success(`Booked — tracking ${data.tracking_number}`);
      onDone?.(data);
      onClose?.();
    } catch (err) {
      toast.error(apiError(err, "Couldn't book the shipment"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Book ${courier.courier_name}`} description="The receiver and the courier are told; every status update lands in the bell.">
      <form onSubmit={submit} className="space-y-3">
        <Select label="Receiver" required value={form.receiver_vendor_id} onChange={set("receiver_vendor_id")} placeholder={connections.length ? "Choose a connected vendor…" : "Connect with a vendor first"} options={connections.map((v) => ({ value: v.id, label: `${v.business_name} · @${v.vendor_handle}` }))} />
        {movements.length > 0 && (
          <Select label="For a movement (optional)" value={form.movement_id} onChange={(e) => {
            const mv = movements.find((x) => x.id === e.target.value);
            setForm((f) => ({ ...f, movement_id: e.target.value, notes: f.notes || (mv ? `${num(mv.quantity)} × ${mv.stock_name}` : f.notes) }));
          }} placeholder="Not tied to a movement" options={movements.map((mv) => ({ value: mv.id, label: `${mv.stock_name} · ${num(mv.quantity)} → @${mv.to_handle} (${mv.status})` }))} />
        )}
        <div className="grid grid-cols-2 gap-3">
          <Input label="Pick up from" value={form.origin} onChange={set("origin")} placeholder="Ngara Market" />
          <Input label="Deliver to" value={form.destination} onChange={set("destination")} placeholder="Kirinyaga Road" />
          <Input label="Weight (kg)" type="number" min="0" step="any" value={form.weight_kg} onChange={set("weight_kg")} />
          <Input label="Agreed cost" type="number" min="0" step="any" prefix="KES" value={form.cost} onChange={set("cost")} hint={estimate != null ? `estimate ${currency(estimate)}` : undefined} />
        </div>
        <Input label="Notes for the rider" value={form.notes} onChange={set("notes")} placeholder="Keep upright, call on arrival" />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} icon={Truck}>
            Book courier
          </Button>
        </div>
      </form>
    </Modal>
  );
}
