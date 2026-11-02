import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import { fieldBase } from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { logisticsAPI, apiError } from "@/lib/api";
import { STATUS_LABEL } from "@/pages/logistics/LogisticsPage";

/** One group order: join or leave, the organiser's route and delivery, and the activity record. */

// Same rules the server enforces. The buttons only offer moves the server will accept.
const NEXT = {
  open: ["locked", "cancelled"],
  locked: ["open", "scheduled", "cancelled"],
  scheduled: ["in_transit", "cancelled"],
  in_transit: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

const when = (iso) => (iso ? new Date(iso).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

/** Lines like "Stage 3 market, -0.10, 34.76" → stops. Bad lines are reported, not guessed. */
export function parseStops(text) {
  const stops = [];
  const bad = [];
  text.split("\n").map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
    const parts = line.split(",").map((p) => p.trim());
    const lat = Number(parts[parts.length - 2]);
    const lng = Number(parts[parts.length - 1]);
    const label = parts.slice(0, -2).join(", ");
    if (!label || Number.isNaN(lat) || Number.isNaN(lng)) bad.push(i + 1);
    else stops.push({ label, lat, lng, priority: 0 });
  });
  return { stops, bad };
}

export default function LogisticsOrderPage() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [providers, setProviders] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [stopsText, setStopsText] = useState("");
  const [start, setStart] = useState({ lat: "", lng: "" });
  const [sched, setSched] = useState({ provider_id: "", window_start: "", window_end: "" });

  const load = useCallback(async () => {
    try {
      const { data } = await logisticsAPI.get(id);
      setOrder(data);
      setError(null);
    } catch (err) {
      setError(apiError(err, "Could not load this group order"));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    logisticsAPI.providers().then(({ data }) => setProviders(data)).catch(() => {});
  }, []);

  const run = async (fn, ok) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      await load();
    } catch (err) {
      toast.error(apiError(err, "That did not work"));
    } finally {
      setBusy(false);
    }
  };

  if (error && !order) {
    return (
      <Card>
        <p className="text-sm font-semibold text-ink-1">This group order could not be opened</p>
        <p className="text-2xs text-ink-3 mt-0.5">{error}</p>
        <Link to="/logistics" className="text-2xs underline mt-2 inline-block">Back to group orders</Link>
      </Card>
    );
  }
  if (!order) return <PageSpinner label="Opening group order…" />;

  const isOrganiser = order.my_role === "organiser";
  const isParticipant = order.my_role === "participant";
  const meta = STATUS_LABEL[order.status] || { label: order.status, variant: "gray" };
  const moves = NEXT[order.status] || [];

  const saveRoute = () => {
    const { stops, bad } = parseStops(stopsText);
    if (!stops.length) return toast.error("Add at least one stop, one per line: name, latitude, longitude");
    if (bad.length) return toast.error(`Check line ${bad.join(", ")}: use name, latitude, longitude`);
    const body = { stops };
    if (start.lat !== "" && start.lng !== "") {
      body.start_lat = Number(start.lat);
      body.start_lng = Number(start.lng);
    }
    return run(() => logisticsAPI.route(id, body), "Route planned");
  };

  const saveSchedule = () => {
    if (!sched.window_start || !sched.window_end) return toast.error("Choose the start and end of the delivery window");
    const body = {
      provider_id: sched.provider_id || null,
      window_start: sched.window_start,
      window_end: sched.window_end,
    };
    return run(() => logisticsAPI.schedule(id, body), "Delivery scheduled");
  };

  return (
    <div className="max-w-3xl space-y-4">
      <Link to="/logistics" className="text-2xs underline text-ink-3">← Group orders</Link>

      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-extrabold tracking-tight text-ink-1">{order.title}</h1>
            {order.description && <p className="text-sm text-ink-2 mt-1">{order.description}</p>}
            {order.item_summary && <p className="text-2xs text-ink-3 mt-2 whitespace-pre-line">{order.item_summary}</p>}
            <p className="text-micro text-ink-4 mt-2">
              {order.delivery_point ? `Deliver to ${order.delivery_point}` : "No delivery point yet"}
              {order.closes_at ? ` · members join until ${when(order.closes_at)}` : ""}
            </p>
          </div>
          <Badge variant={meta.variant}>{meta.label}</Badge>
        </div>
        <p className="text-2xs text-ink-4 mt-3">Coordination only. Any sale or payment happens outside this page.</p>
      </Card>

      {order.status === "open" && !isOrganiser && !isParticipant && (
        <Card>
          <p className="text-sm font-bold text-ink-1">Join this group order</p>
          <div className="mt-2 space-y-2">
            <Input label="What are you adding? (optional)" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            <Button disabled={busy} onClick={() => run(() => logisticsAPI.join(id, note), "You have joined")}>Join</Button>
          </div>
        </Card>
      )}

      {order.status === "open" && isParticipant && (
        <Card>
          <p className="text-sm text-ink-2">You have joined this group order.</p>
          <Button variant="secondary" size="sm" className="mt-2" disabled={busy}
            onClick={() => run(() => logisticsAPI.leave(id), "You have left")}>Leave</Button>
        </Card>
      )}

      {order.participants && (
        <Card>
          <p className="text-sm font-bold text-ink-1 mb-2">Members ({order.participants.length})</p>
          <ul className="divide-y divide-edge-1">
            {order.participants.map((p) => (
              <li key={p.handle} className="py-2 text-2xs text-ink-2">
                <span className="font-semibold">{p.business_name}</span> <span className="text-ink-4">@{p.handle}</span>
                {p.quantity_note ? <span className="block text-ink-3">{p.quantity_note}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {isOrganiser && (
        <Card>
          <p className="text-sm font-bold text-ink-1">Organiser</p>
          {moves.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {moves.map((s) => (
                <Button key={s} size="sm" variant={s === "cancelled" ? "secondary" : "primary"} disabled={busy}
                  onClick={() => run(() => logisticsAPI.status(id, s), `Status: ${(STATUS_LABEL[s] || {}).label || s}`)}>
                  {s === "cancelled" ? "Cancel order" : `Mark ${(STATUS_LABEL[s] || {}).label || s}`}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-2xs text-ink-3 mt-1">This order is closed.</p>
          )}

          {!["delivered", "cancelled"].includes(order.status) && (
            <div className="mt-4 space-y-2 border-t border-edge-1 pt-4">
              <p className="text-2xs font-semibold text-ink-2">Drop-off route</p>
              <Textarea label="Stops, one per line: name, latitude, longitude" value={stopsText}
                onChange={(e) => setStopsText(e.target.value)} placeholder={"Mama Ann, -0.0917, 34.7680\nKibuye, -0.1000, 34.7500"} />
              <div className="grid grid-cols-2 gap-2">
                <Input label="Start latitude (optional)" value={start.lat} onChange={(e) => setStart({ ...start, lat: e.target.value })} />
                <Input label="Start longitude (optional)" value={start.lng} onChange={(e) => setStart({ ...start, lng: e.target.value })} />
              </div>
              <Button size="sm" variant="secondary" disabled={busy} onClick={saveRoute}>Plan the shortest route</Button>
              {order.route?.stops?.length ? (
                <p className="text-micro text-ink-4">
                  Saved route: {order.route.stops.length} stops, about {order.route.total_distance_km} km
                  {order.route.saved_km ? ` (saves ${order.route.saved_km} km)` : ""}.
                </p>
              ) : null}
            </div>
          )}

          {order.status === "locked" && (
            <div className="mt-4 space-y-2 border-t border-edge-1 pt-4">
              <p className="text-2xs font-semibold text-ink-2">Delivery</p>
              <div>
                <label htmlFor="provider" className="block text-2xs font-semibold text-ink-2 mb-1.5">Delivery provider</label>
                <select id="provider" className={`${fieldBase} h-10 px-3`} value={sched.provider_id}
                  onChange={(e) => setSched({ ...sched, provider_id: e.target.value })}>
                  <option value="">No provider yet</option>
                  {providers.map((p) => <option key={p.id} value={p.id}>{p.name}{p.service_area ? ` · ${p.service_area}` : ""}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="win-start" className="block text-2xs font-semibold text-ink-2 mb-1.5">Window opens</label>
                  <input id="win-start" type="datetime-local" className={`${fieldBase} h-10 px-3`} value={sched.window_start}
                    onChange={(e) => setSched({ ...sched, window_start: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="win-end" className="block text-2xs font-semibold text-ink-2 mb-1.5">Window closes</label>
                  <input id="win-end" type="datetime-local" className={`${fieldBase} h-10 px-3`} value={sched.window_end}
                    onChange={(e) => setSched({ ...sched, window_end: e.target.value })} />
                </div>
              </div>
              <Button size="sm" variant="secondary" disabled={busy} onClick={saveSchedule}>Save delivery window</Button>
              {order.window_start && (
                <p className="text-micro text-ink-4">Window: {when(order.window_start)} to {when(order.window_end)}</p>
              )}
            </div>
          )}
        </Card>
      )}

      {order.events && (
        <Card>
          <p className="text-sm font-bold text-ink-1 mb-2">Activity</p>
          {order.events.length === 0 ? <p className="text-2xs text-ink-3">Nothing yet.</p> : (
            <ul className="divide-y divide-edge-1">
              {order.events.map((e, i) => (
                <li key={`${e.at}-${i}`} className="py-2">
                  <p className="text-2xs font-semibold text-ink-2">{e.action.replace(/_/g, " ")}</p>
                  <p className="text-micro text-ink-4">{when(e.at)} · @{e.actor}{e.detail ? ` · ${e.detail}` : ""}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
