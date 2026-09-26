import React from 'react';
import { Wallet, X } from 'lucide-react';
import * as briefApi from '../api/briefApi';
import type { MyServiceFees, ServiceFeeTarget } from '../api/briefApi';

/**
 * FEE PAY SHEET — the shared pay-for-a-service flow behind BoostSheet and
 * LeadPackSheet.
 *
 * Invariants this component exists to keep:
 * 1. Prices are ALWAYS read from the server catalog — the client renders
 *    only `services` rows the server sent and never names a price itself.
 * 2. The flow is the honest manual one: pay Pochi la Biashara in your M-Pesa
 *    app, paste the confirmation code, service stays PENDING until a finance
 *    operator confirms the code. Nothing here pretends a payment succeeded.
 * 3. The request body never carries an amount — only the service key, the
 *    code, and (optionally) what the payment was for.
 */
export interface FeePaySheetProps {
  /** Sheet title, e.g. 'Promote this listing'. */
  title: string;
  /** One line of plain explanation above the price list. */
  intro: string;
  /** Catalog keys this sheet is allowed to offer, in display order. */
  serviceKeys: string[];
  /** What the payment is for; forwarded to the operator, never priced. */
  target: ServiceFeeTarget;
  /** Extra line shown after a successful submission, e.g. what happens next. */
  afterSubmit: string;
  onClose: () => void;
  /** Fired after a payment row is recorded (parent may refresh). */
  onPaid?: () => void;
}

export function FeePaySheet({ title, intro, serviceKeys, target, afterSubmit, onClose, onPaid }: FeePaySheetProps) {
  const [data, setData] = React.useState<MyServiceFees | null>(null);
  const [unavailable, setUnavailable] = React.useState<string | null>(null);
  const [service, setService] = React.useState('');
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    void briefApi.myServiceFees().then((res) => {
      if (!live) return;
      if (!res.ok) { setUnavailable(res.error); return; }
      setData(res.data);
      const first = serviceKeys.find((k) => res.data.services.some((s) => s.key === k));
      if (first) setService(first);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only catalog rows this sheet may offer AND the server actually listed.
  const offered = (data?.services ?? []).filter((s) => serviceKeys.includes(s.key));

  const pay = async () => {
    if (busy || !service || code.trim().length < 8) return;
    setBusy(true); setNote(null);
    const res = await briefApi.payServiceFee(service, code.trim(), target);
    setBusy(false);
    if (!res.ok) { setNote(res.error); return; }
    setCode('');
    setNote(`Recorded and pending. ${afterSubmit}`);
    onPaid?.();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[rgba(10, 14, 20, 0.40)] p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md rounded-t-3xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-5 shadow-2xl sm:rounded-3xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-[#40916C]" aria-hidden="true" />
            <h2 className="text-[14px] font-extrabold text-[var(--brief-ink)]">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer rounded-full p-1 text-[var(--ink-70)] hover:bg-[color:var(--color-well)]">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mb-3 text-[12px] leading-relaxed text-[var(--ink-70)]">{intro}</p>

        {unavailable && (
          <p className="rounded-xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-3 text-[12px] font-semibold text-[#DC2626]">
            Payments are unavailable right now: {unavailable}
          </p>
        )}

        {!unavailable && offered.length === 0 && (
          <p className="rounded-xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-3 text-[12px] font-semibold text-[var(--ink-60)]">
            This service is not on the server's price list yet.
          </p>
        )}

        {offered.length > 0 && (
          <div className="space-y-2">
            {/* The Pochi number is stated or honestly absent — never invented. */}
            <p className="text-[12px] text-[var(--ink-70)]">
              {data?.pochi
                ? <>Pay with M-PESA to <span className="font-bold text-[var(--brief-ink)]">Pochi la Biashara {data.pochi}</span>, then paste the confirmation code below.</>
                : 'Pay to the Brief Pochi la Biashara number (ask for it if you do not have it), then paste the confirmation code below.'}
            </p>

            {offered.map((svcItem) => (
              <label key={svcItem.key} className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 py-2 ${service === svcItem.key ? 'border-[#40916C] bg-[color:var(--color-well)]' : 'border-[var(--brief-line)]'}`}>
                <span className="flex items-center gap-2">
                  <input type="radio" name="feepay-service" checked={service === svcItem.key} onChange={() => setService(svcItem.key)} aria-label={svcItem.label} />
                  <span className="text-[12px] font-bold text-[var(--brief-ink)]">{svcItem.label}</span>
                </span>
                {/* The price comes from the server catalog — never from this file. */}
                <span className="text-[12px] font-extrabold text-[#40916C]">KES {svcItem.amountKes}</span>
              </label>
            ))}

            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="M-PESA code, e.g. QJD31X5K2S"
              aria-label="M-Pesa confirmation code"
              className="w-full rounded-xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-3 py-2 text-[13px] font-semibold text-[var(--brief-ink)] outline-none placeholder:text-[var(--ink-60)] focus:border-[#0891B2]"
            />

            <button
              type="button"
              onClick={() => void pay()}
              disabled={busy || !service || code.trim().length < 8}
              className="w-full cursor-pointer rounded-xl bg-[#40916C] py-2.5 text-[13px] font-extrabold text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Recording…' : 'Submit confirmation code'}
            </button>

            {note && <p className="text-[12px] font-semibold leading-relaxed text-[var(--ink-70)]">{note}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
