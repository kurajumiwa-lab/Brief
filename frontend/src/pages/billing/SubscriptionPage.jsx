import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CreditCard, Info, RefreshCw } from "lucide-react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { billingAPI, apiError } from "@/lib/api";

/**
 * SUBSCRIPTION — Track 2 (v2.15).
 *
 * Two things this screen refuses to do:
 *
 *   1. Imply billing is live when the provider is a mock. If `billing.live` is
 *      false the page says so, in the same place a receipt would be.
 *   2. Treat a click as a payment. A plan only activates from a verified
 *      provider event; until then the invoice says pending.
 */

const STATUS_META = {
  trialing: { label: "Trial", variant: "blue" },
  active: { label: "Active", variant: "brand" },
  past_due: { label: "Payment failed", variant: "amber" },
  cancelled: { label: "Cancelled", variant: "gray" },
  expired: { label: "Lapsed", variant: "gray" },
};

const money = (n) => `KES ${Number(n || 0).toLocaleString("en-KE")}`;
const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "—");

export default function SubscriptionPage() {
    const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: body } = await billingAPI.me();
      setData(body);
      setError(null);
    } catch (err) {
      setError(apiError(err, "Could not read your billing"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (label, fn, success) => {
    setBusy(label);
    try {
      await fn();
      toast.success(success);
      await load();
    } catch (err) {
      toast.error(apiError(err, `${label} failed`));
    } finally {
      setBusy("");
    }
  };

  if (loading && !data) return <PageSpinner label="Reading your plan…" />;

  if (error && !data) {
    return (
      <Card>
        <p className="text-sm font-semibold text-ink-1">Billing could not be loaded</p>
        <p className="text-2xs text-ink-3 mt-0.5">{error}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={load}>Try again</Button>
      </Card>
    );
  }

  const sub = data?.subscription;
  const live = data?.billing?.live;
  const meta = sub ? STATUS_META[sub.status] || STATUS_META.expired : null;
  const paidPlans = (data?.catalogue || []).filter((p) => p.price_kes_monthly > 0);

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-2xs uppercase tracking-wide text-ink-4">Subscription</p>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-1">
            {data?.plan?.name || "Your plan"}
          </h1>
          <p className="text-sm text-ink-3 mt-0.5">
            {data?.plan?.price_kes_monthly
              ? `${money(data.plan.price_kes_monthly)} per month`
              : "Free — no card, no expiry."}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading} aria-label="Refresh billing">
          <RefreshCw size={15} className={loading ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </div>

      {/* The honesty bar: whether money can actually move here. */}
      <Card className={live ? "border-emerald-200 dark:border-emerald-500/30" : "border-amber-200 dark:border-amber-500/30"}>
        <div className="flex items-start gap-2.5">
          <Info size={17} className={live ? "text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" : "text-amber-600 dark:text-amber-400 mt-0.5 shrink-0"} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink-1">
              {live ? `Charges run through ${data.billing.provider}` : "Recurring billing is not live"}
            </p>
            <p className="text-2xs text-ink-3 mt-0.5 leading-relaxed">
              {live
                ? "A plan activates only after the provider confirms payment. If a charge fails you keep your plan during the grace period."
                : data?.billing?.reason}
            </p>
          </div>
        </div>
      </Card>

      {sub && (
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold text-ink-1">{data.plan.name}</p>
                <Badge variant={meta.variant}>{meta.label}</Badge>
              </div>
              <p className="text-2xs text-ink-3 mt-1">
                {sub.status === "trialing" && sub.trial_ends_at
                  ? `Trial ends ${shortDate(sub.trial_ends_at)}`
                  : sub.status === "active"
                  ? `Renews ${shortDate(sub.current_period_end)}`
                  : sub.grace_until
                  ? `Grace period until ${shortDate(sub.grace_until)}`
                  : `Ended ${shortDate(sub.cancelled_at || sub.current_period_end)}`}
                {sub.cancel_at_period_end ? " · will not renew" : ""}
              </p>
            </div>
            <p className="text-sm font-bold text-ink-1 shrink-0">{money(sub.price_kes)}</p>
          </div>

          <div className="flex flex-wrap gap-2 mt-3">
            {["trialing", "active", "past_due"].includes(sub.status) && !sub.cancel_at_period_end && (
              <Button
                size="sm"
                variant="secondary"
                disabled={Boolean(busy)}
                onClick={() => run("Cancel", () => billingAPI.cancel(false), "Subscription will end at the period's close")}
              >
                Cancel at period end
              </Button>
            )}
            {["trialing", "active", "past_due"].includes(sub.status) && (
              <Button
                size="sm"
                variant="ghost"
                disabled={Boolean(busy)}
                onClick={() => run("Cancel now", () => billingAPI.cancel(true), "Subscription ended")}
              >
                Cancel immediately
              </Button>
            )}
          </div>
        </Card>
      )}

      {!sub && (
        <Card>
          <p className="text-sm font-bold text-ink-1">Choose a plan</p>
          <p className="text-2xs text-ink-3 mt-0.5 mb-3">
            Starter stays free. Paid plans add seats, watches and the verification queue.
          </p>
          <div className="space-y-2">
            {paidPlans.map((plan) => (
              <div key={plan.tier} className="flex items-center justify-between gap-3 rounded-xl border border-edge-1 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-1">{plan.name}</p>
                  <p className="text-micro text-ink-4">
                    {plan.max_seats} seat{plan.max_seats === 1 ? "" : "s"} · {plan.max_watches} watches
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-2xs font-semibold text-ink-2">{money(plan.price_kes_monthly)}/mo</span>
                  <Button
                    size="sm"
                    disabled={Boolean(busy)}
                    onClick={() => run("Subscribe", () => billingAPI.subscribe(plan.tier), `${plan.name} started`)}
                  >
                    Subscribe
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {data?.invoices?.length ? (
        <Card>
          <p className="text-sm font-bold text-ink-1 mb-2">Invoices</p>
          <div className="divide-y divide-edge-1">
            {data.invoices.map((invoice) => (
              <div key={invoice.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-2xs font-semibold text-ink-2">
                    {money(invoice.amount_kes)} · {invoice.status}
                  </p>
                  <p className="text-micro text-ink-4">
                    {shortDate(invoice.period_start)} → {shortDate(invoice.period_end)}
                    {invoice.paid_at ? ` · paid ${shortDate(invoice.paid_at)}` : ""}
                  </p>
                  {invoice.failure_reason ? (
                    <p className="text-micro text-rose-600 dark:text-rose-400 mt-0.5">
                      {invoice.failure_reason}
                    </p>
                  ) : null}
                </div>
                {invoice.status === "pending" && (
                  <div className="shrink-0 text-right">
                    <p className="text-micro text-ink-4">awaiting provider</p>
                    {!live && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={Boolean(busy)}
                        onClick={() => run("Simulate", () => billingAPI.simulatePayment(invoice.id), "Mock payment applied — no money moved")}
                      >
                        <CreditCard size={13} /> Simulate
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <p className="text-micro text-ink-4 leading-relaxed px-1">
        {data?.terms?.lapse_policy} Grace period: {data?.terms?.grace_days} days.
        {" "}<Link to="/legal" className="underline">Refunds and disputes</Link>.
      </p>
    </div>
  );
}
