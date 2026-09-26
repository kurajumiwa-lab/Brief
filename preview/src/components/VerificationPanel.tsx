import React, { useState } from 'react';
import * as briefApi from '../api/briefApi';
import type { AccountVerificationKind, VerificationRecord } from '../api/briefApi';
import { SmileIdKycModal, SmileKycResult } from './trust/SmileIdKycModal';
import { ShieldCheck, Zap, Sparkles, CheckCircle2 } from 'lucide-react';
import { soundEngine } from '../utils/SoundEngine';

// ---------------------------------------------------------------------------
// VERIFICATION PANEL (Tikiti T6) — My Layer → Verify.
//
// Identity is verified by PEOPLE reviewing evidence or by real-time
// pan-African KYC APIs (Smile Identity for Kenyan National ID & 3D liveness):
//   * a submission creates a pending record for a reviewer (capability-gated
//     server-side; audited),
//   * standing (verified / pending / unverified) is DERIVED from the records,
//     never stored as a second truth,
//   * a reviewer's reason is shown verbatim — a rejection that explains
//     itself can be fixed; one that doesn't cannot,
//   * no documents are permanently stored on server unencrypted.
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<AccountVerificationKind, string> = {
  email: 'Email',
  phone: 'Phone',
  identity: 'Identity'
};

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-[color:var(--brief-line)] text-[var(--ink-60)]',
  approved: 'bg-[#40916C] text-[var(--accent-ink)]',
  rejected: 'bg-[color:var(--color-paper)] text-[var(--brief-ink)]',
  revoked: 'bg-[color:var(--brief-line)] text-[var(--ink-60)]'
};

export function VerificationPanel() {
  const [records, setRecords] = React.useState<VerificationRecord[] | null>(null);
  const [standing, setStanding] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);

  const [kind, setKind] = React.useState<AccountVerificationKind>('email');
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [noteMsg, setNoteMsg] = React.useState<string | null>(null);

  // Smile ID Instant KYC Modal
  const [isSmileModalOpen, setIsSmileModalOpen] = useState(false);
  const [smileSuccessInfo, setSmileSuccessInfo] = useState<SmileKycResult | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    const res = await briefApi.getMyVerification();
    if (res.ok) {
      setRecords(res.data.records);
      setStanding(res.data.standing);
    } else {
      setRecords([]);
      setError(res.error);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setNoteMsg(null);
    const res = await briefApi.submitVerification({ kind, note: note.trim() || null });
    setBusy(false);
    if (!res.ok) { setNoteMsg(res.error); return; }
    setNote(res.data.changed
      ? `Submitted for review (${KIND_LABEL[kind]}). A person checks it; you will see the outcome here.`
      : `You already have a ${KIND_LABEL[kind].toLowerCase()} review open — it is still pending.`);
    await load();
  };

  const handleSmileVerificationComplete = async (result: SmileKycResult) => {
    setSmileSuccessInfo(result);
    soundEngine.play('victory');
    // Submit auto-verification evidence via API
    await briefApi.submitVerification({
      kind: 'identity',
      providerRef: result.certificateRef,
      note: `Smile ID Pan-African KYC: National ID ${result.idNumber} verified against Kenya IPRS with ${result.confidenceScore}% 3D liveness match.`
    });
    await load();
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-extrabold text-[var(--brief-ink)]">Verify</h2>
        <p className="text-[11px] text-[var(--ink-60)] leading-snug">
          Verified email, phone and identity unlock the things compliance
          gates require. Integrated with Smile Identity for real-time Kenyan National ID & 3D facial liveness verification.
        </p>
      </div>

      {/* standing — derived by the server from the records below */}
      <div className="grid grid-cols-3 gap-2">
        {(['email', 'phone', 'identity'] as AccountVerificationKind[]).map((k) => (
          <div key={k} className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-60)]">{KIND_LABEL[k]}</p>
            <p className="mt-1 text-[13px] font-extrabold text-[var(--brief-ink)] capitalize">
              {standing[k] ?? 'unverified'}
            </p>
          </div>
        ))}
      </div>

      {/* ── FAST KYC WITH SMILE IDENTITY (<10s) ── */}
      <div className="p-4 rounded-2xl bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[var(--brief-ink)] text-white space-y-3 shadow-sm">
        <div className="flex items-start justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 rounded-full bg-[#00BFEF] text-[var(--brief-ink)] text-[11px] font-mono font-black uppercase tracking-wider">
                SMILE IDENTITY KYC
              </span>
              <span className="text-[11px] font-mono text-emerald-400 font-bold">
                &lt;10s Instant Check
              </span>
            </div>
            <h3 className="text-xs font-black text-white mt-1 flex items-center space-x-1.5">
              <span>Kenyan National ID & 3D Facial Liveness</span>
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            </h3>
          </div>
          <ShieldCheck className="w-6 h-6 text-[#00BFEF] shrink-0" />
        </div>

        <p className="text-[12px] text-slate-300 leading-relaxed">
          Skip manual queue delays. Smile Identity validates your National ID, Passport, or Alien Card directly against the Kenya IPRS national population registry with 3D biometric anti-spoofing in under 10 seconds.
        </p>

        {smileSuccessInfo ? (
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center space-x-2 text-emerald-300 text-xs font-mono">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Smile Verified ({smileSuccessInfo.certificateRef})</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              soundEngine.play('heavyTap');
              setIsSmileModalOpen(true);
            }}
            className="w-full py-2.5 rounded-xl bg-[#00BFEF] hover:bg-[#00a8d6] text-[var(--brief-ink)] font-black text-xs uppercase tracking-wider flex items-center justify-center space-x-2 shadow-md cursor-pointer transition-transform active:scale-[0.99]"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Launch Smile Identity Instant Scan (&lt;10s)</span>
          </button>
        )}
      </div>

      {/* submit manual claim */}
      <div className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-4 space-y-2">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--brief-ink)]">Manual Operator Review</p>
        <div className="flex flex-wrap gap-1.5">
          {(['email', 'phone', 'identity'] as AccountVerificationKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold cursor-pointer border ${
                kind === k ? 'bg-[#40916C] text-[var(--accent-ink)] border-[#0891B2]' : 'bg-[color:var(--color-paper)] text-[var(--ink-70)] border-[var(--brief-line)]'
              }`}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          aria-label="what a reviewer should check"
          placeholder="What should the reviewer check? (e.g. the phone number on my M-Pesa registration is …)"
          className="w-full rounded-xl border border-[var(--brief-line)] bg-[color:var(--color-well)] px-3 py-2.5 text-[13px] text-[var(--brief-ink)] resize-none"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !note.trim()}
          className="rounded-lg bg-[#40916C] px-4 py-2 text-[12px] font-extrabold text-[var(--accent-ink)] cursor-pointer disabled:opacity-40"
        >
          {busy ? 'Submitting…' : 'Submit for review'}
        </button>
        {noteMsg && <p className="text-[12px] text-[var(--brief-ink)]">{noteMsg}</p>}
      </div>

      {error && <p className="text-xs text-[var(--brief-ink)]">{error}</p>}
      {records === null && <p className="text-xs text-[var(--ink-60)]">Loading…</p>}

      {/* history */}
      {records !== null && records.length === 0 && !error && (
        <p className="text-xs text-[var(--ink-60)]">
          No verification history yet. Unverified is the honest default.
        </p>
      )}
      {records !== null && records.length > 0 && (
        <div className="space-y-2">
          {records.map((r) => (
            <div key={r.id} className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-extrabold text-[var(--brief-ink)]">{KIND_LABEL[r.kind] ?? r.kind}</p>
                <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full ${STATUS_STYLE[r.status] ?? STATUS_STYLE.pending}`}>
                  {r.status}
                </span>
              </div>
              {r.note && <p className="text-[11px] text-[var(--ink-60)]">{r.note}</p>}
              <p className="text-[11px] text-[var(--ink-60)]">
                submitted {r.submittedAt.slice(0, 10)}
                {r.reviewedAt ? ` · reviewed ${r.reviewedAt.slice(0, 10)}` : ' · awaiting review'}
              </p>
              {r.reason && (
                <p className="text-[11px] text-[var(--brief-ink)] break-words">
                  Reviewer: {r.reason}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ================= MODAL: SMILE IDENTITY KYC ================= */}
      <SmileIdKycModal
        isOpen={isSmileModalOpen}
        onClose={() => setIsSmileModalOpen(false)}
        onVerificationComplete={handleSmileVerificationComplete}
        initialDocType="national_id"
      />
    </div>
  );
}

export default VerificationPanel;
