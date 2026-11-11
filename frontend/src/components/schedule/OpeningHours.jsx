import { useCallback, useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { fieldBase } from "@/components/ui/Input";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { scheduleAPI, apiError } from "@/lib/api";
import { WEEKDAYS } from "@/pages/calendar/calendarTime";

/**
 * The provider's weekly opening hours, one row per weekday (0 = Monday). It reads and writes the
 * existing availability rules (GET/PUT /api/schedule/availability). These hours belong to the
 * provider, so they apply to every service they offer. Saving is independent of any form around it.
 */
export default function OpeningHours({ title = "Opening hours", note }) {
  const [windows, setWindows] = useState(() => emptyHours());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await scheduleAPI.availability();
      setWindows(hoursFromRules(data.windows));
    } catch (err) {
      toast.error(apiError(err, "Could not load your opening hours"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
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

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-ink-1">{title}</h2>
      <Card className="space-y-2">
        {note && <p className="text-xs text-ink-3">{note}</p>}
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
        <Button className="w-full" onClick={save}>Save opening hours</Button>
      </Card>
    </section>
  );
}

// One row per weekday. Off until a window is saved for that day.
export function emptyHours() {
  return Array.from({ length: 7 }, () => ({ on: false, from: "09:00", to: "17:00" }));
}

export function hoursFromRules(rules) {
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
