import { useCallback, useEffect, useId, useRef, useState } from "react";
import { BRAND } from "@/config/brand";
import { cn } from "@/lib/utils";

/**
 * THE COLD-START SCREEN.
 *
 * A phone on a weak connection is not instant: the bundle parses, the session
 * is checked, the network is asked who you are. This screen owns that time
 * instead of leaving a grey rectangle — a mark drawing itself, a shelf being
 * filled, and a line that says the one thing worth saying while it happens.
 *
 * It used to be a timer. Five seconds, always, whatever the application was
 * actually doing, with a percentage that measured the clock rather than the
 * work. That is the one thing a loading screen must not be: a number that
 * looks like progress and is not.
 *
 * So the screen has four rules now, and they are the whole of the design.
 *
 *   1. IT SAYS WHAT THE APPLICATION KNOWS. The application reports the
 *      milestone it has reached; this screen writes the sentence for it. It
 *      never writes a milestone the application has not reached, and it
 *      never invents one.
 *
 *   2. IT LEAVES WHEN THE APPLICATION IS READY. Not on a timer. The floor
 *      below is a floor — it stops a warm start from flashing — and a slow
 *      application is waited for, however long it takes.
 *
 *   3. IT NEVER SHOWS 100% BEFORE THE WORK IS DONE. When the application
 *      cannot measure its own progress the bar says so: it moves, and it
 *      carries no number. A caller that *can* measure passes `progress`, and
 *      even then the number is held below the top until the application says
 *      it is ready.
 *
 *   4. IT SETTLES. The last line is held long enough to be read, and the
 *      lift away is a fade rather than a cut, so the screen never flashes.
 *
 * The sequence of lines is fixed, because a screen that changes at random
 * speeds reads as a glitch. What is not fixed is *when* each line appears:
 * that belongs to the application.
 */

/** The floor: the screen cannot leave before this, whatever else is true. */
export const SPLASH_MIN_MS = 1200;

/** Every line is held at least this long, so that it can be read. */
export const SPLASH_STAGE_MIN_MS = 600;

/** The last line is held this long before the screen lifts. */
export const SPLASH_SETTLE_MS = 700;

/** The lift away from the screen. */
export const SPLASH_EXIT_MS = 260;

/** The highest number the screen may show before the application is ready. */
export const SPLASH_MAX_BEFORE_READY = 99;

/**
 * The copy.
 *
 * The first four are milestones the application reports; the last one is
 * this screen's to say, because only the application knows the work is
 * finished. The keys are what the application passes as `milestone`.
 */
export const SPLASH_STAGES = Object.freeze([
  { key: "shelf", label: "Opening your shelf…" },
  { key: "network", label: "Discovering your network…" },
  { key: "curate", label: "Curating meaningful connections…" },
  { key: "prepare", label: "Preparing your experience…" },
  { key: "ready", label: "Your shelf is ready." },
]);

const FIRST_KEY = SPLASH_STAGES[0].key;
const LAST_KEY = SPLASH_STAGES[SPLASH_STAGES.length - 1].key;
const STAGE_BY_KEY = new Map(SPLASH_STAGES.map((stage) => [stage.key, stage]));
const indexOfStage = (key) => SPLASH_STAGES.findIndex((stage) => stage.key === key);

/** Test environments skip it, as they always have. */
const DISABLED = import.meta.env?.MODE === "test" || import.meta.env?.VITE_NO_SPLASH === "1";

/** The paint the document wears before the application has painted. */
const BOOT_PAINT_ID = "wasta-boot-paint";
const BOOT_FOREST = "#0D2B24";

/**
 * Does this person have asked for less movement?
 *
 * The stylesheet already stills the animation for them; what the script has
 * to know is that the mark should be drawn complete from the first frame,
 * and that the exit should not wait for a fade that will not happen.
 */
function useReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event) => setReduced(event.matches);

    if (typeof query.addEventListener === "function") query.addEventListener("change", onChange);
    else if (typeof query.addListener === "function") query.addListener(onChange);

    return () => {
      if (typeof query.removeEventListener === "function") query.removeEventListener("change", onChange);
      else if (typeof query.removeListener === "function") query.removeListener(onChange);
    };
  }, []);

  return reduced;
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));

export default function BootSplash({
  onDone,
  ready = false,
  milestone = FIRST_KEY,
  progress = null,
  enabled = !DISABLED,
  minDurationMs = SPLASH_MIN_MS,
  settleMs = SPLASH_SETTLE_MS,
  replayKey = 0,
  showReplay = false,
  className,
}) {
  const [phase, setPhase] = useState("loading"); // loading → leaving
  const [lineKey, setLineKey] = useState(FIRST_KEY);

  const reducedMotion = useReducedMotion();

  // `useId` keeps the badge's gradient reference unique if the screen is ever
  // mounted twice. React's ids contain colons, which are not valid in a
  // url(#id), so the characters that cannot go there are taken out.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  const rootRef = useRef(null);
  const markRef = useRef(null);
  const animationsRef = useRef([]);

  // Everything the clock reads lives in a ref, so that a re-render — or a
  // replay — never restarts it by accident.
  const onDoneRef = useRef(onDone);
  const readyRef = useRef(ready);
  const milestoneRef = useRef(milestone);
  const reducedRef = useRef(reducedMotion);
  const startedAt = useRef(0);
  const lineAt = useRef(0);
  const lineRef = useRef(FIRST_KEY);
  const phaseRef = useRef("loading");
  const settleStepRef = useRef(0);
  const historyRef = useRef([]);
  const replayRef = useRef(null);
  const exitTimer = useRef(null);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  useEffect(() => {
    reducedRef.current = reducedMotion;
  }, [reducedMotion]);

  /* ── The milestones the application reported ────────────────────────────
     Kept in order, because a replay walks through them again. A milestone
     the application has not reported is never shown. */
  useEffect(() => {
    const key = STAGE_BY_KEY.has(milestone) ? milestone : FIRST_KEY;
    milestoneRef.current = key;
    const history = historyRef.current;
    if (history[history.length - 1] !== key) history.push(key);
  }, [milestone]);

  /* ── The mark ──────────────────────────────────────────────────────────
     The monogram is drawn on with the Web Animations API rather than a CSS
     animation, for one reason: a CSS animation cannot be rewound without
     rebuilding the element, and this screen has to be able to replay itself
     in place, on the same nodes, without leaving a second mark behind.

     A browser without the API (or a person who asked for less movement) gets
     the finished mark, because the resting state of the stroke is the drawn
     stroke. */
  const drawMark = useCallback(() => {
    const mark = markRef.current;

    for (const animation of animationsRef.current) {
      try {
        animation.cancel();
      } catch {
        /* an animation that refuses to be cancelled is not worth breaking over */
      }
    }
    animationsRef.current = [];

    if (!mark) return;
    if (reducedRef.current) return;
    if (typeof mark.animate !== "function") return;

    const strokes = mark.querySelectorAll("[data-draw]");
    let index = 0;
    for (const node of strokes) {
      const animation = node.animate(
        [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }],
        {
          duration: 900,
          delay: 120 + index * 160,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
          fill: "both",
        },
      );
      animationsRef.current.push(animation);
      index += 1;
    }
  }, []);

  useEffect(() => {
    drawMark();
    return () => {
      for (const animation of animationsRef.current) {
        try {
          animation.cancel();
        } catch {
          /* nothing to do */
        }
      }
      animationsRef.current = [];
    };
  }, [drawMark, reducedMotion]);

  /* ── The replay ────────────────────────────────────────────────────────
     A reviewer's control. It rewinds the mark, puts the copy back to the
     beginning, and walks the milestones the application reported, in order,
     at the same pace as the first time.

     It reuses the nodes that are already on the screen. Nothing is cloned,
     nothing is rebuilt, and the pending exit is cancelled: a completion that
     belonged to the previous run must not fire into this one. */
  const replay = useCallback(() => {
    window.clearTimeout(exitTimer.current);
    exitTimer.current = null;

    startedAt.current = Date.now();
    lineAt.current = Date.now();
    phaseRef.current = "loading";
    settleStepRef.current = 0;

    const first = historyRef.current[0] || FIRST_KEY;
    lineRef.current = first;
    setLineKey(first);
    setPhase("loading");

    replayRef.current = { index: 0 };
    drawMark();
  }, [drawMark]);

  const lastReplayKey = useRef(replayKey);
  useEffect(() => {
    if (lastReplayKey.current === replayKey) return;
    lastReplayKey.current = replayKey;
    replay();
  }, [replayKey, replay]);

  /* ── The clock ──────────────────────────────────────────────────────────
     One interval, started once, for the life of the screen. It does three
     things: it writes the line for the milestone the application has
     reached, it decides when the screen may go, and it hands over.

     The line is written one stage at a time and each stage is held long
     enough to be read, so a fast application does not flash past its own
     copy. */
  useEffect(() => {
    if (!enabled) {
      onDoneRef.current?.();
      return undefined;
    }

    startedAt.current = Date.now();
    lineAt.current = Date.now();

    const tick = () => {
      const now = Date.now();
      const elapsed = now - startedAt.current;

      // (1) The milestone the application has reached — or, during a replay,
      //     the recorded milestones in the order they happened.
      let target;
      if (replayRef.current) {
        target = historyRef.current[replayRef.current.index] || LAST_KEY;
      } else if (phaseRef.current === "settling") {
        // The last two steps of the handover: the line the application
        // earned, and then the one this screen owns.
        target = settleStepRef.current === 0 ? milestoneRef.current || LAST_KEY : LAST_KEY;
      } else {
        target = milestoneRef.current || FIRST_KEY;
      }

      // The line only ever moves forward. A milestone that has been passed
      // does not un-happen, and the screen must not step back to the opening
      // line while it is on its way out.
      const targetIndex = Math.max(0, indexOfStage(target));
      const lineIndex = Math.max(0, indexOfStage(lineRef.current));
      if (targetIndex > lineIndex && now - lineAt.current >= SPLASH_STAGE_MIN_MS) {
        lineRef.current = SPLASH_STAGES[targetIndex].key;
        lineAt.current = now;
        setLineKey(lineRef.current);
      }

      // (2) A replay walks the recorded milestones and then hands back to
      //     whatever the application is doing now. Each one is held for its
      //     moment first: a replay that flashed through the copy would not be
      //     a replay of anything.
      if (replayRef.current) {
        const history = historyRef.current;
        const index = replayRef.current.index;
        if (lineRef.current === history[index] && now - lineAt.current >= SPLASH_STAGE_MIN_MS) {
          if (index + 1 < history.length) replayRef.current.index = index + 1;
          else replayRef.current = null;
        }
      }

      // (3) The handover. The application is ready, the floor has passed,
      //     the last line has been read, and only then does the screen go.
      if (!readyRef.current || replayRef.current) return;
      if (phaseRef.current === "loading") {
        phaseRef.current = "settling";
        settleStepRef.current = 0;
        setPhase("settling");
        return;
      }
      if (phaseRef.current !== "settling") return;
      if (settleStepRef.current === 0) {
        // The application's own line has had its moment; the last one is next.
        if (now - lineAt.current >= SPLASH_STAGE_MIN_MS) settleStepRef.current = 1;
        return;
      }
      if (lineRef.current !== LAST_KEY) return;
      if (elapsed < minDurationMs) return;
      if (now - lineAt.current < settleMs) return;

      phaseRef.current = "leaving";
      setPhase("leaving");

      const generation = replayRef.current;
      exitTimer.current = window.setTimeout(() => {
        // A completion from a run that has been superseded must not land in
        // this one.
        if (phaseRef.current !== "leaving") return;
        if (generation && generation !== replayRef.current) return;
        onDoneRef.current?.();
      }, reducedRef.current ? 0 : SPLASH_EXIT_MS);
    };

    const timer = window.setInterval(tick, 80);

    return () => {
      window.clearInterval(timer);
      window.clearTimeout(exitTimer.current);
    };
  }, [enabled, minDurationMs, settleMs]);

  /* ── The focus ──────────────────────────────────────────────────────────
     While the screen is up, the application behind it is inert (App.jsx
     sets the attribute), so the keyboard cannot wander into it. The screen
     takes the focus itself, and gives it back when it goes. */
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) return undefined;

    try {
      root.focus({ preventScroll: true });
    } catch {
      /* focusing is a courtesy, not a requirement */
    }

    return () => {
      const page = document.querySelector("main") || document.body;
      try {
        page?.focus?.({ preventScroll: true });
      } catch {
        /* nothing to give back to */
      }
    };
  }, [enabled]);

  /* ── The paint ──────────────────────────────────────────────────────────
     The screen is forest and the document behind it is ivory. Left alone,
     the two would trade places in front of the person: an ivory flash
     before the screen arrives, and another after it goes.

     So the boot paint is installed before the bundle is parsed (index.html)
     and taken away at the handover, and the browser's own chrome is asked
     to match the screen while it is up — on a phone that chrome is a strip
     of the page, and a strip of the wrong colour is a strip of the wrong
     colour. */
  useEffect(() => {
    if (!enabled) {
      document.getElementById(BOOT_PAINT_ID)?.remove();
      return undefined;
    }

    if (!document.getElementById(BOOT_PAINT_ID)) {
      const paint = document.createElement("style");
      paint.id = BOOT_PAINT_ID;
      paint.textContent = `body { background-color: ${BOOT_FOREST} !important; }`;
      document.head.appendChild(paint);
    }

    const metas = Array.from(document.querySelectorAll('meta[name="theme-color"]'));
    const previous = metas.map((meta) => meta.getAttribute("content"));
    for (const meta of metas) meta.setAttribute("content", BOOT_FOREST);

    return () => {
      document.getElementById(BOOT_PAINT_ID)?.remove();
      metas.forEach((meta, index) => {
        if (previous[index]) meta.setAttribute("content", previous[index]);
      });
    };
  }, [enabled]);

  if (!enabled) return null;

  const stage = STAGE_BY_KEY.get(lineKey) || SPLASH_STAGES[0];
  const reached = SPLASH_STAGES.findIndex((item) => item.key === lineKey);

  // A caller that can measure its own progress passes a number. One that
  // cannot gets an indeterminate bar, which says so by moving rather than by
  // counting.
  const measured = typeof progress === "number" && Number.isFinite(progress);
  const determinate = ready || measured;

  // 100% is the one number this screen may only say when the work is done.
  const percent = ready
    ? 100
    : Math.min(SPLASH_MAX_BEFORE_READY, Math.round(clamp01(measured ? progress : 0) * 100));

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className={cn("wasta-splash", className)}
      data-testid="boot-splash"
      data-phase={phase}
    >
      <div className="wasta-splash__body">
        {/* The mark: the W, drawn as a network, resting on a shelf. */}
        <div className="wasta-splash__emblem">
          <svg
            ref={markRef}
            className="wasta-splash__mark"
            viewBox="0 0 128 128"
            aria-hidden="true"
            focusable="false"
            data-testid="boot-splash-mark"
          >
            <defs>
              <linearGradient
                id={`wasta-splash-badge-${uid}`}
                x1="18"
                y1="14"
                x2="110"
                y2="116"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor="rgb(var(--wasta-ivory))" />
                <stop offset="100%" stopColor="rgb(var(--wasta-surface))" />
              </linearGradient>
            </defs>

            {/* The gold frame, on the forest, where the gold has contrast. */}
            <rect className="wasta-splash__frame" x="8" y="8" width="112" height="112" rx="34" />
            {/* The paper. */}
            <rect
              className="wasta-splash__badge"
              x="13"
              y="13"
              width="102"
              height="102"
              rx="29"
              fill={`url(#wasta-splash-badge-${uid})`}
            />
            <rect className="wasta-splash__hairline" x="19" y="19" width="90" height="90" rx="24" />

            {/* The woven second voice: the same line, a hair lower, in green. */}
            <path
              className="wasta-splash__stroke wasta-splash__stroke--weave"
              data-draw="weave"
              pathLength="1"
              d="M32 49 L45 89 L64 57 L83 89 L96 49"
            />
            {/* The monogram. */}
            <path
              className="wasta-splash__stroke wasta-splash__stroke--main"
              data-draw="main"
              pathLength="1"
              d="M32 44 L45 84 L64 52 L83 84 L96 44"
            />

            {/* The connection points. */}
            <circle className="wasta-splash__node" cx="32" cy="44" r="3.4" />
            <circle className="wasta-splash__node" cx="45" cy="84" r="2.4" />
            <circle className="wasta-splash__node wasta-splash__node--apex" cx="64" cy="52" r="4.6" />
            <circle className="wasta-splash__node" cx="83" cy="84" r="2.4" />
            <circle className="wasta-splash__node" cx="96" cy="44" r="3.4" />
            <circle className="wasta-splash__pulse" cx="64" cy="52" r="7" />
          </svg>
        </div>

        <div>
          <p className="text-xl font-extrabold tracking-tight text-wasta-ivory">{BRAND.name}</p>
          <p className="wasta-splash__tagline mt-1 text-2xs">{BRAND.shortLine}</p>
        </div>

        {/* The shelf: one gold block per milestone, lit by what the
            application has actually reported. */}
        <div className="wasta-splash__shelf" aria-hidden="true">
          <div className="wasta-splash__blocks">
            {SPLASH_STAGES.map((item, index) => (
              <span
                key={item.key}
                className="wasta-splash__block"
                data-active={index <= reached ? "true" : "false"}
                data-stage={item.key}
              />
            ))}
          </div>
          <span className="wasta-splash__rule" />
        </div>

        <div className="flex w-full flex-col gap-2">
          <div
            className="wasta-splash__track"
            data-mode={determinate ? "determinate" : "indeterminate"}
            data-complete={ready ? "true" : "false"}
            role="progressbar"
            aria-label={`${BRAND.name} is loading`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={determinate ? percent : undefined}
          >
            <div
              className="wasta-splash__fill"
              style={{ "--wasta-splash-progress": String(determinate ? percent / 100 : 0) }}
            />
          </div>

          <div className="flex min-h-[1.25rem] items-baseline justify-between gap-3">
            {/* The one live region on the screen. The bar carries the number,
                so the region carries the sentence and says it once. */}
            <p
              className="wasta-splash__status text-2xs font-medium"
              data-testid="boot-splash-status"
              role="status"
              aria-live="polite"
            >
              {stage.label}
            </p>
            {determinate && (
              <span
                className="wasta-splash__percent text-2xs font-semibold tabular-nums"
                data-testid="boot-splash-percent"
                aria-hidden="true"
              >
                {percent}%
              </span>
            )}
          </div>
        </div>

        <p className="wasta-splash__note text-2xs">{BRAND.noteLine}</p>
      </div>

      {showReplay && (
        <button
          type="button"
          onClick={replay}
          data-testid="boot-splash-replay"
          className="wasta-splash__replay rounded-full border px-4 py-2 text-2xs font-medium"
        >
          Replay loading
        </button>
      )}
    </div>
  );
}
