import React, { useCallback, useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { StageStepper } from './StageStepper';
import * as briefApi from '../api/briefApi';
import type { GroupBuy } from '../api/briefApi';

/** A wa.me link to this app's group-buys door. No invented shop URL. */
function groupBuyWhatsApp(title: string): string | null {
  if (typeof window === 'undefined') return null;
  const origin = window.location.origin;
  if (!origin || origin === 'null') return null;
  const url = `${origin}${window.location.pathname || '/'}#groupbuys`;
  return `https://wa.me/?text=${encodeURIComponent(`${title} — Wairo Blue Avenue ${url}`)}`;
}

// ---------------------------------------------------------------------------
// GROUP BUY PORTAL — the "Circle & Group Buy" financial package.
//
//   INTAKE     the rapid 3-field contribution form: Member ID, amount,
//              payment source — the moment a member contributes, the engine
//              records it, writes the ledger row, and returns a structured
//              RECEIPT with a verifiable digest (shown inline).
//   STEPPER    the real-time ledger pipeline: Funding Pool Initiated -> Target
//              Achieved -> Merchant Escrow Locked -> Bulk Order Dispatched ->
//              Individual Delivery — server-authoritative, auto-advancing the
//              moment the target is covered.
//   ROUTING    every contribution and stage change emits a signal through the
//              SAME Universal Data Router a gaming update uses — configure a
//              route once and the group's WhatsApp/Telegram thread is told.
//
// Honesty: contributions are RECORDS (ledger rows), not settled payments —
// no payment rail is connected and the UI never implies money moved.
// ---------------------------------------------------------------------------

const SOURCES: { id: string; label: string }[] = [
  { id: 'mpesa', label: 'M-Pesa' },
  { id: 'cash', label: 'Cash' },
  { id: 'bank', label: 'Bank' },
  { id: 'other', label: 'Other' }
];

const money = (n: number) => `KSh ${n.toLocaleString()}`;

export function GroupBuyPortal({ onClose }: { onClose?: () => void } = {}) {
  const [buys, setBuys] = useState<GroupBuy[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<{ memberRef: string; amount: number; receiptHash: string } | null>(null);

  // the 3-field intake
  const [memberRef, setMemberRef] = useState('');
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState('mpesa');
  const [busy, setBusy] = useState(false);
  const [intakeError, setIntakeError] = useState<string | null>(null);

  // create form
  const [newTitle, setNewTitle] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    const res = await briefApi.listGroupBuys();
    if (res.ok) {
      setBuys(res.data);
      setState('ready');
      setSelectedId((cur) => cur ?? res.data[0]?.id ?? null);
    } else {
      setState('error');
      setError(res.error ?? 'could not load group buys');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = buys.find((b) => b.id === selectedId) ?? buys[0] ?? null;

  const contribute = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setIntakeError(null);
    setLastReceipt(null);
    const res = await briefApi.contributeGroupBuy(selected.id, {
      memberRef: memberRef.trim(),
      amount: Number(amount),
      source
    });
    setBusy(false);
    if (!res.ok) {
      setIntakeError(res.error);
      return;
    }
    setLastReceipt(res.data.receipt);
    setMemberRef('');
    setAmount('');
    await load();
  };

  const create = async () => {
    if (!newTitle.trim() || !newTarget.trim() || creating) return;
    setCreating(true);
    setIntakeError(null);
    const res = await briefApi.createGroupBuy({ title: newTitle.trim(), targetAmount: Number(newTarget) });
    setCreating(false);
    if (!res.ok) {
      setIntakeError(res.error);
      return;
    }
    setNewTitle('');
    setNewTarget('');
    setSelectedId(res.data.id);
    await load();
  };

  const advance = async (to: string) => {
    if (!selected) return;
    await briefApi.advanceGroupBuyStage(selected.id, to);
    await load();
  };

  // --- priced bargains (Tikiti T2) ------------------------------------------
  // A buy may price PER HEAD instead of pooling: the price falls as the room
  // fills. Everything about the price is derived server-side; this panel only
  // sends the ladder and shows the server's own view back.
  const [bargain, setBargain] = useState<briefApi.BargainView | null>(null);
  const [tierRows, setTierRows] = useState<{ min: string; pricePerHead: string }[]>([
    { min: '1', pricePerHead: '' },
    { min: '5', pricePerHead: '' },
    { min: '10', pricePerHead: '' }
  ]);
  const [bargainMax, setBargainMax] = useState('');
  const [bargainExpiry, setBargainExpiry] = useState('');
  const [bargainBusy, setBargainBusy] = useState(false);
  const [bargainNote, setBargainNote] = useState<string | null>(null);
  const [joinNote, setJoinNote] = useState<string | null>(null);

  const loadBargain = useCallback(async (id: string) => {
    setBargain(null);
    const res = await briefApi.getGroupBuy(id);
    if (res.ok) setBargain(res.data.bargain);
  }, []);

  useEffect(() => {
    if (selectedId) { void loadBargain(selectedId); setJoinNote(null); }
  }, [selectedId, loadBargain]);

  const priceBargain = async () => {
    if (!selected || bargainBusy) return;
    const tiers = tierRows
      .filter((t) => t.min.trim() && t.pricePerHead.trim())
      .map((t) => ({ min: Number(t.min), pricePerHead: Number(t.pricePerHead) }));
    if (tiers.length === 0) { setBargainNote('Give the ladder at least one band: a minimum head-count and a price per head.'); return; }
    setBargainBusy(true);
    setBargainNote(null);
    const res = await briefApi.priceGroupBuyBargain(selected.id, {
      tiers,
      maxParticipants: bargainMax.trim() ? Number(bargainMax) : null,
      // A datetime-local value has no timezone; the server owns the wall
      // anyway, so send it parsed as-is from the local clock.
      expiresAt: bargainExpiry ? new Date(bargainExpiry).toISOString() : null
    });
    setBargainBusy(false);
    if (!res.ok) { setBargainNote(res.error); return; }
    setBargainNote('Priced. The price each joiner pays now falls as the room fills.');
    await load();
    await loadBargain(selected.id);
  };

  const [mySeat, setMySeat] = useState(false);

  const joinOrLeave = async () => {
    if (!selected) return;
    setBargainBusy(true);
    setJoinNote(null);
    if (!mySeat) {
      const res = await briefApi.joinBargain(selected.id);
      setBargainBusy(false);
      if (!res.ok) { setJoinNote(res.error); return; }
      setMySeat(true);
      setJoinNote(res.data.changed
        ? `In at KSh ${res.data.participant.priceAtJoin.toLocaleString()} per head (${res.data.participant.tierLabelAtJoin}).`
        : 'You are already in this bargain.');
    } else {
      const res = await briefApi.leaveBargain(selected.id);
      setBargainBusy(false);
      if (!res.ok) { setJoinNote(res.error); return; }
      setMySeat(false);
      setJoinNote('You left the bargain; your spot opened again.');
    }
    await loadBargain(selected.id);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-[var(--brief-ink)]">Group Buy</h2>
          <p className="text-[11px] text-[var(--ink-60)]">
            Circle cycles and group orders — contributions, receipts and the pipeline, tracked by the engine.
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close group buys"
            className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-bold cursor-pointer border"
            style={{ borderColor: 'var(--brief-line)', color: 'var(--color-text-muted)', background: 'var(--color-paper)' }}
          >
            Done
          </button>
        )}
      </div>

      {state === 'loading' && <p className="text-xs text-[var(--ink-60)]">Loading…</p>}
      {state === 'error' && <p className="text-xs text-[var(--brief-ink)]">{error}</p>}

      {state === 'ready' && (
        <>
          {/* buy selector + create */}
          {buys.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {buys.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => { setSelectedId(b.id); setLastReceipt(null); }}
                  className="rounded-lg border px-2.5 py-1 text-[11px] font-extrabold cursor-pointer"
                  style={{
                    borderColor: b.id === selected?.id ? 'var(--color-primary)' : 'var(--brief-line)',
                    background: b.id === selected?.id ? 'var(--color-primary)' : 'var(--color-paper)',
                    color: b.id === selected?.id ? 'var(--accent-ink)' : 'var(--wairo-slate)'
                  }}
                >
                  {b.title}
                </button>
              ))}
            </div>
          )}

          {!selected && (
            <div className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-4">
              <p className="text-[14px] font-bold text-[var(--brief-ink)]">No group buys yet.</p>
              <p className="mt-1 text-[12px] text-[var(--ink-60)]">Open the first circle cycle or group order below.</p>
            </div>
          )}

          {/* create form */}
          <div className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-3.5">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--brief-ink)]">Open a buy</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Title (e.g. Unga December cycle)"
                className="min-w-[180px] flex-1 rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-well)] px-3 py-2 text-[13px] text-[var(--brief-ink)] outline-none focus:border-[#0891B2]"
              />
              <input
                value={newTarget}
                onChange={(e) => setNewTarget(e.target.value)}
                inputMode="numeric"
                placeholder="Target KSh"
                className="w-32 rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-well)] px-3 py-2 text-[13px] text-[var(--brief-ink)] outline-none focus:border-[#0891B2]"
              />
              <button
                type="button"
                onClick={() => void create()}
                disabled={creating || !newTitle.trim() || !newTarget.trim()}
                className="rounded-lg bg-[#40916C] px-4 py-2 text-[12px] font-extrabold text-[var(--accent-ink)] cursor-pointer disabled:opacity-40"
              >
                {creating ? '…' : 'Open'}
              </button>
            </div>
          </div>

          {selected && (
            <>
              {/* the ledger stepper */}
              <div className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-4">
                <div className="mb-3 flex items-baseline justify-between gap-2">
                  <div>
                    <p className="text-[15px] font-extrabold text-[var(--brief-ink)]">{selected.title}</p>
                    <p className="text-[11px] text-[var(--ink-60)]">
                      {money(selected.total)} of {money(selected.targetAmount)} · {selected.progressPct}% · {selected.contributionCount} contribution{selected.contributionCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  <span className="rounded-md bg-[#40916C] px-2 py-0.5 text-[11px] font-extrabold text-[var(--accent-ink)]">
                    {selected.stages[selected.stageIndex]?.label}
                  </span>
                </div>
                {groupBuyWhatsApp(selected.title) ? (
                  <a
                    href={groupBuyWhatsApp(selected.title) ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="groupbuy-whatsapp"
                    className="mb-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-black"
                    style={{ background: 'var(--wairo-green)', color: '#04310F' }}
                  >
                    <MessageCircle className="w-4 h-4" /> Share to WhatsApp
                  </a>
                ) : null}
                <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--brief-line)]">
                  <div className="h-full rounded-full bg-[#40916C] transition-all" style={{ width: `${selected.progressPct}%` }} />
                </div>
                <div className="mt-4">
                  <StageStepper stages={selected.stages} currentIndex={selected.stageIndex} />
                </div>
                {/* organiser stage controls — only the legal next move */}
                {selected.stageIndex < selected.stages.length - 1 && (
                  <button
                    type="button"
                    onClick={() => void advance(selected.stages[selected.stageIndex + 1].id)}
                    className="mt-3 rounded-lg border border-[#0891B2] px-3 py-1.5 text-[12px] font-extrabold text-[var(--brief-ink)] cursor-pointer"
                  >
                    Mark: {selected.stages[selected.stageIndex + 1].label}
                  </button>
                )}
              </div>

              {/* PRICED BARGAIN (T2): ladder pricing, per-head joins.
                  The price is the SERVER's, derived from the live count. */}
              <div className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-4 space-y-3">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--brief-ink)]">Bargain pricing</p>

                {!bargain ? (
                  <>
                    <p className="text-[12px] leading-snug text-[var(--ink-60)]">
                      Price this buy per head instead of pooling: each band drops the price for everyone who joins after it fills.
                      The ladder must climb in heads and fall in price — the server refuses anything else.
                    </p>
                    <div className="space-y-1.5">
                      {tierRows.map((t, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            value={t.min}
                            onChange={(e) => setTierRows((rows) => rows.map((r, j) => j === i ? { ...r, min: e.target.value } : r))}
                            inputMode="numeric"
                            aria-label={`band ${i + 1} minimum heads`}
                            placeholder="heads"
                            className="w-20 rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-well)] px-2.5 py-1.5 text-[13px] text-[var(--brief-ink)]"
                          />
                          <span className="text-[11px] text-[var(--ink-60)]">+ people at</span>
                          <input
                            value={t.pricePerHead}
                            onChange={(e) => setTierRows((rows) => rows.map((r, j) => j === i ? { ...r, pricePerHead: e.target.value } : r))}
                            inputMode="numeric"
                            aria-label={`band ${i + 1} price per head`}
                            placeholder="KSh / head"
                            className="w-24 rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-well)] px-2.5 py-1.5 text-[13px] text-[var(--brief-ink)]"
                          />
                          <span className="text-[11px] text-[var(--ink-60)]">each</span>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => setTierRows((rows) => [...rows, { min: '', pricePerHead: '' }])}
                        className="text-[11px] font-extrabold text-[var(--ink-60)] cursor-pointer"
                      >
                        + add a band
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={bargainMax}
                        onChange={(e) => setBargainMax(e.target.value)}
                        inputMode="numeric"
                        aria-label="maximum participants"
                        placeholder="max heads (optional)"
                        className="w-40 rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-well)] px-2.5 py-1.5 text-[13px] text-[var(--brief-ink)]"
                      />
                      <input
                        type="datetime-local"
                        value={bargainExpiry}
                        onChange={(e) => setBargainExpiry(e.target.value)}
                        aria-label="expiry"
                        className="rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-well)] px-2.5 py-1.5 text-[13px] text-[var(--brief-ink)]"
                      />
                      <button
                        type="button"
                        onClick={() => void priceBargain()}
                        disabled={bargainBusy}
                        className="rounded-lg bg-[#40916C] px-4 py-2 text-[12px] font-extrabold text-[var(--accent-ink)] cursor-pointer disabled:opacity-40"
                      >
                        {bargainBusy ? '…' : 'Price this bargain'}
                      </button>
                    </div>
                    {bargainNote && <p className="text-[12px] text-[var(--brief-ink)]">{bargainNote}</p>}
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="rounded-lg bg-[color:var(--color-well)] p-2">
                        <p className="text-[11px] text-[var(--ink-70)]">in the room</p>
                        <p className="text-[15px] font-extrabold text-[var(--brief-ink)]">{bargain.participants}{bargain.requiredParticipants ? ` / ${bargain.requiredParticipants} needed` : ''}</p>
                      </div>
                      <div className="rounded-lg bg-[color:var(--color-well)] p-2">
                        <p className="text-[11px] text-[var(--ink-70)]">join now at</p>
                        <p className="text-[15px] font-extrabold text-[var(--brief-ink)]">{bargain.currentPricePerHead != null ? money(bargain.currentPricePerHead) : '—'}</p>
                        <p className="text-[11px] text-[var(--ink-60)]">{bargain.currentTierLabel ?? ''}</p>
                      </div>
                      <div className="rounded-lg bg-[color:var(--color-well)] p-2">
                        <p className="text-[11px] text-[var(--ink-70)]">next band</p>
                        <p className="text-[15px] font-extrabold text-[var(--brief-ink)]">
                          {bargain.nextTier ? money(bargain.nextTier.pricePerHead) : 'best price'}
                        </p>
                        <p className="text-[11px] text-[var(--ink-60)]">
                          {bargain.nextTier ? `${bargain.nextTier.needs} more join${bargain.nextTier.needs === 1 ? '' : 's'}` : 'room at the final band'}
                        </p>
                      </div>
                      <div className="rounded-lg bg-[color:var(--color-well)] p-2">
                        <p className="text-[11px] text-[var(--ink-70)]">settles at</p>
                        <p className="text-[15px] font-extrabold text-[var(--brief-ink)]">{money(bargain.settlesAt)}</p>
                        <p className="text-[11px] text-[var(--ink-60)]">if the room fills</p>
                      </div>
                    </div>

                    {bargain.expiresAt && (
                      <p className="text-[11px] text-[var(--ink-60)]">
                        {bargain.expired
                          ? 'This bargain has expired — no more joins.'
                          : `Open until ${new Date(bargain.expiresAt).toLocaleString('en-KE')} — the server\\u2019s clock decides, not yours.`}
                      </p>
                    )}
                    {bargain.maxParticipants != null && (
                      <p className="text-[11px] text-[var(--ink-60)]">
                        {bargain.spotsLeft === 0 ? 'Full — every spot is taken.' : `${bargain.spotsLeft} spot${bargain.spotsLeft === 1 ? '' : 's'} left of ${bargain.maxParticipants}.`}
                      </p>
                    )}
                    {bargain.requiredParticipants != null && (
                      <p className="text-[11px] text-[var(--ink-60)]">
                        {bargain.minimumMet ? 'The minimum is met — this bargain will execute.' : `Waiting for ${bargain.requiredParticipants - bargain.participants} more before the bargain executes.`}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void joinOrLeave()}
                        disabled={bargainBusy || bargain.expired}
                        className="rounded-lg bg-[#40916C] px-4 py-2 text-[12px] font-extrabold text-[var(--accent-ink)] cursor-pointer disabled:opacity-40"
                      >
                        {bargainBusy ? '…' : mySeat ? 'Leave the bargain' : 'Join at the current price'}
                      </button>
                      <span className="text-[11px] leading-snug text-[var(--ink-70)]">
                        You commit at today\\u2019s band; if a better band fills later, everyone settles at the final price.
                        Money moves only through the ordinary chain — nothing is charged here.
                      </span>
                    </div>
                    {joinNote && <p className="text-[12px] text-[var(--brief-ink)]">{joinNote}</p>}
                  </>
                )}
              </div>

              {/* the 3-field intake */}
              <div className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-4 space-y-2.5">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--brief-ink)]">Record a contribution</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <input
                    value={memberRef}
                    onChange={(e) => setMemberRef(e.target.value)}
                    placeholder="Member ID"
                    className="rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-well)] px-3 py-2 text-[13px] text-[var(--brief-ink)] outline-none focus:border-[#0891B2]"
                  />
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="numeric"
                    placeholder="Amount KSh"
                    className="rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-well)] px-3 py-2 text-[13px] text-[var(--brief-ink)] outline-none focus:border-[#0891B2]"
                  />
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    className="rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-well)] px-2 py-2 text-[13px] text-[var(--brief-ink)]"
                    aria-label="Payment source"
                  >
                    {SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => void contribute()}
                  disabled={busy || !memberRef.trim() || !Number(amount)}
                  className="w-full rounded-lg bg-[#40916C] py-2.5 text-[13px] font-extrabold text-[var(--accent-ink)] cursor-pointer disabled:opacity-40"
                >
                  {busy ? 'Recording…' : 'Record contribution'}
                </button>
                <p className="text-[11px] leading-snug text-[var(--ink-70)]">
                  A contribution is a ledger record with a verifiable receipt — and it notifies the group's routed
                  channels automatically. No payment rail is connected, so nothing pretends money moved.
                </p>

                {intakeError && <p className="text-[12px] text-[var(--brief-ink)]">{intakeError}</p>}

                {/* the structured receipt */}
                {lastReceipt && (
                  <div className="rounded-xl border border-[#0891B2] bg-[color:var(--color-well)] p-3">
                    <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--brief-ink)]">Ledger receipt</p>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[12px]">
                      <span className="font-bold text-[var(--brief-ink)]">{lastReceipt.memberRef} · {money(lastReceipt.amount)}</span>
                      <span className="font-mono text-[11px] text-[var(--ink-60)]">#{lastReceipt.receiptHash.slice(0, 12)}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* the contributions feed */}
              {selected.contributions.length > 0 && (
                <div className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-4">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--brief-ink)]">
                    Contributions ({selected.contributionCount})
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {selected.contributions.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-2 text-[12px]">
                        <span className="min-w-0 truncate font-semibold text-[var(--brief-ink)]">{c.memberRef}</span>
                        <span className="shrink-0 font-mono text-[var(--brief-ink)]">{money(c.amount)}</span>
                        <span className="shrink-0 rounded-full border border-[var(--brief-line)] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[var(--ink-60)]">{c.source}</span>
                        <span className="shrink-0 font-mono text-[11px] text-[var(--ink-60)]">#{c.receiptHash.slice(0, 8)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default GroupBuyPortal;
