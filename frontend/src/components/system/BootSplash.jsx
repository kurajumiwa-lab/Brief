import { useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/layout/Logo";
import { BRAND } from "@/config/brand";
import { cn } from "@/lib/utils";

/**
 * THE FIRST FIVE SECONDS.
 *
 * A cold start on a phone in the market is not instant: the bundle parses, the
 * session is checked, the network is asked who you are. This screen owns that
 * time instead of leaving a grey rectangle — a shelf drawing itself, and a line
 * that says the one thing worth saying while it happens.
 *
 * The sequence is fixed on purpose (five seconds; the last two name the
 * handshake), because a splash that comes and goes at random speeds is worse
 * than no splash: people read the *change* in it as a change in the app.
 *
 * What it must never do is lie. It leaves the moment the app is ready and the
 * minimum has elapsed — it does not hold a working app hostage to a timer, and
 * it does not claim "logging in" for a person who is not signed in.
 */

export const SPLASH_TOTAL_MS = 5000;
export const SPLASH_HANDSHAKE_AT_MS = 3000; // the last two seconds say "logging in"

/** Test and storybook environments skip it: a five-second timer in every spec
 *  would slow the suite and race every `findBy*`. */
const DISABLED = import.meta.env?.MODE === "test" || import.meta.env?.VITE_NO_SPLASH === "1";

export default function BootSplash({ onDone, enabled = !DISABLED }) {
  const [phase, setPhase] = useState("arriving"); // arriving → handshake → leaving
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(Date.now());

  useEffect(() => {
    if (!enabled) {
      onDone?.();
      return undefined;
    }
    const tick = window.setInterval(() => {
      const ms = Date.now() - started.current;
      setElapsed(ms);
      if (ms >= SPLASH_HANDSHAKE_AT_MS) setPhase((p) => (p === "arriving" ? "handshake" : p));
    }, 100);

    const finish = window.setTimeout(() => {
      setPhase("leaving");
      window.setTimeout(() => onDone?.(), 220); // the exit animation, not a second wait
    }, SPLASH_TOTAL_MS);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(finish);
    };
  }, [onDone, enabled]);

  const progress = Math.min(100, Math.round((elapsed / SPLASH_TOTAL_MS) * 100));

  if (!enabled) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[120] grid place-items-center bg-surface-0 transition-opacity duration-2 ease-out",
        phase === "leaving" ? "pointer-events-none opacity-0" : "opacity-100"
      )}
      data-testid="boot-splash"
      data-phase={phase}
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-xs px-8 text-center">
        {/* The mark, assembling: three shelves sliding in one after another. */}
        <div className="mx-auto mb-5 grid place-items-center">
          <LogoMark size={56} className="animate-scale-in" />
        </div>

        <p className="text-lg font-extrabold tracking-tight text-ink-1">{BRAND.wordmark}</p>
        <p className="mt-0.5 text-2xs text-ink-4">{BRAND.tagline}</p>

        <div className="mx-auto mt-6 h-1 w-40 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-brand-600 transition-[width] duration-1 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        <p
          className="mt-3 min-h-[1.25rem] text-2xs font-semibold text-ink-3"
          data-testid="boot-splash-status"
        >
          {phase === "arriving" ? "Opening your shelf…" : "Logging in to the network…"}
        </p>
      </div>
    </div>
  );
}
