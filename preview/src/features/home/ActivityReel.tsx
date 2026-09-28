// ---------------------------------------------------------------------------
// ACTIVITY REEL — "Latest activity" as a stream you move through, not a list
// you scroll.
//
// The point is not a new interaction language: the physics are the ones
// people already learned elsewhere (browsing cards, expanding a story,
// dismissing a feed). What is ours is the CONSISTENT grammar:
//
//   horizontal swipe  /  ← →        move between items     "I'm browsing"
//   vertical swipe ↑  /  tap        open the full item     "there is more"
//   hold              /  P          quick preview          "peek, don't leave"
//   tap the edges                   previous / next item   "precise navigation"
//   double tap        /  S          save for later         "this is an action"
//   swipe down        /  Esc        back to the reel       "done here"
//   moving on                         the item you leave fades to "seen"
//
// Once every item is seen, the shelf folds itself into a quiet history strip
// with one Replay — the familiarity of a vanished story without pretending to
// be one. Content supplies the excitement; the vocabulary stays the same.
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Check, Heart, Package, RotateCcw, X } from 'lucide-react';
import * as api from '../../api/briefApi';
import type { DiscoverFeedItem } from '../../api/briefApi';
import { NoPhotoPlate } from '../city/NoPhotoPlate';
import { PHOTO_FILTER, listedAgo } from '../city/room';
import { soundEngine } from '../../utils/SoundEngine';
import '../../ui/reel.css';

const GAP_PX = 12;
const EDGE_TAP = 0.2;            // outer 20% of a card = prev / next
const HOLD_MS = 480;             // hold → quick preview
const DOUBLE_TAP_MS = 300;       // two taps → save, not open
const OPEN_DELAY_MS = 280;       // what makes double-tap possible without a flash
const OPEN_DRAG_PX = 76;         // vertical drag that opens the full item
const FLING_VELOCITY = 0.5;      // px/ms that counts as a fling
const CLOSE_DRAG_PX = 90;        // expanded: drag down that dismisses
const SEEN_KEY = 'brief_reel_seen_v1';
const SAVED_KEY = 'brief_reel_saved_v1';

type StoreMap = Record<string, number>;
function readStore(key: string): StoreMap {
  try { return JSON.parse(window.localStorage.getItem(key) || '{}') as StoreMap; }
  catch { return {}; }
}
function writeStore(key: string, map: StoreMap): void {
  try { window.localStorage.setItem(key, JSON.stringify(map)); } catch { /* private mode: session only */ }
}

interface DragState {
  pointerId: number;
  startX: number; startY: number;
  lastX: number; lastY: number; lastT: number;
  dx: number; dy: number; velocity: number;
  intent: 'none' | 'h' | 'v';
  slotW: number;
  /** The card the gesture started on — a swipe up on the peeking card opens
      THAT item, not the one that happens to be active. */
  startIdx: number;
  holdTimer: number | null;
  holdFired: boolean;
  moved: boolean;
}

/** Story-style position bar: seen = full, viewing = half, ahead = empty. */
function Segments({ items, index, seen, className = '' }: {
  items: DiscoverFeedItem[]; index: number; seen: Set<string>; className?: string;
}) {
  return (
    <div className={`reel-progress ${className}`} data-testid="reel-progress" aria-hidden="true">
      {items.map((it, i) => (
        <span key={it.id} className={`reel-seg ${i === index ? 'is-active' : ''} ${seen.has(it.id) ? 'is-seen' : ''}`}>
          <span className="reel-seg-fill" />
        </span>
      ))}
    </div>
  );
}

function factsOf(item: DiscoverFeedItem): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['price', item.priceLabel ?? 'not stated'],
    ['where', item.location ?? 'no place given'],
    ['when', item.dateLabel ?? 'no date given'],
  ];
  if (item.kind === 'event') {
    if (item.seller) rows.push(['hosted by', item.seller]);
    if (item.recurrence?.ruleText) rows.push(['repeats', item.recurrence.ruleText]);
  } else {
    if (item.seller) rows.push(['seller', item.seller]);
    if (item.origin) rows.push(['from', item.origin + (item.originKind ? ` (${item.originKind})` : '')]);
    if (item.destination) rows.push(['to', item.destination + (item.destinationKind ? ` (${item.destinationKind})` : '')]);
    if (item.minOrder) rows.push(['minimum', `${item.minOrder}${item.unit ? ` ${item.unit}` : ''}`]);
    if (item.commodity) rows.push(['commodity', item.commodity]);
  }
  return rows.slice(0, 6);
}

export interface ActivityReelProps {
  /** Already filtered and bounded by the parent (max 5). */
  items: DiscoverFeedItem[];
  /** The item's one real action: events go to Wanderly, offers to the shared sheet. */
  onOpenFull: (item: DiscoverFeedItem) => void;
}

export function ActivityReel({ items, onOpenFull }: ActivityReelProps) {
  const [index, setIndex] = useState(0);
  const [settling, setSettling] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  /** Which card is holding open its quick preview (null = none). */
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [seenMap, setSeenMap] = useState<StoreMap>(() => readStore(SEEN_KEY));
  const [savedMap, setSavedMap] = useState<StoreMap>(() => readStore(SAVED_KEY));
  const [burst, setBurst] = useState<{ id: string; t: number } | null>(null);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const cardEls = useRef<Array<HTMLDivElement | null>>([]);
  const scrimPreviewRef = useRef<HTMLDivElement | null>(null);
  const expandedRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const exDragRef = useRef<{ y: number; lastY: number; lastT: number; v: number; dy: number } | null>(null);
  const settleTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const pendingOpenRef = useRef<{ t: number; x: number; y: number; timer: number } | null>(null);
  const consumedClickRef = useRef(false);
  const touchBlockRef = useRef<((e: TouchEvent) => void) | null>(null);

  const n = items.length;
  const seen = new Set(Object.keys(seenMap));
  const allSeen = n > 0 && items.every((it) => seen.has(it.id));
  const active = items[Math.min(index, n - 1)] ?? null;

  // ── persistence ──────────────────────────────────────────────────────────
  useEffect(() => { writeStore(SEEN_KEY, seenMap); }, [seenMap]);
  useEffect(() => { writeStore(SAVED_KEY, savedMap); }, [savedMap]);

  // ── the track's resting position (imperative: never through React state) ─
  const reposition = useCallback((toIndex: number, offsetDx = 0) => {
    const track = trackRef.current;
    const slot = cardEls.current[toIndex];
    if (!track || !slot) return;
    const slotW = slot.getBoundingClientRect().width || 0;
    track.style.transform = `translateX(${-(toIndex * (slotW + GAP_PX)) + offsetDx}px)`;
  }, []);
  useLayoutEffect(() => {
    if (!dragRef.current) reposition(index);
  }, [index, n, reposition]);

  // A new set of items (new filter, new feed) starts the reel at the front.
  const itemsKey = items.map((i) => i.id).join('|');
  const prevKeyRef = useRef(itemsKey);
  useEffect(() => {
    if (prevKeyRef.current !== itemsKey) {
      prevKeyRef.current = itemsKey;
      setIndex(0);
      setExpanded(false);
      setPreviewIdx(null);
    }
  }, [itemsKey]);
  useEffect(() => {
    if (index > n - 1) setIndex(Math.max(0, n - 1));
  }, [index, n]);

  useEffect(() => () => {
    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    if (pendingOpenRef.current) window.clearTimeout(pendingOpenRef.current.timer);
  }, []);

  // ── seen / saved ─────────────────────────────────────────────────────────
  const markSeen = useCallback((id: string) => {
    setSeenMap((prev) => (prev[id] ? prev : { ...prev, [id]: Date.now() }));
  }, []);
  const toggleSave = useCallback((id: string) => {
    setSavedMap((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id]; else next[id] = Date.now();
      return next;
    });
    setBurst({ id, t: Date.now() });
  }, []);
  useEffect(() => {
    if (!burst) return;
    const t = window.setTimeout(() => setBurst(null), 800);
    return () => window.clearTimeout(t);
  }, [burst]);

  // ── navigation ──────────────────────────────────────────────────────────
  const goto = useCallback((to: number) => {
    if (!n) return;
    const clamped = Math.max(0, Math.min(n - 1, to));
    if (clamped === index) return;
    if (clamped > index) markSeen(items[index].id); // leaving forward = dealt with
    setIndex(clamped);
  }, [n, index, items, markSeen]);

  const settle = useCallback((toIndex: number) => {
    if (toIndex > index) markSeen(items[index].id); // moving on = dealt with
    setSettling(true);
    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      setSettling(false);
      reposition(toIndex);
      settleTimer.current = null;
    }, 360);
    setIndex(toIndex);
    reposition(toIndex);
  }, [reposition, index, items, markSeen]);

  const openItem = useCallback((at?: number) => {
    const to = at ?? index;
    const it = items[to];
    if (!it) return;
    if (to > index) markSeen(items[index].id); // leaving forward, same as a swipe
    setIndex(to);
    setPreviewIdx(null);
    setExpanded(true);
    soundEngine.play('tap');
  }, [items, index, markSeen]);

  const closeExpanded = useCallback((animated = true) => {
    if (!expanded) return;
    markSeen(active.id); // it has now been properly viewed
    if (!animated) { setExpanded(false); setClosing(false); return; }
    setClosing(true);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setExpanded(false);
      setClosing(false);
      closeTimer.current = null;
    }, 200);
  }, [expanded, active, markSeen]);

  const onCta = useCallback(() => {
    if (!active) return;
    soundEngine.play('tap');
    const it = active;
    markSeen(it.id);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setExpanded(false);
    setClosing(false);
    onOpenFull(it);
  }, [active, markSeen, onOpenFull]);

  const replay = useCallback(() => {
    setSeenMap((prev) => {
      const next = { ...prev };
      for (const it of items) delete next[it.id];
      return next;
    });
    setIndex(0);
    soundEngine.play('tap');
  }, [items]);

  // ── card gestures: horizontal browse, vertical open, hold to preview ─────
  const beginDrag = (e: React.PointerEvent<HTMLDivElement>, i: number) => {
    if (dragRef.current) return;
    const rect = (cardEls.current[i] ?? e.currentTarget).getBoundingClientRect();
    const slotW = rect.width || 0;
    const holdTimer = window.setTimeout(() => {
      const d = dragRef.current;
      if (d && !d.moved) { d.holdFired = true; setPreviewIdx(i); }
    }, HOLD_MS);
    dragRef.current = {
      pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
      lastX: e.clientX, lastY: e.clientY, lastT: performance.now(),
      dx: 0, dy: 0, velocity: 0, intent: 'none', slotW, startIdx: i,
      holdTimer, holdFired: false, moved: false,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // Touch: the browser owns vertical scroll (touch-action: pan-y). A
    // deliberate upward swipe on a card must win, so block scroll only after
    // vertical intent is unambiguous.
    if (e.pointerType === 'touch') {
      const block = (te: TouchEvent) => {
        const d = dragRef.current;
        if (d && d.intent === 'v' && d.dy < 0) te.preventDefault();
      };
      touchBlockRef.current = block;
      window.addEventListener('touchmove', block, { passive: false });
    }
  };

  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const now = performance.now();
    if (now - d.lastT > 0) {
      d.velocity = (d.intent === 'v' ? (e.clientY - d.lastY) : (e.clientX - d.lastX)) / (now - d.lastT);
      d.lastX = e.clientX; d.lastY = e.clientY; d.lastT = now;
    }
    if (d.intent === 'none') {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (d.holdTimer) window.clearTimeout(d.holdTimer);
      d.moved = true;
      d.intent = Math.abs(dy) > Math.abs(dx) * 1.15 ? 'v' : 'h';
      setSettling(false);
    }
    d.dx = dx; d.dy = dy;
    if (d.intent === 'h') {
      const atEdge = (index === 0 && dx > 0) || (index === n - 1 && dx < 0);
      const offset = atEdge ? dx * 0.35 : dx; // rubber band at the ends
      const track = trackRef.current;
      if (track) track.style.transform = `translateX(${-(index * (d.slotW + GAP_PX)) + offset}px)`;
    } else if (d.intent === 'v' && dy < 0) {
      const card = cardEls.current[d.startIdx];
      if (card) card.style.transform = `translateY(${dy * 0.92}px) scale(${1 + Math.min(0.03, -dy / 5000)})`;
      if (scrimPreviewRef.current) scrimPreviewRef.current.style.opacity = String(Math.min(0.55, -dy / 300));
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    dragRef.current = null;
    if (d.holdTimer) window.clearTimeout(d.holdTimer);
    if (touchBlockRef.current) {
      window.removeEventListener('touchmove', touchBlockRef.current);
      touchBlockRef.current = null;
    }
    const card = cardEls.current[d.startIdx];
    if (card) {
      if (d.intent === 'v') {
        // Spring the card home instead of snapping it.
        card.style.transition = 'transform 300ms var(--ease-emphasized)';
        requestAnimationFrame(() => { card.style.transform = ''; });
        window.setTimeout(() => { card.style.transition = ''; }, 320);
      } else {
        card.style.transform = '';
      }
    }
    const scrim = scrimPreviewRef.current;
    if (scrim) {
      if (parseFloat(scrim.style.opacity || '0') > 0) {
        scrim.style.transition = 'opacity 250ms var(--ease-standard)';
        scrim.style.opacity = '0';
        window.setTimeout(() => { scrim.style.transition = ''; }, 260);
      } else {
        scrim.style.opacity = '0';
      }
    }
    if (d.holdFired) { setPreviewIdx(null); consumedClickRef.current = true; return; }
    if (d.moved) {
      // A real drag: swallow the click the browser will still dispatch.
      consumedClickRef.current = true;
      if (d.intent === 'h') {
        const jump = Math.max(60, d.slotW * 0.24);
        if (d.dx < -jump || d.velocity < -FLING_VELOCITY) { settle(index + 1); soundEngine.play('tap'); }
        else if (d.dx > jump || d.velocity > FLING_VELOCITY) settle(index - 1);
        else settle(index);
      } else if (d.intent === 'v' && (d.dy < -OPEN_DRAG_PX || (d.velocity < -FLING_VELOCITY && d.dy < -36))) {
        openItem(d.startIdx);
      } else {
        reposition(index);
      }
    }
    // !d.moved: a plain tap — the click event carries the tap grammar.
  };

  // ── tap grammar: edges navigate, center opens, double-tap saves ──────────
  const onCardClick = (e: React.MouseEvent<HTMLDivElement>, item: DiscoverFeedItem, i: number) => {
    if (consumedClickRef.current) { consumedClickRef.current = false; return; }
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width > 0) {
      const rel = (e.clientX - rect.left) / rect.width;
      if (rel < EDGE_TAP) { goto(i - 1); return; }
      if (rel > 1 - EDGE_TAP) { goto(i + 1); return; }
    }
    const now = Date.now();
    const p = pendingOpenRef.current;
    if (p && now - p.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 24) {
      window.clearTimeout(p.timer);
      pendingOpenRef.current = null;
      toggleSave(item.id);
      return;
    }
    if (p) window.clearTimeout(p.timer);
    pendingOpenRef.current = {
      t: now, x: e.clientX, y: e.clientY,
      timer: window.setTimeout(() => { pendingOpenRef.current = null; openItem(); }, OPEN_DELAY_MS),
    };
  };

  const onReelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!active) return;
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); goto(index + 1); break;
      case 'ArrowLeft': e.preventDefault(); goto(index - 1); break;
      case 'ArrowUp': case 'Enter': case ' ':
        e.preventDefault();
        if (!expanded) openItem();
        break;
      case 'p': case 'P': setPreviewIdx((v) => (v === index ? null : index)); break;
      case 's': case 'S': toggleSave(active.id); break;
    }
  };

  const onExpandedKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!active) return;
    switch (e.key) {
      case 'Escape': case 'ArrowDown': e.preventDefault(); closeExpanded(); break;
      case 'ArrowRight': e.preventDefault(); goto(index + 1); break;
      case 'ArrowLeft': e.preventDefault(); goto(index - 1); break;
      case 's': case 'S': toggleSave(active.id); break;
    }
  };

  // Expanded: focus, scroll lock, Escape from anywhere.
  useEffect(() => {
    if (!expanded) return;
    expandedRef.current?.focus();
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeExpanded(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.documentElement.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [expanded, closeExpanded]);

  // ── expanded-view drag: swipe down returns to the reel ───────────────────
  const onExpandedPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return; // controls keep their own gestures
    exDragRef.current = { y: e.clientY, lastY: e.clientY, lastT: performance.now(), v: 0, dy: 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onExpandedPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = exDragRef.current;
    if (!d) return;
    const now = performance.now();
    if (now - d.lastT > 0) { d.v = (e.clientY - d.lastY) / (now - d.lastT); d.lastY = e.clientY; d.lastT = now; }
    d.dy = Math.max(0, e.clientY - d.y);
    // The panel is centered by flex, not left:50% — translate vertically only.
    if (d.dy > 0 && expandedRef.current) expandedRef.current.style.transform = `translateY(${d.dy * 0.85}px)`;
  };
  const onExpandedPointerUp = () => {
    const d = exDragRef.current;
    exDragRef.current = null;
    const el = expandedRef.current;
    if (!d) return;
    if (d.v > FLING_VELOCITY || d.dy > CLOSE_DRAG_PX) {
      closeExpanded(); // dismissed: it has been viewed
    } else if (el) {
      // Short pull: spring the panel home, it stays open.
      el.style.transition = 'transform 300ms var(--ease-emphasized)';
      requestAnimationFrame(() => { el.style.transform = ''; });
      window.setTimeout(() => { el.style.transition = ''; }, 320);
    }
  };

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <div className="reel" data-testid="activity-reel" role="region"
      aria-roledescription="activity reel" aria-label="Latest activity reel"
      onKeyDown={onReelKeyDown}>
      <div className="reel-scrim-preview" ref={scrimPreviewRef} aria-hidden="true" />

      {allSeen ? (
        /* Every item dealt with: the shelf folds into its own history. */
        <div className="reel-history" data-testid="reel-history">
          {items.map((it) => (
            <button type="button" key={it.id} className="reel-history-item"
              onClick={() => { soundEngine.play('tap'); setIndex(items.findIndex((x) => x.id === it.id)); setExpanded(true); }}
              aria-label={`${it.title}, seen — open again`}>
              <span className="reel-history-thumb">
                {it.mediaUrl ? <img src={api.mediaFileUrl(it.mediaUrl)} alt="" style={{ filter: PHOTO_FILTER }} />
                  : (it.kind === 'event' ? <CalendarDays size={16} /> : <Package size={16} />)}
              </span>
              <span className="reel-history-title">{it.title}</span>
              <span className="reel-history-stamp">Seen</span>
            </button>
          ))}
          <button type="button" className="reel-replay compact-primary" data-testid="reel-replay" onClick={replay}>
            <RotateCcw size={13} /> Replay reel
          </button>
        </div>
      ) : (
        <>
          <div className="reel-progress-row">
            <Segments items={items} index={index} seen={seen} />
            <span className="reel-count" data-testid="reel-count">{index + 1} of {n}</span>
          </div>
          <div className="reel-viewport">
            <div className={`reel-track ${settling ? 'is-settling' : ''}`} ref={trackRef}>
              {items.map((item, i) => {
                const isSeen = seen.has(item.id);
                const isActive = i === index;
                return (
                  <div className="reel-slot" key={item.id}>
                    <div
                      className={`reel-card ${isActive ? 'is-active' : ''} ${isSeen ? 'is-seen' : ''}`}
                      role="button" tabIndex={0} data-item-id={item.id}
                      data-active={isActive ? 'true' : undefined}
                      aria-label={`${item.title}, ${item.kind === 'event' ? 'event' : 'offer'}, item ${i + 1} of ${n}`}
                      ref={(el) => { cardEls.current[i] = el; }}
                      onPointerDown={(e) => beginDrag(e, i)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      onClick={(e) => onCardClick(e, item, i)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openItem(); }
                      }}>
                      <div className="reel-card-media">
                        {item.mediaUrl ? (
                          <img src={api.mediaFileUrl(item.mediaUrl)} alt="" style={{ filter: PHOTO_FILTER }} />
                        ) : (
                          <NoPhotoPlate seller={item.seller}
                            mark={item.kind === 'event' ? 'Event' : (item.flow ?? 'Offer')}
                            icon={item.kind === 'event' ? <CalendarDays size={15} /> : <Package size={15} />}
                            stamp={item.kind === 'listing' ? listedAgo(item.listedAt) : null} />
                        )}
                        {isSeen && <span className="reel-seen-stamp">Seen</span>}
                        <button type="button" className="reel-save-corner" data-testid={`reel-save-${i}`}
                          aria-pressed={Boolean(savedMap[item.id])}
                          aria-label={savedMap[item.id] ? `Unsave ${item.title}` : `Save ${item.title}`}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); toggleSave(item.id); }}>
                          <Heart size={15} fill={savedMap[item.id] ? 'currentColor' : 'none'} />
                        </button>
                      </div>
                      <div className="reel-card-body">
                        <span className="reel-card-kind">{item.kind === 'event' ? 'Event' : 'Offer'}</span>
                        <h3 className="reel-card-title">{item.title}</h3>
                        <p className="reel-card-facts">
                          {[item.priceLabel, item.location, item.dateLabel].filter(Boolean).join('  ·  ') || 'Details inside'}
                        </p>
                        {isActive && !isSeen && (
                          <p className="reel-hints" aria-hidden="true">
                            <span>Swipe ↑ for details</span>
                            <span>Swipe ← → to browse</span>
                          </p>
                        )}
                      </div>
                      {previewIdx === i && (
                        <div className="reel-peek" data-testid="reel-peek" role="status">
                          <dl>
                            {factsOf(item).map(([k, v]) => (
                              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                            ))}
                          </dl>
                          {item.why && <p className="reel-peek-why">{item.why}</p>}
                          <small>Release to close</small>
                        </div>
                      )}
                      {burst && burst.id === item.id && (
                        <span className="reel-burst" key={burst.t} aria-hidden="true"><Heart size={34} fill="currentColor" /></span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      <span className="reel-live" role="status" aria-live="polite">
        {active && !allSeen ? `${active.title} — item ${index + 1} of ${n}` : allSeen ? 'All activity seen' : ''}
      </span>

      {expanded && active && createPortal(
        <div className="reel-scrim" data-testid="reel-scrim"
          onClick={(e) => { if (e.target === e.currentTarget) closeExpanded(); }}>
          <div
            ref={expandedRef}
            className={`reel-expanded ${closing ? 'is-closing' : ''}`}
            data-testid="reel-expanded"
            role="dialog" aria-modal="true" aria-label={active.title}
            tabIndex={-1}
            onKeyDown={onExpandedKeyDown}
            onPointerDown={onExpandedPointerDown}
            onPointerMove={onExpandedPointerMove}
            onPointerUp={onExpandedPointerUp}
            onPointerCancel={onExpandedPointerUp}>
            <div className="reel-expanded-top">
              <Segments items={items} index={index} seen={seen} className="is-small" />
              <span className="reel-count">{index + 1} of {n}</span>
              <button type="button" className="reel-expanded-close" data-testid="reel-close"
                aria-label="Back to reel" onClick={() => closeExpanded()}>
                <X size={16} />
              </button>
            </div>
            <div className="reel-expanded-media">
              {active.mediaUrl ? (
                <img src={api.mediaFileUrl(active.mediaUrl)} alt="" style={{ filter: PHOTO_FILTER }} />
              ) : (
                <NoPhotoPlate seller={active.seller}
                  mark={active.kind === 'event' ? 'Event' : (active.flow ?? 'Offer')}
                  icon={active.kind === 'event' ? <CalendarDays size={18} /> : <Package size={18} />}
                  stamp={active.kind === 'listing' ? listedAgo(active.listedAt) : null}
                  quiet />
              )}
            </div>
            <div className="reel-expanded-body">
              <div className="reel-chips">
                <span className="reel-chip">{active.kind === 'event' ? 'Event' : (active.flow ?? 'Offer')}</span>
                {active.kind === 'event' && active.seller && (
                  <span className="reel-chip-soft">Hosted by {active.seller}</span>
                )}
                {active.kind === 'listing' && active.seller && (
                  <span className="reel-chip-soft">from {active.seller}</span>
                )}
              </div>
              <h2 className="reel-expanded-title">{active.title}</h2>
              {active.description && <p className="reel-expanded-desc">{active.description}</p>}
              <dl className="reel-facts">
                {factsOf(active).map(([k, v]) => (
                  <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                ))}
              </dl>
              {active.why && <p className="reel-why">{active.why} — by a stated rule, not a ranking.</p>}
              <div className="reel-actions">
                <button type="button" className="compact-primary reel-action-primary" data-testid="reel-open" onClick={onCta}>
                  {active.kind === 'event' ? 'Get ticket' : 'Open offer'}
                </button>
                <button type="button" className="reel-action-save" data-testid="reel-save"
                  aria-pressed={Boolean(savedMap[active.id])}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); toggleSave(active.id); }}>
                  {savedMap[active.id] ? <Check size={15} /> : <Heart size={15} />}
                  {savedMap[active.id] ? 'Saved' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
