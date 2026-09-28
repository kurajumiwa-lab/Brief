// ---------------------------------------------------------------------------
// useGestureSurface — the grammar from `grammar.ts`, wired to a real finger.
//
// This hook owns the messy parts that a gesture has and a screenshot does not:
// the wobble of a fingertip, the finger that lifts mid-drag, the second finger
// that arrives uninvited, the diagonal that belongs to neither axis, and the
// press that turns into a hold while the user is still deciding.
//
// What it does NOT own: what any of it means. It calls back with an intent and
// a live offset, and the surface decides. That is the whole point of a shared
// grammar — one vocabulary, many screens.
//
// Rules it keeps:
//   * A gesture never starts on a control that has its own job. Anything
//     marked `data-gesture-static` (a button, a link, an input) is left alone,
//     so "swipe the card" can never eat "press the button".
//   * One pointer. A second finger during a drag is ignored rather than
//     fighting the first for the offset.
//   * Losing the pointer (cancel, blur, unmount) resets to rest. A stuck
//     half-open drag is how a deck ends up frozen mid-air after a phone call.
//   * The peek is a hold, not a hover: it opens while the finger is down and
//     closes when it lifts, and the lift is not also a tap.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DragFollow,
  GestureMetrics,
  axisOf,
  classifyGesture,
  commitProgress,
  isStill,
  withResistance
} from './grammar';
import type { GestureAxis, GestureIntent, GestureState } from './grammar';

export interface GestureSurfaceOptions {
  /** Where the surface is standing. A downward swipe means two things. */
  state: GestureState;
  onIntent: (intent: GestureIntent) => void;
  /** A still press that lasted `holdMs`: open the peek; lifting closes it. */
  onPeek?: (phase: 'start' | 'end') => void;
  /** Whether there is anything to browse to, per direction. Used only for the
   *  resistance at the ends — the intent is still reported, the sets decide. */
  canBrowse?: { next: boolean; prev: boolean };
  /** Off for a surface that should only be driven by its own buttons. */
  enabled?: boolean;
}

export interface GestureDrag {
  axis: GestureAxis | null;
  /** Travel since the press, in px. Negative x is left, negative y is up. */
  dx: number;
  dy: number;
  /** The same travel as the surface should DRAW it: follow + end resistance. */
  x: number;
  y: number;
  /** 0…1, how far towards committing on the locked axis. */
  progress: number;
  dragging: boolean;
  peeking: boolean;
}

interface Press {
  active: boolean;
  pointerId: number | null;
  x0: number;
  y0: number;
  t0: number;
  axis: GestureAxis | null;
  peeked: boolean;
  holdTimer: ReturnType<typeof setTimeout> | null;
}

const NO_PRESS: Press = { active: false, pointerId: null, x0: 0, y0: 0, t0: 0, axis: null, peeked: false, holdTimer: null };
const AT_REST: GestureDrag = { axis: null, dx: 0, dy: 0, x: 0, y: 0, progress: 0, dragging: false, peeking: false };

export interface GestureSurfaceHandlers {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  onPointerCancel: (event: React.PointerEvent) => void;
  onLostPointerCapture?: (event: React.PointerEvent) => void;
}

export function useGestureSurface({
  state,
  onIntent,
  onPeek,
  canBrowse = { next: true, prev: true },
  enabled = true
}: GestureSurfaceOptions): { handlers: GestureSurfaceHandlers; drag: GestureDrag; end: () => void; wasGesture: () => boolean } {
  const [drag, setDrag] = useState<GestureDrag>(AT_REST);

  const press = useRef<Press>({ ...NO_PRESS });
  /** Whether the press that just ended was a real gesture (a drag or a hold)
   *  rather than a tap. A browser still fires `click` after a mouse drag, and a
   *  surface that acts on tap must not act on the echo of a swipe. */
  const lastWasGesture = useRef(false);

  // The callbacks are read through refs so a re-render never restarts a drag
  // that is already in flight.
  const intentRef = useRef(onIntent);
  intentRef.current = onIntent;
  const peekRef = useRef(onPeek);
  peekRef.current = onPeek;
  const canBrowseRef = useRef(canBrowse);
  canBrowseRef.current = canBrowse;
  const stateRef = useRef(state);
  stateRef.current = state;

  const clearHold = () => {
    if (press.current.holdTimer !== null) {
      clearTimeout(press.current.holdTimer);
      press.current.holdTimer = null;
    }
  };

  /** Everything back to rest, releasing a peek if one is open. Safe to call at
   *  any time — unmount, cancel, or after an intent has been delivered. */
  const end = useCallback(() => {
    clearHold();
    const peeked = press.current.peeked;
    press.current = { ...NO_PRESS };
    setDrag(AT_REST);
    if (peeked) peekRef.current?.('end');
  }, []);

  useEffect(() => end, [end]);

  const ownsPointer = (event: React.PointerEvent): boolean => {
    const id = typeof event.pointerId === 'number' ? event.pointerId : null;
    return id === null || press.current.pointerId === null || id === press.current.pointerId;
  };

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (!enabled) return;
    // Left button, or a finger. A right-click is a context menu, not a swipe.
    if (typeof event.button === 'number' && event.button > 0) return;
    if (event.isPrimary === false) return;
    const target = event.target as Element | null;
    if (target && typeof target.closest === 'function' && target.closest('[data-gesture-static]')) return;
    if (press.current.active) return; // one pointer at a time
    lastWasGesture.current = false;

    press.current = {
      active: true,
      pointerId: typeof event.pointerId === 'number' ? event.pointerId : null,
      x0: event.clientX,
      y0: event.clientY,
      t0: Date.now(),
      axis: null,
      peeked: false,
      holdTimer: null
    };

    // Capture so the drag survives the finger leaving the card. Absent in
    // jsdom and on old browsers; the pointercancel path covers those.
    try { (event.currentTarget as Element)?.setPointerCapture?.(event.pointerId); } catch { /* not fatal */ }

    press.current.holdTimer = setTimeout(() => {
      if (!press.current.active) return;
      press.current.peeked = true;
      setDrag((d) => ({ ...d, peeking: true }));
      peekRef.current?.('start');
    }, GestureMetrics.holdMs);
  }, [enabled]);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const now = press.current;
    if (!now.active || !ownsPointer(event)) return;

    const dx = event.clientX - now.x0;
    const dy = event.clientY - now.y0;

    // A hold that has opened its peek stays open: the finger moving now is the
    // same finger, and turning a peek into a drag would fling the card out from
    // under someone who was only looking.
    if (now.peeked) return;

    if (now.axis === null) {
      if (isStill({ dx, dy })) return;
      const axis = axisOf(dx, dy);
      if (!axis) return; // diagonal and undecided: no axis owns this yet
      now.axis = axis;
      clearHold(); // it is a drag, so it is not a hold
    }

    if (now.axis === 'horizontal') {
      const more = dx < 0 ? canBrowseRef.current.next : canBrowseRef.current.prev;
      setDrag({
        ...AT_REST,
        axis: 'horizontal',
        dx,
        dy,
        x: withResistance(dx * DragFollow.horizontal, more),
        y: 0,
        dragging: true,
        progress: commitProgress('horizontal', { dx, dy }, stateRef.current)
      });
    } else {
      setDrag({
        ...AT_REST,
        axis: 'vertical',
        dx,
        dy,
        x: 0,
        y: dy * DragFollow.vertical,
        dragging: true,
        progress: commitProgress('vertical', { dx, dy }, stateRef.current)
      });
    }

    // The card owns the finger now, so the page must not also be scrolling
    // under it. `touch-action` in CSS does most of this; this is the belt.
    if (event.cancelable) event.preventDefault();
  }, []);

  const finish = useCallback((event: React.PointerEvent | null, cancelled: boolean) => {
    const now = press.current;
    if (!now.active) return;
    if (event && !ownsPointer(event)) return;

    clearHold();
    const peeked = now.peeked;
    const sample = event && !cancelled
      ? { dx: event.clientX - now.x0, dy: event.clientY - now.y0, ms: Date.now() - now.t0 }
      : null;
    lastWasGesture.current = Boolean(peeked || now.axis);

    press.current = { ...NO_PRESS };
    setDrag(AT_REST);
    if (peeked) peekRef.current?.('end');
    if (cancelled || !sample || peeked) return;
    const intent = classifyGesture(sample, stateRef.current);
    if (intent) intentRef.current(intent);
  }, []);

  return {
    drag,
    end,
    /** True when the press that just ended was a swipe or a hold, so the click
     *  the browser fires afterwards is an echo and not a selection. */
    wasGesture: () => lastWasGesture.current,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event) => finish(event, false),
      onPointerCancel: (event) => finish(event, true),
      onLostPointerCapture: (event) => finish(event, true)
    }
  };
}
