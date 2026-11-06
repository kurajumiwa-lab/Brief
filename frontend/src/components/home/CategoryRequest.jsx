import { useState } from "react";
import { vendorAPI, apiError } from "@/lib/api";
import { toast } from "@/components/ui/Toast";

/**
 * CATEGORY DATA REQUEST — one missing fact, one input, one save.
 *
 * Shown in place of the daily welcome when a business's category needs a fact
 * it does not yet have. `onAnswered(rule, value)` runs after a successful save,
 * so the parent can re-read the profile and stop asking.
 */
export default function CategoryRequest({ rule, onAnswered, onLater }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const min = rule.minLength || 1;
  const valid = value.trim().length >= min;

  const save = async (event) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      const body = { [rule.field]: value.trim() };
      if (rule.scope === "vendor") await vendorAPI.update(body);
      else await vendorAPI.updateProfile(body);
      toast.success("Saved");
      onAnswered?.(rule, value.trim());
    } catch (err) {
      setError(apiError(err, "That could not be saved. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-1/30 p-4 sm:items-center">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-request-title"
        onSubmit={save}
        className="w-full max-w-sm space-y-3 rounded-3xl border border-edge-1 bg-surface-0 p-5 shadow-xl"
      >
        <h2 id="category-request-title" className="text-base font-bold text-ink-1">{rule.label}</h2>
        <p className="text-xs text-ink-3">{rule.prompt}</p>
        <label className="sr-only" htmlFor="category-request-input">{rule.label}</label>
        <input
          id="category-request-input"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={rule.placeholder}
          autoFocus
          className="w-full rounded-xl border border-edge-2 bg-surface-0 px-3 py-2.5 text-sm text-ink-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
        />
        {error && <p role="alert" className="text-micro text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onLater?.(rule)}
            className="flex-1 rounded-xl border border-edge-1 px-4 py-2.5 text-xs font-bold text-ink-2 hover:bg-surface-1"
          >
            Later
          </button>
          <button
            type="submit"
            disabled={!valid || busy}
            className="flex-1 rounded-xl bg-brand-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
