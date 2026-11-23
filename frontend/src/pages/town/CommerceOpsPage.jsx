import { useCallback, useEffect, useState } from "react";
import {
  Activity, AlertTriangle, BadgeCheck, CheckCircle2, Coins, RefreshCw,
  ShieldCheck, SlidersHorizontal, XCircle,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { apiError } from "@/lib/api";
import { commerceOpsAPI } from "@/lib/townApi";
import { formatKes } from "@/lib/receipts";
import { cn } from "@/lib/utils";

const TABS = [
  ["overview", "Overview"],
  ["credits", "Credit"],
  ["listings", "Listings"],
  ["conversions", "Conversions"],
  ["subscriptions", "Analytics"],
  ["disputes", "Disputes"],
  ["settings", "Rates"],
];

const SCOUT_RATES = {
  scout_fee_delivery_handoff_pct: "Delivery handoff %",
  scout_fee_errand_pickup_pct: "Errand pickup %",
  scout_fee_deal_spot_check_pct: "Shop check %",
  scout_fee_merchant_onboard_pct: "Merchant onboarding %",
  scout_fee_qr_distribution_pct: "QR distribution %",
  scout_fee_customer_acquisition_pct: "Customer acquisition %",
};

export default function CommerceOpsPage() {
  const [tab, setTab] = useState("overview");
  const [overview, setOverview] = useState(null);
  const [credits, setCredits] = useState([]);
  const [listings, setListings] = useState([]);
  const [conversions, setConversions] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [disputes, setDisputes] = useState([]);
  const [settings, setSettings] = useState(null);
  const [fees, setFees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [rates, setRates] = useState({
    campaign_fee_pct: 2, lead_fee_pct: 6, credit_expiry_days: 365,
    ...Object.fromEntries(Object.keys(SCOUT_RATES).map((key) => [key, 5])),
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [o, c, l, cv, s, d, st, f] = await Promise.all([
        commerceOpsAPI.overview(),
        commerceOpsAPI.pendingCredits(),
        commerceOpsAPI.pendingListings(),
        commerceOpsAPI.pendingConversions(),
        commerceOpsAPI.pendingSubscriptions(),
        commerceOpsAPI.disputes("open"),
        commerceOpsAPI.settings(),
        commerceOpsAPI.fees(),
      ]);
      setOverview(o.data);
      setCredits(c.data?.purchases || []);
      setListings(l.data?.listings || []);
      setConversions(cv.data?.conversions || []);
      setSubscriptions(s.data?.subscriptions || []);
      setDisputes(d.data?.disputes || []);
      setSettings(st.data);
      setFees(f.data?.fees || []);
      const values = st.data?.settings || {};
      setRates({
        campaign_fee_pct: values.referral_campaign_fee?.pct ?? 2,
        lead_fee_pct: values.referral_lead_fee?.pct ?? 6,
        credit_expiry_days: values.merchant_credit_expiry?.days ?? 365,
        ...Object.fromEntries(Object.keys(SCOUT_RATES).map((key) => [key, values[key.replace(/_pct$/, "")]?.pct ?? 5])),
      });
    } catch (err) {
      setError(err?.response?.status === 403 ? "This surface is restricted to platform operators." : apiError(err, "Commerce operations could not be loaded"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(key, request, success) {
    setBusy(key);
    try {
      await request();
      toast.success(success);
      load();
    } catch (err) {
      toast.error(apiError(err, "The action failed"));
    } finally {
      setBusy("");
    }
  }

  async function saveRates() {
    setBusy("rates");
    try {
      await commerceOpsAPI.updateSettings({
        campaign_fee_pct: Number(rates.campaign_fee_pct),
        lead_fee_pct: Number(rates.lead_fee_pct),
        credit_expiry_days: Number(rates.credit_expiry_days),
        ...Object.fromEntries(Object.keys(SCOUT_RATES).map((key) => [key, Number(rates[key])])),
        note: "Operator rate change",
      });
      toast.success("Rates updated. Existing accrued fees are not rewritten.");
      load();
    } catch (err) {
      toast.error(apiError(err, "The rates could not be saved"));
    } finally {
      setBusy("");
    }
  }

  if (loading && !overview) return <PageSpinner label="Reading the commerce desk…" />;
  if (error) {
    return <EmptyState icon={ShieldCheck} tone="danger" title="Commerce desk unavailable" description={error} action={<Button size="sm" onClick={load}>Try again</Button>} />;
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Operations · commerce</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink-1">Moderation & money rules</h1>
          <p className="mt-1.5 max-w-lg text-xs leading-relaxed text-ink-3">
            Confirm externally settled credit, verify listings and conversions, resolve disputes,
            and change the disclosed percentages. Unredeemed credit and outstanding rewards are
            obligations, never revenue.
          </p>
        </div>
        <Button size="sm" variant="secondary" icon={RefreshCw} onClick={load}>Refresh</Button>
      </header>

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-edge-1 bg-surface-0 p-1">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "shrink-0 rounded-lg px-3 py-1.5 text-2xs font-bold transition-colors",
              tab === value ? "bg-brand-600 text-white" : "text-ink-3 hover:bg-surface-2",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && overview && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Available credit", formatKes(overview.credits.available_kes)],
              ["Outstanding", formatKes(overview.credits.outstanding_obligations_kes)],
              ["Expired credit", formatKes(overview.credits.expired_kes)],
              ["Fee revenue paid", formatKes(overview.fees.recognized_fee_revenue_kes)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-edge-1 bg-surface-1 px-3 py-2.5">
                <p className="text-2xs font-bold uppercase tracking-wide text-ink-4">{label}</p>
                <p className="digital mt-0.5 text-sm font-extrabold text-ink-1">{value}</p>
              </div>
            ))}
          </div>
          <Card className="space-y-2 p-4">
            <p className="text-sm font-extrabold text-ink-1">Queues</p>
            <div className="grid grid-cols-2 gap-2 text-2xs">
              {[
                ["Credit purchases", overview.queues.pending_credit_purchases],
                ["Subscriptions", overview.queues.pending_subscriptions],
                ["Conversions", overview.queues.pending_conversions],
                ["Open disputes", overview.queues.open_disputes],
                ["Receipts", overview.receipts.count],
                ["Referral listings", overview.referrals.listings],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between rounded-xl border border-edge-1 bg-surface-0 px-3 py-2">
                  <span className="text-ink-3">{label}</span>
                  <span className="digital font-bold text-ink-1">{value}</span>
                </div>
              ))}
            </div>
          </Card>
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-2xs leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertTriangle size={13} className="mr-1 inline" /> {overview.accounting_note}
          </p>
          <p className="text-2xs text-ink-4">
            Collection is {overview.fees_enabled && !overview.free_for_now ? "ON" : "OFF"}.
            {overview.free_for_now ? " FREE_FOR_NOW suppresses charging; the quote still shows the configured percentage." : ""}
          </p>
        </div>
      )}

      {tab === "credits" && (
        <section className="space-y-2">
          {credits.length === 0 ? <EmptyState icon={Coins} title="No pending credit purchases" description="A merchant records a payment; it appears here for confirmation." /> : credits.map((purchase) => (
            <Card key={purchase.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-ink-1">{purchase.merchant_name || purchase.merchant_id}</p>
                <p className="text-micro text-ink-4">{formatKes(purchase.amount_kes)} · ref {purchase.payment_reference}</p>
              </div>
              <div className="flex gap-1.5">
                <Button size="xs" loading={busy === purchase.id} icon={CheckCircle2} onClick={() => act(purchase.id, () => commerceOpsAPI.reviewCredit(purchase.id, { approve: true }), "Credit posted.")}>Confirm</Button>
                <Button size="xs" variant="dangerGhost" icon={XCircle} onClick={() => act(`${purchase.id}-no`, () => commerceOpsAPI.reviewCredit(purchase.id, { approve: false }), "Purchase rejected.")}>Reject</Button>
              </div>
            </Card>
          ))}
        </section>
      )}

      {tab === "listings" && (
        <section className="space-y-2">
          {listings.length === 0 ? <EmptyState icon={BadgeCheck} title="No listings waiting" description="New listings start unverified until they are reviewed." /> : listings.map((listing) => (
            <Card key={listing.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-ink-1">{listing.title}</p>
                  <p className="text-micro text-ink-4">{listing.provider} · {listing.category} · {formatKes(listing.bounty_kes)} bounty</p>
                </div>
                <Badge variant="outline">{listing.verification_status}</Badge>
              </div>
              <div className="flex gap-1.5">
                <Button size="xs" icon={CheckCircle2} onClick={() => act(listing.id, () => commerceOpsAPI.verifyListing(listing.id, { approve: true, note: "Provider and code checked." }), "Listing verified.")}>Verify</Button>
                <Button size="xs" variant="dangerGhost" onClick={() => act(`${listing.id}-no`, () => commerceOpsAPI.verifyListing(listing.id, { approve: false, note: "Proof method not supported." }), "Listing rejected.")}>Reject</Button>
              </div>
            </Card>
          ))}
        </section>
      )}

      {tab === "conversions" && (
        <section className="space-y-2">
          {conversions.length === 0 ? <EmptyState icon={Activity} title="No conversions waiting" description="A claimed referral appears here for independent review." /> : conversions.map((conversion) => (
            <Card key={conversion.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-ink-1">{conversion.title}</p>
                  <p className="text-micro text-ink-4">{conversion.provider} · {conversion.proof_type} · {conversion.proof_reference || "no reference"}</p>
                </div>
                <span className="digital text-xs font-bold text-ink-1">{formatKes(conversion.bounty_kes)}</span>
              </div>
              <div className="flex gap-1.5">
                <Button size="xs" icon={CheckCircle2} onClick={() => act(conversion.id, () => commerceOpsAPI.verifyConversion(conversion.id, { approve: true, note: "Reference matched." }), "Conversion verified.")}>Verify</Button>
                <Button size="xs" variant="dangerGhost" onClick={() => act(`${conversion.id}-no`, () => commerceOpsAPI.verifyConversion(conversion.id, { approve: false, note: "Evidence insufficient." }), "Conversion rejected.")}>Reject</Button>
              </div>
            </Card>
          ))}
        </section>
      )}

      {tab === "subscriptions" && (
        <section className="space-y-2">
          {subscriptions.length === 0 ? <EmptyState icon={SlidersHorizontal} title="No subscription requests" description="Premium analytics requests appear here for confirmation." /> : subscriptions.map((sub) => (
            <Card key={sub.merchant_id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div>
                <p className="text-xs font-bold text-ink-1">{sub.merchant_name}</p>
                <p className="text-micro text-ink-4">{formatKes(sub.price_kes)} · {sub.months} month(s) · ref {sub.payment_reference}</p>
              </div>
              <div className="flex gap-1.5">
                <Button size="xs" onClick={() => act(sub.merchant_id, () => commerceOpsAPI.reviewSubscription(sub.merchant_id, { approve: true }), "Subscription active.")}>Confirm</Button>
                <Button size="xs" variant="dangerGhost" onClick={() => act(`${sub.merchant_id}-no`, () => commerceOpsAPI.reviewSubscription(sub.merchant_id, { approve: false }), "Subscription rejected.")}>Reject</Button>
              </div>
            </Card>
          ))}
        </section>
      )}

      {tab === "disputes" && (
        <section className="space-y-2">
          {disputes.length === 0 ? <EmptyState icon={ShieldCheck} title="No open disputes" description="Receipt, referral and task disputes appear here." /> : disputes.map((dispute) => (
            <Card key={dispute.id} className="space-y-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-ink-1">{dispute.domain} · {dispute.status}</p>
                  <p className="mt-1 text-2xs leading-relaxed text-ink-3">{dispute.reason}</p>
                </div>
                <Badge variant="outline">{dispute.created_at?.slice(0, 10)}</Badge>
              </div>
              <div className="flex gap-1.5">
                <Button size="xs" onClick={() => act(dispute.id, () => commerceOpsAPI.resolveDispute(dispute.id, { status: "resolved", resolution: "Evidence reviewed; resolved by an operator." }), "Dispute resolved.")}>Resolve</Button>
                <Button size="xs" variant="dangerGhost" onClick={() => act(`${dispute.id}-no`, () => commerceOpsAPI.resolveDispute(dispute.id, { status: "rejected", resolution: "Evidence did not support the claim." }), "Dispute rejected.")}>Reject</Button>
              </div>
            </Card>
          ))}
        </section>
      )}

      {tab === "settings" && settings && (
        <Card className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={16} className="text-brand-600 dark:text-brand-400" />
            <p className="text-sm font-extrabold text-ink-1">Runtime percentages</p>
          </div>
          <p className="text-2xs leading-relaxed text-ink-3">{settings.disclosure}</p>
          <div className="grid grid-cols-2 gap-2">
            <Input label="Campaign fee %" type="number" value={rates.campaign_fee_pct} onChange={(e) => setRates({ ...rates, campaign_fee_pct: e.target.value })} />
            <Input label="Verified lead fee %" type="number" value={rates.lead_fee_pct} onChange={(e) => setRates({ ...rates, lead_fee_pct: e.target.value })} />
            <Input label="Credit expiry (days)" type="number" value={rates.credit_expiry_days} onChange={(e) => setRates({ ...rates, credit_expiry_days: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(SCOUT_RATES).map(([key, label]) => (
              <Input key={key} label={label} type="number" value={rates[key]} onChange={(e) => setRates({ ...rates, [key]: e.target.value })} />
            ))}
          </div>
          <Button size="sm" loading={busy === "rates"} onClick={saveRates}>Save rates</Button>
          <div className="border-t border-edge-1 pt-3">
            <p className="text-2xs font-bold uppercase tracking-wide text-ink-4">Recent fee entries</p>
            <ul className="mt-2 space-y-1">
              {fees.slice(0, 6).map((fee) => (
                <li key={fee.id} className="flex items-center justify-between gap-2 text-2xs">
                  <span className="text-ink-3">{fee.source_type}</span>
                  <span className="text-ink-4">{fee.fee_pct}%</span>
                  <span className="digital text-ink-1">{formatKes(fee.fee_kes)}</span>
                  <Badge variant={fee.status === "paid" ? "brand" : "outline"}>{fee.status}</Badge>
                </li>
              ))}
              {fees.length === 0 && <li className="text-2xs text-ink-4">No fee entries yet.</li>}
            </ul>
          </div>
        </Card>
      )}
    </div>
  );
}
