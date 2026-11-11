import { useEffect, useState } from "react";
import { ListChecks } from "lucide-react";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { onboardingAPI, apiError } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * "What do you do?" (Phase 1). A person can pick several activities at once, or skip and
 * finish later. Nothing here creates a business. The card shows only while the step is
 * pending (never after an answer or a skip is saved), and a local dismiss hides it on this
 * device without changing the saved state, so it can still be finished from elsewhere.
 */
const DISMISS_KEY = "brief.whatDoYouDo.dismissed";

function dismissed() {
  try { return !!localStorage.getItem(DISMISS_KEY); } catch { return false; }
}

export default function WhatDoYouDo() {
  const [data, setData] = useState(null);
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);
  const [hidden, setHidden] = useState(dismissed());
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let live = true;
    onboardingAPI.getActivities()
      .then((r) => {
        if (!live) return;
        setData(r.data);
        setPicked(r.data.activities || []);
      })
      .catch(() => { if (live) setLoadError(true); });
    return () => { live = false; };
  }, []);

  if (hidden || loadError || !data || data.state !== "pending") return null;

  const toggle = (key) =>
    setPicked((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

  const save = async () => {
    if (picked.length === 0) return toast.error("Pick at least one, or skip for now");
    setSaving(true);
    try {
      const { data: next } = await onboardingAPI.saveActivities(picked);
      setData(next);
      toast.success("Saved. Your home office is ready.");
    } catch (err) {
      toast.error(apiError(err, "Couldn't save that. Try again."));
    } finally {
      setSaving(false);
    }
  };

  const skip = async () => {
    setSaving(true);
    try {
      await onboardingAPI.skipActivities();
    } catch {
      // The local hide still applies; the state is retried on the next visit.
    } finally {
      try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode */ }
      setHidden(true);
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="what-do-you-do-title" className="rounded-2xl border border-surface-3 bg-surface-2 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <ListChecks className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="what-do-you-do-title" className="text-base font-semibold text-ink-1">What do you do?</h2>
          <p className="mt-1 text-sm text-ink-3">Pick all that apply. You can change this later.</p>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="What you do">
            {data.options.map((o) => {
              const on = picked.includes(o.key);
              return (
                <button
                  key={o.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(o.key)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm transition",
                    on ? "border-brand-600 bg-brand-600 text-white" : "border-surface-3 bg-surface-1 text-ink-2 hover:border-brand-600",
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={save} disabled={saving || picked.length === 0}>Save</Button>
            <Button size="sm" variant="ghost" onClick={skip} disabled={saving}>Skip for now</Button>
          </div>
        </div>
      </div>
    </section>
  );
}
