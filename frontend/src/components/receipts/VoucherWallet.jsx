import { useEffect, useMemo, useState } from "react";
import {
  BadgePercent, Clock3, Loader2, Ticket, WifiOff,
} from "lucide-react";
import Button from "@/components/ui/Button";
import VoucherConfirmationCard from "@/components/receipts/VoucherConfirmationCard";
import { useAuthStore } from "@/stores/authStore";
import { useReceiptStore } from "@/stores/receiptStore";
import { receiptsAPI } from "@/lib/receiptsApi";
import { apiError } from "@/lib/api";
import { formatKes } from "@/lib/receipts";
import { shortDate } from "@/lib/formatters";

const COUNTER_SECONDS = 5 * 60;

/**
 * THE CUSTOMER'S SIDE OF THE COUNTER.
 *
 * A voucher card is useful only if it opens inside a shop with no signal, so the
 * server hands out a fixed six-character code at issue and the wallet caches it
 * on this phone. Tapping "Use now" enlarges the code for five minutes; the code
 * itself stays valid until its expiry date.
 */
export default function VoucherWallet({ region = null }) {
  const token = useAuthStore((state) => state.token);
  const vouchers = useReceiptStore((state) => state.vouchers);
  const setVouchers = useReceiptStore((state) => state.setVouchers);
  const receipts = useReceiptStore((state) => state.receipts);

  const [offers, setOffers] = useState([]);
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState("");
  const [claiming, setClaiming] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [seconds, setSeconds] = useState(COUNTER_SECONDS);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([receiptsAPI.vouchers(), receiptsAPI.offers(region)])
      .then(([wallet, shelf]) => {
        if (cancelled) return;
        if (wallet.status === "fulfilled") {
          setVouchers(wallet.value.data.vouchers || []);
          setBalance(wallet.value.data.balance || null);
          setError("");
        } else {
          setError(apiError(wallet.reason, "The wallet could not be refreshed."));
        }
        if (shelf.status === "fulfilled") setOffers(shelf.value.data.offers || []);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, region, setVouchers]);

  // The shop redeems on its own phone. While the code is on screen, quietly ask
  // the server whether it has happened yet; no websocket and no paid push.
  useEffect(() => {
    if (!token || !openId) return undefined;
    const poll = window.setInterval(() => {
      receiptsAPI.voucher(openId)
        .then(({ data }) => {
          const current = useReceiptStore.getState().vouchers;
          setVouchers(current.map((row) => (row.id === data.id ? data : row)));
          if (data.status !== "issued") setOpenId(null);
        })
        .catch(() => {});
    }, 4000);
    return () => window.clearInterval(poll);
  }, [token, openId, setVouchers]);

  useEffect(() => {
    if (!openId) return undefined;
    setSeconds(COUNTER_SECONDS);
    const tick = window.setInterval(() => {
      setSeconds((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(tick);
  }, [openId]);

  // A deal is offered by a shop this person has actually paid. Receipt evidence
  // is what puts a shop in the wallet, not an advert.
  const shelf = useMemo(() => {
    const paid = new Set(receipts.map((receipt) => receipt.pin).filter(Boolean));
    return offers.filter((offer) => !offer.merchant_pin || paid.has(offer.merchant_pin));
  }, [offers, receipts]);

  const sorted = useMemo(() => {
    const rank = { issued: 0, redeemed: 1, expired: 2, cancelled: 3 };
    return [...vouchers].sort(
      (a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9)
        || String(b.issued_at || "").localeCompare(String(a.issued_at || "")),
    );
  }, [vouchers]);

  const claim = async (offer) => {
    setClaiming(offer.id);
    setError("");
    try {
      const { data } = await receiptsAPI.claimOffer(offer.id);
      setVouchers([data.voucher, ...useReceiptStore.getState().vouchers]);
      setBalance(data.balance || null);
      setOffers((rows) => rows.filter((row) => row.id !== offer.id));
      setOpenId(data.voucher.id);
    } catch (err) {
      setError(apiError(err, "That voucher could not be added."));
    } finally {
      setClaiming(null);
    }
  };

  if (!token) return null;

  const active = sorted.filter((voucher) => voucher.status === "issued");
  const spent = sorted.filter((voucher) => voucher.status === "redeemed");
  const hidden = sorted.filter((voucher) => ["expired", "cancelled"].includes(voucher.status));

  return (
    <section id="voucher-wallet" aria-labelledby="voucher-wallet-heading" className="space-y-3" data-testid="voucher-wallet">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="eyebrow">Vouchers</p>
          <h2 id="voucher-wallet-heading" className="mt-1 text-lg font-extrabold tracking-tight text-ink-1">
            Your voucher wallet
          </h2>
          <p className="mt-1 max-w-md text-xs leading-relaxed text-ink-3">
            A code you can show at the counter, even when the shop has no signal.
            One use, and it is a discount — never a cash payment.
          </p>
        </div>
        {balance && (
          <p className="text-micro text-ink-4">
            <span className="digital font-extrabold text-ink-1">{balance.available}</span> points available
          </p>
        )}
      </div>

      {error && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" data-testid="voucher-error">
          {error}
        </p>
      )}

      {loading && active.length === 0 && (
        <p className="flex items-center gap-2 rounded-2xl border border-edge-1 bg-surface-1 px-4 py-5 text-xs text-ink-3">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Opening your wallet…
        </p>
      )}

      {!loading && active.length === 0 && spent.length === 0 && (
        <div className="rounded-2xl border border-dashed border-edge-2 bg-surface-0 px-4 py-5">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-3">
              <Ticket size={17} aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-bold text-ink-1">No vouchers yet</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-3">
                A shop you have paid can publish a deal. Your receipt points unlock it;
                nothing here is a cash payout.
              </p>
            </div>
          </div>
        </div>
      )}

      {active.length > 0 && (
        <ul className="space-y-2">
          {active.map((voucher) => {
            const open = openId === voucher.id;
            return (
              <li
                key={voucher.id}
                className="overflow-hidden rounded-2xl border border-edge-1 bg-surface-1"
                data-testid="voucher-card"
              >
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                    <BadgePercent size={18} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold text-ink-1">
                      {voucher.merchant_name || "Local shop"}
                    </p>
                    <p className="text-xs text-ink-3">
                      {formatKes(voucher.value_kes)} off next purchase
                      {voucher.expires_at ? ` · until ${shortDate(voucher.expires_at)}` : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={open ? "secondary" : "primary"}
                    onClick={() => setOpenId(open ? null : voucher.id)}
                    data-testid="voucher-use-now"
                  >
                    {open ? "Hide code" : "Use now"}
                  </Button>
                </div>

                {open && (
                  <div className="border-t border-edge-1 bg-surface-0 px-4 py-4" data-testid="voucher-active-code">
                    <p className="text-micro font-bold uppercase tracking-[0.18em] text-ink-4">
                      Show this at the counter
                    </p>
                    <p className="digital mt-1 text-4xl font-extrabold tracking-[0.16em] text-ink-1">
                      {seconds > 0 ? voucher.code : "•••-•••"}
                    </p>
                    {seconds > 0 ? (
                      <p className="mt-1 flex items-center gap-1.5 text-micro text-ink-4">
                        <Clock3 size={12} aria-hidden="true" />
                        Screen hides in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
                        {" · "}the code stays valid until {shortDate(voucher.expires_at)}
                      </p>
                    ) : (
                      <button
                        type="button"
                        className="mt-1 text-micro font-bold text-brand-700 underline dark:text-brand-300"
                        onClick={() => setSeconds(COUNTER_SECONDS)}
                      >
                        Show it again
                      </button>
                    )}
                    <p className="mt-2 flex items-start gap-1.5 text-micro leading-relaxed text-ink-4">
                      <WifiOff size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                      The shop types these six characters into Brief. If their phone
                      is offline, the code is still here on yours.
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {spent.length > 0 && (
        <div className="space-y-2">
          <p className="text-micro font-bold uppercase tracking-[0.16em] text-ink-4">Used</p>
          {spent.map((voucher) => (
            voucher.confirmation ? (
              <VoucherConfirmationCard
                key={voucher.id}
                confirmation={voucher.confirmation}
                compact
                showShare
              />
            ) : (
              <p key={voucher.id} className="rounded-xl border border-edge-1 bg-surface-1 px-3 py-2 text-xs text-ink-3">
                {formatKes(voucher.value_kes)} off at {voucher.merchant_name || "a local shop"} — used.
              </p>
            )
          ))}
        </div>
      )}

      {hidden.length > 0 && (
        <p className="text-micro text-ink-4">
          {hidden.length} expired or cancelled {hidden.length === 1 ? "voucher" : "vouchers"} kept for your records.
        </p>
      )}

      {shelf.length > 0 && (
        <div className="rounded-2xl border border-edge-1 bg-surface-1">
          <div className="border-b border-edge-1 px-4 py-3">
            <h3 className="text-sm font-extrabold text-ink-1">Available at your shops</h3>
            <p className="text-micro text-ink-4">Published by verified shops. Points, not cash.</p>
          </div>
          <ul className="divide-y divide-edge-1">
            {shelf.map((offer) => (
              <li key={offer.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="voucher-offer">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-ink-1">{offer.title}</p>
                  <p className="truncate text-micro text-ink-4">
                    {offer.merchant_name || "Local shop"} · {formatKes(offer.discount_kes)} off
                    {offer.min_spend_kes ? ` over ${formatKes(offer.min_spend_kes)}` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={claiming === offer.id}
                  onClick={() => claim(offer)}
                  data-testid="voucher-claim"
                >
                  {offer.points_cost} pts
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
