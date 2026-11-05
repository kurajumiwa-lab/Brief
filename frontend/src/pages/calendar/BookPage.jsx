import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { useAuthStore } from "@/stores/authStore";
import { scheduleAPI, apiError } from "@/lib/api";
import { dayLabel, timeOf, toDayString } from "./calendarTime";

/**
 * BOOK — pick a service and a free time with a business. You are asked to
 * confirm the booking with your name and phone; the business then confirms it.
 * No payment is taken here.
 */
export default function BookPage() {
  const { vendorId } = useParams();
  const me = useAuthStore((s) => s.vendor);
  const [services, setServices] = useState(null);
  const [service, setService] = useState(null);
  const [day, setDay] = useState(() => toDayString(new Date()));
  const [slots, setSlots] = useState(null);
  const [picked, setPicked] = useState(null);
  const [form, setForm] = useState({ client_name: "", client_phone: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setServices(null);
    scheduleAPI.vendorServices(vendorId)
      .then(({ data }) => setServices(data.services))
      .catch((err) => setError(apiError(err, "Could not load this booking page")));
  }, [vendorId]);

  useEffect(() => {
    if (!service) return;
    setSlots(null);
    setPicked(null);
    scheduleAPI.slots(vendorId, service.id, day)
      .then(({ data }) => setSlots(data.slots))
      .catch((err) => { setSlots([]); toast.error(apiError(err, "Could not load times")); });
  }, [vendorId, service, day]);

  const book = async (e) => {
    e.preventDefault();
    if (!form.client_name.trim()) return toast.error("Please add your name");
    setBusy(true);
    try {
      const { data } = await scheduleAPI.book({
        host_vendor_id: vendorId, service_id: service.id, starts_at: picked,
        client_name: form.client_name.trim(), client_phone: form.client_phone || null, notes: form.notes || null,
      });
      setDone(data);
    } catch (err) {
      toast.error(apiError(err, "That time has just gone. Pick another."));
      setPicked(null);
      setService((s) => (s ? { ...s } : s));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p role="alert" className="p-6 text-sm text-red-600">{error}</p>;
  if (services === null) return <PageSpinner />;

  if (done) {
    return (
      <div className="mx-auto max-w-md space-y-3 p-6">
        <Card className="space-y-2">
          <h1 className="text-lg font-semibold text-ink-1">Request sent</h1>
          <p className="text-sm text-ink-2">{done.service} · {dayLabel(done.starts_at.slice(0, 10))} at {timeOf(done.starts_at)}</p>
          <p className="text-sm text-ink-3">The business will confirm this time. You can see it under Calendar → Appointments.</p>
        </Card>
        <Link to="/calendar" className="text-sm font-medium text-brand-700 underline">Go to my calendar</Link>
      </div>
    );
  }

  const isMe = me?.id === vendorId;

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 pb-24">
      <header>
        <h1 className="text-xl font-semibold text-ink-1">Book a time</h1>
        <p className="text-sm text-ink-3">Choose a service, then a free time. The business confirms each booking.</p>
      </header>
      {isMe && <p className="rounded-xl bg-surface-2 p-3 text-sm text-ink-2">This is your own booking page. Clients see this same view.</p>}

      {services.length === 0 && <p className="text-sm text-ink-4">No services are open for booking right now.</p>}

      <div className="space-y-2">
        {services.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setService(s)}
            aria-pressed={service?.id === s.id}
            className={`w-full rounded-xl border p-3 text-left transition ${service?.id === s.id ? "border-brand-500 bg-brand-50" : "border-edge-2 bg-surface-0"}`}
          >
            <span className="block text-sm font-medium text-ink-1">{s.name}</span>
            <span className="block text-xs text-ink-3">
              {s.duration_minutes} min{s.price_kes != null ? ` · KSh ${s.price_kes.toLocaleString("en-KE")}` : ""}
            </span>
          </button>
        ))}
      </div>

      {service && (
        <Card className="space-y-3">
          <Input label="Day" type="date" value={day} min={toDayString(new Date())} onChange={(e) => setDay(e.target.value)} />
          {slots === null && <PageSpinner />}
          {slots && slots.length === 0 && <p className="text-sm text-ink-4">No free times on this day. Try another day.</p>}
          {slots && slots.length > 0 && (
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Free times">
              {slots.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setPicked(t)}
                  aria-pressed={picked === t}
                  className={`rounded-lg border px-2 py-2 text-sm tabular-nums ${picked === t ? "border-brand-600 bg-brand-600 text-white" : "border-edge-2 bg-surface-0 text-ink-1"}`}
                >
                  {timeOf(t)}
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      {picked && (
        <Card as="form" onSubmit={book} className="space-y-3">
          <p className="text-sm font-medium text-ink-1">{service.name} · {dayLabel(day)} at {timeOf(picked)}</p>
          <Input label="Your name" value={form.client_name} maxLength={200} onChange={(e) => setForm({ ...form, client_name: e.target.value })} />
          <Input label="Phone (optional)" value={form.client_phone} maxLength={40} onChange={(e) => setForm({ ...form, client_phone: e.target.value })} />
          <Input label="Note for the business (optional)" value={form.notes} maxLength={1000} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <Button type="submit" loading={busy} className="w-full" disabled={isMe}>Request this time</Button>
        </Card>
      )}
    </div>
  );
}
