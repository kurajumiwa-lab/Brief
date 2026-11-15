import { Check, ShieldCheck } from "lucide-react";
import { formatKes } from "@/lib/receipts";
import { shortDateTime } from "@/lib/formatters";

/**
 * THE RECEIPT BOTH PHONES SEE.
 *
 * Deliberately shaped like the M-Pesa message every shopkeeper already reads:
 * one green box, the code, what it was worth, who it came from, who took it,
 * and when. It is not a payment confirmation and it never says money moved.
 */
export default function VoucherConfirmationCard({ confirmation, compact = false }) {
  if (!confirmation) return null;
  const customer = confirmation.customer;

  return (
    <div
      className="overflow-hidden rounded-2xl border-2 border-brand-500 bg-brand-50 text-brand-950 shadow-sm dark:bg-brand-500/10 dark:text-brand-50"
      data-testid="voucher-confirmation"
    >
      <div className="flex items-center gap-2 border-b border-brand-200/80 px-4 py-3 dark:border-brand-500/25">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-white">
          <Check size={17} strokeWidth={3} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-extrabold tracking-wide">VOUCHER CONFIRMED</p>
          <p className="text-micro text-brand-800/80 dark:text-brand-100/70">
            One use. No cash paid out.
          </p>
        </div>
      </div>

      <div className="px-4 py-4">
        <p className="text-micro font-bold uppercase tracking-[0.18em] text-brand-800/70 dark:text-brand-100/60">
          Code
        </p>
        <p className="digital mt-1 text-3xl font-extrabold tracking-[0.16em]">
          {confirmation.code}
        </p>

        <dl className={compact ? "mt-3 space-y-1.5 text-xs" : "mt-4 space-y-2 text-xs"}>
          <div className="flex justify-between gap-4">
            <dt className="text-brand-800/75 dark:text-brand-100/65">Reward</dt>
            <dd className="text-right font-bold">
              {formatKes(confirmation.value_kes)} off
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-brand-800/75 dark:text-brand-100/65">From</dt>
            <dd className="text-right font-semibold">
              {customer?.name || "A customer"}
              {customer?.handle && (
                <span className="block text-micro font-normal text-brand-800/70 dark:text-brand-100/60">
                  /p/{customer.handle}
                </span>
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-brand-800/75 dark:text-brand-100/65">To</dt>
            <dd className="text-right font-semibold">{confirmation.merchant_name}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-brand-800/75 dark:text-brand-100/65">Date</dt>
            <dd className="text-right font-semibold">{shortDateTime(confirmation.redeemed_at)}</dd>
          </div>
        </dl>
      </div>

      <div className="flex items-start gap-2 border-t border-brand-200/80 bg-brand-100/50 px-4 py-2.5 text-micro text-brand-900/80 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-100/70">
        <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p>
          Standing: {confirmation.verified_trades || 0} verified{" "}
          {confirmation.verified_trades === 1 ? "trade" : "trades"} on Home Office.
          This voucher is a discount, not a payment.
        </p>
      </div>
    </div>
  );
}
