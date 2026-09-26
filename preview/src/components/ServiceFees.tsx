import React from 'react';
import { Wallet } from 'lucide-react';
import * as briefApi from '../api/briefApi';
import type { MyServiceFees, ServiceFee } from '../api/briefApi';

// SERVICE FEES — paying Brief through Pochi la Biashara. Pochi has no API,
// so the flow is honest and manual at the seams: Brief shows its Pochi
// number and the SERVER-side price, the member pays in their M-Pesa app and
// submits the confirmation code, and the fee stays PENDING until a finance
// operator confirms the code. A service never activates on trust alone.
export default function ServiceFees() {
  const [data, setData] = React.useState<MyServiceFees | null>(null);
  const [service, setService] = React.useState('');
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const res = await briefApi.myServiceFees();
    if (res.ok) {
      setData(res.data);
      if (!service && res.data.services.length > 0) setService(res.data.services[0].key);
    } else {
      setNote(res.error);
    }
  }, [service]);

  React.useEffect(() => { void load(); }, [load]);

  const pay = async () => {
    if (busy || !service || code.trim().length < 8) return;
    setBusy(true); setNote(null);
    const res = await briefApi.payServiceFee(service, code.trim());
    setBusy(false);
    if (!res.ok) { setNote(res.error); return; }
    setCode('');
    setNote('Recorded and pending. Your service activates when the operator confirms the code.');
    await load();
  };

  const statusChip = (f: ServiceFee) =>
    f.status === 'confirmed' ? 'text-[#059669]'
      : f.status === 'refused' ? 'text-[#DC2626]'
        : 'text-[var(--ink-60)]';

  return (
    <div className="space-y-4">
      <section aria-label="Pay for Brief services" className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-[#40916C]" aria-hidden="true" />
          <h2 className="text-[14px] font-extrabold text-[var(--brief-ink)]">Pay for Brief services</h2>
        </div>

        {/* The Pochi number is stated or honestly absent — never invented. */}
        <p className="text-[12px] text-[var(--ink-70)]">
          {data?.pochi
            ? <>Pay with M-PESA to <span className="font-bold text-[var(--brief-ink)]">Pochi la Biashara {data.pochi}</span>, then paste the confirmation code below.</>
            : 'The Pochi la Biashara number is not configured yet — ask for it, then paste your M-PESA confirmation code below.'}
        </p>

        <div className="space-y-2">
          {(data?.services ?? []).map((svcItem) => (
            <label key={svcItem.key} className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 cursor-pointer ${service === svcItem.key ? 'border-[#40916C] bg-[color:var(--color-well)]' : 'border-[var(--brief-line)]'}`}>
              <span className="flex items-center gap-2">
                <input type="radio" name="fee-service" checked={service === svcItem.key} onChange={() => setService(svcItem.key)} aria-label={svcItem.label} />
                <span className="text-[12px] font-bold text-[var(--brief-ink)]">{svcItem.label}</span>
              </span>
              {/* The price comes from the server catalog — the client never sets it. */}
              <span className="text-[12px] font-extrabold text-[#40916C]">KES {svcItem.amountKes}</span>
            </label>
          ))}
          {data && data.services.length === 0 && (
            <p className="text-[12px] text-[var(--ink-60)]">No services are priced yet.</p>
          )}
        </div>

        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="M-PESA confirmation code"
            aria-label="M-PESA confirmation code"
            className="flex-1 rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-well)] px-3 py-2 text-[13px] tracking-wide text-[var(--brief-ink)]"
          />
          <button type="button" onClick={() => void pay()} disabled={busy || !service || code.trim().length < 8}
            className="rounded-lg bg-[#40916C] px-3 py-2 text-[12px] font-extrabold text-[var(--accent-ink)] disabled:opacity-40">
            Submit
          </button>
        </div>
        {note && <p className="text-[12px] font-bold text-[var(--brief-ink)]" role="status">{note}</p>}
      </section>

      <section aria-label="Your payments" className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-4 space-y-2">
        <h2 className="text-[14px] font-extrabold text-[var(--brief-ink)]">Your payments</h2>
        {(data?.fees ?? []).length === 0 && (
          <p className="text-[12px] text-[var(--ink-60)]">Nothing yet. Your first payment will show here, with its state.</p>
        )}
        {(data?.fees ?? []).slice(0, 10).map((f) => (
          <div key={f.id} className="rounded-xl border border-[var(--brief-line)] px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] font-bold text-[var(--brief-ink)]">{f.label}</p>
              <p className={`text-[11px] font-extrabold uppercase ${statusChip(f)}`}>{f.status}</p>
            </div>
            <p className="text-[11px] text-[var(--ink-55)]">
              KES {f.amountKes} · code {f.mpesaCode}
              {f.status === 'pending' && ' · waiting for the operator to confirm the code'}
              {f.status === 'confirmed' && f.confirmedAt && ` · confirmed ${new Date(f.confirmedAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}`}
            </p>
            {f.status === 'refused' && f.refusedReason && (
              <p className="text-[11px] text-[#DC2626]">Refused: {f.refusedReason}</p>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
