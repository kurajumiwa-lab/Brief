import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import { fieldBase } from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { logisticsAPI, apiError } from "@/lib/api";

/**
 * GROUP ORDERS — pool an order with neighbours and share one delivery.
 * Coordination only: the sale and its payment are never handled here. Free for now.
 */

export const STATUS_LABEL = {
  open: { label: "Open to join", variant: "brand" },
  locked: { label: "Locked", variant: "gray" },
  scheduled: { label: "Delivery scheduled", variant: "blue" },
  in_transit: { label: "On the way", variant: "amber" },
  delivered: { label: "Delivered", variant: "brand" },
  cancelled: { label: "Cancelled", variant: "gray" },
};

const when = (iso) => (iso ? new Date(iso).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

function OrderRow({ order }) {
  const meta = STATUS_LABEL[order.status] || { label: order.status, variant: "gray" };
  return (
    <Link to={`/logistics/${order.id}`} className="block">
      <Card hover>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink-1 truncate">{order.title}</p>
            <p className="text-2xs text-ink-3 truncate">
              {order.item_summary || "No items listed"}{order.delivery_point ? ` · ${order.delivery_point}` : ""}
            </p>
            <p className="text-micro text-ink-4 mt-1">
              {order.participant_count} member{order.participant_count === 1 ? "" : "s"}
              {order.closes_at ? ` · closes ${when(order.closes_at)}` : ""}
            </p>
          </div>
          <Badge variant={meta.variant}>{meta.label}</Badge>
        </div>
      </Card>
    </Link>
  );
}

export default function LogisticsPage() {
  const navigate = useNavigate();
  const [mine, setMine] = useState(null);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", item_summary: "", delivery_point: "", closes_at: "", description: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, o] = await Promise.all([logisticsAPI.mine(), logisticsAPI.openOrders()]);
      setMine(m.data);
      setOpen(o.data);
      setError(null);
    } catch (err) {
      setError(apiError(err, "Could not load group orders"));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        title: form.title,
        item_summary: form.item_summary || null,
        delivery_point: form.delivery_point || null,
        description: form.description || null,
        closes_at: form.closes_at || null,
      };
      const { data } = await logisticsAPI.create(payload);
      toast.success("Group order started");
      navigate(`/logistics/${data.id}`);
    } catch (err) {
      toast.error(apiError(err, "Could not start the group order"));
    } finally {
      setBusy(false);
    }
  };

  if (error && !mine) {
    return (
      <Card>
        <p className="text-sm font-semibold text-ink-1">Group orders could not be loaded</p>
        <p className="text-2xs text-ink-3 mt-0.5">{error}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={load}>Try again</Button>
      </Card>
    );
  }
  if (!mine || !open) return <PageSpinner label="Loading group orders…" />;

  const joinedIds = new Set(mine.map((o) => o.id));
  const others = open.filter((o) => !joinedIds.has(o.id));

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-2xs uppercase tracking-wide text-ink-4">Logistics</p>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-1">Group orders</h1>
          <p className="text-sm text-ink-3 mt-0.5">Buy together, deliver together. Free for now.</p>
        </div>
        <Button size="sm" variant={creating ? "secondary" : "primary"} onClick={() => setCreating((v) => !v)}>
          {creating ? "Cancel" : "Start a group order"}
        </Button>
      </div>

      {creating && (
        <Card>
          <form onSubmit={submit} className="space-y-3" aria-label="New group order">
            <Input label="What are you ordering together?" required minLength={3} maxLength={160}
              value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Textarea label="Items and quantities" maxLength={2000} value={form.item_summary}
              onChange={(e) => setForm({ ...form, item_summary: e.target.value })} />
            <Input label="Delivery point" maxLength={300} value={form.delivery_point}
              onChange={(e) => setForm({ ...form, delivery_point: e.target.value })} />
            <div>
              <label htmlFor="closes-at" className="block text-2xs font-semibold text-ink-2 mb-1.5">Members can join until (optional)</label>
              <input id="closes-at" type="datetime-local" className={`${fieldBase} h-10 px-3`} value={form.closes_at}
                onChange={(e) => setForm({ ...form, closes_at: e.target.value })} />
            </div>
            <Button type="submit" disabled={busy}>Start group order</Button>
          </form>
        </Card>
      )}

      <section aria-labelledby="mine-h">
        <h2 id="mine-h" className="text-sm font-bold text-ink-1 mb-2">Your group orders</h2>
        {mine.length === 0 ? (
          <p className="text-2xs text-ink-3">You have not joined or started a group order yet.</p>
        ) : (
          <div className="space-y-2">{mine.map((o) => <OrderRow key={o.id} order={o} />)}</div>
        )}
      </section>

      <section aria-labelledby="open-h">
        <h2 id="open-h" className="text-sm font-bold text-ink-1 mb-2">Open to join</h2>
        {others.length === 0 ? (
          <p className="text-2xs text-ink-3">Nothing open right now.</p>
        ) : (
          <div className="space-y-2">{others.map((o) => <OrderRow key={o.id} order={o} />)}</div>
        )}
      </section>
    </div>
  );
}
