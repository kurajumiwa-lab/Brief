import { useEffect, useState } from "react";
import { Check, Store, Ticket } from "lucide-react";
import Button from "@/components/ui/Button";
import VoucherConfirmationCard from "@/components/receipts/VoucherConfirmationCard";
import { useAuthStore } from "@/stores/authStore";
import { receiptsAPI } from "@/lib/receiptsApi";
import { apiError } from "@/lib/api";

/**
 * THE SHOP'S SIDE OF THE COUNTER.
 *
 * One input, one button, one receipt. No scanner, no SMS, no operator queue.
 * The shop must own the page, but it does not have to be verified: a
 * probationary owner may check vouchers while trade-proof confirmation stays
 * locked. The server decides the cap; this card only shows the door.
 */
export default function VoucherRedeemCard() {
  const token = useAuthStore((state) => state.token);
  const [merchants, setMerchants] = useState([]);
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState(null);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    receiptsAPI.myMerchants()
      .then(({ data }) => { if (!cancelled) setMerchants(data.merchants || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [token]);

  if (!token || !ready || merchants.length === 0) return null;

  const redeemable = merchants.filter((merchant) => (
    typeof merchant.can_redeem === "boolean"
      ? merchant.can_redeem
      : merchant.verified || merchant.probationary
  ));
  if (redeemable.length === 0) {
    return (
      <section className="rounded-2xl border border-edge-1 bg-surface-1 px-4 py-3" data-testid="voucher-redeem-pending">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-3">
            <Store size={16} aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-bold text-ink-1">Voucher checking unlocks after a test sale</p>
            <p className="mt-0.5 text-micro leading-relaxed text-ink-4">
              Your claim is still pending. Answer one test sale at the till, or wait
              for review, to check customer codes.
            </p>
          </div>
        </div>
      </section>
    );
  }
  const probationary = redeemable.some((merchant) => merchant.probationary);

  const submit = async (event) => {
    event.preventDefault();
    const cleaned = code.trim();
    if (!cleaned) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await receiptsAPI.redeem({ code: cleaned });
      setConfirmation(data.confirmation || data.voucher?.confirmation || null);
      setCode("");
    } catch (err) {
      setError(apiError(err, "That code could not be checked."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="rounded-2xl border border-edge-1 bg-surface-1 p-4"
      aria-labelledby="voucher-redeem-heading"
      data-testid="voucher-redeem"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
          <Ticket size={17} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="voucher-redeem-heading" className="text-sm font-extrabold text-ink-1">
            Check a customer voucher
          </h2>
          <p className="mt-0.5 text-micro leading-relaxed text-ink-4">
            {redeemable.map((merchant) => merchant.name).join(" · ")}. Type the six
            characters from the customer's screen. No scanner needed.
            {probationary ? " Probationary owners can check up to five vouchers a week." : ""}
          </p>
        </div>
      </div>

      {confirmation ? (
        <div className="mt-3 space-y-2">
          <VoucherConfirmationCard confirmation={confirmation} />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setConfirmation(null)}
            data-testid="voucher-redeem-another"
          >
            Check another code
          </Button>
        </div>
      ) : (
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={submit}>
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-micro font-bold uppercase tracking-[0.14em] text-ink-4">
              Customer voucher code
            </span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="HO-84K"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={16}
              className="h-11 w-full rounded-xl border border-edge-2 bg-surface-0 px-3 font-mono text-base font-bold tracking-[0.14em] text-ink-1 uppercase placeholder:text-ink-4 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              data-testid="voucher-redeem-code"
              aria-describedby={error ? "voucher-redeem-error" : undefined}
            />
          </label>
          <Button
            type="submit"
            size="lg"
            icon={Check}
            loading={busy}
            disabled={!code.trim()}
            data-testid="voucher-redeem-submit"
          >
            Confirm
          </Button>
        </form>
      )}

      {error && (
        <p id="voucher-redeem-error" className="mt-2 text-xs text-red-600 dark:text-red-400" data-testid="voucher-redeem-error">
          {error}
        </p>
      )}
    </section>
  );
}
