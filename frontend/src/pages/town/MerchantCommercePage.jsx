import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, BadgeCheck, BarChart3, Coins, Receipt, Sparkles, Store, Wallet,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { apiError } from "@/lib/api";
import { townAPI } from "@/lib/townApi";
import { formatKes } from "@/lib/receipts";
import { cn } from "@/lib/utils";

function idempotencyKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `credit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function MerchantCommercePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState("");
  const [amount, setAmount] = useState("1000");
  const [reference, setReference] = useState("");
  const [policy, setPolicy] = useState({ points_per_100_kes: 2, max_points_per_receipt: 500, priority_bonus_pct: 0 });
  const [subRef, setSubRef] = useState("");
  const [purchaseKey, setPurchaseKey] = useState(idempotencyKey);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: payload } = await townAPI.merchantDashboard(30);
      setData(payload);
      setMissing(false);
      setPolicy({
        points_per_100_kes: payload.policy?.points_per_100_kes ?? 2,
        max_points_per_receipt: payload.policy?.max_points_per_receipt ?? 500,
        priority_bonus_pct: payload.policy?.priority_bonus_pct ?? 0,
      });
    } catch (err) {
      if (err?.response?.status === 404) {
        setMissing(true);
      } else {
        setError(apiError(err, "The merchant dashboard could not be loaded"));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const merchantId = data?.merchant?.id;
  const analytics = data?.analytics || {};
  const credits = data?.credits || {};

  const demandMax = useMemo(
    () => Math.max(1, ...(analytics.daily_demand || []).map((row) => row.receipts)),
    [analytics.daily_demand],
  );

  async function buyCredit() {
    if (!merchantId) return;
    setBusy("credit");
    try {
      await townAPI.buyCredit(merchantId, {
        amount_kes: Number(amount),
        payment_reference: reference,
        idempotency_key: purchaseKey,
      });
      toast.success("Purchase recorded. An operator confirms the payment before credit is posted.");
      setReference("");
      setPurchaseKey(idempotencyKey());
      load();
    } catch (err) {
      toast.error(apiError(err, "The purchase could not be recorded"));
    } finally {
      setBusy("");
    }
  }

  async function savePolicy() {
    if (!merchantId) return;
    setBusy("policy");
    try {
      await townAPI.setRewardPolicy(merchantId, {
        points_per_100_kes: Number(policy.points_per_100_kes),
        max_points_per_receipt: Number(policy.max_points_per_receipt),
        priority_bonus_pct: Number(policy.priority_bonus_pct),
      });
      toast.success("Reward rate updated. It applies to the next receipt.");
      load();
    } catch (err) {
      toast.error(apiError(err, "The reward rate could not be saved"));
    } finally {
      setBusy("");
    }
  }

  async function subscribe() {
    if (!merchantId) return;
    setBusy("subscribe");
    try {
      await townAPI.subscribeAnalytics(merchantId, { months: 1, payment_reference: subRef });
      toast.success("Subscription requested. Premium analytics unlocks after an operator confirms.");
      setSubRef("");
      load();
    } catch (err) {
      toast.error(apiError(err, "The subscription request failed"));
    } finally {
      setBusy("");
    }
  }

  if (loading && !data) return <PageSpinner label="Opening the shop dashboard…" />;
  if (missing) {
    return (
      <EmptyState
        icon={Store}
        title="No shop is linked yet"
        description="Claim your shop from a receipt first. Then this dashboard can show its prepaid credit, reward rate, redemptions and demand."
        action={<Button as={Link} to="/receipts" size="sm">Open my receipts</Button>}
      />
    );
  }
  if (error) {
    return <EmptyState icon={Store} tone="danger" title="The dashboard is down" description={error} action={<Button size="sm" onClick={load}>Try again</Button>} />;
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Merchant dashboard</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink-1">{data.merchant.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant={data.merchant.claim_status === "verified" ? "brand" : "outline"}>
              {data.merchant.claim_status === "verified" && <BadgeCheck size={10} />}
              {data.merchant.claim_status}
            </Badge>
            <span className="text-2xs text-ink-4">{data.merchant.region || "Region not set"}</span>
            <span className="text-2xs text-ink-4">· Trust Level {data.viewer_trust?.level} {data.viewer_trust?.level_name}</span>
          </div>
        </div>
        <Button as={Link} to="/receipt-rewards" size="sm" variant="secondary" icon={Receipt}>
          Scan a receipt
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Available credit", formatKes(credits.available_kes || 0)],
          ["Spent on rewards", formatKes(credits.spent_kes || 0)],
          ["Outstanding", formatKes(credits.outstanding_kes || 0)],
          ["Expired credit", formatKes(credits.expired_kes || 0)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-edge-1 bg-surface-1 px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-ink-4">{label}</p>
            <p className="digital mt-0.5 text-sm font-extrabold text-ink-1">{value}</p>
          </div>
        ))}
      </div>

      <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-2xs leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        <AlertTriangle size={13} className="mr-1 inline" aria-hidden="true" />
        {data.obligations_note}
      </p>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Wallet size={16} className="text-brand-600 dark:text-brand-400" />
            <p className="text-sm font-extrabold text-ink-1">Buy prepaid credit</p>
          </div>
          <p className="text-2xs leading-relaxed text-ink-3">
            Pay the platform's published paybill or till in your merchant terms, then record the
            reference. A purchase is pending until an operator matches it. Credit is promotional
            and cannot be withdrawn.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Input label="Amount (KES)" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Input label="Payment reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="QK12ABCDEF" />
          </div>
          <Button size="sm" loading={busy === "credit"} onClick={buyCredit}>Record purchase</Button>
        </Card>

        <Card className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Coins size={16} className="text-accent-600 dark:text-accent-400" />
            <p className="text-sm font-extrabold text-ink-1">Your reward rate</p>
          </div>
          <p className="text-2xs leading-relaxed text-ink-3">{data.policy.explanation}</p>
          <div className="grid grid-cols-3 gap-2">
            <Input label="Points / KES 100" type="number" value={policy.points_per_100_kes} onChange={(e) => setPolicy({ ...policy, points_per_100_kes: e.target.value })} />
            <Input label="Cap" type="number" value={policy.max_points_per_receipt} onChange={(e) => setPolicy({ ...policy, max_points_per_receipt: e.target.value })} />
            <Input label="15-min bonus %" type="number" value={policy.priority_bonus_pct} onChange={(e) => setPolicy({ ...policy, priority_bonus_pct: e.target.value })} />
          </div>
          <Button size="sm" variant="secondary" loading={busy === "policy"} onClick={savePolicy}>Save rate</Button>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Receipts", data.totals.receipts],
          ["Receipt sales", formatKes(data.totals.sales_kes)],
          ["Receipt senders", data.totals.customers],
          ["Vouchers used", data.redemptions.redemptions],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-edge-1 bg-surface-1 px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-ink-4">{label}</p>
            <p className="digital mt-0.5 text-sm font-extrabold text-ink-1">{value}</p>
          </div>
        ))}
      </div>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className="text-brand-600 dark:text-brand-400" />
            <div>
              <p className="text-sm font-extrabold text-ink-1">Demand & price analytics</p>
              <p className="text-2xs text-ink-3">Item-level lines, demand by day and anonymised regional price bands.</p>
            </div>
          </div>
          <Badge variant={analytics.premium ? "brand" : "outline"}>{analytics.premium ? "Premium" : "Locked"}</Badge>
        </div>
        {analytics.premium ? (
          <div className="space-y-3">
            {analytics.daily_demand?.length > 0 && (
              <div className="flex h-20 items-end gap-1 rounded-xl border border-edge-1 bg-surface-0 px-2 pb-2 pt-3">
                {analytics.daily_demand.map((row) => (
                  <div key={row.date} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${row.date}: ${row.receipts} receipts`}>
                    <div className="w-full rounded-t bg-brand-400/80" style={{ height: `${Math.max(3, (row.receipts / demandMax) * 100)}%` }} />
                  </div>
                ))}
              </div>
            )}
            <div className="divide-y divide-edge-1 overflow-hidden rounded-xl border border-edge-1">
              {(analytics.top_items || []).slice(0, 5).map((item) => (
                <div key={item.description} className="flex items-center justify-between gap-2 px-3 py-2 text-2xs">
                  <span className="min-w-0 flex-1 truncate text-ink-2">{item.description}</span>
                  <span className="text-ink-4">{item.quantity} sold</span>
                  <span className="digital text-ink-1">{formatKes(item.value_kes)}</span>
                </div>
              ))}
              {!analytics.top_items?.length && <p className="px-3 py-3 text-2xs text-ink-3">No item lines yet. Receipts with OCR items will appear here.</p>}
            </div>
            {analytics.region_price_bands?.length > 0 && (
              <div className="rounded-xl border border-edge-1 bg-surface-0 p-3">
                <p className="text-2xs font-bold uppercase tracking-wide text-ink-4">Regional price bands (anonymised)</p>
                <ul className="mt-2 space-y-1">
                  {analytics.region_price_bands.slice(0, 4).map((band) => (
                    <li key={band.description} className="flex items-center justify-between gap-2 text-2xs">
                      <span className="min-w-0 flex-1 truncate text-ink-2">{band.description}</span>
                      <span className="digital text-ink-1">{formatKes(band.average_unit_price_kes)}</span>
                      <span className="text-ink-4">{band.merchants} shops</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-2xs leading-relaxed text-ink-3">{analytics.locked_reason}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input value={subRef} onChange={(e) => setSubRef(e.target.value)} placeholder="Payment reference" className="max-w-[180px]" />
              <Button size="sm" loading={busy === "subscribe"} onClick={subscribe}>
                Request premium · {formatKes(analytics.price_kes || 500)}/mo
              </Button>
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-extrabold text-ink-1">Recent receipts</p>
            <Receipt size={15} className="text-ink-4" />
          </div>
          <ul className="mt-2 divide-y divide-edge-1">
            {data.recent_receipts?.length ? data.recent_receipts.map((receipt) => (
              <li key={receipt.id} className="flex items-center justify-between gap-2 py-2 text-2xs">
                <span className="text-ink-3">{new Date(receipt.scanned_at).toLocaleDateString()}</span>
                <span className={cn("font-semibold", receipt.funded_kes > 0 ? "text-brand-700 dark:text-brand-300" : "text-ink-4")}>
                  {receipt.points} pts funded
                </span>
                <span className="digital text-ink-1">{formatKes(receipt.total_kes)}</span>
              </li>
            )) : <li className="py-2 text-2xs text-ink-3">No receipts at this shop yet.</li>}
          </ul>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-extrabold text-ink-1">Referral listings</p>
            <Sparkles size={15} className="text-ink-4" />
          </div>
          <ul className="mt-2 divide-y divide-edge-1">
            {data.listings?.length ? data.listings.map((listing) => (
              <li key={listing.id} className="flex items-center justify-between gap-2 py-2 text-2xs">
                <span className="min-w-0 flex-1 truncate text-ink-2">{listing.title}</span>
                <Badge variant={listing.verification_status === "verified" ? "brand" : "outline"}>{listing.verification_status}</Badge>
              </li>
            )) : <li className="py-2 text-2xs text-ink-3">No referral listings yet.</li>}
          </ul>
          <Link to="/referral-index" className="mt-2 inline-flex items-center gap-1 text-2xs font-semibold text-brand-700 dark:text-brand-300">
            Manage referrals <ArrowRight size={12} />
          </Link>
        </Card>
      </div>
    </div>
  );
}
