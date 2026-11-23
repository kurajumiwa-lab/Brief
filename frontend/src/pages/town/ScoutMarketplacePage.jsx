import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BadgeCheck, Coins, Star, Wallet,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import CorridorTaskBoard from "@/components/tasks/CorridorTaskBoard";
import { useAuthStore } from "@/stores/authStore";
import { apiError } from "@/lib/api";
import { townAPI } from "@/lib/townApi";
import { formatKes } from "@/lib/receipts";
import { DEFAULT_REGION, regionFromPlace } from "@/config/regions";

const TYPE_NOTE = {
  CUSTOMER_ACQUISITION: "Bring customers who complete a qualifying first purchase.",
  DEAL_SPOT_CHECK: "Photograph stock, price tags or a shelf and answer the checklist.",
  QR_DISTRIBUTION: "Place the shop's QR card and record where it was placed.",
  DELIVERY_HANDOFF: "Hand the parcel over and capture the timestamped photo.",
};

export default function ScoutMarketplacePage() {
  const vendor = useAuthStore((s) => s.vendor);
  const location = useAuthStore((s) => s.vendor?.physical_location);
  const [board, setBoard] = useState(null);
  const [profile, setProfile] = useState(null);
  const [fees, setFees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payFor, setPayFor] = useState(null);
  const [rateFor, setRateFor] = useState(null);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [rating, setRating] = useState(5);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const region = useMemo(() => regionFromPlace(location) || DEFAULT_REGION, [location]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [boardRes, profileRes, feesRes] = await Promise.all([
        townAPI.scoutBoard({ region_slug: region?.slug, days: 14 }),
        townAPI.scoutProfile(),
        townAPI.scoutFees(),
      ]);
      setBoard(boardRes.data);
      setProfile(profileRes.data);
      setFees(feesRes.data?.fees || []);
    } catch (err) {
      setError(apiError(err, "The scout board could not be loaded"));
    } finally {
      setLoading(false);
    }
  }, [region?.slug]);

  useEffect(() => { load(); }, [load]);

  const actionable = (board?.tasks || []).filter(
    (task) => task.status === "COMPLETED" && (task.is_assignee || task.is_creator),
  );

  async function reportPayment() {
    if (!payFor) return;
    setBusy(true);
    try {
      await townAPI.confirmScoutPayment(payFor.id, {
        amount_kes: Number(amount),
        payment_reference: reference,
      });
      toast.success("Reported. The merchant still has to acknowledge it.");
      setPayFor(null);
      setAmount("");
      setReference("");
      load();
    } catch (err) {
      toast.error(apiError(err, "The payment could not be reported"));
    } finally {
      setBusy(false);
    }
  }

  async function acknowledgePayment(task) {
    try {
      await townAPI.acknowledgeScoutPayment(task.id);
      toast.success("Acknowledged. The scout's report now has a second signal.");
      load();
    } catch (err) {
      toast.error(apiError(err, "The acknowledgement failed"));
    }
  }

  async function submitRating() {
    if (!rateFor) return;
    setBusy(true);
    try {
      await townAPI.rateScout(rateFor.id, { rating, note });
      toast.success("Rating recorded.");
      setRateFor(null);
      setNote("");
      load();
    } catch (err) {
      toast.error(apiError(err, "The rating could not be saved"));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !board) return <PageSpinner label="Opening the scout board…" />;
  if (error) return <EmptyState icon={Coins} tone="danger" title="The board is down" description={error} action={<Button size="sm" onClick={load}>Try again</Button>} />;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Scout marketplace</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink-1">Local work, paid directly</h1>
          <p className="mt-1.5 max-w-xl text-xs leading-relaxed text-ink-3">
            Merchants publish customer acquisition, shop verification, delivery and QR-distribution
            jobs. Scouts claim them and submit evidence. The merchant pays the scout directly over
            M-Pesa; the platform records a transparent percentage fee.
          </p>
        </div>
        <Button as={Link} to="/inbox" size="sm" variant="secondary" icon={ArrowRight}>
          Full work inbox
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Completed", profile?.completed_tasks || 0],
          ["Rating", profile?.rating_avg ? `${profile.rating_avg}/5` : "—"],
          ["Earned", formatKes(profile?.earned_kes || 0)],
          ["Fees on your work", formatKes(profile?.platform_fees_kes || 0)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-edge-1 bg-surface-1 px-3 py-2.5">
            <p className="text-2xs font-bold uppercase tracking-wide text-ink-4">{label}</p>
            <p className="digital mt-0.5 text-sm font-extrabold text-ink-1">{value}</p>
          </div>
        ))}
      </div>

      <Card className="space-y-2 p-4">
        <div className="flex items-center gap-2">
          <BadgeCheck size={16} className="text-brand-600 dark:text-brand-400" />
          <p className="text-sm font-extrabold text-ink-1">Fee is a percentage, not a deduction</p>
        </div>
        <p className="text-2xs leading-relaxed text-ink-3">
          The card shows the scout's full payout. The merchant pays the platform fee on top.
          Rates currently: {fees.map((fee) => `${fee.label} ${fee.fee_pct}%`).join(" · ")}.
        </p>
        <p className="text-2xs text-ink-4">{profile?.settlement}</p>
      </Card>

      {actionable.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-extrabold text-ink-1">Completed work</h2>
          <div className="space-y-2">
            {actionable.map((task) => (
              <Card key={task.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-ink-1">{task.title}</p>
                  <p className="text-micro text-ink-4">
                    {formatKes(task.worker_payout_kes)} payout · {task.is_assignee ? "You were the scout" : "You posted this"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {task.is_assignee && !task.payment_confirmation && (
                    <Button size="xs" variant="secondary" icon={Wallet} onClick={() => setPayFor(task)}>
                      Report payment
                    </Button>
                  )}
                  {task.is_assignee && task.payment_confirmation && (
                    <span className="self-center text-micro text-ink-4">
                      {task.payment_confirmation.payer_confirmed
                        ? "Payment acknowledged"
                        : "Reported — waiting for the merchant"}
                    </span>
                  )}
                  {task.is_creator && (
                    <>
                      <Button
                        size="xs"
                        variant="secondary"
                        icon={Star}
                        disabled={Boolean(task.rating)}
                        onClick={() => setRateFor(task)}
                      >
                        {task.rating ? `Rated ${task.rating.rating}/5` : "Rate scout"}
                      </Button>
                      {task.payment_confirmation && !task.payment_confirmation.payer_confirmed && (
                        <Button size="xs" variant="ghost" onClick={() => acknowledgePayment(task)}>
                          Acknowledge payment
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-extrabold text-ink-1">Open work near you</h2>
          <span className="text-micro text-ink-4">{region?.name || "Your region"} · next 14 days</span>
        </div>
        <CorridorTaskBoard data={board} onChanged={load} defaultRegion={region?.slug || "nairobi-metro"} town={vendor?.physical_location || ""} />
      </section>

      <div className="grid gap-2 sm:grid-cols-2">
        {Object.entries(TYPE_NOTE).map(([type, text]) => (
          <div key={type} className="rounded-2xl border border-edge-1 bg-surface-0 p-3">
            <p className="text-2xs font-bold uppercase tracking-wide text-ink-4">{type.replaceAll("_", " ")}</p>
            <p className="mt-1 text-2xs leading-relaxed text-ink-3">{text}</p>
          </div>
        ))}
      </div>

      <p className="flex items-center justify-center gap-1.5 text-center text-micro text-ink-4">
        <Coins size={11} /> A pasted M-Pesa message is a signal, not a platform confirmation.
      </p>

      <Modal open={Boolean(payFor)} onClose={() => setPayFor(null)} title="Report a direct payment">
        <div className="space-y-3">
          <p className="text-2xs leading-relaxed text-ink-3">
            The merchant pays you directly. This report is an unverified signal until the merchant
            acknowledges it; the platform does not move the money.
          </p>
          <Input label="Amount received (KES)" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input label="M-Pesa reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="QK55SCOUT" />
          <Button loading={busy} onClick={reportPayment}>Save report</Button>
        </div>
      </Modal>

      <Modal open={Boolean(rateFor)} onClose={() => setRateFor(null)} title="Rate the scout">
        <div className="space-y-3">
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setRating(value)}
                className={`grid h-10 w-10 place-items-center rounded-xl border ${rating >= value ? "border-amber-300 bg-amber-50 text-amber-700" : "border-edge-1 bg-surface-0 text-ink-4"}`}
                aria-label={`${value} stars`}
              >
                <Star size={16} fill={rating >= value ? "currentColor" : "none"} />
              </button>
            ))}
          </div>
          <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button loading={busy} onClick={submitRating}>Save rating</Button>
        </div>
      </Modal>
    </div>
  );
}
