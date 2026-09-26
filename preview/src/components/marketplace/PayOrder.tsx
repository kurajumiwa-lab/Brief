import React from 'react';
import * as briefApi from '../../api/briefApi';
import type { Order, PaymentIntent } from '../../api/types';
import { money } from './ListingCard';

// ---------------------------------------------------------------------------
// PAY ORDER (M-Pesa STK Push, via the configured payment rail)
//
// The buyer's checkout. One input (their phone number) and one button. The
// amount is NEVER entered here -- the server reads it from the order row.
//
// HONESTY RULES BAKED IN:
//   - "charged" / a dispatched STK prompt is NOT success. The only word that
//     counts is the server's intent status, discovered by polling
//     getOrderPayments() -- never by trusting the redirect or the button.
//   - Each state maps to the server's actual intent state machine. There is
//     no client-side notion of "probably paid".
//   - A failed or cancelled payment can be retried; a confirmed one cannot be
//     paid again (the server refuses, and this component hides the button).
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<string, string> = {
  intent: 'Payment requested',
  authorized: 'Waiting for payment',
  confirmed: 'Payment confirmed',
  failed: 'Payment failed',
  cancelled: 'Payment cancelled',
  reversed: 'Payment refunded'
};

const STATUS_TONE: Record<string, string> = {
  intent: 'text-[var(--brief-ink)]',
  authorized: 'text-[var(--brief-ink)]',
  confirmed: 'text-[var(--brief-ink)]',
  failed: 'text-[var(--brief-ink)]',
  cancelled: 'text-[var(--brief-ink)]',
  reversed: 'text-[var(--brief-ink)]'
};

const TERMINAL = new Set(['confirmed', 'failed', 'cancelled', 'reversed']);

export interface PayOrderProps {
  order: Order;
  /** Called once the server confirms payment, so the parent can refetch. */
  onPaid?: () => void;
}

export function PayOrder({ order, onPaid }: PayOrderProps) {
  const [phone, setPhone] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [intent, setIntent] = React.useState<PaymentIntent | null>(null);
  const [polling, setPolling] = React.useState(false);

  const onPaidRef = React.useRef(onPaid);
  onPaidRef.current = onPaid;

  // The one authority: the server's payment intents for this order.
  const refresh = React.useCallback(async () => {
    const res = await briefApi.getOrderPayments(order.id);
    if (!res.ok) return null;
    const list = res.data;
    return list.length ? list[list.length - 1] : null;
  }, [order.id]);

  // Poll while a payment is live, and only while it is live. Success is the
  // server's `confirmed`; the client merely reports it.
  React.useEffect(() => {
    if (!polling) return;
    let stop = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const tick = async () => {
      const latest = await refresh();
      if (stop || !latest) return;
      setIntent(latest);
      if (latest.status === 'confirmed') {
        setPolling(false);
        onPaidRef.current?.();
        return;
      }
      if (TERMINAL.has(latest.status)) setPolling(false);
    };

    void tick();
    timer = setInterval(tick, 3000);
    return () => {
      stop = true;
      if (timer) clearInterval(timer);
    };
  }, [polling, refresh]);

  const pay = async () => {
    setBusy(true);
    setError(null);
    const res = await briefApi.payOrder(order.id, phone.trim());
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setIntent(res.data.intent);
    // Even a dispatched prompt is only "waiting" -- start polling for the
    // verified state rather than claiming anything.
    setPolling(true);
  };

  const status = intent?.status ?? null;
  // A live (non-terminal) payment is in flight: show the wait, hide the form.
  const inFlight = status === 'intent' || status === 'authorized';

  return (
    <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-extrabold text-[var(--brief-ink)]">Pay with M-Pesa</p>
      </div>

      <p className="text-sm font-extrabold text-[var(--brief-ink)]">
        {money(order.total, order.currency)}
      </p>

      {error && <p className="text-[11px] text-[var(--brief-ink)]">{error}</p>}

      {status && (
        <p className={`text-[12px] font-bold ${STATUS_TONE[status] ?? 'text-[var(--ink-60)]'}`}>
          {STATUS_LABEL[status] ?? status}
          {status === 'failed' && intent?.failureReason
            ? ` — ${intent.failureReason}`
            : ''}
        </p>
      )}

      {!inFlight && (
        <div className="space-y-1.5">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="M-Pesa number, e.g. 0722 000 111"
            inputMode="tel"
            className="w-full bg-[color:var(--color-well)] border border-[var(--brief-line)] rounded-lg px-3 py-2 text-xs text-[var(--brief-ink)] placeholder:text-[var(--ink-60)] outline-none focus:border-[#0891B2]"
          />
          <button
            onClick={pay}
            disabled={busy || phone.trim().length < 9}
            className="w-full px-3 py-2 rounded-lg bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-[12px] cursor-pointer disabled:opacity-40"
          >
            {busy ? 'Requesting payment…' : 'Pay now'}
          </button>
          <p className="text-[11px] text-[var(--ink-60)] leading-snug">
            A prompt is sent to your phone. Confirmation appears only after
            Brief verifies the payment.
          </p>
        </div>
      )}

      {inFlight && (
        <p className="text-[11px] text-[var(--ink-60)] leading-snug">
          Check your phone for the M-Pesa prompt and enter your PIN. This
          screen updates automatically once the payment is verified.
        </p>
      )}
    </div>
  );
}
