import React, { useCallback, useEffect, useState } from 'react';
import { Bike, Check, HeartHandshake, Package, Plus, Shapes, Star, Truck, Users, UtensilsCrossed, Wrench } from 'lucide-react';
import * as briefApi from '../../api/briefApi';
import type { Errand, ErrandBoard, ErrandProviders, StatedFee } from '../../api/briefApi';
import { WairoDispatchPanel } from './WairoDispatchPanel';
import { ExternalPlaces } from './ExternalPlaces';
import { soundEngine } from '../../utils/SoundEngine';
import { ImageField } from '../../components/ImageField';
import { supplyPath } from '../supply/shared';

// ---------------------------------------------------------------------------
// ERRANDS LOBBY — the noticeboard in the waiting area, not a gallery case.
//
// The loop, out loud: post → a carrier takes it → collected → delivered → the
// fee agreed between the two of you → rated. Every stage below is a timestamped
// row; a stage nobody has reached yet is shown as upcoming, with no invented
// date, no ETA and no "3 people are looking at this".
//
// Who may take an errand: a real record as a field agent, a partner, an active
// shop claim, or a pickup you have already been assigned. The board is readable
// by anyone signed in; the "Take this errand" button only renders when the
// server has already agreed you can carry, because a button the server would
// refuse is a trap.
//
// Money: the fee is what the poster wrote. Brief moves nothing — there is no
// errand payment provider wired — so "settled" is both of you confirming the
// cash changed hands out there, and the row says so.
//
// Rating: one per person, per completed delivery, from the two parties only,
// displayed exactly as said. No average, no score, no ranking is computed, and
// the panel states that instead of quietly hiding it.
// ---------------------------------------------------------------------------

const ago = (iso: string | null) => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const h = Math.max(0, Math.round((Date.now() - ms) / 3600000));
  if (h < 1) return 'just now';
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }) : null);

const money = (n: number | null, currency: string) => (n == null ? 'no fee stated' : `${currency} ${Number(n).toLocaleString('en-KE')}`);

type Errors = Record<string, string>;

/** A carrier's eligibility code, in the words the carrier uses. */
export function basisLabel(code: string): string {
  const raw = String(code ?? '');
  if (raw === 'role:field_agent') return 'Field agent';
  if (raw === 'role:partner') return 'Partner';
  const claims = raw.match(/^agent:(\d+) active shop claims?$/);
  if (claims) return `${claims[1]} shop${claims[1] === '1' ? '' : 's'} run from this account`;
  const pickups = raw.match(/^rider:(\d+) pickups? assigned$/);
  if (pickups) return `${pickups[1]} pickup${pickups[1] === '1' ? '' : 's'} assigned to you`;
  return raw;
}

const KIND_ICON: Record<string, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>> = {
  delivery: Truck,
  pickup: Package,
  food: UtensilsCrossed,
  skilled: Wrench,
  care: HeartHandshake,
  other: Shapes
};

export interface ErrandsLobbyComposerSignal {
  nonce: number;
  /** The kind the caller chose — the "Runs" tile arrives as 'delivery'. */
  kind: string | null;
}

export function ErrandsLobby({ className = '', composerSignal }: { className?: string; composerSignal?: ErrandsLobbyComposerSignal | null }) {
  const [board, setBoard] = useState<ErrandBoard | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Which external carrier's "why" is open. One at a time, and only on this
  // surface: the card states the limit in a clause, the reason is a tap away.
  const [whyOpen, setWhyOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState({ what: '', pickup: '', dropoff: '', sizeOrWeight: '', whenNeeded: '', offeredFeeKes: '', note: '' });
  // The chosen kind lives with the board, not the composer: tapping a tile both
  // labels what you are about to post and filters what you can see, which is the
  // only reason the grid is on the screen at all.
  const [kind, setKind] = useState<string | null>(null);
  // The map finder fills one address field, then closes: a picked point is a
  // map listing (name + coordinates), never a registered shop.
  const [findingFor, setFindingFor] = useState<'pickup' | 'dropoff' | null>(null);
  const [fees, setFees] = useState<StatedFee[] | null>(null);

  const load = useCallback(async () => {
    const res = await briefApi.getErrandBoard();
    if (!res.ok) {
      setStatus((s) => (s === 'ready' ? 'ready' : 'error'));
      return;
    }
    setBoard(res.data);
    void briefApi.listStatedFees().then((r) => { if (r.ok) setFees(r.data.fees); });
    setStatus('ready');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A "Start a run" from Home (or the bar's [+]) arrives as a nonce: open the
  // composer with the kind the caller chose, once per nonce.
  const [seenSignal, setSeenSignal] = useState<number>(0);
  useEffect(() => {
    if (composerSignal && composerSignal.nonce !== seenSignal) {
      setSeenSignal(composerSignal.nonce);
      setKind(composerSignal.kind);
      setPosting(true);
    }
  }, [composerSignal, seenSignal]);

  // Coming back to the tab re-reads the board. A refresh on return, not a
  // pushed feed — there is no socket here and we do not pretend there is.
  useEffect(() => {
    const onVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void load();
    };
    if (typeof window === 'undefined') return;
    window.addEventListener('focus', onVisible);
    return () => window.removeEventListener('focus', onVisible);
  }, [load]);

  const act = async (id: string, action: 'accept' | 'picked' | 'delivered' | 'cancel' | 'settle', body: Record<string, unknown> = {}) => {
    setBusy(`${id}:${action}`);
    setErrors((e) => ({ ...e, [id]: '' }));
    const res = await briefApi.errandAction(id, action, action === 'cancel' ? { reason: draft.note || 'Cancelled by the poster.' } : body);
    setBusy(null);
    if (!res.ok) {
      // A refused accept carries the eligibility answer, so it is shown, not
      // swallowed into a generic failure.
      const extra = (res as { errorBody?: { eligibility?: { howToJoin?: string } } }).errorBody?.eligibility?.howToJoin;
      setErrors((e) => ({ ...e, [id]: `${res.error ?? 'That did not work.'}${extra ? ` ${extra}` : ''}` }));
      return;
    }
    soundEngine.play('tap');
    setNotice(
      action === 'accept' ? 'Taken. The poster has been told in their app.'
        : action === 'settle' ? 'Your side of the fee is confirmed. Brief moved nothing.'
        : 'Updated.'
    );
    await load();
  };

  const rate = async (id: string, stars: number) => {
    setBusy(`${id}:rate`);
    const res = await briefApi.rateErrand(id, stars);
    setBusy(null);
    if (!res.ok) {
      setErrors((e) => ({ ...e, [id]: res.error ?? 'That rating was refused.' }));
      return;
    }
    setNotice('Rating recorded against that delivery. It is not averaged into anything.');
    await load();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.what.trim() || !draft.pickup.trim() || !draft.dropoff.trim()) {
      setErrors((x) => ({ ...x, post: 'Say what needs carrying, where it is collected, and where it goes.' }));
      return;
    }
    setBusy('post');
    setErrors((x) => ({ ...x, post: '' }));
    const res = await briefApi.postErrand({
      what: draft.what.trim(),
      pickup: draft.pickup.trim(),
      dropoff: draft.dropoff.trim(),
      sizeOrWeight: draft.sizeOrWeight.trim() || null,
      whenNeeded: draft.whenNeeded || null,
      offeredFeeKes: draft.offeredFeeKes.trim() === '' ? null : Number(draft.offeredFeeKes),
      note: draft.note.trim(),
      kind
    });
    setBusy(null);
    if (!res.ok) {
      setErrors((x) => ({ ...x, post: res.error ?? 'Could not post that errand.' }));
      return;
    }
    const n = res.data.notified?.notified ?? 0;
    setNotice(`Posted. ${n} carrier${n === 1 ? '' : 's'} with a record on Brief ${n === 1 ? 'was' : 'were'} notified in their app — nothing was texted or sent on WhatsApp.`);
    setDraft({ what: '', pickup: '', dropoff: '', sizeOrWeight: '', whenNeeded: '', offeredFeeKes: '', note: '' });
    setKind(null);
    setPosting(false);
    await load();
  };

  if (status === 'loading') {
    return <p className="text-xs brief-skeleton h-6 rounded" style={{ color: 'var(--color-text-muted)' }}>Reading the board…</p>;
  }
  if (status === 'error' || !board) {
    return (
      <div className="brief-lobby p-5">
        <p className="text-sm font-bold">The board could not be read.</p>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
          Nothing is shown in its place — no borrowed errands, no seeded board.
        </p>
        <button type="button" className="brief-lobby-btn brief-lobby-btn--primary mt-3" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  const eligibility = board.eligibility;
  // The filter runs over the rows the board already returned, and the reset chip
  // says so as a true count. The API also accepts ?kind= for anyone paging the
  // board directly; filtering here avoids a second request for a list this screen
  // has in hand, and it means the grid can never show a number the server did not
  // answer with.
  const visibleOpen = kind ? board.open.filter((e) => e.kind === kind) : board.open;

  return (
    <div className={`brief-lobby p-4 sm:p-5 space-y-5 ${className}`}>
      {/* ── The room ─────────────────────────────────────────────────────── */}
      <header className="space-y-1.5">
        <p className="text-[12px] font-black uppercase tracking-[0.2em]" style={{ color: 'var(--color-primary)' }}>
          The lobby
        </p>
        <h2 className="text-2xl font-black leading-tight" style={{ color: 'var(--wairo-slate)' }}>
          Errands people need carried
        </h2>
        <p className="text-sm" style={{ color: 'rgba(36,31,26,0.66)' }}>
          {board.open.length} open on the board · {board.carriersAround} carrier{board.carriersAround === 1 ? '' : 's'} with a record here
        </p>
      </header>

      {/* ── Whether you can carry, and why ────────────────────────────────── */}
      <section
        className="brief-lobby-card p-4 flex flex-wrap items-center gap-2"
        data-urgency={eligibility.eligible ? undefined : 'quiet'}
      >
        <Users className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
        <p className="text-sm font-bold flex-1 min-w-[180px]" style={{ color: '#241F1A' }}>
          {eligibility.eligible ? 'You can take errands.' : 'You cannot take errands yet.'}
        </p>
        {eligibility.basis.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {eligibility.basis.map((b) => (
              /* Words on the chip, the audit code one attribute away: the server
                 answers with `agent:4 …` because a log should read like a log,
                 but a person deciding whether they can carry should not have to
                 decode a key. Nothing is hidden — title={b} is the raw basis. */
              <span key={b} className="brief-lobby-stage" data-done="true" title={b}>
                <Check className="w-3 h-3" /> {basisLabel(b)}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[12px] max-w-md" style={{ color: 'rgba(36,31,26,0.6)' }}>{eligibility.howToJoin}</p>
        )}
      </section>

      {notice && (
        <p role="status" className="text-[13px] font-bold" style={{ color: 'var(--color-success)' }}>
          {notice}
        </p>
      )}

      {/* ── Post a need ──────────────────────────────────────────────────── */}
      {!posting ? (
        <button type="button" className="brief-lobby-btn brief-lobby-btn--primary w-full" onClick={() => { soundEngine.play('tap'); setPosting(true); }}>
          <span className="inline-flex items-center gap-2"><Plus className="w-4 h-4" /> Post an errand</span>
        </button>
      ) : (
        <form className="brief-lobby-card p-4 space-y-3" onSubmit={submit}>
          <p className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: 'var(--color-primary)' }}>
            Post an errand
          </p>
          <input className="brief-lobby-input" aria-label="What needs carrying" placeholder="What needs carrying?"
            value={draft.what} onChange={(e) => setDraft((d) => ({ ...d, what: e.target.value }))} maxLength={140} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input className="brief-lobby-input" aria-label="Collected from" placeholder="Collected from (e.g. Wakulima stall 42)"
              value={draft.pickup} onChange={(e) => setDraft((d) => ({ ...d, pickup: e.target.value }))} />
            <input className="brief-lobby-input" aria-label="Dropped at" placeholder="Dropped at (e.g. Westlands, Section 108)"
              value={draft.dropoff} onChange={(e) => setDraft((d) => ({ ...d, dropoff: e.target.value }))} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="brief-lobby-btn brief-lobby-btn--quiet" onClick={() => setFindingFor((f) => (f === 'pickup' ? null : 'pickup'))}>
              {findingFor === 'pickup' ? 'Close the map' : 'Find a pickup point'}
            </button>
            <button type="button" className="brief-lobby-btn brief-lobby-btn--quiet" onClick={() => setFindingFor((f) => (f === 'dropoff' ? null : 'dropoff'))}>
              {findingFor === 'dropoff' ? 'Close the map' : 'Find a drop-off point'}
            </button>
          </div>
          {findingFor && (
            <ExternalPlaces
              onSelectPlace={(label) => {
                const field = findingFor;
                setDraft((d) => (field === 'pickup' ? { ...d, pickup: label } : { ...d, dropoff: label }));
                setFindingFor(null);
                setNotice('Point set from the map. It is a map listing, not a registered shop.');
              }}
            />
          )}
          <div className="grid grid-cols-3 gap-2">
            <input className="brief-lobby-input" aria-label="Size or weight" placeholder="Size / weight"
              value={draft.sizeOrWeight} onChange={(e) => setDraft((d) => ({ ...d, sizeOrWeight: e.target.value }))} />
            <input className="brief-lobby-input" type="date" aria-label="Needed by"
              value={draft.whenNeeded} onChange={(e) => setDraft((d) => ({ ...d, whenNeeded: e.target.value }))} />
            <input className="brief-lobby-input" type="number" min={0} aria-label="Fee you will pay" placeholder="Fee you’ll pay"
              value={draft.offeredFeeKes} onChange={(e) => setDraft((d) => ({ ...d, offeredFeeKes: e.target.value }))} />
          </div>
          <input className="brief-lobby-input" aria-label="Note for carriers" placeholder="Anything a carrier needs to know (cash on arrival, call first)"
            value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
          {errors.post && <p className="text-[12px] font-bold" role="alert" style={{ color: 'var(--color-danger)' }}>{errors.post}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy === 'post'} className="brief-lobby-btn brief-lobby-btn--primary flex-1 disabled:opacity-50">
              {busy === 'post' ? 'Posting…' : 'Put it on the board'}
            </button>
            <button type="button" className="brief-lobby-btn brief-lobby-btn--quiet" onClick={() => setPosting(false)}>Cancel</button>
          </div>
          <p className="text-[11px]" style={{ color: 'rgba(36,31,26,0.6)' }}>
            Leave the fee blank if it is a favour. Whatever you write is a statement to a carrier, not a payment Brief makes or holds.
          </p>
        </form>
      )}

      {/* ── The board ────────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h3 className="text-xs font-black uppercase tracking-wider" style={{ color: '#241F1A' }}>
          On the board
        </h3>
        {/* ── The kinds ──────────────────────────────────────────────────
            1xBet's category grid is worth stealing; its category *page* is not.
            These tiles are honest because the taxonomy is stored on the errand
            row (validated on the server, `domain/errands.js`), not inferred from
            the words in a title. Untyped errands stay on the board under "Any
            kind" — an unlabelled row is a real state, and silently filing it
            would be the same invention as a padded count. No tile carries a
            number, so six zeros cannot be painted as a shop window. */}
        {(board.kinds?.length ?? 0) > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {board.kinds!.map((k) => {
              const on = kind === k.id;
              const Icon = KIND_ICON[k.id] ?? Shapes;
              return (
                <button
                  key={k.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setKind(on ? null : k.id)}
                  className="flex items-center gap-2.5 p-3 rounded-2xl text-left cursor-pointer"
                  style={{
                    background: on ? 'var(--color-primary)' : 'var(--color-well)',
                    color: on ? 'var(--accent-ink)' : 'var(--brief-ink)',
                    boxShadow: on ? 'var(--lift-signal)' : 'none'
                  }}
                >
                  <span
                    className="w-9 h-9 rounded-full grid place-items-center shrink-0"
                    style={{ background: on ? 'rgba(255,255,255,0.16)' : 'var(--color-paper)' }}
                  >
                    <Icon className="w-4 h-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-bold leading-tight">{k.label}</span>
                    <span
                      className="block text-[11px] leading-tight mt-0.5"
                      style={{ color: on ? 'rgba(255,255,255,0.8)' : 'var(--brief-muted)' }}
                    >
                      {k.blurb}
                    </span>
                  </span>
                </button>
              );
            })}
            {kind && (
              <button
                type="button"
                onClick={() => setKind(null)}
                className="col-span-2 py-2 rounded-full text-[12px] font-bold cursor-pointer"
                style={{ background: 'var(--color-paper)', color: 'var(--color-primary)' }}
              >
                Any kind · showing {visibleOpen.length} of {board.open.length}
              </button>
            )}
          </div>
        )}

        {board.open.length === 0 ? (
          <div className="brief-lobby-card p-4" data-urgency="quiet">
            <p className="text-sm font-bold" style={{ color: '#241F1A' }}>Nothing is posted right now.</p>
            <p className="text-[13px] mt-1" style={{ color: 'rgba(36,31,26,0.66)' }}>
              No errands have been put on this board yet. Post one, or push a bike below — and if nobody answers it, that is the truth of the board, not a hidden queue.
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {visibleOpen.map((e) => (
              <li key={e.id}>
                {kind && e.kind === kind ? (
                  <p className="mb-1 text-[11px] font-bold" style={{ color: 'var(--brief-muted)' }}>
                    Matched on “{e.kindLabel}” — the kind the poster chose
                  </p>
                ) : null}
                <ErrandCard
                  errand={e}
                  stages={board.stages}
                  canCarry={eligibility.eligible}
                  busy={busy}
                  error={errors[e.id] ?? ''}
                  onAccept={() => void act(e.id, 'accept')}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── What completed runs stated ───────────────────────────────────────
          Poster-written fees on delivered runs, newest first. Listed, never
          averaged: there is no index here, and the cargo line travels with
          every fee so a number can never pose as a quote. */}
      {fees !== null && fees.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-black uppercase tracking-wider" style={{ color: '#241F1A' }}>
            What completed runs stated
          </h3>
          <ul className="space-y-2">
            {fees.map((f, i) => (
              <li key={`${f.at}-${i}`}>
                <p className="text-[14px] font-semibold" style={{ color: '#241F1A' }}>
                  {f.pickup} <span aria-hidden="true">→</span> {f.dropoff}
                </p>
                <p className="text-[13px] font-mono" style={{ color: 'rgba(36,31,26,0.66)' }}>
                  {money(f.offeredFeeKes, f.currency)} · {f.what}{f.sizeOrWeight ? ` · ${f.sizeOrWeight}` : ''} · {ago(f.at) ?? '—'}
                </p>
              </li>
            ))}
          </ul>
          <p className="text-[11px]" style={{ color: 'rgba(36,31,26,0.55)' }}>
            Stated fees, not quotes and not an average. Routes read as the poster wrote them.
          </p>
        </section>
      )}

      {/* ── Your loops ───────────────────────────────────────────────────── */}
      {board.mine.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-black uppercase tracking-wider" style={{ color: '#241F1A' }}>
            Your errands
          </h3>
          <ul className="space-y-2.5">
            {board.mine.map((e) => (
              <li key={e.id}>
                <ErrandCard
                  errand={e}
                  stages={board.stages}
                  canCarry={eligibility.eligible}
                  busy={busy}
                  error={errors[e.id] ?? ''}
                  onAccept={() => void act(e.id, 'accept')}
                  onAdvance={(a, body) => void act(e.id, a, body)}
                  onRate={(stars) => void rate(e.id, stars)}
                  onCancel={() => void act(e.id, 'cancel')}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── How to move it another way ──────────────────────────────────── */}
      {/* ── Push for a bike, from the same room ─────────────────────────── */}
      <section className="space-y-2">
        <h3 className="text-xs font-black uppercase tracking-wider" style={{ color: '#241F1A' }}>
          Dispatch a shop order
        </h3>
        <p className="text-[12px] mb-1" style={{ color: 'rgba(36,31,26,0.66)' }}>Already sold something? Arrange collection from a shop here. For a new job, post an errand above.</p>
        <WairoDispatchPanel />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One card: the ask, the loop, and only the actions this row actually allows.
// ---------------------------------------------------------------------------
function ErrandCard({
  errand: e,
  stages,
  canCarry,
  busy,
  error,
  onAccept,
  onAdvance,
  onRate,
  onCancel
}: {
  errand: Errand;
  stages: Array<{ key: string; label: string }>;
  canCarry: boolean;
  busy: string | null;
  error: string;
  onAccept: () => void;
  onAdvance?: (a: 'picked' | 'delivered' | 'settle', body?: Record<string, unknown>) => void;
  onRate?: (stars: number) => void;
  onCancel?: () => void;
}) {
  const [stars, setStars] = useState(0);
  const [podOpen, setPodOpen] = useState(false);
  const [podPhoto, setPodPhoto] = useState<string | null>(null);
  const [podBusy, setPodBusy] = useState(false);
  const [podMsg, setPodMsg] = useState('');
  const [pod, setPod] = useState(e.pod);
  const [sharing, setSharing] = useState(false);
  const [shareMsg, setShareMsg] = useState('');
  const [lastSentAt, setLastSentAt] = useState<string | null>(null);
  const watchId = React.useRef<number | null>(null);
  const lastPost = React.useRef(0);
  const urgency = e.whenNeeded && Date.parse(e.whenNeeded) - Date.now() < 2 * 86400000 ? 'now' : 'quiet';
  const settledNames = e.settlement?.confirmedNames ?? [];
  // Attach-later: the photo the doorstep moment deserved, added once the
  // carrier is back online. The card shows the returned row, not a guess.
  const savePod = async () => {
    if (!podPhoto || podBusy) return;
    setPodBusy(true);
    setPodMsg('');
    soundEngine.play('tap');
    const res = await briefApi.attachErrandPod(e.id, { photo: podPhoto });
    setPodBusy(false);
    if (!res.ok) {
      setPodMsg(res.error ?? 'That photo did not attach.');
      return;
    }
    setPod(res.data.errand.pod ?? null);
    setPodPhoto(null);
    setPodOpen(false);
  };
  // Live sharing: explicit toggle, off on every load, dead the moment the
  // delivery ends. Pings are throttled to one per 15 seconds — a courier's
  // battery is not the platform's to spend.
  const stopSharing = React.useCallback(() => {
    if (watchId.current !== null && "geolocation" in navigator) {
      try { navigator.geolocation.clearWatch(watchId.current); } catch { /* already gone */ }
    }
    watchId.current = null;
    setSharing(false);
  }, []);
  React.useEffect(() => () => {
    if (watchId.current !== null && "geolocation" in navigator) {
      try { navigator.geolocation.clearWatch(watchId.current); } catch { /* already gone */ }
    }
  }, []);
  React.useEffect(() => {
    if (sharing && (e.status === "delivered" || e.status === "cancelled")) stopSharing();
  });
  const startSharing = () => {
    if (!("geolocation" in navigator)) {
      setShareMsg("This device has no GPS to share.");
      return;
    }
    setShareMsg("");
    setSharing(true);
    soundEngine.play("tap");
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (Date.now() - lastPost.current < 15000) return;
        lastPost.current = Date.now();
        void briefApi
          .shareErrandPosition(e.id, {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? null,
          })
          .then((r) => {
            if (r.ok) setLastSentAt(new Date().toISOString());
            else setShareMsg(r.error ?? "The position did not send.");
          });
      },
      () => {
        setShareMsg("GPS refused — sharing stopped.");
        stopSharing();
      },
      { enableHighAccuracy: false, maximumAge: 15000, timeout: 20000 },
    );
  };

  return (
    <article className="brief-lobby-card p-4 space-y-2.5" data-urgency={urgency}>
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-[15px] font-black leading-snug min-w-0" style={{ color: '#241F1A' }}>
          {e.what}
        </h4>
        <span className="shrink-0 text-[11px] font-black uppercase tracking-wider" style={{ color: 'rgba(36,31,26,0.55)' }}>
          {e.status.replace('_', ' ')}
        </span>
      </div>

      <p className="text-[14px] font-semibold" style={{ color: '#241F1A' }}>
        {e.pickup} <span aria-hidden="true">→</span> {e.dropoff}
      </p>
      <p className="text-[13px] font-mono" style={{ color: 'rgba(36,31,26,0.66)' }}>
        {money(e.offeredFeeKes, e.currency)}
        {e.sizeOrWeight ? ` · ${e.sizeOrWeight}` : ''}
        {e.whenNeeded ? ` · by ${day(e.whenNeeded)}` : ''}
        {` · posted ${ago(e.createdAt) ?? '—'}`}
      </p>
      {e.note && <p className="text-[13px]" style={{ color: 'rgba(36,31,26,0.7)' }}>{e.note}</p>}

      {/* The loop. A stage without a timestamp is simply not there yet. */}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {stages.map((s) => {
          const row = e.loop.find((l) => l.key === s.key);
          return (
            <span key={s.key} className="brief-lobby-stage" data-done={row?.done ? 'true' : 'false'}>
              {s.label}
              {row?.done ? <span className="font-mono text-[11px]">{ago(row.at)}</span> : <span className="font-mono text-[11px] opacity-60">—</span>}
            </span>
          );
        })}
      </div>

      {e.carrierName && (
        <p className="text-[12px]" style={{ color: 'rgba(36,31,26,0.66)' }}>
          Carried by <strong>{e.carrierName}</strong>
          {e.carrierBasis.length > 0 ? ` (${e.carrierBasis.join(', ')})` : ''}
        </p>
      )}
      {e.carrierPosition && (e.iAmThePoster || e.iAmTheCarrier) && (
        <p className="text-[12px]" style={{ color: 'rgba(36,31,26,0.66)' }}>
          Carrier last seen {ago(e.carrierPosition.at) ?? '—'}
          {typeof e.carrierPosition.accuracy === 'number' ? ` (±${Math.round(e.carrierPosition.accuracy)} m)` : ''}
          {' · '}
          <button
            type="button"
            onClick={() => supplyPath('map')}
            className="font-bold underline underline-offset-2 cursor-pointer"
            style={{ color: 'var(--color-primary)' }}
          >
            View on map
          </button>
        </p>
      )}
      {e.settlement && (
        <p className="text-[12px] font-bold" style={{ color: 'var(--color-text)' }}>
          Fee {money(e.settlement.amountKes, e.settlement.currency)} confirmed by {settledNames.join(' + ') || 'nobody yet'}
          {e.settlement.at ? ` · ${ago(e.settlement.at)}` : ' · waiting on the other side'}
          {'. Brief moved nothing.'}
        </p>
      )}

      {error && <p className="text-[12px] font-bold" role="alert" style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {/* Actions: only what this row and this person allow. */}
      <div className="flex flex-wrap gap-2 pt-0.5">
        {e.status === 'open' && !e.isMine && (
          canCarry ? (
            <button type="button" disabled={busy === `${e.id}:accept`} onClick={onAccept}
              className="brief-lobby-btn brief-lobby-btn--primary disabled:opacity-50">
              Take this errand
            </button>
          ) : (
            <span className="text-[12px] font-bold" style={{ color: 'rgba(36,31,26,0.6)' }}>
              Only agents and partners on record can take an errand.
            </span>
          )
        )}
        {e.iAmTheCarrier && e.status === 'accepted' && onAdvance && (
          <button type="button" disabled={busy === `${e.id}:picked`} onClick={() => onAdvance('picked')}
            className="brief-lobby-btn brief-lobby-btn--primary disabled:opacity-50">
            I have collected it
          </button>
        )}
        {e.iAmTheCarrier && e.status === 'picked_up' && onAdvance && (
          podOpen ? (
            <div className="w-full space-y-2">
              <ImageField
                label="Delivery photo"
                hint="The item at the door, or the signed receipt. No signal now? Confirm without it and attach it later."
                value={podPhoto}
                onChange={setPodPhoto}
                compact
              />
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy === `${e.id}:delivered`}
                  onClick={() => { soundEngine.play('tap'); onAdvance('delivered', podPhoto ? { photo: podPhoto } : {}); }}
                  className="brief-lobby-btn brief-lobby-btn--primary disabled:opacity-50">
                  Confirm delivered
                </button>
                <button type="button" onClick={() => { setPodOpen(false); setPodPhoto(null); }}
                  className="brief-lobby-btn brief-lobby-btn--quiet">
                  Back
                </button>
              </div>
            </div>
          ) : (
            <button type="button" disabled={busy === `${e.id}:delivered`} onClick={() => { soundEngine.play('tap'); setPodOpen(true); }}
              className="brief-lobby-btn brief-lobby-btn--primary disabled:opacity-50">
              It is delivered
            </button>
          )
        )}
        {e.iAmTheCarrier && (e.status === 'accepted' || e.status === 'picked_up') && (
          <button
            type="button"
            onClick={() => {
              soundEngine.play('tap');
              if (sharing) stopSharing();
              else startSharing();
            }}
            className="brief-lobby-btn brief-lobby-btn--quiet"
          >
            {sharing ? `Sharing location${lastSentAt ? ` · sent ${ago(lastSentAt) ?? ''}` : ''} — tap to stop` : 'Share live location'}
          </button>
        )}
        {shareMsg && <p className="text-[12px] font-bold w-full" role="alert" style={{ color: 'var(--color-danger)' }}>{shareMsg}</p>}
        {e.canConfirmFee && onAdvance && (
          <button type="button" disabled={busy === `${e.id}:settle`} onClick={() => onAdvance('settle')}
            className="brief-lobby-btn brief-lobby-btn--quiet">
            {e.offeredFeeKes == null ? 'Nothing was offered — mark it agreed' : `Confirm the ${money(e.offeredFeeKes, e.currency)} changed hands`}
          </button>
        )}
        {e.iAmThePoster && (e.status === 'open' || e.status === 'accepted') && onCancel && (
          <button type="button" onClick={onCancel} className="brief-lobby-btn brief-lobby-btn--quiet">
            Cancel my errand
          </button>
        )}
      </div>

      {/* Proof of delivery: the photo, who attached it, when — or the honest
          absence of one. Either party can attach it after the fact. */}
      {e.status === 'delivered' && (pod ? (
        <div className="flex items-center gap-2.5 pt-1">
          <img src={briefApi.mediaFileUrl(pod.photo)} alt="Delivery proof" className="w-14 h-14 rounded-xl object-cover shrink-0" />
          <p className="text-[12px]" style={{ color: 'rgba(36,31,26,0.66)' }}>
            Delivery photo · {pod.by} · {ago(pod.at) ?? '—'}
          </p>
        </div>
      ) : (
        <div className="pt-1">
          <p className="text-[12px]" style={{ color: 'rgba(36,31,26,0.55)' }}>No delivery photo.</p>
          {(e.iAmTheCarrier || e.iAmThePoster) && (
            podOpen ? (
              <div className="space-y-2 pt-2">
                <ImageField
                  label="Delivery photo"
                  hint="The item at the door, or the signed receipt."
                  value={podPhoto}
                  onChange={setPodPhoto}
                  compact
                />
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={!podPhoto || podBusy} onClick={() => void savePod()}
                    className="brief-lobby-btn brief-lobby-btn--primary disabled:opacity-50">
                    {podBusy ? 'Attaching…' : 'Attach photo'}
                  </button>
                  <button type="button" onClick={() => { setPodOpen(false); setPodPhoto(null); setPodMsg(''); }}
                    className="brief-lobby-btn brief-lobby-btn--quiet">
                    Cancel
                  </button>
                </div>
                {podMsg && <p className="text-[12px] font-bold" role="alert" style={{ color: 'var(--color-danger)' }}>{podMsg}</p>}
              </div>
            ) : (
              <button type="button" onClick={() => { soundEngine.play('tap'); setPodOpen(true); }}
                className="brief-lobby-btn brief-lobby-btn--quiet mt-1.5">
                Add delivery photo
              </button>
            )
          )}
        </div>
      ))}

      {/* Ratings, listed exactly as said. */}
      {e.ratings.length > 0 && (
        <ul className="space-y-1 pt-1">
          {e.ratings.map((r) => (
            <li key={r.id} className="text-[12px]" style={{ color: 'rgba(36,31,26,0.7)' }}>
              <Star className="w-3 h-3 inline" style={{ color: 'var(--color-primary)' }} />{' '}
              <strong>{r.stars}</strong>/5 on {r.about === 'carrier' ? 'the carrier' : 'the poster'} · {r.by}
              {r.note ? ` — “${r.note}”` : ''} · {ago(r.createdAt)}
            </li>
          ))}
        </ul>
      )}
      {e.canRate && onRate && (
        <div className="flex items-center gap-1.5 flex-wrap pt-1">
          <span className="text-[12px] font-bold" style={{ color: '#241F1A' }}>
            Rate this delivery:
          </span>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
              aria-pressed={stars === n}
              disabled={busy === `${e.id}:rate`}
              onClick={() => { setStars(n); onRate(n); }}
              className="brief-lobby-star"
            >
              {n}
            </button>
          ))}
          <span className="text-[11px]" style={{ color: 'rgba(36,31,26,0.6)' }}>{e.ratingsNote}</span>
        </div>
      )}
    </article>
  );
}

export default ErrandsLobby;
