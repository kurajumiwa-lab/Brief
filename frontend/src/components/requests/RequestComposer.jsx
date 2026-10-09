import { useEffect, useState } from "react";
import {
  Package, Users, Truck, Wrench, Footprints, HeartHandshake, CheckCircle2, X,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import { requestsAPI, apiError } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// RequestComposer — THE reusable business request.
//
// Whenever a business needs something the directory cannot answer, this is the
// one form. The type changes the wording, never the flow: post → relevant
// businesses see it → offers arrive → accept one → fulfilled. It is opened
// from Browse's action center, from Work, and from every empty state that
// would otherwise dead-end.
// ─────────────────────────────────────────────────────────────────────────────

export const REQUEST_TYPES = [
  { value: "stock", label: "Stock", icon: Package, example: "20 bags of maize flour…" },
  { value: "worker", label: "Worker", icon: Users, example: "3 loaders, tomorrow morning…" },
  { value: "delivery", label: "Delivery", icon: Truck, example: "Pick up at Kibuye, drop at Kondele…" },
  { value: "rental", label: "Rental", icon: Wrench, example: "Concrete mixer for two days…" },
  { value: "errand", label: "Errand", icon: Footprints, example: "Buy packaging at the wholesale…" },
  { value: "service", label: "Other service", icon: HeartHandshake, example: "Fix the shop shutter…" },
];

const URGENCIES = [
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "this_week", label: "This week" },
  { value: "flexible", label: "Flexible" },
];

export default function RequestComposer({ open, onClose, defaultType = "stock", onPosted }) {
  const vendor = useAuthStore((s) => s.vendor);
  const [requestType, setRequestType] = useState(defaultType);
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [neededBy, setNeededBy] = useState("flexible");
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Every open starts from the type that launched it and the trader's own
  // location words — typing your town for the hundredth time is the tax this
  // form exists to remove. Reset fires on the OPEN TRANSITION only: identity
  // of the other deps must never wipe what the trader is typing.
  useEffect(() => {
    if (!open) return;
    setRequestType(defaultType);
    setDescription("");
    setLocation(vendor?.physical_location || "");
    setNeededBy("flexible");
    setBudget("");
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const example = REQUEST_TYPES.find((t) => t.value === requestType)?.example;

  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { data } = await requestsAPI.create({
        request_type: requestType,
        description,
        location,
        needed_by: neededBy,
        budget_kes: budget ? Number(budget.replace(/[^\d]/g, "")) || null : null,
      });
      toast.success("Request posted — nearby businesses can respond now");
      onPosted?.(data);
      onClose?.();
    } catch (err) {
      setError(apiError(err, "The request could not be posted"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[700] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Post a business request">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-ink-1/40 backdrop-blur-[2px] cursor-default" onClick={onClose} />
      <form
        onSubmit={submit}
        className="relative w-full sm:max-w-lg max-h-[92vh] overflow-y-auto bg-surface-0 rounded-t-3xl sm:rounded-3xl border border-edge-1 shadow-2xl p-4 sm:p-5 space-y-4 animate-slide-up"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink-1">Post a request</h2>
            <p className="text-2xs text-ink-3 mt-0.5">
              Reach relevant vendors, workers and service providers in your network.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-4 hover:text-ink-1 cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <fieldset>
          <legend className="text-xs font-semibold text-ink-2 mb-1.5">What do you need?</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {REQUEST_TYPES.map(({ value, label, icon: Icon }) => {
              const active = requestType === value;
              return (
                <button key={value} type="button" onClick={() => setRequestType(value)}
                  aria-pressed={active}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-2.5 py-2 text-xs font-semibold cursor-pointer transition-colors text-left",
                    active
                      ? "border-brand-600/70 bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300"
                      : "border-edge-2 text-ink-2 hover:border-edge-3",
                  )}>
                  <Icon size={14} className={active ? "text-brand-700 dark:text-brand-300" : "text-ink-4"} />
                  <span className="flex-1 truncate">{label}</span>
                  {active && <CheckCircle2 size={13} className="text-brand-700 dark:text-brand-300 shrink-0" />}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="block">
          <span className="text-xs font-semibold text-ink-2">Describe what you need</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            required
            minLength={8}
            placeholder={example ? `E.g. ${example}` : "Be specific — quantity, quality, timing…"}
            className="mt-1 w-full rounded-xl border border-edge-2 bg-surface-1 px-3 py-2 text-sm text-ink-1 placeholder:text-ink-4 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-ink-2">Location</span>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            required
            placeholder="Town, market or neighbourhood"
            className="mt-1 w-full h-10 rounded-xl border border-edge-2 bg-surface-1 px-3 text-sm text-ink-1 placeholder:text-ink-4 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
          />
        </label>

        <fieldset>
          <legend className="text-xs font-semibold text-ink-2 mb-1.5">Needed by</legend>
          <div className="flex flex-wrap gap-1.5">
            {URGENCIES.map(({ value, label }) => (
              <button key={value} type="button" onClick={() => setNeededBy(value)}
                aria-pressed={neededBy === value}
                className={cn(
                  "h-8 px-3 rounded-full text-xs font-semibold cursor-pointer border transition-colors",
                  neededBy === value
                    ? "border-brand-600/70 bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300"
                    : "border-edge-2 text-ink-3 hover:text-ink-1",
                )}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="text-xs font-semibold text-ink-2">Budget <span className="font-normal text-ink-4">(optional — KSh)</span></span>
          <input
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            inputMode="numeric"
            placeholder="e.g. 2,000 — leave empty for open quotes"
            className="mt-1 w-full h-10 rounded-xl border border-edge-2 bg-surface-1 px-3 text-sm text-ink-1 placeholder:text-ink-4 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
          />
        </label>

        {error && (
          <p className="text-2xs text-red-600 dark:text-red-400 bg-red-500/10 rounded-xl px-3 py-2">{error}</p>
        )}

        <div className="flex items-center gap-2">
          <Button type="submit" block loading={busy} disabled={busy}>
            {busy ? "Posting…" : "Post my request"}
          </Button>
        </div>
        {busy && <Spinner size={12} className="sr-only" />}
      </form>
    </div>
  );
}
