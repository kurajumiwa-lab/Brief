import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarClock, Check, Loader2, Pause, Play, Plus, Send, Share2, Trash2,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { recurringRoutineAPI, apiError } from "@/lib/api";
import { DEFAULT_REGION, REGIONS, regionFromPlace } from "@/config/regions";
import { useAuthStore } from "@/stores/authStore";
import { num } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * RECURRING HUSTLE ROUTINES — /routines
 *
 * The recurring vendor (a Saturday delivery run, a Friday clinic, a bulk-buy
 * round) should type it once. This page stores the weekly slot and template;
 * the hourly sweep publishes a normal activity when the 48-hour lead window
 * opens, and the owner gets a one-tap WhatsApp prompt in the Inbox.
 *
 * "Repeat weekly" is a switch, not a separate product. Turning it off leaves
 * the ordinary Create flow to handle a one-off.
 */

const DAYS = [
  { value: 1, label: "Mon" }, { value: 2, label: "Tue" }, { value: 3, label: "Wed" },
  { value: 4, label: "Thu" }, { value: 5, label: "Fri" }, { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const KINDS = [
  { value: "scheduled", label: "Market day / delivery run" },
  { value: "event", label: "Pop-up clinic or service" },
  { value: "offer", label: "Bulk-buy round or weekly offer" },
];

function emptyForm(regionSlug, town) {
  return {
    repeat: true,
    kind: "scheduled",
    title: "",
    region_slug: regionSlug,
    town,
    day_of_week: 6,
    start_time_local: "08:00",
    duration_hours: "6",
    publish_lead_hours: "48",
    body: "",
    price_kes: "",
    capacity: "",
    meeting_point: "",
    payment_method: "SEND_MONEY",
    payment_number: "",
    payment_name: "",
  };
}

export default function RoutinesPage() {
  const vendor = useAuthStore((s) => s.vendor);
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(null);

  const region = regionFromPlace(vendor?.physical_location) || DEFAULT_REGION;
  const town = String(vendor?.physical_location || "").split(",")[0].trim();

  const load = useCallback(async () => {
    try {
      const { data: payload } = await recurringRoutineAPI.mine();
      setData(payload);
      setError("");
    } catch (err) {
      setError(apiError(err, "Your routines could not be loaded."));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    try {
      await recurringRoutineAPI.create({
        kind: form.kind,
        title: form.title.trim(),
        region_slug: form.region_slug,
        town: form.town.trim(),
        day_of_week: Number(form.day_of_week),
        start_time_local: form.start_time_local,
        duration_hours: Number(form.duration_hours),
        publish_lead_hours: Number(form.publish_lead_hours),
        template_payload: {
          body: form.body.trim(),
          price_kes: form.price_kes === "" ? null : Number(form.price_kes),
          capacity: form.capacity === "" ? null : Number(form.capacity),
          meeting_point: form.meeting_point.trim() || null,
          inferred_template: form.kind === "offer" ? "group_sourcing" : "travelling_round",
          payment_tag: form.payment_number.trim()
            ? { method: form.payment_method, number: form.payment_number.trim(), name: form.payment_name.trim() || null }
            : null,
        },
      });
      toast.success("Routine saved. It publishes itself when the week opens.");
      setForm(null);
      await load();
    } catch (err) {
      toast.error(apiError(err, "That routine could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(routine) {
    setBusy(routine.id);
    try {
      await recurringRoutineAPI.update(routine.id, { is_active: !routine.is_active });
      await load();
    } catch (err) {
      toast.error(apiError(err, "That routine could not be updated."));
    } finally {
      setBusy(null);
    }
  }

  async function publish(routine) {
    setBusy(routine.id);
    try {
      await recurringRoutineAPI.publish(routine.id);
      toast.success("This week's round is live.");
      await load();
    } catch (err) {
      toast.error(apiError(err, "This week's round could not be published."));
    } finally {
      setBusy(null);
    }
  }

  async function remove(routine) {
    setBusy(routine.id);
    try {
      await recurringRoutineAPI.remove(routine.id);
      toast.success("Routine removed. Rounds already published stay live.");
      await load();
    } catch (err) {
      toast.error(apiError(err, "That routine could not be removed."));
    } finally {
      setBusy(null);
    }
  }

  async function share(prompt) {
    const url = `${window.location.origin}${prompt.share_path}`;
    const text = `${prompt.share_text} ${url}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(prompt.instance_id);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      // The link stays visible and selectable.
    }
    try { await recurringRoutineAPI.markShared(prompt.instance_id); } catch { /* optional */ }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  if (!data) {
    return error ? (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-sm font-semibold text-ink-1">{error}</p>
      </main>
    ) : <PageSpinner label="Loading your routines…" />;
  }

  return (
    <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Hustle routine</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink-1">Repeat weekly</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-3">
            Type it once. The round republishes itself before market day, so buyers
            see a reliable schedule instead of last week&apos;s post.
          </p>
        </div>
        <Button icon={Plus} onClick={() => setForm(emptyForm(region.slug, town))}>New</Button>
      </header>

      {form && (
        <RoutineForm
          form={form}
          setForm={setForm}
          saving={saving}
          onSave={save}
          onCancel={() => setForm(null)}
        />
      )}

      {data.share_prompts.length > 0 && (
        <section aria-labelledby="share-heading" className="space-y-2">
          <h2 id="share-heading" className="text-sm font-extrabold text-ink-1">This week&apos;s rounds</h2>
          {data.share_prompts.slice(0, 4).map((prompt) => (
            <div key={prompt.instance_id} className="flex items-center gap-3 rounded-xl border border-edge-1 bg-surface-0 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-ink-1">{prompt.title}</p>
                <p className="mt-0.5 text-[11px] text-ink-4">
                  {new Date(`${prompt.occurrence_date}T12:00:00`).toLocaleDateString(undefined, {
                    weekday: "long", day: "numeric", month: "short",
                  })}
                  {prompt.shared_at ? " · shared" : ""}
                </p>
              </div>
              <Button size="sm" variant="secondary" icon={copied === prompt.instance_id ? Check : Share2} onClick={() => share(prompt)}>
                WhatsApp
              </Button>
            </div>
          ))}
        </section>
      )}

      <section aria-labelledby="routines-heading" className="space-y-2">
        <h2 id="routines-heading" className="text-sm font-extrabold text-ink-1">Your routines</h2>
        {data.routines.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-edge-2 bg-surface-0 px-4 py-8 text-center">
            <CalendarClock size={20} className="mx-auto text-ink-4" aria-hidden="true" />
            <p className="mt-2 text-xs font-semibold text-ink-1">No weekly routine yet</p>
            <p className="mx-auto mt-1 max-w-sm text-2xs leading-relaxed text-ink-3">
              A Saturday delivery run, a Friday clinic or a bulk-buy round can
              republish itself every week. Nothing is posted until its lead window opens.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {data.routines.map((routine) => (
              <li key={routine.id} className="rounded-xl border border-edge-1 bg-surface-0 p-3" data-testid="routine-row">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200">
                        {routine.recurrence_label}
                      </span>
                      {!routine.is_active && <Badge variant="amber">Paused</Badge>}
                    </div>
                    <p className="mt-1 truncate text-sm font-bold text-ink-1">{routine.title}</p>
                    <p className="mt-0.5 text-[11px] text-ink-4">
                      {routine.start_time_local} EAT · {routine.town} · {routine.duration_hours}h
                      {routine.template?.price_kes != null ? ` · KSh ${num(routine.template.price_kes)}` : ""}
                      {routine.template?.capacity ? ` · ${routine.template.capacity} places` : ""}
                    </p>
                    <p className="mt-1 text-[10px] text-ink-4">
                      {routine.last_generated_for_date
                        ? `Last published for ${routine.last_generated_for_date}`
                        : `Publishes ${routine.publish_lead_hours}h before it starts`}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Button size="xs" variant="secondary" icon={routine.is_active ? Pause : Play} loading={busy === routine.id} onClick={() => toggle(routine)}>
                      {routine.is_active ? "Pause" : "Resume"}
                    </Button>
                    <Button size="xs" variant="ghost" icon={Send} onClick={() => publish(routine)}>Publish now</Button>
                    <Button size="xs" variant="ghost" icon={Trash2} onClick={() => remove(routine)}>Remove</Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-center text-[10px] leading-relaxed text-ink-4">
        A weekly badge says the seller publishes on a schedule. It is not a
        reliability guarantee and awards no standing credit.{" "}
        <Link to="/inbox" className="font-semibold underline">Back to the Inbox</Link>
      </p>
    </main>
  );
}

function RoutineForm({ form, setForm, saving, onSave, onCancel }) {
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const valid = form.repeat && form.title.trim().length >= 4 && form.town.trim().length >= 2
    && form.body.trim().length >= 8;

  return (
    <section className="space-y-3 rounded-2xl border border-edge-1 bg-surface-0 p-4" data-testid="routine-form">
      <label className="flex items-start justify-between gap-3">
        <span>
          <span className="block text-xs font-bold text-ink-1">Repeat weekly (market day / routine)</span>
          <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-4">
            Publishes automatically before the day you choose. Off means a one-off post.
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={form.repeat}
          onChange={(event) => setForm((f) => ({ ...f, repeat: event.target.checked }))}
          className="mt-1 h-5 w-5 shrink-0 accent-brand-700"
          aria-label="Repeat weekly"
        />
      </label>

      {!form.repeat && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          A one-off is posted from <Link to="/create" className="font-bold underline">Create</Link>.
          This page only keeps schedules that repeat.
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-ink-2 sm:col-span-2">
          Title
          <input className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-1 px-3 py-2 text-sm" value={form.title} onChange={set("title")} placeholder="Nairobi → Kisumu Saturday deliveries" />
        </label>
        <label className="block text-xs font-semibold text-ink-2">
          Kind
          <select className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-1 px-2 py-2 text-sm" value={form.kind} onChange={set("kind")}>
            {KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-ink-2">
          Region
          <select className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-1 px-2 py-2 text-sm" value={form.region_slug} onChange={set("region_slug")}>
            {REGIONS.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-ink-2">
          Town
          <input className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-1 px-2 py-2 text-sm" value={form.town} onChange={set("town")} placeholder="Kisumu" />
        </label>
        <label className="block text-xs font-semibold text-ink-2">
          Starts (EAT)
          <input type="time" className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-1 px-2 py-2 text-sm" value={form.start_time_local} onChange={set("start_time_local")} />
        </label>
      </div>

      {form.repeat && (
        <div>
          <p className="text-xs font-semibold text-ink-2">Which day?</p>
          <div className="mt-1.5 grid grid-cols-7 gap-1" role="group" aria-label="Repeat day">
            {DAYS.map((day) => {
              const active = Number(form.day_of_week) === day.value;
              return (
                <button
                  key={day.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setForm((f) => ({ ...f, day_of_week: day.value }))}
                  className={cn(
                    "rounded-lg border py-2 text-[11px] font-bold transition-colors",
                    active
                      ? "border-brand-700 bg-brand-700 text-white"
                      : "border-edge-2 bg-surface-1 text-ink-2 hover:border-edge-3",
                  )}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <label className="block text-xs font-semibold text-ink-2">
        What happens each week
        <textarea className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-1 px-3 py-2 text-sm" rows={3} value={form.body} onChange={set("body")} placeholder="Pickup at Kencom, delivery to Kisumu bus park by 2pm." />
      </label>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="block text-xs font-semibold text-ink-2">
          Price (KSh)
          <input type="number" min="0" className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-1 px-2 py-2 text-sm" value={form.price_kes} onChange={set("price_kes")} />
        </label>
        <label className="block text-xs font-semibold text-ink-2">
          Capacity
          <input type="number" min="1" className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-1 px-2 py-2 text-sm" value={form.capacity} onChange={set("capacity")} />
        </label>
        <label className="block text-xs font-semibold text-ink-2">
          Hours
          <input type="number" min="1" max="72" className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-1 px-2 py-2 text-sm" value={form.duration_hours} onChange={set("duration_hours")} />
        </label>
        <label className="block text-xs font-semibold text-ink-2">
          Lead (hours)
          <input type="number" min="0" max="336" className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-1 px-2 py-2 text-sm" value={form.publish_lead_hours} onChange={set("publish_lead_hours")} />
        </label>
      </div>

      <label className="block text-xs font-semibold text-ink-2">
        Meeting point
        <input className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-1 px-3 py-2 text-sm" value={form.meeting_point} onChange={set("meeting_point")} placeholder="Kencom, next to the stage" />
      </label>

      <details className="rounded-xl border border-edge-1 bg-surface-1 p-3">
        <summary className="cursor-pointer text-xs font-bold text-ink-2">Payment tag (kept private)</summary>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-4">
          This is shared in your WhatsApp text and on your own page. It is not
          published on the public activity card.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <select className="rounded-lg border border-edge-2 bg-surface-0 px-2 py-2 text-sm" value={form.payment_method} onChange={set("payment_method")}>
            <option value="SEND_MONEY">Send Money</option>
            <option value="POCHI">Pochi</option>
            <option value="TILL">Till</option>
            <option value="PAYBILL">Paybill</option>
          </select>
          <input className="rounded-lg border border-edge-2 bg-surface-0 px-2 py-2 text-sm" inputMode="tel" placeholder="Number" value={form.payment_number} onChange={set("payment_number")} />
        </div>
      </details>

      <div className="flex gap-2">
        <Button variant="secondary" fullWidth onClick={onCancel}>Cancel</Button>
        <Button fullWidth loading={saving} disabled={!valid} onClick={onSave} icon={saving ? Loader2 : CalendarClock}>
          Save routine
        </Button>
      </div>
    </section>
  );
}
