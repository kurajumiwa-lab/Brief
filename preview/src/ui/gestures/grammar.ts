// ---------------------------------------------------------------------------
// INTERACTION GRAMMAR — one vocabulary of touch, used by every reeling surface.
//
// The rule this file exists to enforce: Brief does not invent an interaction
// language, it borrows the one people already have in their hands. Horizontal
// is browse. Vertical is depth. A tap selects. A hold peeks. A swipe away is
// done with it. Those five verbs are already learned before anyone opens this
// app; the app's job is only to give them somewhere to land.
//
// The vocabulary (same everywhere, so nothing has to be taught):
//
//   ← / →    BROWSE     the next / previous thing in the set
//   ↑        DEEPER     there is more here than the card shows
//   ↓        BACK/DONE  in the detail: return to the set.
//                       in the set:   dealt with — it leaves the set
//   tap      ACT        select the thing under the finger
//   2× tap   QUICK      the one action the card really has, without opening it
//   hold     PEEK       examine it without leaving or changing anything
//
// Two properties make this honest rather than clever:
//
//   1. Nothing here decides what an action DOES. It returns an intent —
//      'browse' / 'open-detail' / 'dismiss' / 'act' — and the surface decides.
//      So the grammar can be shared without the screens becoming the same
//      screen, which is the difference between borrowing a physical language
//      and copying an app.
//   2. Every intent is reachable without a gesture: the same component exposes
//      prev/next buttons, an expand button, a dismiss button and a preview
//      that reveals nothing the detail does not also reveal. A finger is a
//      shortcut, never the only door.
//
// The numbers are thresholds on a fingertip, not decoration: `tapSlopPx` is
// the wobble a finger makes while standing still, `axisBias` is how much one
// axis must beat the other before it owns the gesture (without it, every
// diagonal drag is a coin toss between scrolling and browsing), and
// `flickVelocity` lets a fast flick commit with less distance than a slow
// deliberate drag.
// ---------------------------------------------------------------------------

export const GestureMetrics = {
  /** Movement under this is a tap, not a drag. */
  tapSlopPx: 10,
  /** A press held this long, without moving, is a peek. */
  holdMs: 320,
  /** Two taps on the same spot, within this long of each other, are one
   *  gesture — the card's quick action. Long enough for a deliberate second
   *  tap, short enough not to catch two separate decisions. */
  doubleTapMs: 280,
  /** Horizontal distance that commits to the next / previous item. */
  browseCommitPx: 52,
  /** Vertical distance that opens the detail (up) or returns from it (down). */
  depthCommitPx: 56,
  /** Vertical distance that puts an item away, from the set itself. Deliberately
   *  longer than the other thresholds: this one removes something. */
  dismissCommitPx: 96,
  /** How much one axis must outweigh the other before it owns the gesture. */
  axisBias: 1.15,
  /** px per ms. A flick commits early; a slow drag has to travel further. */
  flickVelocity: 0.45
} as const;

/** Where the surface is when the gesture starts. The only state the grammar
 *  needs: a downward swipe means two different things in two different places. */
export type GestureState = 'set' | 'detail';

export type GestureIntent =
  /** ← / → : move within the set */
  | { kind: 'browse'; direction: 'next' | 'prev' }
  /** ↑ : there is more here */
  | { kind: 'open-detail' }
  /** ↓ in the detail : back to the set */
  | { kind: 'close-detail' }
  /** ↓ in the set : dealt with, it leaves the set */
  | { kind: 'dismiss' }
  /** a tap : select the thing under the finger */
  | { kind: 'act' }
  /** two taps on the same spot : the one quick action the card really has */
  | { kind: 'quick' };

export interface GestureSample {
  /** Horizontal travel since the press, in px. Negative is left. */
  dx: number;
  /** Vertical travel since the press, in px. Negative is up. */
  dy: number;
  /** How long the press lasted, in ms. */
  ms: number;
}

export type GestureAxis = 'horizontal' | 'vertical';

function velocity(travel: number, ms: number): number {
  // A sample with no elapsed time carries no speed: zero, so distance alone
  // decides. Reporting "infinitely fast" there would turn every undated sample
  // into a flick, which is the opposite of the intent.
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.abs(travel) / ms;
}

/**
 * Which axis owns this movement, or null while it is still ambiguous. The bias
 * is what stops a diagonal drag from being a coin toss: a 30px-right / 28px-down
 * drag is a browse, a 28px-right / 30px-down drag is a scroll, and neither is
 * "whichever callback ran first".
 */
export function axisOf(dx: number, dy: number): GestureAxis | null {
  const x = Math.abs(dx);
  const y = Math.abs(dy);
  if (x === 0 && y === 0) return null;
  if (x > y * GestureMetrics.axisBias) return 'horizontal';
  if (y > x * GestureMetrics.axisBias) return 'vertical';
  return null;
}

/** True while the press is still a press and not yet a drag or a hold. */
export function isStill(sample: Pick<GestureSample, 'dx' | 'dy'>): boolean {
  return Math.hypot(sample.dx, sample.dy) <= GestureMetrics.tapSlopPx;
}

/** One completed tap, kept only so the next tap can be compared with it. */
export interface TapRecord {
  /** Where the finger was, in client coordinates. */
  x: number;
  y: number;
  /** When it lifted, in ms. */
  at: number;
}

/**
 * Two taps that mean one thing: the same spot, close together in time.
 *
 * Both halves are checked, because either one alone is wrong. Time alone makes
 * "tap the card, then tap its Save button" a quick action on whatever happened
 * to be under the second finger; distance alone makes two separate decisions a
 * minute apart into one.
 */
export function isDoubleTap(first: TapRecord, second: TapRecord): boolean {
  if (second.at - first.at > GestureMetrics.doubleTapMs) return false;
  return Math.hypot(second.x - first.x, second.y - first.y) <= GestureMetrics.tapSlopPx;
}

/** True when a press that has not moved should be treated as a peek. */
export function shouldPeek(sample: GestureSample): boolean {
  return isStill(sample) && sample.ms >= GestureMetrics.holdMs;
}

/**
 * The whole grammar in one function: what did the finger mean?
 *
 * Returns null for "not yet decided" — a nudge too small to commit, a diagonal
 * that belongs to neither axis, a press that ended before it was a hold. A
 * surface that receives null leaves its state exactly as it was, which is what
 * makes a half-swipe snap back instead of guessing.
 */
export function classifyGesture(sample: GestureSample, state: GestureState): GestureIntent | null {
  const { dx, dy, ms } = sample;

  // A press that barely moved is a tap — select, don't navigate.
  if (isStill(sample)) {
    // …unless it was held: a hold already opened the peek while the finger was
    // down, so lifting is the end of that, and never a surprise tap.
    return ms >= GestureMetrics.holdMs ? null : { kind: 'act' };
  }

  const axis = axisOf(dx, dy);
  if (axis === 'horizontal') {
    if (Math.abs(dx) >= GestureMetrics.browseCommitPx || velocity(dx, ms) >= GestureMetrics.flickVelocity) {
      return { kind: 'browse', direction: dx < 0 ? 'next' : 'prev' };
    }
    return null;
  }

  if (axis === 'vertical') {
    if (dy < 0) {
      // Up is always "deeper", wherever you are standing.
      if (-dy >= GestureMetrics.depthCommitPx || velocity(dy, ms) >= GestureMetrics.flickVelocity) {
        return { kind: 'open-detail' };
      }
      return null;
    }
    // Down. In the detail it is the way back; in the set it is the way out.
    if (state === 'detail') {
      return dy >= GestureMetrics.depthCommitPx || velocity(dy, ms) >= GestureMetrics.flickVelocity
        ? { kind: 'close-detail' }
        : null;
    }
    if (dy >= GestureMetrics.dismissCommitPx) return { kind: 'dismiss' };
    // A hard downward flick is a throw, even if it did not travel far.
    return velocity(dy, ms) >= GestureMetrics.flickVelocity * 1.4 ? { kind: 'dismiss' } : null;
  }

  // Diagonal, and neither axis has won. Nothing happens on purpose: doing
  // nothing is better than doing the wrong thing at speed.
  return null;
}

/**
 * Resistance at the ends of a set. Dragging past the first or the last item
 * moves a fraction of the finger's distance, so the set feels bounded instead
 * of broken — the difference between "there is nothing there" and "the screen
 * ignored me".
 */
export function withResistance(offset: number, hasMore: boolean): number {
  if (hasMore) return offset;
  return Math.sign(offset) * Math.pow(Math.abs(offset), 0.6) * 1.4;
}

/** How far the deck travels per pixel dragged on each axis, so the picture
 *  follows the finger instead of lagging behind it or racing it. */
export const DragFollow = {
  horizontal: 1,
  /** Vertical drags move less: the card grows upward, it does not slide away. */
  vertical: 0.55
} as const;

/** The share of the commit distance travelled — what a surface draws while a
 *  gesture is in flight (the ring around a held card, the tint of a dismiss). */
export function commitProgress(
  axis: GestureAxis,
  sample: Pick<GestureSample, 'dx' | 'dy'>,
  state: GestureState
): number {
  if (axis === 'horizontal') {
    return Math.min(1, Math.abs(sample.dx) / GestureMetrics.browseCommitPx);
  }
  if (sample.dy < 0) return Math.min(1, -sample.dy / GestureMetrics.depthCommitPx);
  const limit = state === 'detail' ? GestureMetrics.depthCommitPx : GestureMetrics.dismissCommitPx;
  return Math.min(1, sample.dy / limit);
}
