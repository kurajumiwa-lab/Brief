import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, QrCode, Receipt } from "lucide-react";
import Button from "@/components/ui/Button";
import ReceiptScanner from "@/components/receipts/ReceiptScanner";
import { useReceiptStore } from "@/stores/receiptStore";
import { useAuthStore } from "@/stores/authStore";
import { useReceiptSync } from "@/hooks/useReceiptSync";
import { receiptsAPI } from "@/lib/receiptsApi";
import { networkSummary } from "@/lib/receipts";

/**
 * THE RECEIPT CARD, IN THE FEED.
 *
 * A rewards programme hidden in a settings page is a rewards programme nobody
 * joins. This is the home-feed invitation: one line about why the receipt in
 * your hand is worth something *now*, the balance you already have, and the
 * scanner one tap away.
 *
 * The urgency is honest. The value really does fall with time, and the card
 * says how long is left rather than manufacturing a countdown.
 */
export default function ReceiptScanCard() {
  const receipts = useReceiptStore((s) => s.receipts);
  const points = useReceiptStore((s) => s.points);
  const vouchers = useReceiptStore((s) => s.vouchers);
  const setVouchers = useReceiptStore((s) => s.setVouchers);
  const token = useAuthStore((s) => s.token);
  const [open, setOpen] = useState(false);
  useReceiptSync();

  // The wallet is the reward the receipt actually buys. Fetch it here too so
  // Home can say "one voucher ready" instead of describing a future feature.
  useEffect(() => {
    if (!token) return;
    receiptsAPI.vouchers()
      .then(({ data }) => setVouchers(data.vouchers || []))
      .catch(() => {});
  }, [token, setVouchers]);

  const summary = useMemo(() => networkSummary(receipts), [receipts]);
  const last = receipts[0];
  const ready = vouchers.filter((voucher) => voucher.status === "issued").length;

  return (
    <>
      <section
        aria-labelledby="receipt-card-heading"
        data-testid="receipt-card"
        className="overflow-hidden rounded-2xl border border-edge-1 bg-surface-1 shadow-xs"
      >
        <div className="flex items-start gap-3 p-4 sm:p-5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent-50 text-accent-700 dark:bg-accent-600/15 dark:text-accent-300">
            <QrCode size={22} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
              <h2 id="receipt-card-heading" className="text-base font-extrabold tracking-tight text-ink-1">
                Receipt rewards
              </h2>
              {ready > 0 && (
                <span className="inline-flex items-center gap-1 text-micro font-bold text-brand-700 dark:text-brand-300">
                  {ready} voucher{ready === 1 ? "" : "s"} ready
                </span>
              )}
            </div>
            <p className="mt-1 text-2xs leading-relaxed text-ink-3">
              {ready > 0
                ? "A voucher is waiting at a shop you actually paid. Show its six-character code at the counter — it works without a signal."
                : points > 0
                  ? "Your points can become a merchant-funded voucher. Claim one at a shop you have paid, then show the code at the counter."
                  : "Scan the QR on a local shop receipt before you leave. It is worth the most in the first fifteen minutes, then falls — so the receipt in your hand right now is the one that counts."}
            </p>

            <div
              className="mt-3 grid grid-cols-3 divide-x divide-edge-1 overflow-hidden rounded-xl border border-edge-1 bg-surface-0"
              data-testid="receipt-wallet-strip"
            >
              {[
                { label: "Receipts", value: receipts.length },
                { label: "Points", value: points },
                { label: "Vouchers ready", value: ready, testId: "receipt-vouchers-ready" },
              ].map((stat) => (
                <div key={stat.label} className="px-3 py-2">
                  <p
                    className={`text-sm font-extrabold ${stat.testId && stat.value > 0 ? "text-brand-700 dark:text-brand-300" : "text-ink-1"}`}
                    data-testid={stat.testId}
                  >
                    {stat.value}
                  </p>
                  <p className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-4">{stat.label}</p>
                </div>
              ))}
            </div>

            {last ? (
              <p className="mt-2 flex items-center gap-1.5 truncate text-micro text-ink-4">
                <Receipt size={12} aria-hidden="true" />
                Last: {last.merchant} · {last.points} pts
                {summary.merchants > 1 ? ` · ${summary.merchants} shops in your network` : ""}
              </p>
            ) : (
              <p className="mt-2 text-micro text-ink-4">
                No receipts yet. The first scan starts your local merchant map.
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" icon={QrCode} onClick={() => setOpen(true)} data-testid="receipt-card-scan">
                Scan a receipt
              </Button>
              <Button as={Link} to="/receipts#voucher-wallet" size="sm" variant="ghost" iconRight={ArrowRight}>
                {ready > 0 ? "Open my vouchers" : "Wallet & shops"}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <ReceiptScanner open={open} onClose={() => setOpen(false)} />
    </>
  );
}
