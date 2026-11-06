import { useEffect, useState } from "react";
import { X } from "lucide-react";

/**
 * DAILY WELCOME — a short, dismissible hello at most once every 24 hours.
 *
 * The moment it is shown is written to localStorage, so the rule survives an
 * app restart or a closed tab. A browser that refuses storage simply shows it
 * on each visit: a little too often is better than never.
 */
export const WELCOME_KEY = "brief-welcome-shown-at";
export const WELCOME_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function shouldShowDailyWelcome(now = Date.now(), storage = globalThis.localStorage) {
  try {
    const last = Number(storage?.getItem(WELCOME_KEY) || 0);
    return !last || now - last >= WELCOME_INTERVAL_MS;
  } catch {
    return true;
  }
}

export default function DailyWelcome({ name }) {
  const [open, setOpen] = useState(() => shouldShowDailyWelcome());

  useEffect(() => {
    if (!open) return;
    try {
      localStorage.setItem(WELCOME_KEY, String(Date.now()));
    } catch {
      /* storage refused: the welcome simply returns next visit */
    }
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-1/30 p-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="welcome-title" className="relative w-full max-w-sm rounded-3xl border border-edge-1 bg-surface-0 p-5 shadow-xl">
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close welcome"
          className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-lg text-ink-4 hover:bg-surface-2 hover:text-ink-1"
        >
          <X size={15} aria-hidden="true" />
        </button>
        <h2 id="welcome-title" className="pr-8 text-base font-bold text-ink-1">
          {name ? `Good to see you, ${name}` : "Good to see you"}
        </h2>
        <p className="mt-1 text-xs text-ink-3">Here is what needs you today.</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-4 w-full rounded-xl bg-brand-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-brand-700"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
