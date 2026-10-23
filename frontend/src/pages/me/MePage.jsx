import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowUpRight, BarChart3, Bookmark, Building2, CheckCircle2, ChevronRight,
  ClipboardList, Compass, FileCheck, Home, Layers3, List, Lock, Package,
  PlusCircle, Repeat, Settings, ShieldCheck, ShoppingBag, ShoppingBasket,
  Sparkles, Store, Terminal, Trash2, Truck, Users,
} from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";
import { VENDOR_ROLES } from "@/config/constants";
import { apiError } from "@/lib/api";
import { ledgerAPI } from "@/lib/ledgerApi";
import { ACCOUNT_KINDS, TEMPLATE_LABELS } from "@/lib/inference";
import { useAuthStore } from "@/stores/authStore";
import { useStockStore } from "@/stores/stockStore";
import { cn } from "@/lib/utils";

const QUICK_ACTIONS = [
  {
    title: "My shelf",
    description: "Manage stock and visibility",
    to: () => "/stock",
    icon: Package,
  },
  {
    title: "View my shop · Shop front",
    description: "Preview the public profile",
    to: (vendor) => `/@${vendor.vendor_handle}`,
    icon: Store,
  },
  {
    title: "Orders & trades",
    description: "Track active transactions",
    to: () => "/orders",
    icon: ShoppingBag,
  },
  {
    title: "Find suppliers",
    description: "Discover and contact vendors",
    to: () => "/network",
    icon: Users,
  },
  {
    title: "Analytics",
    description: "Review trade and price performance",
    to: () => "/analytics",
    icon: BarChart3,
  },
  {
    title: "Business passport",
    description: "Manage verification and documents",
    to: () => "/passport",
    icon: FileCheck,
  },
];

const DESTINATIONS = [
  {
    title: "Storefront & catalogue",
    description: "Sell services, software and field operations: offers, account tiers, trial and enquiries.",
    to: () => "/storefront",
    icon: ShoppingBag,
    tone: "green",
    group: "Work & sourcing",
  },
  {
    title: "Enterprise workspace",
    description: "For associations & organisations: member register, field officers and managed Android devices.",
    to: () => "/enterprise",
    icon: Building2,
    tone: "blue",
    group: "Work & sourcing",
  },
  {
    title: "Growth planner",
    description: "Inverted pyramid plan, live pulse, 5-gear motions and plan tiers.",
    to: () => "/growth",
    icon: Sparkles,
    tone: "purple",
    group: "Stock & integrations",
  },
  {
    title: "POS Bridge",
    description: "Connect a till or import stock from a CSV file.",
    to: () => "/pos",
    icon: Terminal,
    tone: "amber",
    group: "Stock & integrations",
  },
  {
    title: "Creative portfolio",
    description: "Showcase branding, web design, print & motion case studies and client services.",
    to: () => "/portfolio",
    icon: Sparkles,
    tone: "green",
    group: "Work & sourcing",
  },
  {
    title: "Tasks",
    description: "Squad calls, work in progress and network tasks.",
    to: () => "/tasks",
    icon: ClipboardList,
    tone: "purple",
    group: "Work & sourcing",
  },
  {
    title: "Vendor lists",
    description: "Curated supplier directories and patron tools.",
    to: () => "/lists",
    icon: List,
    tone: "green",
    group: "Work & sourcing",
  },
  {
    title: "Market Locks",
    description: "Join coordinated buying windows and track a lock.",
    to: () => "/locks",
    icon: ShoppingBasket,
    tone: "amber",
    group: "Work & sourcing",
  },
  {
    title: "Rentals & logistics",
    description: "Find transport, storage, couriers and equipment.",
    to: () => "/tools",
    icon: Truck,
    tone: "blue",
    group: "Work & sourcing",
  },
  {
    title: "Our Network",
    description: "Vote on proposals, review rules and participate in the governance of the trading network.",
    to: () => "/governance",
    icon: ShieldCheck,
    tone: "green",
    group: "Network",
  },
  {
    title: "Surfaces",
    description: "Follow the wider stream of verified network trades, price restatements and activity.",
    to: () => "/feed",
    icon: Layers3,
    tone: "blue",
    group: "Network",
  },
];

const TONE_CLASSES = {
  brand: "bg-brand-100 text-brand-800 dark:bg-brand-500/15 dark:text-brand-300",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  purple: "bg-orchid-100 text-orchid-800 dark:bg-orchid-500/15 dark:text-orchid-300",
  amber: "bg-accent-100 text-accent-800 dark:bg-accent-500/15 dark:text-accent-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
};

function QuickActionCard({ item, vendor }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to(vendor)}
      className="group flex flex-col justify-between gap-2 rounded-2xl border border-edge-1 bg-surface-0 p-4 hover:border-brand-500/50 hover:shadow-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
    >
      <div className="flex items-center justify-between">
        <span className="grid place-items-center w-10 h-10 rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
          <Icon size={20} aria-hidden="true" />
        </span>
        <ArrowUpRight size={15} className="text-ink-4 group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-bold text-ink-1">{item.title}</p>
        <p className="mt-0.5 text-2xs text-ink-3 leading-relaxed">{item.description}</p>
      </div>
    </Link>
  );
}

function WorkspaceLink({ item, vendor }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to(vendor)}
      className="group flex items-start gap-3.5 border-b border-edge-1 py-4 focus-visible:rounded-xl"
    >
      <span className={cn("grid place-items-center w-10 h-10 rounded-xl shrink-0", TONE_CLASSES[item.tone])}>
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink-1">
          {item.title}
          <ArrowUpRight size={13} className="text-ink-4 opacity-0 -translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 transition-all" aria-hidden="true" />
        </span>
        <span className="mt-0.5 block text-2xs text-ink-3 leading-relaxed">{item.description}</span>
      </span>
      <ChevronRight size={16} className="mt-1 text-ink-4 group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors" aria-hidden="true" />
    </Link>
  );
}

export default function MePage() {
  const navigate = useNavigate();
  const vendor = useAuthStore((s) => s.vendor);
  const mine = useStockStore((s) => s.mine);
  const movements = useStockStore((s) => s.movements);
  const fetchMine = useStockStore((s) => s.fetchMine);
  const fetchMovements = useStockStore((s) => s.fetchMovements);
  const [shelfReady, setShelfReady] = useState(false);

  // Local Activity Ledger state
  const [metrics, setMetrics] = useState(null);
  const [records, setRecords] = useState([]);
  const [relationships, setRelationships] = useState([]);
  const [alternatives, setAlternatives] = useState([]);
  const [altContext, setAltContext] = useState("");
  const [storefront, setStorefront] = useState({
    enabled: false,
    title: "",
    visiting_hours: "",
    audience: "saved_contacts",
    share_directions_only_when_booked: true,
  });
  const [savingStorefront, setSavingStorefront] = useState(false);

  const loadLedger = useCallback(async () => {
    try {
      const [mRes, recRes, relRes, sfRes] = await Promise.all([
        ledgerAPI.metricsSummary(),
        ledgerAPI.records(),
        ledgerAPI.listRelationships(),
        ledgerAPI.getHomeStorefront(),
      ]);
      if (mRes?.data) setMetrics(mRes.data);
      setRecords(recRes?.data?.items || []);
      setRelationships(relRes?.data?.items || []);
      if (sfRes?.data?.config) {
        setStorefront((prev) => ({ ...prev, ...sfRes.data.config }));
      }
    } catch {
      /* graceful no-op in isolated unit tests */
    }
  }, []);

  useEffect(() => {
    let live = true;
    fetchMine?.()
      ?.then(() => live && setShelfReady(true))
      ?.catch(() => live && setShelfReady(true));
    fetchMovements?.()?.catch(() => {});
    loadLedger();
    return () => {
      live = false;
    };
  }, [fetchMine, fetchMovements, loadLedger]);

  const role = VENDOR_ROLES.find((item) => item.value === vendor?.current_role) || VENDOR_ROLES[2];
  const accountKindMeta =
    ACCOUNT_KINDS.find((k) => k.value === (vendor?.account_kind || "business")) || ACCOUNT_KINDS[4];

  const sections = useMemo(
    () =>
      ["Stock & integrations", "Work & sourcing", "Network"].map((group) => ({
        group,
        items: DESTINATIONS.filter((item) => item.group === group),
      })),
    []
  );
  const visibleCount = mine.filter((item) => item.visible_to_network).length;
  const openTrades = (movements || []).filter((m) =>
    ["pending", "confirmed", "shipped", "in_transit"].includes(m.status)
  ).length;
  const score = Number(vendor?.network_score || 0);
  const scoreLabel = score > 0 ? score.toFixed(1) : "—";
  const fulfilment = vendor?.fulfillment_rate == null ? "—" : `${Math.round(Number(vendor.fulfillment_rate))}%`;

  const onRepeatRecord = async (bookingId) => {
    try {
      const { data } = await ledgerAPI.repeatBooking(bookingId, { note: "Repeated from reusable record" });
      toast.success("Repeat booking created");
      if (data?.activity_id) navigate(`/activities/${data.activity_id}`);
      else await loadLedger();
    } catch (err) {
      toast.error(apiError(err, "Could not repeat booking"));
    }
  };

  const onCompareAlternatives = async ({ template, category, excludeVendorId, label }) => {
    try {
      const { data } = await ledgerAPI.alternatives({
        template,
        category,
        exclude_vendor_id: excludeVendorId,
      });
      setAlternatives(data?.items || []);
      setAltContext(label || "local alternatives");
    } catch (err) {
      toast.error(apiError(err, "Could not load alternatives"));
    }
  };

  const onRemoveRelationship = async (relId) => {
    try {
      await ledgerAPI.deleteRelationship(relId);
      setRelationships((prev) => prev.filter((r) => r.id !== relId));
      toast.success("Removed saved contact");
    } catch (err) {
      toast.error(apiError(err, "Could not remove contact"));
    }
  };

  const onSaveStorefront = async (e) => {
    e.preventDefault();
    setSavingStorefront(true);
    try {
      await ledgerAPI.updateHomeStorefront(storefront);
      toast.success("Home Storefront controls updated");
    } catch (err) {
      toast.error(apiError(err, "Could not update Home Storefront"));
    } finally {
      setSavingStorefront(false);
    }
  };

  if (!vendor) return null;

  return (
    <div className="space-y-8 sm:space-y-10">
      {/* ── Profile, Ledger & Business Control Centre Hero ───────────────── */}
      <section
        aria-label="Business control centre"
        className="relative isolate overflow-hidden rounded-[1.75rem] sm:rounded-[2rem] bg-[#17251E] text-white px-5 py-6 sm:px-8 sm:py-8 space-y-5"
      >
        <div
          className="absolute inset-0 -z-10"
          style={{
            backgroundImage:
              "radial-gradient(circle at 88% 12%, rgb(var(--orchid-500) / 0.35), transparent 34%), radial-gradient(circle at 18% 120%, rgb(var(--brand-500) / 0.28), transparent 55%)",
          }}
          aria-hidden="true"
        />

        <div className="flex flex-wrap items-center gap-4">
          <Avatar
            name={vendor.display_name || vendor.business_name}
            src={vendor.logo_url || vendor.avatar_url || undefined}
            size="lg"
            className="ring-2 ring-white/20 rounded-2xl shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="text-micro font-bold uppercase tracking-[0.14em] text-brand-100 dark:text-brand-300">
              {accountKindMeta.label} · Your business workspace
            </p>
            <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              {vendor.display_name || vendor.business_name}
            </h1>
            <p className="mt-0.5 text-sm text-[#C4D1C8]">
              @{vendor.vendor_handle} · {role.hint}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {vendor.hide_exact_location && (
              <Badge variant="green" size="md" className="!bg-emerald-500/20 !text-emerald-100 !border !border-emerald-300/30">
                <Lock size={11} className="mr-1 inline" /> Approximate public location
              </Badge>
            )}
            <Badge variant="purple" size="md" className="!bg-white/10 !text-white !border !border-white/20">
              {role.emoji} Currently {role.label.toLowerCase()}
            </Badge>
            <Link
              to={`/@${vendor.vendor_handle}?edit=1`}
              aria-label="Edit business profile"
              className="grid place-items-center w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <Settings size={18} aria-hidden="true" />
            </Link>
          </div>
        </div>

        {/* Live counts row */}
        <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
          <div className="rounded-2xl bg-[#314238] px-3.5 py-3">
            <p className="text-micro font-semibold text-[#D5E4D9]">Stock items</p>
            <p className="mt-1 text-2xl font-extrabold text-white tabular-nums">
              {shelfReady ? String(mine.length) : "—"}
            </p>
          </div>
          <div className="rounded-2xl bg-[#314238] px-3.5 py-3">
            <p className="text-micro font-semibold text-[#D5E4D9]">Visible listings</p>
            <p className="mt-1 text-2xl font-extrabold text-white tabular-nums">
              {shelfReady ? String(visibleCount) : "—"}
            </p>
          </div>
          <div className="rounded-2xl bg-[#314238] px-3.5 py-3">
            <p className="text-micro font-semibold text-[#D5E4D9]">Open trades</p>
            <p className="mt-1 text-2xl font-extrabold text-white tabular-nums">
              {String(openTrades)}
            </p>
          </div>
        </div>

        {/* Dual primary actions: Post local activity + Optional Add stock */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            to="/create?type=available"
            className="group block rounded-2xl bg-white/10 hover:bg-white/15 border border-white/20 text-white p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <div className="flex items-center gap-2.5">
              <Home size={20} className="text-brand-200 shrink-0" aria-hidden="true" />
              <span className="text-base font-extrabold">Post a local activity</span>
              <ArrowUpRight size={18} className="ml-auto text-white/80" aria-hidden="true" />
            </div>
            <p className="mt-1 text-xs text-[#D5E4D9]">
              Available, Wanted, Scheduled round, or Opportunity — no shop needed.
            </p>
          </Link>

          <Link
            to="/stock?new=1"
            className="group block rounded-2xl bg-[#DDF5E7] hover:bg-[#CBEED9] text-[#175C43] p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <div className="flex items-center gap-2.5">
              <PlusCircle size={20} className="text-[#175C43] shrink-0" aria-hidden="true" />
              <span className="text-base font-extrabold text-[#175C43]">Add stock</span>
              <ArrowUpRight
                size={18}
                className="ml-auto text-[#175C43] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform"
                aria-hidden="true"
              />
            </div>
            <p className="mt-1 text-xs text-[#175C43]/90">
              List a product or service for buyers to discover.
            </p>
          </Link>
        </div>
      </section>

      {/* ── Local Utility Outcomes (Outcomes, never engagement time) ────── */}
      {metrics && (
        <section
          aria-labelledby="utility-outcomes-heading"
          data-testid="utility-metrics-panel"
          className="rounded-card-lg border border-edge-1 bg-surface-1 p-5 shadow-xs space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
                Meaningful local utility
              </p>
              <h2 id="utility-outcomes-heading" className="mt-0.5 text-lg font-bold text-ink-1">
                Completed outcomes — never screen time
              </h2>
            </div>
            <Badge variant="brand" size="sm">Direct & non-custodial</Badge>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <OutcomeStat label="Requests fulfilled" value={metrics.personal?.requests_fulfilled ?? 0} />
            <OutcomeStat label="Matches completed" value={metrics.personal?.successful_matches ?? 0} />
            <OutcomeStat label="Repeat bookings" value={metrics.personal?.repeat_bookings ?? 0} />
            <OutcomeStat label="Notifications acted on" value={metrics.personal?.notifications_acted_upon ?? 0} />
            <OutcomeStat label="Active local providers" value={metrics.network?.active_local_providers_30d ?? 0} />
          </div>
        </section>
      )}

      {/* ── Reusable Activity Records &Saved Relationships ──────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Private Reusable Records */}
        <section
          aria-labelledby="reusable-records-heading"
          data-testid="reusable-records-panel"
          className="rounded-card-lg border border-edge-1 bg-surface-1 p-5 shadow-xs space-y-3"
        >
          <div>
            <h2 id="reusable-records-heading" className="text-lg font-bold text-ink-1 flex items-center gap-2">
              <CheckCircle2 size={18} className="text-emerald-600" aria-hidden="true" />
              Reusable Activity Records
            </h2>
            <p className="text-2xs text-ink-3">
              Your private history of completed repairs, rounds, and shared sourcing — repeat in one tap or compare local alternatives.
            </p>
          </div>
          {records.length === 0 ? (
            <p className="text-xs text-ink-4">
              Completed Local Activity Ledger bookings appear here automatically once both sides confirm completion.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {records.map((rec) => {
                const bk = rec.booking || {};
                const act = rec.activity || {};
                const other = bk.provider?.id === vendor.id ? bk.initiator : bk.provider;
                return (
                  <li key={bk.id} className="rounded-xl border border-edge-1 bg-surface-0 p-3.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Link to={`/activities/${act.id}`} className="text-xs font-bold text-ink-1 hover:text-brand-700">
                        {act.title || "Completed local activity"}
                      </Link>
                      <Badge variant="green" size="sm">Reusable record</Badge>
                    </div>
                    <p className="text-2xs text-ink-3">
                      With {other?.name || "Neighbour"} {other?.handle ? `(@${other.handle})` : ""} ·
                      Settlement: {bk.settlement_method?.replace(/_/g, " ")}
                      {bk.agreed_price_kes != null ? ` · KSh ${bk.agreed_price_kes}` : ""}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="xs"
                        icon={Repeat}
                        onClick={() => onRepeatRecord(bk.id)}
                        data-testid={`me-repeat-${bk.id}`}
                      >
                        Repeat booking
                      </Button>
                      <Button
                        size="xs"
                        variant="secondary"
                        icon={Compass}
                        onClick={() =>
                          onCompareAlternatives({
                            template: act.inferred_template,
                            category: act.category,
                            excludeVendorId: other?.id,
                            label: TEMPLATE_LABELS[act.inferred_template] || act.title,
                          })
                        }
                        data-testid={`me-alternatives-${bk.id}`}
                      >
                        Compare local alternatives
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Saved Local Relationships */}
        <section
          aria-labelledby="saved-relationships-heading"
          data-testid="saved-relationships-panel"
          className="rounded-card-lg border border-edge-1 bg-surface-1 p-5 shadow-xs space-y-3"
        >
          <div>
            <h2 id="saved-relationships-heading" className="text-lg font-bold text-ink-1 flex items-center gap-2">
              <Bookmark size={18} className="text-brand-600" aria-hidden="true" />
              Saved Local Relationships
            </h2>
            <p className="text-2xs text-ink-3">
              Trusted fundis, neighbours, and cooperatives you work with — always paired with open local alternatives.
            </p>
          </div>
          {relationships.length === 0 ? (
            <p className="text-xs text-ink-4">
              Save artisans, neighbours, or cooperatives from any activity page to keep them handy without locking yourself in.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {relationships.map((rel) => (
                <li key={rel.id} className="rounded-xl border border-edge-1 bg-surface-0 p-3.5 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Link to={`/@${rel.target?.handle}`} className="text-xs font-bold text-ink-1 hover:text-brand-700">
                      {rel.target?.name} (@{rel.target?.handle})
                    </Link>
                    <p className="text-2xs text-ink-4">
                      {rel.label || rel.relationship_kind} · {rel.completed_together_count ?? 0} completed together
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="xs"
                      variant="secondary"
                      icon={Compass}
                      onClick={() =>
                        onCompareAlternatives({
                          excludeVendorId: rel.target?.id,
                          label: rel.label || rel.relationship_kind,
                        })
                      }
                    >
                      Alternatives
                    </Button>
                    <button
                      type="button"
                      aria-label={`Remove ${rel.target?.name || "contact"}`}
                      onClick={() => onRemoveRelationship(rel.id)}
                      className="p-1.5 text-ink-4 hover:text-danger"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {altContext && (
            <div data-testid="me-alternatives-drawer" className="rounded-xl border border-brand-500/30 bg-surface-0 p-3 space-y-2">
              <p className="text-2xs font-bold text-ink-1">
                Open local alternatives for {altContext}:
              </p>
              {alternatives.length === 0 ? (
                <p className="text-2xs text-ink-4">No other open listings in this category right now.</p>
              ) : (
                <ul className="space-y-1.5">
                  {alternatives.map((alt) => (
                    <li key={alt.id} className="flex items-center justify-between text-2xs">
                      <Link to={`/activities/${alt.id}`} className="font-semibold text-brand-700 hover:underline">
                        {alt.title} ({alt.owner?.name})
                      </Link>
                      {alt.price_kes != null && <span>KSh {alt.price_kes}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>

      {/* ── Phase 2: Home Storefront Controls ───────────────────────────── */}
      <section
        aria-labelledby="home-storefront-heading"
        data-testid="home-storefront-panel"
        className="rounded-card-lg border border-edge-1 bg-surface-1 p-5 shadow-xs space-y-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
              Household & occasional shelf
            </p>
            <h2 id="home-storefront-heading" className="mt-0.5 text-lg font-bold text-ink-1">
              Home Storefront Controls
            </h2>
            <p className="mt-0.5 text-2xs text-ink-3">
              Share kienyeji eggs, seedlings, baked goods, or home crafts on your own terms — choose who sees your shelf and keep gate directions locked until booked.
            </p>
          </div>
          <Badge variant={storefront.enabled ? "green" : "gray"} size="sm">
            {storefront.enabled ? "Home shelf active" : "Off by default"}
          </Badge>
        </div>

        <form onSubmit={onSaveStorefront} className="grid gap-3 sm:grid-cols-3">
          <Input
            label="Shelf title"
            value={storefront.title || ""}
            onChange={(e) => setStorefront((s) => ({ ...s, title: e.target.value }))}
            placeholder="e.g. Kiamunyi Orchard Shelf"
            data-testid="home-storefront-title"
          />
          <Input
            label="Visiting / pickup hours"
            value={storefront.visiting_hours || ""}
            onChange={(e) => setStorefront((s) => ({ ...s, visiting_hours: e.target.value }))}
            placeholder="e.g. Sat 4pm–6pm"
            data-testid="home-storefront-hours"
          />
          <Select
            label="Who can view home shelf items"
            options={[
              { value: "saved_contacts", label: "Saved local contacts only" },
              { value: "neighbourhood", label: "My neighbourhood" },
              { value: "everyone", label: "Everyone" },
            ]}
            value={storefront.audience || "saved_contacts"}
            onChange={(e) => setStorefront((s) => ({ ...s, audience: e.target.value }))}
            data-testid="home-storefront-audience"
          />
          <label className="sm:col-span-2 flex items-center gap-2.5 text-xs text-ink-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(storefront.enabled)}
              onChange={(e) => setStorefront((s) => ({ ...s, enabled: e.target.checked }))}
              data-testid="home-storefront-enabled"
              className="h-4 w-4 rounded border-edge-2 text-brand-600 focus:ring-brand-500"
            />
            <span>Enable my occasional Home Storefront</span>
          </label>
          <div className="flex justify-end">
            <Button size="sm" type="submit" loading={savingStorefront} data-testid="save-home-storefront-btn">
              Save Home Storefront
            </Button>
          </div>
        </form>
      </section>

      {/* ── Quick actions ─────────────────────────────────────────────────── */}
      <section aria-labelledby="quick-actions-heading" className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
              Control centre
            </p>
            <h2 id="quick-actions-heading" className="mt-1 text-xl font-bold text-ink-1">
              Quick actions
            </h2>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {QUICK_ACTIONS.map((item) => (
            <QuickActionCard key={item.title} item={item} vendor={vendor} />
          ))}
        </div>
      </section>

      {/* ── Business snapshot ─────────────────────────────────────────────── */}
      <section aria-label="Business snapshot" className="grid grid-cols-2 sm:grid-cols-4 border-y border-edge-1 divide-x divide-edge-1">
        <Snapshot label="Fulfilment" value={fulfilment} note="recorded deliveries" />
        <Snapshot label="Network score" value={scoreLabel} note="earned through completed trade" />
        <Snapshot label="On your shelf" value={shelfReady ? String(mine.length) : "—"} note={`${shelfReady ? visibleCount : "—"} visible to the network`} />
        <Snapshot label="Trading mode" value={role.label} note="shared with every screen" />
      </section>

      {/* ── Secondary organized tools ─────────────────────────────────────── */}
      {sections.map(({ group, items }, index) => (
        <section key={group} aria-labelledby={`workspace-${group.toLowerCase().replace(/\s+/g, "-")}`}>
          <div className="flex items-end justify-between gap-4 border-b border-edge-1 pb-3">
            <div>
              <p className="text-micro font-bold uppercase tracking-[0.14em] text-orchid-700 dark:text-orchid-300">
                0{index + 1} / Workspace
              </p>
              <h2 id={`workspace-${group.toLowerCase().replace(/\s+/g, "-")}`} className="mt-1 text-xl font-bold text-ink-1">
                {group}
              </h2>
            </div>
          </div>
          <div className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <WorkspaceLink key={item.title} item={item} vendor={vendor} />
            ))}
          </div>
        </section>
      ))}

      <p className="flex items-start gap-2 rounded-xl bg-surface-2 px-4 py-3 text-2xs text-ink-3">
        <Sparkles size={15} className="mt-0.5 shrink-0 text-orchid-600 dark:text-orchid-300" aria-hidden="true" />
        Scores and fulfilment are calculated from recorded trades. Ogallo does not let businesses enter their own trust metrics.
      </p>
    </div>
  );
}

function OutcomeStat({ label, value }) {
  return (
    <div className="rounded-xl border border-edge-1 bg-surface-0 px-3.5 py-3">
      <p className="text-micro font-semibold text-ink-4">{label}</p>
      <p className="mt-1 text-xl font-extrabold tabular-nums text-ink-1">{value}</p>
    </div>
  );
}

function Snapshot({ label, value, note }) {
  return (
    <div className="min-w-0 px-3 py-4 sm:px-5 sm:py-5 first:pl-0">
      <p className="text-micro font-bold uppercase tracking-[0.1em] text-ink-4">{label}</p>
      <p className="mt-1.5 truncate text-xl sm:text-2xl font-bold leading-none text-ink-1 tabular-nums">{value}</p>
      <p className="mt-1.5 text-micro text-ink-4 leading-snug">{note}</p>
    </div>
  );
}
