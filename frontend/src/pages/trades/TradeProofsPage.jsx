import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, BadgeCheck, Check, MessageCircle, Receipt, ScanLine, Store,
  X,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { apiError } from "@/lib/api";
import { formatKes, merchantSlug } from "@/lib/receipts";
import { receiptsAPI } from "@/lib/receiptsApi";
import { relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * RECEIPT-BACKED TRADES — the second signature.
 *
 * The buyer has the paper; the shop has the till. One side is a claim, two
 * sides are a trade. This screen is where a shop says yes (or says the receipt
 * is not theirs), and where a buyer can see what is still waiting.
 *
 * An unmatched row is not an error. It says the shop is not on Home Office
 * yet, and offers the one zero-cost next step: a WhatsApp invite.
 */

const FILTERS = [
  { value: "all", label: "All" },
  { value: "mine", label: "For you" },
  { value: "waiting", label: "Waiting" },
  { value: "confirmed", label: "Confirmed" },
  { value: "unmatched", label: "Not on Home Office" },
];

function statusTone(status) {
  if (status === "confirmed") return "brand";
  if (status === "disputed") return "red";
  if (status === "unmatched") return "gray";
  return "amber";
}

function statusLabel(status) {
  if (status === "confirmed") return "Confirmed";
  if (status === "disputed") return "Questioned";
  if (status === "unmatched") return "Not on Home Office";
  return "Waiting";
}

function inviteLink(merchant, pin) {
  const name = merchant || "your shop";
  const text =
    `I have a receipt from ${name} on Home Office. ` +
    "Claim the shop page free so the trade counts for both of us.";
  const slug = merchantSlug(name) || pin || "";
  const origin = typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : "";
  const url = `${origin}/invite/${encodeURIComponent(slug)}`;
  return `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
}

export default function TradeProofsPage() {
  const [proofs, setProofs] = useState([]);
  const [summary, setSummary] = useState({});
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(null);
  const [disputing, setDisputing] = useState(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await receiptsAPI.tradeProofs();
      setProofs(data.proofs || []);
      setSummary(data.summary || {});
      setCount(data.confirmed_trade_proofs || 0);
    } catch (err) {
      setError(apiError(err, "The trade proofs could not be loaded"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const replace = (updated) => {
    setProofs((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
  };

  const confirm = async (proof) => {
    setBusy(proof.id);
    try {
      const { data } = await receiptsAPI.confirmTrade(proof.id);
      replace(data.proof);
      setSummary((current) => ({
        ...current,
        pending_for_me: Math.max(0, (current.pending_for_me || 0) - 1),
        confirmed: (current.confirmed || 0) + 1,
      }));
      setCount(data.confirmed_trade_proofs?.mine ?? count);
      toast.success("Trade confirmed for both of you.");
    } catch (err) {
      toast.error(apiError(err, "That trade could not be confirmed"));
    } finally {
      setBusy(null);
    }
  };

  const sendDispute = async (proof) => {
    if (reason.trim().length < 3) {
      toast.error("Say briefly why this receipt is not yours.");
      return;
    }
    setBusy(proof.id);
    try {
      const { data } = await receiptsAPI.disputeTrade(proof.id, reason.trim());
      replace(data.proof);
      setSummary((current) => ({
        ...current,
        pending_for_me: Math.max(0, (current.pending_for_me || 0) - 1),
      }));
      setDisputing(null);
      setReason("");
      toast.success("Marked as questioned. The buyer has been told.");
    } catch (err) {
      toast.error(apiError(err, "That question could not be sent"));
    } finally {
      setBusy(null);
    }
  };

  const shown = useMemo(() => {
    if (filter === "mine") return proofs.filter((proof) => proof.can_confirm);
    if (filter === "waiting") {
      return proofs.filter((proof) => proof.role === "buyer" && proof.status === "pending");
    }
    if (filter === "confirmed") return proofs.filter((proof) => proof.status === "confirmed");
    if (filter === "unmatched") return proofs.filter((proof) => proof.status === "unmatched");
    return proofs;
  }, [proofs, filter]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5" data-testid="trade-proofs">
      <header>
        <p className="eyebrow">Trades</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink-1">Receipt-backed trades</h1>
        <p className="mt-1.5 max-w-lg text-xs leading-relaxed text-ink-3">
          A scanned receipt is one side of a trade. When the shop confirms it, the
          trade counts for both of you — and both profiles move towards Trading.
          Nothing is paid out in cash.
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["For you", summary.pending_for_me || 0],
          ["Waiting", summary.waiting_for_shop || 0],
          ["Confirmed", count],
          ["Not on app", summary.unmatched || 0],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-edge-1 bg-surface-1 px-3 py-2.5">
            <dt className="text-micro text-ink-4">{label}</dt>
            <dd className="mt-0.5 digital text-sm font-extrabold text-ink-1">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label="Trade proof filter">
        {FILTERS.map((item) => {
          const active = filter === item.value;
          return (
            <button
              key={item.value}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(item.value)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-2xs font-bold transition-colors",
                active
                  ? "border-brand-700 bg-brand-700 text-white"
                  : "border-edge-1 bg-surface-1 text-ink-3 hover:border-edge-2 hover:text-ink-1",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-accent-200 bg-accent-50 px-3 py-2 text-2xs text-accent-800 dark:border-accent-500/30 dark:bg-accent-500/10 dark:text-accent-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={load} className="font-bold underline">Retry</button>
        </div>
      )}

      {loading ? (
        <PageSpinner label="Loading trades…" />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={filter === "all" ? "No receipt-backed trades yet" : "Nothing in this view"}
          description="Scan the eTIMS QR on a shop receipt, then ask the shop to confirm it. Both sides have to say yes."
          action={
            <Button as={Link} to="/create" icon={ScanLine} size="sm">
              Scan a receipt
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2">
          {shown.map((proof) => (
            <li
              key={proof.id}
              data-testid="trade-proof-row"
              className="rounded-2xl border border-edge-1 bg-surface-1 p-4"
            >
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-3">
                  <Store size={16} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-extrabold text-ink-1">{proof.merchant_name}</p>
                      <p className="mt-0.5 text-micro text-ink-4">
                        {formatKes(proof.amount)}
                        {proof.receipt?.scanned_at ? ` · scanned ${relativeTime(proof.receipt.scanned_at)}` : ""}
                      </p>
                    </div>
                    <Badge variant={statusTone(proof.status)} size="sm">
                      {statusLabel(proof.status)}
                    </Badge>
                  </div>

                  {proof.status === "confirmed" && (
                    <p className="mt-2 flex items-center gap-1.5 text-micro font-bold text-brand-700 dark:text-brand-300">
                      <BadgeCheck size={13} aria-hidden="true" />
                      Both sides confirmed
                      {proof.buyer?.name ? ` · ${proof.buyer.name} and ${proof.seller?.name || proof.merchant_name}` : ""}
                    </p>
                  )}

                  {proof.status === "disputed" && (
                    <p className="mt-2 text-micro leading-relaxed text-accent-700 dark:text-accent-300">
                      Questioned: {proof.dispute_reason || "The shop says this receipt is not theirs."}
                    </p>
                  )}

                  {proof.status === "pending" && proof.role === "seller" && (
                    <div className="mt-3 space-y-2">
                      {proof.can_confirm === false ? (
                        <p
                          data-testid="trade-proof-confirm-locked"
                          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-micro leading-relaxed text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                        >
                          {proof.confirm_locked_reason ||
                            "Confirming trade proofs unlocks when your shop is verified, not while it is pending or probationary."}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        {proof.can_confirm !== false && (
                          <Button
                            size="sm"
                            icon={Check}
                            data-testid="trade-proof-confirm"
                            loading={busy === proof.id}
                            onClick={() => confirm(proof)}
                          >
                            Confirm this was my shop
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={X}
                          data-testid="trade-proof-dispute"
                          onClick={() => { setDisputing(proof.id); setReason(""); }}
                        >
                          Not mine
                        </Button>
                      </div>
                    </div>
                  )}

                  {proof.status === "pending" && proof.role === "buyer" && (
                    <p className="mt-2 text-micro leading-relaxed text-ink-4">
                      Waiting for {proof.seller?.name || proof.merchant_name} to confirm.
                      The trade counts for both of you once they do.
                    </p>
                  )}

                  {proof.status === "unmatched" && (
                    <div className="mt-2">
                      <p className="text-micro leading-relaxed text-ink-4">
                        This shop is not on Home Office yet, so nobody can confirm the
                        other side. Invite them — the link is the whole growth budget.
                      </p>
                      <Button
                        as="a"
                        href={inviteLink(proof.merchant_name, proof.merchant_pin)}
                        target="_blank"
                        rel="noreferrer"
                        variant="secondary"
                        size="sm"
                        icon={MessageCircle}
                        className="mt-2"
                        data-testid="trade-proof-unmatched"
                      >
                        Invite on WhatsApp
                      </Button>
                    </div>
                  )}

                  {disputing === proof.id && (
                    <div className="mt-3 rounded-xl border border-edge-1 bg-surface-0 p-3">
                      <label htmlFor={`reason-${proof.id}`} className="text-micro font-bold text-ink-2">
                        Why is this not your shop&apos;s receipt?
                      </label>
                      <textarea
                        id={`reason-${proof.id}`}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        rows={2}
                        maxLength={1000}
                        className="mt-1.5 w-full rounded-lg border border-edge-1 bg-surface-1 px-2.5 py-2 text-xs text-ink-1 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                      />
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" variant="danger" loading={busy === proof.id} onClick={() => sendDispute(proof)}>
                          Send question
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDisputing(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="mt-2 flex items-center gap-2 text-micro text-ink-4">
                    {proof.role === "seller" ? "Buyer" : "Shop"}:{" "}
                    {proof.role === "seller" ? proof.buyer?.name : proof.seller?.name || proof.merchant_name}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-2xl border border-edge-1 bg-surface-0 p-4">
        <h2 className="eyebrow">Why both sides?</h2>
        <p className="mt-1.5 text-2xs leading-relaxed text-ink-3">
          One phone can type any story. Two phones that disagree cannot both be
          right, so a receipt only becomes a trade when the shop confirms it. A
          typed record still sits in the ledger; it just never counts here.
        </p>
        <Link to="/receipts" className="mt-2 inline-flex items-center gap-1 text-micro font-bold text-brand-700 dark:text-brand-300">
          Back to receipts
          <ArrowRight size={12} aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}
