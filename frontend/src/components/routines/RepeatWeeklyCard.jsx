import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, Check, Repeat } from "lucide-react";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { recurringRoutineAPI, apiError } from "@/lib/api";
import { DEFAULT_REGION, regionFromPlace } from "@/config/regions";
import { cn } from "@/lib/utils";

/**
 * "REPEAT WEEKLY" ON THE CREATE SCREEN.
 *
 * A market-day or delivery-run seller should not retype the same post every
 * week. Turning this on saves the current draft as a routine: the day it
 * repeats, the time it starts, and the 48-hour lead before it republishes.
 * The ordinary Publish button still publishes this week's one-off.
 */

const DAYS = [
  { value: 1, label: "Mon" }, { value: 2, label: "Tue" }, { value: 3, label: "Wed" },
  { value: 4, label: "Thu" }, { value: 5, label: "Fri" }, { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

export default function RepeatWeeklyCard({ draft }) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(6);
  const [start, setStart] = useState("08:00");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const title = String(draft?.title || "").trim();
  const body = String(draft?.body || "").trim();
  const place = String(draft?.location || "").trim();
  const ready = title.length >= 4 && body.length >= 8 && place.length >= 2;

  async function save() {
    setSaving(true);
    try {
      const region = regionFromPlace(place) || DEFAULT_REGION;
      await recurringRoutineAPI.create({
        kind: draft?.content_type === "offer" ? "offer" : "scheduled",
        title,
        region_slug: region.slug,
        town: place.split(",")[0].trim(),
        day_of_week: day,
        start_time_local: start,
        duration_hours: 6,
        publish_lead_hours: 48,
        template_payload: {
          body,
          price_kes: draft?.price_kes === "" || draft?.price_kes == null ? null : Number(draft.price_kes),
          capacity: draft?.capacity == null || draft?.capacity === "" ? null : Number(draft.capacity),
          meeting_point: place,
          inferred_template: draft?.content_type === "offer" ? "group_sourcing" : "travelling_round",
        },
      });
      setSaved(true);
      toast.success("Saved as a weekly routine. It publishes itself before the day you chose.");
    } catch (err) {
      toast.error(apiError(err, "That routine could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-edge-1 bg-surface-1 p-3.5" data-testid="repeat-weekly-card">
      <label className="flex items-start justify-between gap-3">
        <span className="flex items-start gap-2">
          <Repeat size={15} className="mt-0.5 shrink-0 text-brand-700 dark:text-brand-300" aria-hidden="true" />
          <span>
            <span className="block text-xs font-extrabold text-ink-1">Repeat weekly (market day / routine)</span>
            <span className="mt-0.5 block text-2xs leading-relaxed text-ink-3">
              Keep this post as a weekly slot. Publish still posts this week only.
            </span>
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={open}
          onChange={(event) => setOpen(event.target.checked)}
          className="mt-1 h-5 w-5 shrink-0 accent-brand-700"
          aria-label="Repeat weekly"
        />
      </label>

      {open && (
        <div className="mt-3 space-y-2.5 border-t border-edge-1 pt-3">
          <div>
            <p className="text-2xs font-bold text-ink-2">Which day?</p>
            <div className="mt-1.5 grid grid-cols-7 gap-1" role="group" aria-label="Repeat day">
              {DAYS.map((option) => {
                const active = day === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setDay(option.value)}
                    className={cn(
                      "rounded-lg border py-2 text-2xs font-bold",
                      active
                        ? "border-brand-700 bg-brand-700 text-white"
                        : "border-edge-2 bg-surface-0 text-ink-2 hover:border-edge-3",
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="flex items-center justify-between gap-2 text-2xs font-bold text-ink-2">
            Starts (EAT)
            <input
              type="time"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              className="rounded-lg border border-edge-2 bg-surface-0 px-2 py-1.5 text-xs"
            />
          </label>
          <Button
            fullWidth
            size="md"
            icon={saved ? Check : CalendarClock}
            loading={saving}
            disabled={!ready || saved}
            onClick={save}
          >
            {saved ? "Saved as a routine" : "Save as weekly routine"}
          </Button>
          {!ready && (
            <p className="text-2xs leading-relaxed text-ink-4">
              Add a title, a description and a place above; the routine copies them.
            </p>
          )}
          <p className="text-2xs leading-relaxed text-ink-4">
            A weekly badge is a schedule, not a reliability guarantee, and it
            awards no standing credit.{" "}
            <Link to="/routines" className="font-semibold underline">Manage routines</Link>
          </p>
        </div>
      )}
    </section>
  );
}
