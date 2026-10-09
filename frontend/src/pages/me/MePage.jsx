import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight, BarChart3, ChevronRight, ClipboardList, Layers3,
  List, Package, ShoppingBasket, ShieldCheck, Sparkles, Store, Terminal,
  Truck,
} from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import { VENDOR_ROLES } from "@/config/constants";
import { useAuthStore } from "@/stores/authStore";
import { useStockStore } from "@/stores/stockStore";
import { cn } from "@/lib/utils";

const DESTINATIONS = [
  {
    title: "Shop front",
    description: "Your public business page and shareable shelf.",
    to: (vendor) => `/@${vendor.vendor_handle}`,
    icon: Store,
    tone: "brand",
    group: "Business",
  },
  {
    title: "My shelf",
    description: "Manage quantities, visibility, provenance and imports.",
    to: () => "/stock",
    icon: Package,
    tone: "green",
    group: "Business",
  },
  {
    title: "Analytics",
    description: "Review settled trade, fulfilment and price position.",
    to: () => "/analytics",
    icon: BarChart3,
    tone: "purple",
    group: "Business",
  },
  {
    title: "POS Bridge",
    description: "Connect a till or import stock from a CSV file.",
    to: () => "/pos",
    icon: Terminal,
    tone: "amber",
    group: "Business",
  },
  {
    title: "Tasks",
    description: "Squad calls, work in progress and network tasks.",
    to: () => "/tasks",
    icon: ClipboardList,
    tone: "purple",
    group: "Workspace",
  },
  {
    title: "Vendor lists",
    description: "Curated supplier directories and patron tools.",
    to: () => "/lists",
    icon: List,
    tone: "green",
    group: "Workspace",
  },
  {
    title: "Market Locks",
    description: "Join coordinated buying windows and track a lock.",
    to: () => "/locks",
    icon: ShoppingBasket,
    tone: "amber",
    group: "Workspace",
  },
  {
    title: "Rentals & logistics",
    description: "Find transport, storage, couriers and equipment.",
    to: () => "/tools",
    icon: Truck,
    tone: "blue",
    group: "Workspace",
  },
  {
    title: "Our Network",
    description: "Participate in the governance of the trading network.",
    to: () => "/governance",
    icon: ShieldCheck,
    tone: "green",
    group: "Network",
  },
  {
    title: "Surfaces",
    description: "See the wider stream of network activity.",
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
  const vendor = useAuthStore((s) => s.vendor);
  const mine = useStockStore((s) => s.mine);
  const fetchMine = useStockStore((s) => s.fetchMine);
  const [shelfReady, setShelfReady] = useState(false);

  useEffect(() => {
    let live = true;
    fetchMine()
      .then(() => live && setShelfReady(true))
      .catch(() => live && setShelfReady(true));
    return () => {
      live = false;
    };
  }, [fetchMine]);

  const role = VENDOR_ROLES.find((item) => item.value === vendor?.current_role) || VENDOR_ROLES[2];
  const sections = useMemo(
    () => ["Business", "Workspace", "Network"].map((group) => ({ group, items: DESTINATIONS.filter((item) => item.group === group) })),
    []
  );
  const visibleCount = mine.filter((item) => item.visible_to_network).length;
  const score = Number(vendor?.network_score || 0);
  const scoreLabel = score > 0 ? score.toFixed(1) : "—";
  const fulfilment = vendor?.fulfillment_rate == null ? "—" : `${Math.round(Number(vendor.fulfillment_rate))}%`;

  if (!vendor) return null;

  return (
    <div className="space-y-8 sm:space-y-10">
      <section className="relative isolate overflow-hidden rounded-[1.75rem] sm:rounded-[2rem] bg-ink-1 text-white px-5 py-6 sm:px-8 sm:py-8">
        <div
          className="absolute inset-0 -z-10"
          style={{ backgroundImage: "radial-gradient(circle at 88% 12%, rgb(var(--orchid-500) / 0.55), transparent 34%), radial-gradient(circle at 18% 120%, rgb(var(--brand-500) / 0.38), transparent 55%)" }}
          aria-hidden="true"
        />
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <Avatar name={vendor.business_name} size="lg" className="ring-2 ring-white/20 rounded-2xl" />
          <div className="min-w-0 flex-1">
            <p className="text-micro font-bold uppercase tracking-[0.14em] text-brand-100 dark:text-brand-300">Your business workspace</p>
            <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-white">{vendor.business_name}</h1>
            <p className="mt-1 text-sm text-white/70">@{vendor.vendor_handle} · {role.hint}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="purple" size="md" className="!bg-white/10 !text-white !border !border-white/20">
              {role.emoji} Currently {role.label.toLowerCase()}
            </Badge>
          </div>
        </div>
        <p className="mt-5 max-w-3xl text-sm text-white/75 leading-relaxed">
          Keep your shop, stock and trading tools close. Your operating mode is shared across Ogallo; change it once from your profile menu.
        </p>
      </section>

      <section aria-label="Business snapshot" className="grid grid-cols-2 sm:grid-cols-4 border-y border-edge-1 divide-x divide-edge-1">
        <Snapshot label="Fulfilment" value={fulfilment} note="recorded deliveries" />
        <Snapshot label="Network score" value={scoreLabel} note="earned through completed trade" />
        <Snapshot label="On your shelf" value={shelfReady ? String(mine.length) : "—"} note={`${shelfReady ? visibleCount : "—"} visible to the network`} />
        <Snapshot label="Trading mode" value={role.label} note="shared with every screen" />
      </section>

      {sections.map(({ group, items }, index) => (
        <section key={group} aria-labelledby={`workspace-${group.toLowerCase()}`}>
          <div className="flex items-end justify-between gap-4 border-b border-edge-1 pb-3">
            <div>
              <p className="text-micro font-bold uppercase tracking-[0.14em] text-orchid-700 dark:text-orchid-300">0{index + 1} / Workspace</p>
              <h2 id={`workspace-${group.toLowerCase()}`} className="mt-1 text-xl font-bold text-ink-1">{group}</h2>
            </div>
          </div>
          <div className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => <WorkspaceLink key={item.title} item={item} vendor={vendor} />)}
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

function Snapshot({ label, value, note }) {
  return (
    <div className="min-w-0 px-3 py-4 sm:px-5 sm:py-5 first:pl-0">
      <p className="text-micro font-bold uppercase tracking-[0.1em] text-ink-4">{label}</p>
      <p className="mt-1.5 truncate text-xl sm:text-2xl font-bold leading-none text-ink-1 tabular-nums">{value}</p>
      <p className="mt-1.5 text-micro text-ink-4 leading-snug">{note}</p>
    </div>
  );
}
