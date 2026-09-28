// ---------------------------------------------------------------------------
// ACTIVITY REEL — Latest activity as a stream, not a list.
//
// The panel used to be five grey rows with a chevron on each. Rows are a
// reading shape: they say "here is a record". What is actually happening
// around you is a stream, and a stream is a shape people already know how to
// hold: one thing at a time, sideways for the next, up for the rest of it.
//
// So the words on the screen are the board's own — title, price, place, date,
// the seller's name, and the reason this row is here — and the language is the
// one every phone taught the user: HORIZONTAL IS BROWSE. VERTICAL IS DEPTH.
// TAP SELECTS. HOLD PEEKS. SWIPE AWAY IS DONE WITH IT. (ui/gestures/grammar.ts
// holds that vocabulary; this file is one surface speaking it.)
//
// Four rules keep it from becoming a toy:
//
//   1. Every gesture has a visible, labelled twin. Prev/next, Details, Save,
//      Not for me, Close are all real buttons — a finger is a shortcut, never
//      the only door, and nothing is discoverable ONLY by swiping.
//   2. It is a stream of the SAME rows the board hands out. The reel invents
//      nothing: no counts, no crowd, no "trending". If the board says a listing
//      is the newest live one, the reel repeats that sentence and attributes it.
//   3. An action is offered only where it can land. "Save" and "Not for me" are
//      keyed by an object id; a row with no object gets neither, rather than a
//      button that 404s. (That is why the server sends `objectId`.)
//   4. What is remembered is described in the words it deserves. A save and a
//      "not for me" are server rows and survive a reload on any device. "Seen"
//      and a hide with no object behind it are THIS DEVICE's memory, and the
//      reel says so instead of implying a preference it cannot keep.
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp, Bookmark, CalendarDays, ChevronLeft, ChevronRight,
  MapPin, MessageCircle, Package, RotateCcw, X
} from 'lucide-react';
import * as api from '../../api/briefApi';
import type { DiscoverFeedItem } from '../../api/briefApi';
import { useGestureSurface } from '../../ui/gestures/useGestureSurface';
import type { GestureIntent } from '../../ui/gestures/grammar';
import { soundEngine } from '../../utils/SoundEngine';
import {
  forgetAllHidden, forgetHidden, loadReelMemory, reelKey, rememberHidden, rememberSeen
} from './reelMemory';
import type { ReelMemory } from './reelMemory';
import '../../ui/activityReel.css';

/** How long the leaving card takes to fall out of the reel. Matches the CSS
 *  transition (--motion-normal); reduced motion collapses it in the stylesheet
 *  and this timer simply finishes early. */
const EXIT_MS = 280;

/** How many cards the reel holds, and which ones.
 *
 *  The board hands over its rows as "offers first (newest first), then events
 *  (soonest first)" and there is deliberately no cross-kind sort in it. But a
 *  panel that simply took the first five rows would show five offers and never
 *  reach the event on Saturday — the offers are always first, so the stream
 *  would be a shelf with a party permanently out of frame.
 *
 *  So the selection rule is stated, small and kind-fair: the TWO SOONEST EVENTS
 *  stay in view, and offers fill the rest of the five. Within each kind the
 *  board's own order is kept untouched, and each card still prints the board's
 *  own reason for being there. This is a choice about what to show, not a
 *  ranking of what matters. */
export function reelSelection(items: DiscoverFeedItem[], limit = 5): DiscoverFeedItem[] {
  const events = items.filter((item) => item.kind === 'event').slice(0, 2);
  const offers = items.filter((item) => item.kind !== 'event');
  return [...offers.slice(0, Math.max(0, limit - events.length)), ...events];
}

export interface ActivityReelProps {
  /** The board's own rows, in the board's own order. */
  items: DiscoverFeedItem[];
  /** Open one activity fully: the event page, or the offer's own detail sheet.
      The reel never navigates by itself — the shell owns where things live. */
  onOpenItem: (item: DiscoverFeedItem) => void;
  className?: string;
}

interface Notice {
  text: string;
  tone: 'plain' | 'error';
  undo?: () => void;
}

/** The seller's own published contact, turned into a WhatsApp link — the SAME
 *  rule the offer sheet uses, so the two surfaces cannot disagree about what a
 *  contact is: it must be a number the seller wrote themselves. "WhatsApp" as a
 *  method name is not a number, and is not dressed up as one. */
function whatsappHref(item: DiscoverFeedItem): string | null {
  const digits = (item.contact ?? '').replace(/\D/g, '');
  if (digits.length < 9) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(`Hi — I saw "${item.title}" on Brief and I would like to ask about it.`)}`;
}

/** What can honestly be said about reaching this seller. */
function contactLine(item: DiscoverFeedItem): string | null {
  if (item.kind !== 'listing') return null;
  if (whatsappHref(item)) return item.contactNote ?? 'The seller put this contact on their own listing.';
  if (item.contact) {
    return `The seller listed "${item.contact}" as their contact method, but no number to dial — Brief will not guess one or borrow one from somewhere else.`;
  }
  return 'No contact on this listing, so none is shown — Brief will not guess one or borrow one from somewhere else.';
}

function kindWord(item: DiscoverFeedItem): string {
  return item.kind === 'event' ? 'Event' : 'Offer';
}

interface QuickAction {
  label: string;
  icon: React.ReactNode;
  run: () => void;
  busy: boolean;
}

/** The one quick action a row can honestly offer, or nothing at all:
 *   * an object to save -> Save / Saved (a real server row, and undoable)
 *   * no object, but the seller published a contact -> message them
 *   * neither -> no button, rather than a dead one. */
function quickActionFor(
  item: DiscoverFeedItem,
  saved: Set<string>,
  busy: string,
  onSave: (item: DiscoverFeedItem) => void
): QuickAction | null {
  if (item.objectId) {
    const isSaved = saved.has(item.objectId);
    return {
      label: isSaved ? 'Saved' : 'Save',
      icon: <Bookmark size={15} />,
      run: () => onSave(item),
      busy: busy === item.objectId
    };
  }
  const link = whatsappHref(item);
  if (item.kind === 'listing' && link) {
    return {
      label: 'Message the seller',
      icon: <MessageCircle size={15} />,
      run: () => window.open(link, '_blank', 'noopener'),
      busy: false
    };
  }
  return null;
}

export function ActivityReel({ items, onOpenItem, className = '' }: ActivityReelProps) {
  const [memory, setMemory] = useState<ReelMemory>(() => loadReelMemory());
  /** Server-side memory: the caller's own saves and "not for me" rows. Null
      until it is known (signed out, offline, or a server that refused) — and
      the reel never guesses what is in it. */
  const [server, setServer] = useState<{ saved: string[]; notInterested: string[] } | null>(null);
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const [leaving, setLeaving] = useState<DiscoverFeedItem | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState('');
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (exitTimer.current) clearTimeout(exitTimer.current); }, []);

  useEffect(() => {
    let live = true;
    void api.getPersonalState().then((r) => {
      if (!live || !r.ok) return; // no session, no server memory: device only
      setServer({ saved: r.data.saved ?? [], notInterested: r.data.relevance?.notInterested ?? [] });
    });
    return () => { live = false; };
  }, []);

  const notInterested = useMemo(() => new Set(server?.notInterested ?? []), [server]);
  const savedSet = useMemo(() => new Set(server?.saved ?? []), [server]);
  const hiddenKeys = useMemo(() => new Set(memory.hidden), [memory.hidden]);
  const seenKeys = useMemo(() => new Set(memory.seen), [memory.seen]);

  const visible = useMemo(
    () => items.filter((item) => {
      if (hiddenKeys.has(reelKey(item))) return false;
      // A "not for me" recorded on the server is the row's own object id. This
      // is what keeps the reel honest across a reload: the board still lists the
      // row, and the viewer has already dealt with it.
      if (item.objectId && notInterested.has(item.objectId)) return false;
      return true;
    }),
    [items, hiddenKeys, notInterested]
  );

  const safeIndex = Math.min(index, Math.max(0, visible.length - 1));
  const current = visible[safeIndex] ?? null;
  const previous = safeIndex > 0 ? visible[safeIndex - 1] : null;
  const upcoming = safeIndex < visible.length - 1 ? visible[safeIndex + 1] : null;
  const hasNext = safeIndex < visible.length - 1;
  const hasPrev = safeIndex > 0;

  const markSeen = useCallback((item: DiscoverFeedItem) => {
    setMemory((m) => (m.seen.includes(reelKey(item)) ? m : rememberSeen([reelKey(item)], m)));
  }, []);

  const browse = useCallback((direction: 'next' | 'prev') => {
    setIndex((i) => {
      const at = Math.min(i, Math.max(0, visible.length - 1));
      const next = direction === 'next' ? at + 1 : at - 1;
      if (next < 0 || next > visible.length - 1) return at; // the set is bounded, and stays put
      soundEngine.play('tap');
      return next;
    });
    setPeeking(false);
  }, [visible.length]);

  const openDetail = useCallback((item: DiscoverFeedItem) => {
    setExpanded(true);
    markSeen(item);
  }, [markSeen]);

  const save = useCallback(async (item: DiscoverFeedItem) => {
    if (!item.objectId) return;
    const isSaved = savedSet.has(item.objectId);
    setBusy(item.objectId);
    const result = isSaved
      ? await api.unsaveObjectForMe(item.objectId)
      : await api.saveObjectForMe(item.objectId);
    setBusy('');
    if (!result.ok) {
      // The button did not work, and the reel says so rather than flipping the
      // icon and hoping nobody reloads.
      setNotice({ text: `Brief could not record that: ${result.error}`, tone: 'error' });
      return;
    }
    setServer((s) => ({ saved: result.data.saved, notInterested: s?.notInterested ?? [] }));
    setNotice({
      text: isSaved
        ? `Removed "${item.title}" from your saved things.`
        : `Saved "${item.title}" — it is in your saved things.`,
      tone: 'plain'
    });
    soundEngine.play(isSaved ? 'tap' : 'reward');
  }, [savedSet]);

  const dismiss = useCallback((item: DiscoverFeedItem) => {
    const key = reelKey(item);
    soundEngine.play('heavyTap');
    setExpanded(false);
    setPeeking(false);
    // It leaves the deck now, and the card underneath is already there — so the
    // stream keeps moving instead of waiting on a round trip.
    setLeaving(item);
    if (exitTimer.current) clearTimeout(exitTimer.current);
    exitTimer.current = setTimeout(() => setLeaving(null), EXIT_MS);

    if (item.objectId) {
      const objectId = item.objectId;
      setServer((s) => ({ saved: s?.saved ?? [], notInterested: [...(s?.notInterested ?? []), objectId] }));
      setNotice({
        text: `Noted — "${item.title}" will not come back on this account.`,
        tone: 'plain',
        undo: () => {
          setServer((s) => ({ saved: s?.saved ?? [], notInterested: (s?.notInterested ?? []).filter((id) => id !== objectId) }));
          void api.unsetRelevanceControl('not_interested', { objectId }).then((r) => {
            if (r.ok) setServer((s) => ({ saved: s?.saved ?? [], notInterested: r.data.relevance.notInterested }));
          });
        }
      });
      void api.setRelevanceControl('not_interested', { objectId }).then((r) => {
        if (r.ok) {
          setServer((s) => ({ saved: s?.saved ?? [], notInterested: r.data.relevance.notInterested }));
          return;
        }
        // It did not reach the server, so it is NOT recorded there: take it back
        // out of that set, keep it hidden here, and say exactly which one
        // happened.
        setServer((s) => ({ saved: s?.saved ?? [], notInterested: (s?.notInterested ?? []).filter((id) => id !== objectId) }));
        setMemory((m) => rememberHidden(key, m));
        setNotice({
          text: `The board could not record that: ${r.error}. "${item.title}" is hidden on this device.`,
          tone: 'error',
          undo: () => setMemory((m) => forgetHidden(key, m))
        });
      });
      return;
    }

    setMemory((m) => rememberHidden(key, m));
    setNotice({
      text: `"${item.title}" is hidden on this device — this row has no saved record for Brief to change.`,
      tone: 'plain',
      undo: () => setMemory((m) => forgetHidden(key, m))
    });
  }, []);

  const putBackEverything = useCallback(() => {
    const objectIds = Array.from(notInterested);
    setMemory((m) => forgetAllHidden(m));
    setServer((s) => ({ saved: s?.saved ?? [], notInterested: [] }));
    setNotice({
      text: objectIds.length
        ? `Putting everything back — undoing ${objectIds.length} "not for me" record${objectIds.length === 1 ? '' : 's'} too.`
        : 'Putting everything back.',
      tone: 'plain'
    });
    for (const objectId of objectIds) void api.unsetRelevanceControl('not_interested', { objectId });
  }, [notInterested]);

  /** The one quick action this card can honestly offer, or nothing. It is
   *  computed here, above the gesture surface, because whether a second tap has
   *  a meaning is a property of the card under it. */
  const quick = current ? quickActionFor(current, savedSet, busy, save) : null;

  const handleIntent = useCallback((intent: GestureIntent) => {
    if (!current) return;
    if (intent.kind === 'browse') { browse(intent.direction); return; }
    if (intent.kind === 'open-detail' || intent.kind === 'act') { openDetail(current); return; }
    if (intent.kind === 'close-detail') { setExpanded(false); return; }
    if (intent.kind === 'quick') {
      // The first tap already opened the detail — that is what a tap means
      // here, and it happened without waiting to see whether a second one was
      // coming. A second tap on the same spot means the thing itself, not more
      // detail: put the panel back down and do the one action the card has. A
      // card with no quick action simply stays open, which is where the first
      // tap had already taken you.
      if (quick && !quick.busy) { setExpanded(false); quick.run(); }
      return;
    }
    if (intent.kind === 'dismiss') dismiss(current);
  }, [browse, current, dismiss, openDetail, quick]);

  const { handlers, drag, wasGesture } = useGestureSurface({
    state: expanded ? 'detail' : 'set',
    onIntent: handleIntent,
    onPeek: (phase) => setPeeking(phase === 'start'),
    canBrowse: { next: hasNext, prev: hasPrev },
    doubleTap: Boolean(quick)
  });

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); browse('next'); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); browse('prev'); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); if (current) openDetail(current); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); if (expanded) setExpanded(false); }
    else if (event.key === 'Escape' && expanded) { setExpanded(false); }
  };

  if (!visible.length) {
    const dealt = items.length > 0;
    return (
      <div className={`reel reel--empty ${className}`} data-testid="activity-reel">
        <p className="reel-empty">
          {dealt
            ? 'Nothing left in the reel — you have dealt with everything the board is showing.'
            : 'No recent activity.'}
        </p>
        {dealt && (
          <button type="button" className="reel-restore" onClick={putBackEverything}>
            <RotateCcw size={14} /> Put them back
          </button>
        )}
      </div>
    );
  }

  const openProgress = expanded ? 1 : drag.axis === 'vertical' && drag.dy < 0 ? drag.progress : 0;
  const dismissProgress = !expanded && drag.axis === 'vertical' && drag.dy > 0 ? drag.progress : 0;
  const currentSeen = current ? seenKeys.has(reelKey(current)) : false;
  const seenCount = visible.filter((item) => seenKeys.has(reelKey(item))).length;

  return (
    <div
      className={`reel ${className}`}
      data-testid="activity-reel"
      data-state={expanded ? 'detail' : 'set'}
      onKeyDown={onKeyDown}
    >
      {/* Position, in the shape every story bar taught: you are 2 of 5, and the
          set ends. The count is spoken too, so the set has a size for anyone
          who cannot see the segments. */}
      <div className="reel-meter">
        <ol className="reel-segments" aria-hidden="true">
          {visible.map((item, i) => (
            <li key={reelKey(item)} data-at={i < safeIndex ? 'past' : i === safeIndex ? 'now' : 'next'} />
          ))}
        </ol>
        <p className="reel-count" role="status" aria-live="polite">
          {safeIndex + 1} of {visible.length}
          {seenCount > 0 && <span className="reel-count-seen"> · {seenCount} seen</span>}
        </p>
      </div>

      <div
        className="reel-stage"
        data-gesture={drag.dragging ? drag.axis : 'rest'}
        // A tap is a gesture too, but it also arrives as a `click` — from a
        // mouse, from an assistive tool, from anything that dispatches the
        // event a finger would have produced. So the card answers both, and
        // ignores the echo a swipe leaves behind.
        onClick={(event) => {
          const target = event.target as Element | null;
          if (target && typeof target.closest === 'function' && target.closest('button, a, input, textarea, select, [data-gesture-static]')) return;
          if (wasGesture()) return;
          if (current) openDetail(current);
        }}
        style={{
          '--reel-x': `${drag.axis === 'horizontal' ? drag.x : 0}px`,
          '--reel-y': `${drag.axis === 'vertical' ? drag.y : 0}px`,
          '--reel-open': String(openProgress),
          '--reel-drop': String(dismissProgress)
        } as React.CSSProperties}
        role="group"
        aria-roledescription="activity reel"
        aria-label="Latest activity"
        {...handlers}
      >
        <div className="reel-deck">
          {previous && <CardFace item={previous} slot="prev" />}
          {current && (
            <CardFace
              item={current}
              slot="now"
              seen={currentSeen}
              quick={quick}
              onOpen={() => openDetail(current)}
            />
          )}
          {upcoming && <CardFace item={upcoming} slot="next" />}
        </div>

        {/* Tap the edges to step: the precise version of the same horizontal
            move, for anyone who would rather not swipe (or cannot). */}
        <button
          type="button"
          className="reel-edge reel-edge--prev"
          data-gesture-static
          onClick={() => browse('prev')}
          disabled={!hasPrev}
          aria-label="Previous activity"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          className="reel-edge reel-edge--next"
          data-gesture-static
          onClick={() => browse('next')}
          disabled={!hasNext}
          aria-label="Next activity"
        >
          <ChevronRight size={18} />
        </button>

        {leaving && (
          <div className="reel-leaving" aria-hidden="true">
            <CardFace item={leaving} slot="now" />
          </div>
        )}

        {peeking && current && (
          <div className="reel-peek" aria-hidden="true">
            <p className="reel-peek-kind">{kindWord(current)}</p>
            <p className="reel-peek-title">{current.title}</p>
            {current.priceLabel && <p className="reel-peek-price">{current.priceLabel}</p>}
            {current.dateLabel && <p className="reel-peek-line">{current.dateLabel}</p>}
            {current.location && <p className="reel-peek-line">{current.location}</p>}
            <p className="reel-peek-hint">Release to close · tap the card for details</p>
          </div>
        )}

        {current && (
          <article className="reel-detail" data-testid="reel-detail" hidden={!expanded}>
            <div className="reel-detail-head">
              <span className="reel-chip">{kindWord(current)}</span>
              {current.kind === 'listing' && current.flow && <span className="reel-chip reel-chip--quiet">{current.flow}</span>}
              <button type="button" className="reel-icon" data-gesture-static onClick={() => setExpanded(false)} aria-label="Close details">
                <X size={16} />
              </button>
            </div>
            <h3 className="reel-detail-title">{current.title}</h3>
            <p className="reel-detail-price">{current.priceLabel ?? 'No price stated'}</p>
            <dl className="reel-facts">
              {current.dateLabel && <div><dt>When</dt><dd>{current.dateLabel}</dd></div>}
              {current.location && <div><dt>Where</dt><dd>{current.location}</dd></div>}
              {(current.origin || current.destination) && (
                <div><dt>Route</dt><dd>{[current.origin, current.destination].filter(Boolean).join(' → ')}</dd></div>
              )}
              {current.seller && <div><dt>{current.kind === 'event' ? 'Hosted by' : 'Listed by'}</dt><dd>{current.seller}</dd></div>}
              {current.kind === 'listing' && (
                <div>
                  <dt>Stock</dt>
                  <dd>{current.stock === null || current.stock === undefined ? 'Not counted for this offer' : `${current.stock} available`}</dd>
                </div>
              )}
              {current.minOrder ? (
                <div><dt>Minimum</dt><dd>{current.minOrder}{current.unit ? ` ${current.unit}` : ''}</dd></div>
              ) : null}
            </dl>
            {current.description && <p className="reel-detail-note">{current.description}</p>}
            {contactLine(current) && <p className="reel-detail-note">{contactLine(current)}</p>}
            {/* The board's own reason for showing this row, repeated verbatim
                and attributed — a card should never be a mystery. */}
            <p className="reel-why">On the board because: {current.why}.</p>

            <div className="reel-actions">
              <button
                type="button"
                className="compact-primary"
                data-gesture-static
                onClick={() => { markSeen(current); onOpenItem(current); }}
              >
                {current.kind === 'event' ? 'Open event' : 'Open offer'}
              </button>
              {quick && (
                <button type="button" className="reel-action" data-gesture-static onClick={quick.run} disabled={quick.busy}>
                  {quick.icon}
                  {quick.label}
                </button>
              )}
              <button
                type="button"
                className="reel-action reel-action--quiet"
                data-gesture-static
                onClick={() => dismiss(current)}
              >
                Not for me
              </button>
            </div>
          </article>
        )}
      </div>

      {/* The grammar, said out loud, once. A gesture nobody can find is not a
          feature — it is a secret. */}
      <p className="reel-legend">
        <span><b>← →</b> browse</span>
        <span><b>↑</b> details</span>
        <span><b>2×</b> quick action</span>
        <span><b>hold</b> peek</span>
        <span><b>↓</b> deal with it</span>
      </p>

      {notice && (
        <p className={`reel-notice reel-notice--${notice.tone}`} role="status">
          <span className="reel-notice-text">{notice.text}</span>
          {notice.undo && (
            <button type="button" data-gesture-static onClick={() => { const undo = notice.undo; setNotice(null); undo?.(); }}>
              Undo
            </button>
          )}
          <button type="button" data-gesture-static onClick={() => setNotice(null)} aria-label="Dismiss message">
            <X size={12} />
          </button>
        </p>
      )}

      {seenCount > 0 && seenCount === visible.length && (
        <p className="reel-foot">You have opened everything the board is showing.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The card face: what a card shows at rest, in the reel AND while it leaves
// (the same component, so the thing that flies away is the thing that was
// there — not a lookalike drawn for the animation).
// ---------------------------------------------------------------------------

interface CardFaceProps {
  item: DiscoverFeedItem;
  slot: 'prev' | 'now' | 'next';
  seen?: boolean;
  quick?: QuickAction | null;
  onOpen?: () => void;
}

function CardFace({ item, slot, seen = false, quick = null, onOpen }: CardFaceProps) {
  const isNow = slot === 'now';
  return (
    <div
      className="reel-card"
      data-kind={item.kind}
      data-slot={slot}
      data-seen={seen || undefined}
      data-testid={isNow ? 'reel-card' : undefined}
      aria-hidden={!isNow || undefined}
    >
      {item.mediaUrl ? (
        <img className="reel-card-photo" src={api.mediaFileUrl(item.mediaUrl)} alt="" />
      ) : null}
      <div className="reel-card-body">
        <div className="reel-card-top">
          <span className="reel-chip">{kindWord(item)}</span>
          {isNow && seen && <span className="reel-chip reel-chip--seen">Seen</span>}
          <span className="reel-card-glyph" aria-hidden="true">
            {item.kind === 'event' ? <CalendarDays size={18} /> : <Package size={18} />}
          </span>
          {isNow && quick && (
            <button
              type="button"
              className="reel-icon reel-icon--oncard"
              data-gesture-static
              onClick={quick.run}
              disabled={quick.busy}
              aria-pressed={quick.label.startsWith('Saved')}
              aria-label={quick.label}
            >
              {quick.icon}
            </button>
          )}
        </div>
        <p className="reel-card-title">{item.title}</p>
        <p className="reel-card-meta">
          {item.priceLabel && <span className="reel-card-price">{item.priceLabel}</span>}
          {item.location && <span><MapPin size={12} /> {item.location}</span>}
          {item.dateLabel && <span><CalendarDays size={12} /> {item.dateLabel}</span>}
        </p>
        {isNow && (
          <div className="reel-card-foot">
            <button type="button" className="reel-details-btn" data-gesture-static onClick={onOpen}>
              Details <ArrowUp size={14} />
            </button>
            {/* The verbs, said where the finger is — in the words people
                already use for these moves. The quick action is named only on
                the cards that actually have one. */}
            <span className="reel-card-tap">Swipe ↑ for details · Swipe ← → to browse</span>
            {quick && (
              <span className="reel-card-tap">
                Double-tap to {quick.label.startsWith('Saved') ? 'unsave' : quick.label.toLowerCase()}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
