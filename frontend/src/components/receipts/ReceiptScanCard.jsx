import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, QrCode, Receipt, Sparkles } from "lucide-react";
import Button from "@/components/ui/Button";
import ReceiptScanner from "@/components/receipts/ReceiptScanner";
import { useReceiptStore } from "@/stores/receiptStore";
import { useReceiptSync } from "@/hooks/useReceiptSync";
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
  const [open, setOpen] = useState(false);
  useReceiptSync();

  const summary = useMemo(() => networkSummary(receipts), [receipts]);
  const last = receipts[0];

  return (
    <>
      <section
        aria-labelledby="receipt-card-heading"
        data-testid="receipt-card"
        className="overflow-hidden rounded-3xl border border-edge-1 bg-surface-1 shadow-xs"
      >
        <div className="flex items-start gap-3 p-4 sm:p-5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-300">
            <QrCode size={22} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
              <h2 id="receipt-card-heading" className="text-base font-extrabold tracking-tight text-ink-1">
                Receipt rewards
              </h2>
              {points > 0 && (
                <span className="inline-flex items-center gap-1 text-micro font-bold text-accent-700 dark:text-accent-300">
                  <Sparkles size={12} aria-hidden="true" />
                  {points} points
                </span>
              )}
            </div>
            <p className="mt-1 text-2xs leading-relaxed text-ink-3">
              Scan the QR on a local shop receipt before you leave. It is worth the
              most in the first fifteen minutes, then falls — so the receipt in your
              hand right now is the one that counts.
            </p>

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
              <Button as={Link} to="/receipts" size="sm" variant="ghost" iconRight={ArrowRight}>
                Ledger &amp; shops
              </Button>
            </div>
          </div>
        </div>
      </section>

      <ReceiptScanner open={open} onClose={() => setOpen(false)} />
    </>
  );
}
