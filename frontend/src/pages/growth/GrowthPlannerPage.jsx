import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity, ArrowRight, BadgeCheck, Calendar, CheckCircle2, Crown,
  Layers, Lock, Package, Plus, RefreshCw, ShieldCheck, Sparkles,
  Trash2, TrendingUp, Truck, Users,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Breadcrumbs from "@/components/ui/Breadcrumbs";
import Button from "@/components/ui/Button";
import ErrorState from "@/components/ui/ErrorState";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { growthAPI, apiError } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

const MARK_VARIANT = {
  top: "brand",
  l2: "brand",
  l1: "blue",
  rising: "amber",
  new: "gray",
};

export default function GrowthPlannerPage() {
  const fetchVendor = useAuthStore((s) => s.fetchVendor);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [switchingTier, setSwitchingTier] = useState("");
  const [seatEmail, setSeatEmail] = useState("");
  const [seatHandle, setSeatHandle] = useState("");
  const [seatRole, setSeatRole] = useState("clerk");
  const [seatBusy, setSeatBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await growthAPI.blueprint();
      setData(res.data);
    } catch (err) {
      setError(apiError(err, "Could not load the Business Planner & Pulse"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handlePlanChange = async (tierKey) => {
    setSwitchingTier(tierKey);
    try {
      await growthAPI.changePlan(tierKey);
      toast.success(`Switched plan to ${tierKey}`);
      await load();
      fetchVendor?.();
    } catch (err) {
      toast.error(apiError(err, "Could not update plan"));
    } finally {
      setSwitchingTier("");
    }
  };

  const handleAddSeat = async (e) => {
    e.preventDefault();
    if (!seatEmail.trim()) return;
    setSeatBusy(true);
    try {
      await growthAPI.addSeat({
        member_email: seatEmail.trim(),
        role: seatRole,
        member_handle: seatHandle.trim() || undefined,
      });
      setSeatEmail("");
      setSeatHandle("");
      toast.success("Team seat added");
      await load();
    } catch (err) {
      toast.error(apiError(err, "Could not add seat"));
    } finally {
      setSeatBusy(false);
    }
  };

  const handleRemoveSeat = async (seatId) => {
    try {
      await growthAPI.removeSeat(seatId);
      toast.success("Team seat revoked");
      await load();
    } catch (err) {
      toast.error(apiError(err, "Could not revoke seat"));
    }
  };

  if (loading) return <PageSpinner label="Loading Business Planner & Live Pulse…" />;
  if (error || !data) {
    return <ErrorState title="Planner unavailable" message={error} onRetry={load} />;
  }

  const {
    pulse,
    motions,
    entitlements,
    seats,
    program_status: programStatus,
    inverted_pyramid: pyramid = [],
    plans = [],
    verified_mark_families: markFamilies = [],
    hard_coded_rules: rules = [],
    six_month_rollout: rollout = [],
    acceptance_gates: gates = [],
  } = data;

  const mark = pulse?.fulfillment_mark || { key: "new", label: "New to the network" };
  // Render Inverted Pyramid from Layer 4 (widest top) down to Layer 1 (anchor vertex)
  const pyramidTopDown = [...pyramid].sort((a, b) => b.layer - a.layer);
  const widthClasses = {
    4: "w-full",
    3: "w-full sm:w-11/12 mx-auto",
    2: "w-full sm:w-10/12 mx-auto",
    1: "w-full sm:w-8/12 mx-auto",
  };

  return (
    <div className="space-y-8 pb-12">
      <Breadcrumbs items={[{ label: "Business", to: "/me" }, { label: "Growth planner & pulse" }]} />

      {/* Header */}
      <header className="rounded-3xl border border-edge-1 bg-surface-1 p-5 sm:p-7 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <p className="text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
              Inverted Pyramid · Pulse · Resources Motion
            </p>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-ink-1">
              Business Planner & Growth Engine
            </h1>
            <p className="text-xs sm:text-sm text-ink-3 leading-relaxed">
              Plan customer acquisition and multi-stream revenue from a verified anchor up to
              collective buying and institutional shortlists. Every metric below is read live
              from your database records, and every rule is enforced on the server.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={programStatus?.active ? "brand" : "amber"} size="sm">
              {programStatus?.active ? "6-Month Window Active" : "Motion Window Paused"}
            </Badge>
            <Button variant="secondary" size="sm" onClick={load}>
              <RefreshCw size={13} aria-hidden="true" />
              Refresh pulse
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-edge-1 bg-surface-0 px-4 py-3 text-xs text-ink-3 flex flex-wrap items-center justify-between gap-2">
          <span>
            <strong className="text-ink-1">Program guardrail:</strong> {programStatus?.notice}
          </span>
          <span className="text-2xs text-ink-4">
            Window target end: {programStatus?.end_date} · Existing obligations always preserved
          </span>
        </div>
      </header>

      {/* 1. Live Business Pulse */}
      <section aria-labelledby="live-pulse-heading" className="rounded-3xl border border-edge-1 bg-surface-1 p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
              Live database read
            </p>
            <h2 id="live-pulse-heading" className="text-lg font-bold text-ink-1">
              Business Pulse & Earned Standing
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={MARK_VARIANT[mark.key] || "gray"} size="sm" title={mark.hint}>
              <BadgeCheck size={12} aria-hidden="true" />
              {mark.label}
            </Badge>
            <Badge variant="purple" size="sm">
              Plan: {entitlements?.name || pulse?.plan_tier}
            </Badge>
          </div>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
          <div className="rounded-2xl border border-edge-1 bg-surface-0 p-3.5">
            <dt className="text-micro font-bold uppercase tracking-[0.1em] text-ink-4">Visible listings</dt>
            <dd className="mt-1 text-2xl font-extrabold text-ink-1 tabular-nums">{pulse.visible_listings}</dd>
            <dd className="mt-1 text-2xs text-ink-4">{pulse.total_listings} total on your shelf</dd>
          </div>
          <div className="rounded-2xl border border-edge-1 bg-surface-0 p-3.5">
            <dt className="text-micro font-bold uppercase tracking-[0.1em] text-ink-4">Open trades</dt>
            <dd className="mt-1 text-2xl font-extrabold text-ink-1 tabular-nums">{pulse.open_trades}</dd>
            <dd className="mt-1 text-2xs text-ink-4">{pulse.completed_movements} completed movements</dd>
          </div>
          <div className="rounded-2xl border border-edge-1 bg-surface-0 p-3.5">
            <dt className="text-micro font-bold uppercase tracking-[0.1em] text-ink-4">Supplier links</dt>
            <dd className="mt-1 text-2xl font-extrabold text-ink-1 tabular-nums">{pulse.supplier_links}</dd>
            <dd className="mt-1 text-2xs text-ink-4">
              Fulfilment: {pulse.fulfillment_rate == null ? "—" : `${pulse.fulfillment_rate}%`}
            </dd>
          </div>
          <div className="rounded-2xl border border-edge-1 bg-surface-0 p-3.5">
            <dt className="text-micro font-bold uppercase tracking-[0.1em] text-ink-4">Verified claims</dt>
            <dd className="mt-1 text-2xl font-extrabold text-ink-1 tabular-nums">{pulse.verified_claims}</dd>
            <dd className="mt-1 text-2xs text-ink-4">
              {pulse.documented_claims} unchecked · {pulse.expired_claims} expired
            </dd>
          </div>
        </dl>
      </section>

      {/* 2. Inverted Pyramid Growth Model */}
      <section aria-labelledby="pyramid-heading" className="space-y-4">
        <div>
          <p className="text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
            Customer Acquisition & Revenue Compounding
          </p>
          <h2 id="pyramid-heading" className="text-lg font-bold text-ink-1">
            Inverted Pyramid Growth Architecture
          </h2>
          <p className="text-xs text-ink-3 mt-0.5">
            Start at Layer 1 (the narrow, verified anchor at the base) and expand upward into
            reciprocal trade loops, collective buying pools, and automated institutional demand.
          </p>
        </div>

        <div className="space-y-3">
          {pyramidTopDown.map((item) => (
            <div
              key={item.layer}
              className={cn(
                "rounded-2xl border p-4 sm:p-5 transition-colors",
                widthClasses[item.layer] || "w-full",
                item.active
                  ? "border-brand-500/40 bg-brand-50/40 dark:bg-brand-500/10"
                  : "border-edge-1 bg-surface-1"
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <span className="text-micro font-bold uppercase tracking-[0.12em] text-brand-700 dark:text-brand-300">
                    Layer {item.layer} · {item.stage}
                  </span>
                  <h3 className="text-base font-bold text-ink-1 mt-0.5">{item.name}</h3>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={item.active ? "brand" : "gray"} size="xs">
                    {item.active ? "Active in DB" : "Next step"}
                  </Badge>
                  <Link
                    to={item.route}
                    className="inline-flex items-center gap-1 text-xs font-bold text-brand-700 dark:text-brand-300 hover:underline"
                  >
                    Open surface
                    <ArrowRight size={12} aria-hidden="true" />
                  </Link>
                </div>
              </div>
              <div className="mt-3 grid sm:grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl bg-surface-0 p-3 border border-edge-1">
                  <p className="font-semibold text-ink-1">Customer Acquisition</p>
                  <p className="text-ink-3 mt-0.5 leading-relaxed">{item.acquisition_mechanic}</p>
                </div>
                <div className="rounded-xl bg-surface-0 p-3 border border-edge-1">
                  <p className="font-semibold text-ink-1">Way of Earning</p>
                  <p className="text-ink-3 mt-0.5 leading-relaxed">{item.earning_mechanic}</p>
                </div>
              </div>
              <p className="mt-2.5 text-2xs font-semibold text-ink-3">
                Live status: <span className="text-ink-1">{item.live_metric}</span>
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 3. Five-Gear Resources Motion Engine */}
      <section aria-labelledby="motions-heading" className="space-y-4">
        <div>
          <p className="text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
            Resources Motion Engine
          </p>
          <h2 id="motions-heading" className="text-lg font-bold text-ink-1">
            Five-Gear Resources Motion
          </h2>
          <p className="text-xs text-ink-3 mt-0.5">
            How stock, pooled demand, physical tools, labor requests, and capital move through Brief_.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-edge-1 bg-surface-1 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-ink-1 flex items-center gap-1.5">
                <Package size={15} className="text-brand-600" />
                {motions.stock_motion.label}
              </span>
              <Link to="/stock" className="text-2xs font-bold text-brand-700 dark:text-brand-300 hover:underline">
                /stock
              </Link>
            </div>
            <p className="text-2xs text-ink-3">
              {motions.stock_motion.available_units} available units · {motions.stock_motion.reserved_units} reserved ·{" "}
              {motions.stock_motion.certified_listings} certified SKU(s).
            </p>
          </div>

          <div className="rounded-2xl border border-edge-1 bg-surface-1 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-ink-1 flex items-center gap-1.5">
                <Users size={15} className="text-brand-600" />
                {motions.collective_motion.label}
              </span>
              <Link to="/locks" className="text-2xs font-bold text-brand-700 dark:text-brand-300 hover:underline">
                /locks
              </Link>
            </div>
            <p className="text-2xs text-ink-3">
              {motions.collective_motion.groups_joined} group(s) · {motions.collective_motion.active_pledges} pledge(s) (
              {motions.collective_motion.pledged_units} units) · Zone{" "}
              {motions.collective_motion.market_zone_locked ? "locked" : "unlocked"}.
            </p>
          </div>

          <div className="rounded-2xl border border-edge-1 bg-surface-1 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-ink-1 flex items-center gap-1.5">
                <Truck size={15} className="text-brand-600" />
                {motions.tools_logistics_motion.label}
              </span>
              <Link to="/tools" className="text-2xs font-bold text-brand-700 dark:text-brand-300 hover:underline">
                /tools
              </Link>
            </div>
            <p className="text-2xs text-ink-3">
              {motions.tools_logistics_motion.tool_listings} tool listing(s) ·{" "}
              {motions.tools_logistics_motion.tool_bookings} booking(s) ·{" "}
              {motions.tools_logistics_motion.shipments} courier shipment(s).
            </p>
          </div>

          <div className="rounded-2xl border border-edge-1 bg-surface-1 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-ink-1 flex items-center gap-1.5">
                <Activity size={15} className="text-brand-600" />
                {motions.opportunity_motion.label}
              </span>
              <Link to="/work" className="text-2xs font-bold text-brand-700 dark:text-brand-300 hover:underline">
                /work
              </Link>
            </div>
            <p className="text-2xs text-ink-3">
              {motions.opportunity_motion.open_requests} open request(s) ·{" "}
              {motions.opportunity_motion.offers_submitted} offer(s) sent ·{" "}
              {motions.opportunity_motion.active_watches}/{motions.opportunity_motion.watch_limit} watch radars.
            </p>
          </div>

          <div className="rounded-2xl border border-edge-1 bg-surface-1 p-4 space-y-2 sm:col-span-2 lg:col-span-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-ink-1 flex items-center gap-1.5">
                <ShieldCheck size={15} className="text-brand-600" />
                {motions.capital_custody_motion.label}
              </span>
              <Link to="/orders" className="text-2xs font-bold text-brand-700 dark:text-brand-300 hover:underline">
                /orders
              </Link>
            </div>
            <p className="text-2xs text-ink-3">
              Finance mode: <strong className="text-ink-1">{motions.capital_custody_motion.finance_mode}</strong> ·{" "}
              {motions.capital_custody_motion.completed_payments}/{motions.capital_custody_motion.payment_intents} settled payment intent(s) ·
              Payment confirmation and physical delivery are tracked as independent states.
            </p>
          </div>
        </div>
      </section>

      {/* 4. Freemium & Premium Plans + Server-Side Entitlements */}
      <section aria-labelledby="plans-heading" className="space-y-4">
        <div>
          <p className="text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
            Freemium & Premium Entitlements
          </p>
          <h2 id="plans-heading" className="text-lg font-bold text-ink-1">
            Subscription Tiers & Server-Side Limits
          </h2>
          <p className="text-xs text-ink-3 mt-0.5">
            {entitlements?.verification_guardrail}
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((plan) => (
            <div
              key={plan.key}
              className={cn(
                "rounded-2xl border p-4 flex flex-col justify-between gap-4",
                plan.is_current
                  ? "border-brand-600 bg-brand-50/40 dark:bg-brand-500/10"
                  : "border-edge-1 bg-surface-1"
              )}
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-ink-1">{plan.name}</h3>
                  {plan.is_current && <Badge variant="brand" size="xs">Current plan</Badge>}
                </div>
                <p className="text-xl font-extrabold text-ink-1 tabular-nums">
                  {plan.price_kes_monthly === 0
                    ? "Free"
                    : `KES ${plan.price_kes_monthly.toLocaleString()}/mo`}
                </p>
                <p className="text-2xs text-ink-4">{plan.audience}</p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Badge variant="gray" size="xs">{plan.max_seats} seat(s)</Badge>
                  <Badge variant="gray" size="xs">{plan.max_watches} watches</Badge>
                  {plan.priority_verification_queue && (
                    <Badge variant="blue" size="xs">≤72h queue SLA</Badge>
                  )}
                </div>
                <ul className="space-y-1.5 pt-2 border-t border-edge-1 text-2xs text-ink-2">
                  {plan.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-1.5">
                      <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-brand-600" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <Button
                variant={plan.is_current ? "secondary" : "primary"}
                size="sm"
                disabled={plan.is_current || Boolean(switchingTier)}
                onClick={() => handlePlanChange(plan.key)}
              >
                {plan.is_current
                  ? "Active tier"
                  : switchingTier === plan.key
                  ? "Updating…"
                  : `Switch to ${plan.name}`}
              </Button>
            </div>
          ))}
        </div>

        {/* Team Seats Manager */}
        <div className="rounded-2xl border border-edge-1 bg-surface-1 p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-ink-1">
                Team Passport Seats ({seats?.seats_used} of {seats?.seats_limit} used)
              </h3>
              <p className="text-2xs text-ink-3">
                Share your Business Passport across owner, finance and bid-clerk seats. No team seat can self-verify claims.
              </p>
            </div>
            <Badge variant={seats?.seats_remaining > 0 ? "brand" : "amber"} size="xs">
              {seats?.seats_remaining} seat(s) remaining
            </Badge>
          </div>

          <form onSubmit={handleAddSeat} className="grid sm:grid-cols-4 gap-2.5 items-end">
            <Input
              label="Team member email"
              type="email"
              placeholder="finance@yourbusiness.co.ke"
              value={seatEmail}
              onChange={(e) => setSeatEmail(e.target.value)}
            />
            <Input
              label="Handle (optional)"
              placeholder="@handle"
              value={seatHandle}
              onChange={(e) => setSeatHandle(e.target.value)}
            />
            <Select
              label="Role"
              value={seatRole}
              onChange={(e) => setSeatRole(e.target.value)}
              options={[
                { value: "clerk", label: "Bid / Stock Clerk" },
                { value: "finance", label: "Finance / Accountant" },
                { value: "owner", label: "Co-owner / Director" },
              ]}
            />
            <Button type="submit" size="md" disabled={seatBusy || !seatEmail.trim()}>
              <Plus size={14} aria-hidden="true" />
              {seatBusy ? "Adding…" : "Add team seat"}
            </Button>
          </form>

          {seats?.members?.length > 0 && (
            <ul className="divide-y divide-edge-1 rounded-xl border border-edge-1 bg-surface-0">
              {seats.members.map((m) => (
                <li key={m.id} className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="font-semibold text-ink-1">{m.member_email}</span>
                    {m.member_handle && <span className="text-ink-4"> · @{m.member_handle}</span>}
                    <span className="ml-2 text-2xs uppercase font-bold text-brand-700 dark:text-brand-300">
                      {m.role}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => handleRemoveSeat(m.id)}
                    aria-label={`Revoke ${m.member_email}`}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 5. Verified Marks Families */}
      <section aria-labelledby="marks-heading" className="space-y-4">
        <div>
          <p className="text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
            Auditable Trust Signals
          </p>
          <h2 id="marks-heading" className="text-lg font-bold text-ink-1">
            The Four Families of Verified Marks
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {markFamilies.map((fam) => (
            <div key={fam.family} className="rounded-2xl border border-edge-1 bg-surface-1 p-4 space-y-2.5">
              <div>
                <h3 className="text-sm font-bold text-ink-1">{fam.title}</h3>
                <p className="text-2xs text-ink-4">{fam.source}</p>
              </div>
              <ul className="space-y-1.5 divide-y divide-edge-1">
                {fam.marks.map((m) => (
                  <li key={m.key} className="pt-1.5 first:pt-0 text-xs">
                    <span className="font-semibold text-ink-1">{m.label}: </span>
                    <span className="text-ink-3">{m.rule}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* 6. Six-Month Rollout Plan & Hard-Coded Business Rules */}
      <div className="grid lg:grid-cols-2 gap-6">
        <section aria-labelledby="rollout-heading" className="rounded-3xl border border-edge-1 bg-surface-1 p-5 space-y-4">
          <div>
            <p className="text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
              Six-Month Rollout Plan
            </p>
            <h2 id="rollout-heading" className="text-lg font-bold text-ink-1">
              Sequenced Execution (Oct–Apr)
            </h2>
          </div>

          <div className="divide-y divide-edge-1">
            {rollout.map((item) => (
              <div key={item.month} className="py-3 first:pt-0 last:pb-0 flex items-start gap-3">
                <div className="rounded-xl bg-surface-2 px-2.5 py-1.5 text-center min-w-[74px] shrink-0">
                  <p className="text-xs font-bold text-ink-1">Month {item.month}</p>
                  <p className="text-2xs text-ink-4">{item.window}</p>
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-ink-1">{item.title}</p>
                    <Badge variant={item.milestone_active ? "brand" : "gray"} size="xs">
                      {item.milestone_active ? "Active" : "Target"}
                    </Badge>
                  </div>
                  <p className="text-2xs text-ink-3 leading-relaxed">{item.summary}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-2xs text-ink-4">
            These are rollout targets, not guarantees of commercial success.
          </p>
        </section>

        <section aria-labelledby="rules-heading" className="rounded-3xl border border-edge-1 bg-surface-1 p-5 space-y-4">
          <div>
            <p className="text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
              Centrally Enforced Guardrails
            </p>
            <h2 id="rules-heading" className="text-lg font-bold text-ink-1">
              Hard-Coded Business Rules & Launch Gates
            </h2>
          </div>

          <ul className="space-y-2.5">
            {rules.map((r) => (
              <li key={r.id} className="rounded-xl border border-edge-1 bg-surface-0 p-3 space-y-1">
                <p className="text-xs font-bold text-ink-1">{r.title}</p>
                <p className="text-2xs text-ink-3 leading-relaxed">{r.rule}</p>
                <p className="text-[10px] font-mono text-ink-4">{r.enforced_in}</p>
              </li>
            ))}
          </ul>

          <div className="pt-2 border-t border-edge-1 space-y-1.5">
            <p className="text-xs font-bold text-ink-1">Launch Acceptance Checklist</p>
            <ul className="space-y-1">
              {gates.map((g) => (
                <li key={g.id} className="flex items-start gap-2 text-2xs text-ink-3">
                  <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-brand-600" />
                  <span>{g.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
