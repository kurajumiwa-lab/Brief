import React from 'react';
import { Users } from 'lucide-react';
import * as briefApi from '../api/briefApi';
import type { MyReferrals } from '../api/briefApi';
import { soundEngine } from '../utils/SoundEngine';

// REWARDS — referrals, points, and cash from a pool that real revenue backs.
// The surface states the three anti-pyramid rules in plain words, because a
// member should be able to tell an honest reward program from a scheme:
// one level deep, no entry fee, and cash only from money the business
// actually earned.
export default function RewardsDesk({ settledPoints, rank, accepted, pending }: {
  settledPoints: number; rank: string; accepted: number; pending: number;
}) {
  const [data, setData] = React.useState<MyReferrals | null>(null);
  const [shareMsg, setShareMsg] = React.useState<string | null>(null);
  const [points, setPoints] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const [mine, share] = await Promise.all([briefApi.myReferrals(), briefApi.referralShare()]);
    if (mine.ok) setData(mine.data);
    else setNote(mine.error);
    if (share.ok) setShareMsg(`${share.data.message}\n\n${share.data.waMe}`);
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const convert = async () => {
    const pts = Math.floor(Number(points));
    if (busy || !Number.isFinite(pts) || pts <= 0) return;
    setBusy(true); setNote(null);
    const res = await briefApi.convertReferralPoints(pts);
    setBusy(false);
    if (!res.ok) { setNote(res.error); return; }
    setPoints('');
    setNote(`Requested. KES ${res.data.conversion.kes} is paid to your number once finance confirms it.`);
    await load();
  };

  const copyShare = async () => {
    if (!shareMsg) return;
    try { await navigator.clipboard.writeText(shareMsg); setNote('Share message copied — paste it into WhatsApp.'); }
    catch { setNote('Copy failed — select the message below manually.'); }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h2 className="text-lg font-extrabold text-[var(--brief-ink)]">Rewards</h2>
        <p className="text-[12px] text-[var(--ink-60)] leading-snug mt-1">
          Bring people, products, services or traffic. One level deep — nobody
          above you, nobody below you paying you. No entry fee. Points become
          cash only from a pool backed by money Brief actually earned.
        </p>
      </div>

      {/* Contribution points from the existing ladder stay visible — they are
          a different currency with a different story. */}
      <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] text-[var(--ink-60)]">Contribution Points</span>
          <span className="text-lg font-extrabold text-[var(--brief-ink)]">{settledPoints.toLocaleString()}</span>
        </div>
        <p className="text-[11px] text-[var(--ink-60)]">Progress {rank} - {accepted} accepted contributions</p>
        {pending > 0 && <p className="text-[11px] text-[var(--brief-ink)]">{pending} submitted, awaiting review. Worth nothing yet.</p>}
      </div>

      {data && (
        <>
          <section aria-label="Your referral code" className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[#40916C]" aria-hidden="true" />
              <h3 className="text-[14px] font-extrabold text-[var(--brief-ink)]">Your code</h3>
            </div>
            <p className="text-lg font-extrabold tracking-widest text-[#40916C]">{data.code}</p>
            <p className="text-[11px] text-[var(--ink-60)] break-all">{data.link}</p>
            <button type="button" onClick={() => { soundEngine.play('tap'); void copyShare(); }}
              className="rounded-lg bg-[#40916C] px-3 py-2 text-[12px] font-extrabold text-[var(--accent-ink)]">
              Copy WhatsApp share message
            </button>
            {shareMsg && (
              <p className="text-[11px] text-[var(--ink-60)] whitespace-pre-line border border-[var(--brief-line)] rounded-xl p-2">{shareMsg}</p>
            )}
          </section>

          <section aria-label="Points balance" className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-4 space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] text-[var(--ink-60)]">Referral points</span>
              <span className="text-lg font-extrabold text-[var(--brief-ink)]">{data.balance.available.toLocaleString()}</span>
            </div>
            <p className="text-[11px] text-[var(--ink-60)]">
              {data.balance.earned.toLocaleString()} earned · {data.balance.locked.toLocaleString()} locked in payouts
            </p>
            <div className="flex gap-2 pt-1">
              <input value={points} onChange={(e) => setPoints(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder={`at least ${data.conversion.minPoints} points`}
                aria-label="Points to convert"
                className="flex-1 rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-well)] px-3 py-2 text-[13px] text-[var(--brief-ink)]" />
              <button type="button" onClick={() => { soundEngine.play('heavyTap'); void convert(); }} disabled={busy || !points}
                className="rounded-lg bg-[#40916C] px-3 py-2 text-[12px] font-extrabold text-[var(--accent-ink)] disabled:opacity-40">
                Convert
              </button>
            </div>
            <p className="text-[11px] text-[var(--ink-60)]">
              1 point = KES {data.conversion.ptsToKes} · pool holds KES {data.pool.availableKes.toLocaleString()} right now
              {data.pool.availableKes === 0 && ' — conversions open when the business earns; they are never printed from nothing.'}
            </p>
            {note && <p className="text-[12px] font-bold text-[var(--brief-ink)]" role="status">{note}</p>}
          </section>

          {data.conversions.length > 0 && (
            <section aria-label="Payouts" className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-4 space-y-2">
              <h3 className="text-[14px] font-extrabold text-[var(--brief-ink)]">Payouts</h3>
              {data.conversions.slice(0, 8).map((c) => (
                <div key={c.id} className="rounded-xl border border-[var(--brief-line)] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] font-bold text-[var(--brief-ink)]">{c.points.toLocaleString()} points → KES {c.kes.toLocaleString()}</p>
                    <p className={`text-[11px] font-extrabold uppercase ${c.status === 'confirmed' ? 'text-[#059669]' : c.status === 'refused' ? 'text-[#DC2626]' : 'text-[var(--ink-60)]'}`}>{c.status}</p>
                  </div>
                  {c.status === 'refused' && c.refusedReason && <p className="text-[11px] text-[#DC2626]">Refused: {c.refusedReason}</p>}
                </div>
              ))}
            </section>
          )}

          {data.events.length > 0 && (
            <section aria-label="How your points were earned" className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-4 space-y-1.5">
              <h3 className="text-[14px] font-extrabold text-[var(--brief-ink)]">How they were earned</h3>
              {data.events.slice(0, 10).map((e) => (
                <p key={e.id} className="text-[11px] text-[var(--ink-70)]">
                  +{e.points} · {e.kind === 'signup' ? 'someone joined with your code'
                    : e.kind === 'purchase' ? 'your own fulfilled order'
                      : e.kind === 'referral_order' ? 'an order by someone you brought'
                        : e.kind === 'event_signup' ? 'an event registration through your link'
                          : 'a unique visit through your link'}
                </p>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
