import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, CircleDashed, HelpCircle, XCircle } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { requestsAPI, apiError } from "@/lib/api";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════════════════
   FIT CHECKLIST — "you meet 8 of 10; two still need confirmation"
   ---------------------------------------------------------------------------
   The buyer asked for things; this panel says, in plain words, how my
   business measures against them. The counts are kept apart on purpose:

       met                 a live verified fact on my passport
       needs_confirmation  on file but unchecked, or lapsed — fixable
       missing             nothing on file yet — also fixable
       unverifiable        the buyer's own words; nobody can check them

   No score, no rank, and no gate: an unmet requirement is shown and the
   offer button stays available. The buyer decides who they talk to.
   ═══════════════════════════════════════════════════════════════════════════ */

const STATE_META = {
  met: { icon: CheckCircle2, className: "text-brand-700 dark:text-brand-300" },
  needs_confirmation: { icon: CircleDashed, className: "text-accent-700 dark:text-accent-300" },
  missing: { icon: XCircle, className: "text-ink-3" },
  unverifiable: { icon: HelpCircle, className: "text-ink-3" },
};

export default function FitChecklist({ requestId, enabled = true, defaultOpen = false }) {
  const [fit, setFit] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(defaultOpen);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!requestsAPI?.fit) return Promise.resolve();
    setLoading(true);
    setError("");
    return requestsAPI.fit(requestId)
      .then((r) => setFit(r.data))
      .catch((e) => setError(apiError(e, "The match could not be loaded")))
      .finally(() => setLoading(false));
  }, [requestId]);

  useEffect(() => { if (open && enabled && !fit) load(); }, [open, enabled, fit, load]);

  if (!enabled) return null;

  if (!open) {
    return (
      <Button size="sm" variant="ghost" icon={ChevronDown} loading={loading}
              onClick={() => setOpen(true)}>
        How I measure up
      </Button>
    );
  }

  if (error) {
    return (
      <p className="text-2xs text-ink-3">
        {error}{" "}
        <button type="button" onClick={load} className="underline cursor-pointer">Try again</button>
      </p>
    );
  }
  if (!fit) return <p className="text-2xs text-ink-4">Checking your documents…</p>;

  return (
    <div className="rounded-xl border border-edge-1 bg-surface-1 px-3 py-2.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-ink-1">{fit.sentence}</p>
        <button type="button" onClick={() => setOpen(false)} aria-label="Hide"
                className="text-2xs text-ink-4 hover:text-ink-1 cursor-pointer shrink-0">Hide</button>
      </div>

      <ul className="space-y-1.5">
        {fit.checklist.map((item) => {
          const meta = STATE_META[item.state] || STATE_META.missing;
          const Icon = meta.icon;
          return (
            <li key={`${item.key}-${item.label}`} className="flex items-start gap-2">
              <Icon size={12} className={cn("mt-0.5 shrink-0", meta.className)} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-2xs text-ink-1">
                  {item.label}
                  {item.must_have && <span className="text-ink-4"> · required</span>}
                </p>
                <p className="text-2xs text-ink-4">{item.reason}{item.next_step ? ` — ${item.next_step}` : ""}</p>
              </div>
            </li>
          );
        })}
      </ul>

      {fit.context?.length > 0 && (
        <p className="text-2xs text-ink-4">{fit.context.join(" ")}</p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {fit.missing_must_haves.length > 0 && (
          <Badge variant="amber" size="xs">
            Required documents not verified yet
          </Badge>
        )}
        {fit.next_steps?.map((step) => (
          <Badge key={step} variant="outline" size="xs">{step}</Badge>
        ))}
      </div>
      <p className="text-2xs text-ink-4">{fit.disclaimer}</p>
    </div>
  );
}
