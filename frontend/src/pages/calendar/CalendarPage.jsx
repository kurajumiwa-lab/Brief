import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import Tabs from "@/components/ui/Tabs";
import { fieldBase } from "@/components/ui/Input";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { useAuthStore } from "@/stores/authStore";
import { scheduleAPI, apiError } from "@/lib/api";
import { dayKey, dayLabel, mondayOf, shiftDays, timeRange, toDayString, toLocalStamp, WEEKDAYS } from "./calendarTime";

/**
 * CALENDAR — your week, appointments and booking page, in one place.
 *
 * Times are the wall-clock times in Nairobi. Plans and appointments are never
 * double-booked with each other; overlaps are shown as a warning, not blocked.
 */

const KIND_LABEL = { plan: "Plan", task: "Task", meeting: "Meeting", reminder: "Reminder" };
const SOURCE_BADGE = {
  plan: { label: "My plan", variant: "brand" },
  appointment: { label: "Appointment", variant: "blue" },
  booking: { label: "Rental", variant: "amber" },
  event: { label: "Event", variant: "purple" },
};
const APPT_NEXT = {
  host: { requested: ["confirmed", "declined"], confirmed: ["completed", "no_show", "cancelled"] },
  client: { requested: ["cancelled"], confirmed: ["cancelled"] },
};
const APPT_LABEL = {
  requested: "Waiting for confirmation", confirmed: "Confirmed", declined: "Declined",
  cancelled: "Cancelled", completed: "Completed", no_show: "No-show",
};
const ACTION_LABEL = {
  confirmed: "Confirm", declined: "Decline", completed: "Mark done", no_show: "No-show", cancelled: "Cancel",
};

export default function CalendarPage() {
  const [tab, setTab] = useState("week");
  const vendorId = useAuthStore((s) => s.vendor?.id);
  const tabs = [
    { value: "week", label: "My week" },
    { value: "appointments", label: "Appointments" },
    { value: "booking", label: "Booking page" },
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <header>
        <h1 className="text-xl font-semibold text-ink-1">Calendar</h1>
        <p className="text-sm text-ink-3">Plan your week, take bookings and keep appointments in one place. Free for now.</p>
      </header>
      <Tabs tabs={tabs} value={tab} onChange={setTab} variant="pill" />
      {tab === "week" && <WeekTab />}
      {tab === "appointments" && <AppointmentsTab />}
      {tab === "booking" && <BookingTab vendorId={vendorId} />}
    </div>
  );
}

function WeekTab() {
  const [start, setStart] = useState(() => toDayString(mondayOf(new Date())));
  const [week, setWeek] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await scheduleAPI.week(start);
      setWeek(data);
      setError(null);
    } catch (err) {
      setError(apiError(err, "Could not load your week"));
    } finally {
      setLoading(false);
    }
  }, [start]);

  useEffect(() => { load(); }, [load]);

  const days = useMemo(() => {
    const first = new Date(`${start}T00:00:00`);
    return Array.from({ length: 7 }, (_, i) => {
      const d = shiftDays(first, i);
      const key = toDayString(d);
      return { key, date: d, items: (week?.items || []).filter((it) => dayKey(it.starts_at) === key) };
    });
  }, [start, week]);

  const conflictIds = useMemo(() => new Set((week?.conflicts || []).flat()), [week]);

  const markEntry = async (item, status) => {
    try {
      await scheduleAPI.updateEntry(item.id, { status });
      load();
    } catch (err) {
      toast.error(apiError(err, "Could not update that plan"));
    }
  };

  const removeEntry = async (item) => {
    if (!window.confirm(`Remove "${item.title}"?`)) return;
    try {
      await scheduleAPI.deleteEntry(item.id);
      load();
    } catch (err) {
      toast.error(apiError(err, "Could not remove that plan"));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={() => setStart(toDayString(shiftDays(new Date(`${start}T00:00:00`), -7)))}>
          ← Previous
        </Button>
        <p className="text-sm font-medium text-ink-1">{dayLabel(start)} – {dayLabel(toDayString(shiftDays(new Date(`${start}T00:00:00`), 6)))}</p>
        <Button variant="outline" size="sm" onClick={() => setStart(toDayString(shiftDays(new Date(`${start}T00:00:00`), 7)))}>
          Next →
        </Button>
      </div>

      {week?.conflicts?.length > 0 && (
        <div role="alert" className="rounded-xl border border-accent-300 bg-accent-50 p-3 text-sm text-accent-800">
          {week.conflicts.length} overlap{week.conflicts.length === 1 ? "" : "s"} this week. Look at the items marked "Overlaps".
        </div>
      )}

      <div className="flex justify-end">
        <Button size="sm" onClick={() => setAdding((v) => !v)}>{adding ? "Close" : "+ Add to my week"}</Button>
      </div>
      {adding && <AddEntryForm defaultDay={toDayString(new Date())} onSaved={() => { setAdding(false); load(); }} />}

      {loading && !week && <PageSpinner />}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {week && days.map((day) => (
        <section key={day.key} aria-label={dayLabel(day.key)}>
          <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">
            {WEEKDAYS[(day.date.getDay() + 6) % 7]} · {dayLabel(day.key)}
          </h2>
          {day.items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-edge-2 px-3 py-2 text-sm text-ink-4">Nothing planned.</p>
          ) : (
            <ul className="space-y-2">
              {day.items.map((item) => {
                const badge = SOURCE_BADGE[item.source] || { label: item.source, variant: "gray" };
                const overlaps = conflictIds.has(item.id);
                return (
                  <li key={`${item.source}-${item.id}-${item.starts_at}`}>
                    <Card padding="p-3" className={overlaps ? "ring-1 ring-accent-400" : undefined}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold tabular-nums text-ink-2">{timeRange(item.starts_at, item.ends_at)}</span>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        {item.kind && item.source === "plan" && <span className="text-2xs text-ink-3">{KIND_LABEL[item.kind] || item.kind}</span>}
                        {overlaps && <Badge variant="amber">Overlaps</Badge>}
                        {item.status === "done" && <Badge variant="brand">Done</Badge>}
                      </div>
                      <p className={`mt-1 text-sm font-medium ${item.status === "done" || item.status === "cancelled" ? "text-ink-3 line-through" : "text-ink-1"}`}>
                        {item.title}
                      </p>
                      {item.location && <p className="text-xs text-ink-3">{item.location}</p>}
                      {item.editable && (
                        <div className="mt-2 flex gap-2">
                          {item.status !== "done" && <Button size="sm" variant="outline" onClick={() => markEntry(item, "done")}>Mark done</Button>}
                          <Button size="sm" variant="ghost" onClick={() => removeEntry(item)}>Remove</Button>
                        </div>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function AddEntryForm({ defaultDay, onSaved }) {
  const [form, setForm] = useState({ title: "", kind: "plan", day: defaultDay, from: "09:00", to: "10:00", location: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return toast.error("Give it a name");
    if (form.to <= form.from) return toast.error("The end time must be after the start time");
    setSaving(true);
    try {
      await scheduleAPI.addEntry({
        title: form.title.trim(), kind: form.kind,
        starts_at: toLocalStamp(form.day, form.from), ends_at: toLocalStamp(form.day, form.to),
        location: form.location || null, notes: form.notes || null,
      });
      toast.success("Added to your week");
      onSaved();
    } catch (err) {
      toast.error(apiError(err, "Could not add that"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card as="form" onSubmit={submit} className="space-y-3">
      <Input label="What is it?" value={form.title} onChange={set("title")} maxLength={200} placeholder="Restock the shelves, supplier visit…" />
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-2xs font-semibold text-ink-2">Kind
          <select className={`${fieldBase} mt-1.5 h-10 px-3`} value={form.kind} onChange={set("kind")}>
            {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <Input label="Day" type="date" value={form.day} onChange={set("day")} />
        <Input label="From" type="time" value={form.from} onChange={set("from")} />
        <Input label="To" type="time" value={form.to} onChange={set("to")} />
      </div>
      <Input label="Where (optional)" value={form.location} onChange={set("location")} maxLength={300} />
      <Button type="submit" loading={saving} className="w-full">Save</Button>
    </Card>
  );
}

function AppointmentsTab() {
  const [rows, setRows] = useState({ host: [], client: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [host, client] = await Promise.all([scheduleAPI.appointments("host"), scheduleAPI.appointments("client")]);
      setRows({ host: host.data.appointments, client: client.data.appointments });
      setError(null);
    } catch (err) {
      setError(apiError(err, "Could not load appointments"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (appt, role, status) => {
    try {
      await scheduleAPI.setAppointmentStatus(appt.id, status);
      toast.success(`${ACTION_LABEL[status] || "Updated"}`);
      load();
    } catch (err) {
      toast.error(apiError(err, "That change is not allowed"));
    }
  };

  if (loading && !rows.host.length && !rows.client.length) return <PageSpinner />;
  if (error) return <p role="alert" className="text-sm text-red-600">{error}</p>;

  const section = (title, list, role, empty) => (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-ink-1">{title}</h2>
      {list.length === 0 && <p className="text-sm text-ink-4">{empty}</p>}
      {list.map((a) => (
        <Card key={a.id} padding="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold tabular-nums text-ink-2">{timeRange(a.starts_at, a.ends_at)} · {dayLabel(dayKey(a.starts_at))}</span>
            <Badge variant={a.status === "confirmed" ? "brand" : a.status === "requested" ? "amber" : "gray"}>{APPT_LABEL[a.status] || a.status}</Badge>
          </div>
          <p className="mt-1 text-sm font-medium text-ink-1">{a.service}{role === "host" ? ` · ${a.client_name}` : ""}</p>
          {role === "host" && a.client_phone && <p className="text-xs text-ink-3">{a.client_phone}</p>}
          {a.notes && <p className="text-xs text-ink-3">{a.notes}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {(APPT_NEXT[role][a.status] || []).map((next) => (
              <Button key={next} size="sm" variant={next === "confirmed" ? "primary" : "outline"} onClick={() => act(a, role, next)}>
                {ACTION_LABEL[next]}
              </Button>
            ))}
          </div>
        </Card>
      ))}
    </section>
  );

  return (
    <div className="space-y-6">
      {section("Bookings from clients", rows.host, "host", "No bookings yet. Share your booking page to get them.")}
      {section("Things I have booked", rows.client, "client", "You have not booked anyone's time yet.")}
    </div>
  );
}

function BookingTab({ vendorId }) {
  const [services, setServices] = useState([]);
  const [windows, setWindows] = useState(() => emptyHours());
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", duration_minutes: 30, buffer_minutes: 10, price_kes: "", description: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [svc, av] = await Promise.all([scheduleAPI.services(), scheduleAPI.availability()]);
      setServices(svc.data.services);
      setWindows(hoursFromRules(av.data.windows));
    } catch (err) {
      toast.error(apiError(err, "Could not load your booking page"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addService = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Give the service a name");
    setSaving(true);
    try {
      await scheduleAPI.addService({
        name: form.name.trim(),
        duration_minutes: Number(form.duration_minutes),
        buffer_minutes: Number(form.buffer_minutes),
        price_kes: form.price_kes === "" ? null : Number(form.price_kes),
        description: form.description || null,
      });
      setForm({ name: "", duration_minutes: 30, buffer_minutes: 10, price_kes: "", description: "" });
      toast.success("Service added");
      load();
    } catch (err) {
      toast.error(apiError(err, "Could not add that service"));
    } finally {
      setSaving(false);
    }
  };

  const toggleService = async (svc) => {
    try {
      await scheduleAPI.updateService(svc.id, { is_active: !svc.is_active });
      load();
    } catch (err) {
      toast.error(apiError(err, "Could not change that service"));
    }
  };

  const saveHours = async () => {
    const rules = [];
    for (const [day, w] of windows.entries()) {
      if (!w.on) continue;
      const start = toMinutes(w.from);
      const end = toMinutes(w.to);
      if (end <= start) return toast.error(`${WEEKDAYS[day]}: the closing time must be after opening`);
      rules.push({ weekday: day, start_minute: start, end_minute: end });
    }
    try {
      await scheduleAPI.setAvailability(rules);
      toast.success("Opening hours saved");
      load();
    } catch (err) {
      toast.error(apiError(err, "Could not save your hours"));
    }
  };

  if (loading) return <PageSpinner />;

  const link = vendorId ? `${window.location.origin}/book/${vendorId}` : "";

  return (
    <div className="space-y-6">
      <Card className="space-y-2">
        <h2 className="text-sm font-semibold text-ink-1">Your booking link</h2>
        <p className="text-xs text-ink-3">Send this to clients. They choose a service and a free time; you confirm it.</p>
        {link && (
          <div className="flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-2 py-1.5 text-xs">{link}</code>
            <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(link).then(() => toast.success("Link copied"))}>Copy</Button>
          </div>
        )}
        <Link to={vendorId ? `/book/${vendorId}` : "/calendar"} className="text-xs font-medium text-brand-700 underline">Open my booking page</Link>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-1">Services</h2>
        {services.length === 0 && <p className="text-sm text-ink-4">No services yet. Add one below.</p>}
        {services.map((s) => (
          <Card key={s.id} padding="p-3" className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink-1">{s.name}</p>
              <p className="text-xs text-ink-3">
                {s.duration_minutes} min{s.buffer_minutes ? ` + ${s.buffer_minutes} min break` : ""}
                {s.price_kes != null ? ` · KSh ${s.price_kes.toLocaleString("en-KE")}` : ""}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => toggleService(s)}>{s.is_active ? "Pause" : "Turn on"}</Button>
          </Card>
        ))}
        <Card as="form" onSubmit={addService} className="space-y-3">
          <Input label="Service name" value={form.name} maxLength={200} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="grid grid-cols-3 gap-2">
            <Input label="Minutes" type="number" min={5} max={480} value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })} />
            <Input label="Break after" type="number" min={0} max={120} value={form.buffer_minutes} onChange={(e) => setForm({ ...form, buffer_minutes: e.target.value })} />
            <Input label="Price KSh" type="number" min={0} value={form.price_kes} onChange={(e) => setForm({ ...form, price_kes: e.target.value })} />
          </div>
          <Button type="submit" loading={saving} className="w-full">Add service</Button>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-1">Opening hours</h2>
        <Card className="space-y-2">
          {windows.map((w, day) => (
            <div key={day} className="grid grid-cols-[4.5rem_1fr_auto_auto] items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-ink-1">
                <input type="checkbox" checked={w.on} onChange={(e) => setWindows(setDay(windows, day, { on: e.target.checked }))} />
                {WEEKDAYS[day]}
              </label>
              <input aria-label={`${WEEKDAYS[day]} opens`} type="time" className={`${fieldBase} h-9 px-2`} disabled={!w.on} value={w.from} onChange={(e) => setWindows(setDay(windows, day, { from: e.target.value }))} />
              <span className="text-xs text-ink-3">to</span>
              <input aria-label={`${WEEKDAYS[day]} closes`} type="time" className={`${fieldBase} h-9 px-2`} disabled={!w.on} value={w.to} onChange={(e) => setWindows(setDay(windows, day, { to: e.target.value }))} />
            </div>
          ))}
          <Button className="w-full" onClick={saveHours}>Save opening hours</Button>
        </Card>
      </section>
    </div>
  );
}

// Opening hours are kept in the UI as one row per weekday (0 = Monday).
function emptyHours() {
  return Array.from({ length: 7 }, () => ({ on: false, from: "09:00", to: "17:00" }));
}

function hoursFromRules(rules) {
  const hours = emptyHours();
  for (const r of rules) {
    hours[r.weekday] = { on: true, from: minutesToTime(r.start_minute), to: minutesToTime(r.end_minute) };
  }
  return hours;
}

function setDay(list, day, patch) {
  return list.map((w, i) => (i === day ? { ...w, ...patch } : w));
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(total) {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

