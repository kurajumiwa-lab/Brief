import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, MapPin, Package, Plus, Route, Send, Trash2, Truck, XCircle } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Drawer from "@/components/ui/Drawer";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Tabs from "@/components/ui/Tabs";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { toolAPI, apiError } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { shortDateTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const STATUS_BADGE = { planned: "blue", dispatched: "amber", completed: "brand", cancelled: "gray" };

const emptyStop = { label: "", lat: "", lng: "", priority: 0 };

/**
 * Courier route optimisation (v2.1 §5.5). A courier plans a run from the
 * parcels they are still carrying (or a custom stop list), the optimiser
 * orders it, and the plan is stored so senders can see their parcel's run.
 */
export default function RoutePlanner({ onRegisterCourier }) {
  const me = useAuthStore((s) => s.vendor);
  const confirm = useConfirm();
  const [courier, setCourier] = useState(undefined); // undefined = loading, null = none
  const [role, setRole] = useState("courier");
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    toolAPI
      .couriers()
      .then(({ data }) => setCourier(data.find((c) => c.vendor_handle === me?.vendor_handle) || null))
      .catch(() => setCourier(null));
  }, [me?.vendor_handle]);

  const load = async (nextRole = role) => {
    setLoading(true);
    try {
      const { data } = await toolAPI.routes({ role: nextRole });
      setPlans(data);
    } catch (e) {
      toast.error(apiError(e, "Couldn't load routes"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(role);
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (plan) => {
    setDetail(plan);
    try {
      const { data } = await toolAPI.route(plan.id);
      setDetail(data);
    } catch {
      /* keep the list row as a fallback */
    }
  };

  const planFromShipments = async () => {
    setBusy(true);
    try {
      const { data } = await toolAPI.planRouteFromShipments(courier.id, { return_to_start: true, average_speed_kmh: 25 });
      toast.success(`Optimised ${data.total_stops} stops${data.saved_km ? ` · saved ${data.saved_km} km` : ""}`);
      await load("courier");
      open(data);
    } catch (e) {
      toast.error(apiError(e, "Couldn't plan the run"));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (plan, status) => {
    if (status === "cancelled" && !(await confirm({ title: "Cancel this run?", message: "Senders on the run get told their parcel is back to unplanned.", confirmLabel: "Cancel run", danger: true }))) return;
    try {
      const { data } = await toolAPI.setRouteStatus(plan.id, status);
      toast.success(data.message || `Route ${status}`);
      setDetail(data.plan);
      load(role);
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const toggleStop = async (plan, stop) => {
    try {
      await toolAPI.solveStop(plan.id, stop.id, !stop.solved);
      setDetail((d) => ({ ...d, stops: d.stops.map((s) => (s.id === stop.id ? { ...s, solved: !s.solved } : s)) }));
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  if (courier === undefined) return <PageSpinner />;

  if (courier === null) {
    return (
      <EmptyState
        icon={Truck}
        title="Register as a courier to plan runs"
        description="Route optimisation orders your pickups by distance and tells senders when their parcel is on the way."
        action={onRegisterCourier && <Button size="sm" onClick={onRegisterCourier}>Register a courier service</Button>}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <Tabs
          size="sm"
          variant="pill"
          value={role}
          onChange={setRole}
          tabs={[
            { value: "courier", label: "My runs", icon: Route },
            { value: "booker", label: "Carrying my parcels", icon: Package },
          ]}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => setCustom(true)}>
            Custom run
          </Button>
          <Button size="sm" icon={Send} loading={busy} onClick={planFromShipments} disabled={role !== "courier"}>
            Plan from undelivered parcels
          </Button>
        </div>
      </div>

      {loading && plans.length === 0 ? (
        <PageSpinner />
      ) : plans.length === 0 ? (
        <EmptyState
          icon={Route}
          title={role === "courier" ? "No runs planned" : "No runs carrying your parcels"}
          description={
            role === "courier"
              ? "Plan a run from the shipments you are still carrying — the optimiser orders the stops and estimates the day."
              : "When a courier plans a run that includes your shipment, it shows up here with its ETA."
          }
        />
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {plans.map((p) => (
            <Card key={p.id} hover onClick={() => open(p)} className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-ink-1 truncate">{p.name}</h3>
                  <p className="text-2xs text-ink-4 font-mono">
                    {p.courier ? `@${p.courier.vendor_handle} · ` : ""}
                    {p.planned_for ? shortDateTime(p.planned_for) : shortDateTime(p.created_at)}
                  </p>
                </div>
                <Badge variant={STATUS_BADGE[p.status] || "gray"} size="xs">
                  {p.status}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-1.5 text-2xs text-ink-4 font-mono">
                <span className="rounded bg-surface-3 px-1.5 py-0.5">{p.total_stops} stops</span>
                <span className="rounded bg-surface-3 px-1.5 py-0.5">{p.total_distance_km} km</span>
                {p.saved_km > 0 && <span className="rounded bg-brand-950 text-brand-300 px-1.5 py-0.5">−{p.saved_km} km</span>}
                <span className="rounded bg-surface-3 px-1.5 py-0.5">{Math.round(p.estimated_minutes / 60 * 10) / 10} h</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <RouteDrawer plan={detail} onClose={() => setDetail(null)} onStatus={setStatus} onToggleStop={toggleStop} />

      <CustomRunModal open={custom} courier={courier} onClose={() => setCustom(false)} onDone={(plan) => { setCustom(false); load("courier"); open(plan); }} />
    </div>
  );
}

function RouteDrawer({ plan, onClose, onStatus, onToggleStop }) {
  if (!plan) return null;
  const solved = plan.stops.filter((s) => s.solved).length;
  return (
    <Drawer open={!!plan} onClose={onClose} title={plan.name} description={`${plan.algorithm} · ${plan.average_speed_kmh} km/h average`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Stops" value={`${solved}/${plan.total_stops} done`} />
          <Stat label="Distance" value={`${plan.total_distance_km} km`} hint={plan.baseline_distance_km ? `unoptimised ${plan.baseline_distance_km} km` : undefined} />
          <Stat label="Saved" value={plan.saved_km > 0 ? `${plan.saved_km} km · ${plan.saved_pct}%` : "—"} tone={plan.saved_km > 0 ? "brand" : "default"} />
          <Stat label="Estimate" value={`${Math.round(plan.estimated_minutes / 60 * 10) / 10} h`} hint={`${plan.estimated_minutes} min total`} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_BADGE[plan.status] || "gray"} size="xs">{plan.status}</Badge>
          {plan.start_label && <Badge variant="outline" size="xs"><MapPin size={9} /> from {plan.start_label}</Badge>}
          {plan.return_to_start && <Badge variant="outline" size="xs">returns to start</Badge>}
        </div>

        <ol className="space-y-1.5">
          {plan.stops.map((s) => (
            <li key={s.id} className={cn("flex items-start gap-3 rounded-lg border border-edge-1 bg-surface-1 px-3 py-2", s.solved && "opacity-60")}>
              <button
                onClick={() => onToggleStop(plan, s)}
                className="mt-0.5 text-ink-4 hover:text-brand-400 transition-colors"
                title={s.solved ? "Mark as not done" : "Mark as done"}
              >
                {s.solved ? <CheckCircle2 size={15} className="text-brand-400" /> : <Circle size={15} />}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-ink-1 truncate">
                  <span className="font-mono text-ink-4">{s.sequence}.</span> {s.label}
                </p>
                <p className="text-2xs text-ink-4 truncate">
                  {[s.address, s.weight_kg ? `${s.weight_kg} kg` : null, s.priority > 0 ? `priority ${s.priority}` : null].filter(Boolean).join(" · ") || "no address on file"}
                </p>
              </div>
              <div className="text-right shrink-0 text-2xs font-mono text-ink-4">
                <p>{s.distance_from_prev_km} km</p>
                <p>{s.eta_minutes} min{Number.isFinite(s.cumulative_km) ? ` · ${s.cumulative_km} km` : ""}</p>
              </div>
            </li>
          ))}
        </ol>

        {plan.mine && (
          <div className="flex flex-wrap justify-end gap-2">
            {plan.status === "planned" && (
              <>
                <Button size="sm" variant="secondary" icon={XCircle} onClick={() => onStatus(plan, "cancelled")}>
                  Cancel
                </Button>
                <Button size="sm" icon={Send} onClick={() => onStatus(plan, "dispatched")}>
                  Dispatch — tell senders
                </Button>
              </>
            )}
            {plan.status === "dispatched" && (
              <Button size="sm" icon={CheckCircle2} onClick={() => onStatus(plan, "completed")}>
                Complete run
              </Button>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

function Stat({ label, value, hint, tone = "default" }) {
  const tones = { default: "text-ink-1", brand: "text-brand-400" };
  return (
    <div className="rounded-lg border border-edge-1 bg-surface-1 px-3 py-2">
      <p className="text-2xs uppercase tracking-wider text-ink-4">{label}</p>
      <p className={cn("text-sm font-mono mt-0.5", tones[tone])}>{value}</p>
      {hint && <p className="text-2xs text-ink-4 mt-0.5">{hint}</p>}
    </div>
  );
}

function CustomRunModal({ open, courier, onClose, onDone }) {
  const [name, setName] = useState("");
  const [speed, setSpeed] = useState(25);
  const [service, setService] = useState(10);
  const [returnToStart, setReturnToStart] = useState(true);
  const [stops, setStops] = useState([{ ...emptyStop }, { ...emptyStop }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setSpeed(25);
      setService(10);
      setReturnToStart(true);
      setStops([{ ...emptyStop }, { ...emptyStop }]);
    }
  }, [open]);

  const valid = useMemo(() => stops.filter((s) => s.lat !== "" && s.lng !== ""), [stops]);

  const submit = async (e) => {
    e.preventDefault();
    if (valid.length === 0) return toast.error("Give at least one stop coordinates");
    setBusy(true);
    try {
      const { data } = await toolAPI.planRoute(courier.id, {
        name: name || undefined,
        average_speed_kmh: Number(speed),
        service_minutes: Number(service),
        return_to_start: returnToStart,
        stops: valid.map((s) => ({
          label: s.label || undefined,
          lat: Number(s.lat),
          lng: Number(s.lng),
          priority: Number(s.priority) || 0,
        })),
      });
      toast.success(`Planned ${data.total_stops} stops${data.saved_km ? ` · saved ${data.saved_km} km (${data.saved_pct}%)` : ""}`);
      onDone(data);
    } catch (err) {
      toast.error(apiError(err, "Couldn't plan the run"));
    } finally {
      setBusy(false);
    }
  };

  const setStop = (i, patch) => setStops((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <Modal open={open} onClose={onClose} title="Plan a run" description="Add the stops with coordinates — the optimiser orders them and estimates the day." size="md">
      <form onSubmit={submit} className="space-y-3">
        <Input label="Run name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tuesday Eastlands loop" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Average speed (km/h)" type="number" min="2" max="120" value={speed} onChange={(e) => setSpeed(e.target.value)} />
          <Input label="Service time / stop (min)" type="number" min="0" max="240" value={service} onChange={(e) => setService(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <input id="return_to_start" type="checkbox" checked={returnToStart} onChange={(e) => setReturnToStart(e.target.checked)} className="accent-brand-600" />
          <label htmlFor="return_to_start" className="text-xs text-ink-3">Return to the start point at the end</label>
        </div>

        <div className="space-y-2">
          {stops.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_5rem_5rem_4.5rem_2rem] gap-1.5 items-center">
              <Input value={s.label} onChange={(e) => setStop(i, { label: e.target.value })} placeholder={`Stop ${i + 1}`} aria-label={`Stop ${i + 1} label`} />
              <Input value={s.lat} onChange={(e) => setStop(i, { lat: e.target.value })} placeholder="lat" aria-label={`Stop ${i + 1} latitude`} />
              <Input value={s.lng} onChange={(e) => setStop(i, { lng: e.target.value })} placeholder="lng" aria-label={`Stop ${i + 1} longitude`} />
              <Input type="number" min="0" max="10" value={s.priority} onChange={(e) => setStop(i, { priority: e.target.value })} aria-label={`Stop ${i + 1} priority`} />
              <Button size="icon" variant="ghost" icon={Trash2} onClick={() => setStops((rows) => rows.filter((_, idx) => idx !== i))} aria-label={`Remove stop ${i + 1}`} />
            </div>
          ))}
          <Button size="xs" variant="ghost" icon={Plus} onClick={() => setStops((rows) => [...rows, { ...emptyStop }])}>
            Add stop
          </Button>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} icon={Route}>Optimise run</Button>
        </div>
      </form>
    </Modal>
  );
}
