import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BadgePercent, MessageCircle, QrCode, Receipt, ScanLine, ShieldCheck, Store,
  Wallet,
} from "lucide-react";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { BRAND } from "@/config/brand";
import { FRESHNESS, formatKes, maskPin, merchantStats, networkSummary } from "@/lib/receipts";
import { cn } from "@/lib/utils";

/**
 * THE LEDGER AND THE LOCAL NETWORK.
 *
 * Two reads, in the order a person cares about them: what have I earned, and
 * which shops have I actually paid? The merchant list is built from real
 * receipts, never from a directory. A shop appears because somebody spent money
 * there and scanned the proof.
 *
 * Rewards are deliberately not a catalogue of invented offers. Points are
 * banked; vouchers appear when a partner merchant actually joins. An empty
 * reward shelf is honest and still useful.
 */
export default function ReceiptsView({ receipts = [], points = 0, region = null, sync = null, onScan }) {
  const merchants = useMemo(() => merchantStats(receipts), [receipts]);
  const summary = useMemo(() => networkSummary(receipts), [receipts]);

  // No WhatsApp Business API, no broadcast list, no paid install. A person sends
  // this into a group they are already in; the link opens inside the app.
  const invite =
    `I collect receipt points on ${BRAND.name}. Scan the eTIMS QR on a local shop receipt ` +
    "while you are still at the counter — it is worth the most in the first 15 minutes.";
  const ledgerUrl =
    typeof window !== "undefined" && window.location?.origin
      ? `${window.location.origin}/receipts`
      : "/receipts";
  const whatsappInvite = `https://wa.me/?text=${encodeURIComponent(`${invite} ${ledgerUrl}`)}`;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Receipts</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink-1">Your local receipts</h1>
          <p className="mt-1.5 max-w-md text-xs leading-relaxed text-ink-3">
            Every receipt is evidence of a shop you actually paid. Scanning it builds
            your merchant network and earns points — most while you are still at the
            counter.
          </p>
        </div>
        <div className="text-right">
          <p className="digital text-2xl font-extrabold text-ink-1" data-testid="receipt-points-total">
            {points}
          </p>
          <p className="text-micro text-ink-4">points banked</p>
          {sync && (
            <p
              className={cn(
                "mt-1 text-micro",
                sync.error ? "text-accent-700 dark:text-accent-300" : "text-ink-4",
              )}
              data-testid="receipt-sync"
            >
              {sync.syncing
                ? "Syncing to your account…"
                : sync.error
                  ? sync.error
                  : sync.pending > 0
                    ? `${sync.pending} saved on this phone, waiting for a connection`
                    : "Synced to your account"}
            </p>
          )}
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        <Button icon={QrCode} onClick={onScan} data-testid="receipts-scan">
          Scan a receipt
        </Button>
        {region && (
          <Button as="a" href="#merchants" variant="secondary" icon={Store}>
            {merchants.length} shops in your network
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Shops", summary.merchants],
          ["Receipts", summary.receipts],
          ["Spent", formatKes(summary.spend)],
          ["Fresh scans", summary.fresh],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-edge-1 bg-surface-1 px-3 py-2.5">
            <dt className="text-micro text-ink-4">{label}</dt>
            <dd className="mt-0.5 digital text-sm font-extrabold text-ink-1">{value}</dd>
          </div>
        ))}
      </dl>

      <section id="merchants" aria-labelledby="merchants-heading" className="rounded-2xl border border-edge-1 bg-surface-1">
        <div className="flex items-baseline justify-between gap-2 border-b border-edge-1 px-4 py-3">
          <div>
            <h2 id="merchants-heading" className="text-sm font-extrabold text-ink-1">
              Merchant network
            </h2>
            <p className="text-micro text-ink-4">Shops you have paid, strongest first</p>
          </div>
          <Store size={16} className="shrink-0 text-ink-4" aria-hidden="true" />
        </div>
        {merchants.length === 0 ? (
          <div className="p-4">
            <p className="rounded-xl border border-dashed border-edge-2 bg-surface-0 px-3 py-4 text-2xs leading-relaxed text-ink-3">
              No shops yet. A shop joins your network when you scan a receipt from it —
              never because it bought an advert.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-edge-1">
            {merchants.map((merchant, index) => (
              <li key={merchant.key} className="flex items-center gap-3 px-4 py-3" data-testid="merchant-row">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-surface-2 text-xs font-extrabold text-ink-3">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold text-ink-1">{merchant.name}</span>
                  <span className="block truncate text-micro text-ink-4">
                    {merchant.visits} {merchant.visits === 1 ? "visit" : "visits"}
                    {merchant.pin ? ` · PIN ${maskPin(merchant.pin)}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block digital text-xs font-bold text-ink-1">{formatKes(merchant.spend)}</span>
                  <span className="block text-micro text-ink-4">{merchant.points} pts</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="recent-heading" className="rounded-2xl border border-edge-1 bg-surface-1">
        <div className="flex items-baseline justify-between gap-2 border-b border-edge-1 px-4 py-3">
          <div>
            <h2 id="recent-heading" className="text-sm font-extrabold text-ink-1">Recent receipts</h2>
            <p className="text-micro text-ink-4">Newest first, with the value it earned</p>
          </div>
          <Receipt size={16} className="shrink-0 text-ink-4" aria-hidden="true" />
        </div>
        {receipts.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={ScanLine}
              title="No receipts yet"
              description="Scan the QR on a receipt while you are still at the counter to earn full points."
              action={<Button size="sm" icon={QrCode} onClick={onScan}>Open the scanner</Button>}
            />
          </div>
        ) : (
          <ul className="divide-y divide-edge-1">
            {receipts.map((receipt) => (
              <li key={receipt.id} className="flex items-center gap-3 px-4 py-3" data-testid="receipt-row">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-3">
                  <Receipt size={15} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold text-ink-1">
                    {receipt.merchant}
                  </span>
                  <span className="block truncate text-micro text-ink-4">
                    {formatKes(receipt.total)}
                    {receipt.invoice ? ` · ${receipt.invoice}` : ""}
                    {` · ${receipt.freshness_label || "value recorded"}`}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-1 text-micro font-bold",
                    receipt.points > 0
                      ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                      : "bg-surface-2 text-ink-4",
                  )}
                >
                  {receipt.points > 0 ? `+${receipt.points}` : "0"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-edge-1 bg-surface-1 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-700 dark:bg-accent-600/15 dark:text-accent-300">
            <Wallet size={17} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-extrabold text-ink-1">Rewards</h2>
            <p className="mt-1 text-2xs leading-relaxed text-ink-3">
              {points > 0
                ? `${points} points are banked. A partner shop turns them into a discount at the counter; no cash leaves the app, so there is nothing to cash out and no fee.`
                : "Points go up with every scan. Vouchers appear here when a partner shop in your region joins — none has yet."}
            </p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-micro text-ink-4">
              <ShieldCheck size={12} aria-hidden="true" />
              A reward is a discount at the counter, not a cash payout.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-edge-1 bg-surface-1 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
            <Store size={17} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-extrabold text-ink-1">For shops, without a till upgrade</h2>
            <p className="mt-1 text-2xs leading-relaxed text-ink-3">
              If your receipt printer already puts an eTIMS QR on the paper, your shop is
              already scannable. No POS integration, no tablet at the counter, no listing
              fee. Merchants fund the discount on their own Deal of the Day; the app does
              not take a cut of it.
            </p>
            <p className="mt-2 flex items-start gap-1.5 text-micro leading-relaxed text-ink-4">
              <BadgePercent size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
              The redemption design is a fixed six-character code, checked on the
              shopkeeper&apos;s phone — never cash. The code is issued with the
              voucher, so it still opens in a shop with no signal.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button as={Link} to="/referrals" variant="secondary" size="sm" icon={ArrowRight}>
                Fund a verified referral campaign
              </Button>
              <Button as={Link} to="/merchant" variant="secondary" size="sm" icon={Store}>
                For shop owners
              </Button>
              <Button as={Link} to="/receipt-rewards" variant="secondary" size="sm" icon={QrCode}>
                Priority receipt scan
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-edge-1 bg-surface-0 p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-extrabold text-ink-1">
          <MessageCircle size={15} className="text-ink-4" aria-hidden="true" />
          Bring your shops in
        </h2>
        <p className="mt-1 text-2xs leading-relaxed text-ink-3">
          There is no advertising budget here. The network grows one group chat at a time:
          send this to the group where your street already talks.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            as="a"
            href={whatsappInvite}
            target="_blank"
            rel="noreferrer"
            variant="secondary"
            size="sm"
            icon={MessageCircle}
            data-testid="receipt-share"
          >
            Invite on WhatsApp
          </Button>
          <span className="inline-flex items-center text-micro text-ink-4">
            Organic groups only — no WhatsApp API, no broadcast.
          </span>
        </div>
      </section>

      <section className="rounded-2xl border border-edge-1 bg-surface-0 p-4">
        <h2 className="eyebrow">Why a receipt loses value</h2>
        <ul className="mt-2 space-y-1.5">
          {FRESHNESS.map((step) => (
            <li key={step.key} className="flex items-start gap-2 text-2xs text-ink-3">
              <ArrowRight size={12} className="mt-0.5 shrink-0 text-ink-4" aria-hidden="true" />
              {step.label}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-micro leading-relaxed text-ink-4">
          The clock starts on the receipt, not when the app is opened. A shoebox of old
          paper is not a pension.
        </p>
      </section>
    </div>
  );
}
