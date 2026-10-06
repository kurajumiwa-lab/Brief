import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Package, Zap, ArrowLeftRight, CalendarDays, MapPin, Building2, Store,
  Sigma, LayoutGrid, ChevronUp,
} from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { surfaceAPI, apiError } from "@/lib/api";
import { toast } from "@/components/ui/Toast";
import { num, relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE FEED — home as a vertical snap feed. One surface per screen, swipe
// up for the next. Every card is a real row, leads with exactly one number a
// trader acts on, and carries its source + freshness. Ordering is round-robin
// across kinds (done server-side) — no ranking algorithm, no fake engagement.
// The last card is the doors: the full section grid.
// ─────────────────────────────────────────────────────────────────────────────

const KIND_META = {
  product: { icon: Package, tint: "text-amber-300", label: "Price on the shelf" },
  callup: { icon: Zap, tint: "text-amber-300", label: "Call-up near you" },
  movement: { icon: ArrowLeftRight, tint: "text-blue-300", label: "Stock moved" },
  event: { icon: CalendarDays, tint: "text-brand-300", label: "Event coming up" },
  market: { icon: MapPin, tint: "text-violet-300", label: "Market heat" },
  place: { icon: Building2, tint: "text-blue-300", label: "Place near you" },
  vendor: { icon: Store, tint: "text-brand-300", label: "Vendor near you" },
  index: { icon: Sigma, tint: "text-amber-300", label: "Price index" },
};

const DOORS = [
  { to: "/search", label: "Search", icon: SearchIcon },
  { to: "/map", label: "Map", icon: MapPin },
  { to: "/markets", label: "Markets", icon: MapPin },
  { to: "/tasks", label: "Tasks", icon: Zap },
  { to: "/squad", label: "Squad", icon: LayoutGrid },
  { to: "/news", label: "News", icon: CalendarDays },
  { to: "/stock", label: "Stock", icon: Package },
  { to: "/network", label: "Suppliers", icon: Store },
  { to: "/tools", label: "Rentals", icon: Building2 },
  { to: "/groups", label: "Groups", icon: Store },
  { to: "/events", label: "Events", icon: CalendarDays },
  { to: "/brief", label: "Brief", icon: LayoutGrid },
];

function SearchIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>;
}

const Money = ({ value, label, big = true }) => (
  <div className="text-right">
    <p className={cn("digital text-ink-1", big ? "text-2xl" : "text-lg")}>KES {num(value)}</p>
    {label && <p className="text-2xs text-ink-4 mt-0.5">{label}</p>}
  </div>
);

function Hero({ kind, d }) {
  switch (kind) {
    case "product":
      return <Money value={d.price} label={`${d.price_label} price · ${d.category || "stock"}`} />;
    case "callup":
      return <Money value={d.pay} label="pay for the job" />;
    case "movement":
      return <div className="text-right">
        <p className="text-sm font-semibold text-ink-1">{num(d.quantity)} {d.unit}</p>
        {d.total_value != null && <p className="digital text-sm text-ink-2 mt-0.5">KES {num(d.total_value)}</p>}
        <p className="text-2xs text-ink-4 mt-0.5 uppercase">{d.status}</p>
      </div>;
    case "event":
      return <div className="text-center rounded-xl bg-white/[0.05] px-3 py-2 shrink-0">
        <p className="text-2xs font-bold text-ink-4">{d.dow}</p>
        <p className="digital text-2xl text-ink-1 leading-tight">{d.day}</p>
        <p className="text-2xs font-bold text-ink-4">{d.mon}</p>
      </div>;
    case "market":
      return <div className="text-center rounded-xl bg-violet-400/10 px-3 py-2 shrink-0">
        <p className="digital text-2xl text-violet-300 leading-tight">{num(d.members)}</p>
        <p className="text-2xs text-ink-4">registered</p>
      </div>;
    case "place":
    case "vendor":
      return typeof d.distance_km === "number"
        ? <div className="text-center rounded-xl bg-white/[0.05] px-3 py-2 shrink-0">
            <p className="digital text-2xl text-ink-1 leading-tight">{d.distance_km}</p>
            <p className="text-2xs text-ink-4">km away</p>
          </div>
        : <div className="text-center rounded-xl bg-white/[0.05] px-3 py-2 shrink-0">
            <p className="text-xs font-bold text-ink-2 px-1 leading-tight">{d.category || d.name}</p>
          </div>;
    case "index":
      return <div className="text-right">
        <p className="digital text-2xl text-ink-1">KES {num(d.median)}</p>
        <p className="text-2xs text-ink-4 mt-0.5">median of {num(d.n)} stated</p>
      </div>;
    default:
      return null;
  }
}

function MetaLines({ kind, d }) {
  switch (kind) {
    case "product":
      return <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-ink-1 truncate">{d.name}</p>
        <p className="text-2xs text-ink-4 mt-1 truncate">
          {d.vendor}
          {d.quantity_available > 0 ? ` · ${num(d.quantity_available)} ${d.unit_of_measure} available` : ""}
        </p>
        <p className="text-2xs text-ink-4 mt-0.5">{d.quality ? `quality: ${d.quality}` : "quality not stated"}</p>
      </div>;
    case "callup":
      return <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-ink-1 truncate">{d.title}</p>
        <p className="text-2xs text-ink-4 mt-1 truncate">{d.client}{d.location ? ` · ${d.location}` : ""}</p>
        <p className="text-2xs text-ink-4 mt-0.5">
          {d.skill}{d.squad ? " · squad mission" : ""} · expires {d.expires_at ? relativeTime(d.expires_at) : "soon"}
        </p>
      </div>;
    case "movement":
      return <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-ink-1 truncate">{d.name}</p>
        <p className="text-sm text-ink-2 mt-1 flex items-center gap-1.5 truncate">
          <span className="truncate">{d.from_name}</span>
          <ArrowLeftRight size={12} className="text-ink-4 shrink-0" />
          <span className="truncate">{d.to_name}</span>
        </p>
      </div>;
    case "event":
      return <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-ink-1 truncate">{d.title}</p>
        <p className="text-2xs text-ink-4 mt-1 truncate">{d.time} · {d.location}</p>
        <p className="text-2xs text-ink-4 mt-0.5">{num(d.registered)}/{num(d.capacity)} in · by {d.organizer}</p>
        {d.fee != null && <p className="text-2xs text-ink-4 mt-0.5">entry KES {num(d.fee)}</p>}
      </div>;
    case "market":
      return <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-ink-1 truncate">{d.name}</p>
        <p className="text-2xs text-ink-4 mt-1 truncate">{[d.city, d.country].filter(Boolean).join(", ")}</p>
        <p className="text-2xs text-ink-4 mt-0.5">{num(d.places)} public places mapped{typeof d.distance_km === "number" ? ` · ${d.distance_km} km` : ""}</p>
      </div>;
    case "place":
      return <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-ink-1 truncate">{d.name}</p>
        <p className="text-2xs text-ink-4 mt-1 truncate">{d.category || "business"}{d.zone_name ? ` · ${d.zone_name}` : ""}</p>
        <p className="text-2xs text-ink-4 mt-0.5">{d.claimed_by_me ? "claimed by you" : d.checked_at ? `checked ${relativeTime(d.checked_at)}` : "open data"}</p>
      </div>;
    case "vendor":
      return <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-ink-1 truncate">{d.name}</p>
        <p className="text-2xs text-ink-4 mt-1 truncate font-mono">@{d.handle}</p>
        <p className="text-2xs text-ink-4 mt-0.5 truncate">{d.categories?.length ? d.categories.join(" · ") : "categories not stated"}</p>
      </div>;
    case "index":
      return <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-ink-1 capitalize truncate">{d.category}</p>
        <p className="text-2xs text-ink-4 mt-1">KES {num(d.min)}–{num(d.max)} across {num(d.n)} stated prices</p>
        <p className="text-2xs text-ink-4 mt-0.5">no vendor identity · median, not an average of averages</p>
      </div>;
    default:
      return null;
  }
}

function FeedCard({ c, onGo }) {
  const m = KIND_META[c.kind] || KIND_META.product;
  const Icon = m.icon;
  return (
    <section className="h-full snap-start px-4 pt-6 pb-20">
      <div className="glass-strong rounded-3xl p-5 h-full flex flex-col">
        <div className="flex items-center gap-2">
          <span className={cn("inline-flex items-center gap-1.5 text-2xs font-bold uppercase tracking-[0.18em]", m.tint)}>
            <Icon size={13} /> {m.label}
          </span>
          {c.at && <span className="ml-auto text-2xs text-ink-4">{relativeTime(c.at)}</span>}
        </div>
        <div className="mt-5 flex items-start gap-4 flex-1">
          <div className="min-w-0 flex-1 order-1">
            <MetaLines kind={c.kind} d={c.data} />
          </div>
          <div className="order-0 shrink-0">
            <Hero kind={c.kind} d={c.data} />
          </div>
        </div>
        {c.action && (
          <button type="button" onClick={() => onGo(c.action.to)}
            className="mt-5 self-end px-4 py-2.5 rounded-2xl text-xs font-black cursor-pointer"
            style={{ background: "rgba(251,191,36,0.14)", color: "#FCD34D" }}>
            {c.action.label}
          </button>
        )}
      </div>
    </section>
  );
}

function DoorsCard({ onGo }) {
  return (
    <section className="h-full snap-start px-4 pt-6 pb-20">
      <div className="glass-strong rounded-3xl p-5 h-full flex flex-col">
        <div className="flex items-center gap-2">
          <LayoutGrid size={14} className="text-ink-3" />
          <span className="text-2xs font-bold uppercase tracking-[0.18em] text-ink-3">The doors</span>
          <span className="ml-auto text-2xs text-ink-4">every section, one grid</span>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2.5 flex-1 content-start">
          {DOORS.map((d) => (
            <button key={d.to} type="button" onClick={() => onGo(d.to)}
              className="rounded-2xl bg-white/[0.04] hover:bg-white/[0.07] p-3 text-left cursor-pointer">
              <d.icon size={15} className="text-ink-3" />
              <p className="text-xs font-bold text-ink-1 mt-2">{d.label}</p>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function SurfaceFeed() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    surfaceAPI.feed().then((r) => live && setData(r.data)).catch((e) => live && setError(apiError(e, "The feed could not be loaded")));
    return () => { live = false; };
  }, []);

  if (error) return <EmptyState icon={Package} title="The feed is down" description={error} />;
  if (!data) return <PageSpinner label="Reading the surfaces…" />;

  const onGo = (to) => navigate(to);

  const cards = data.cards || [];

  return (
    <div className="h-[calc(100vh-8rem)] overflow-y-auto snap-y snap-mandatory no-scrollbar">
      <div className="pt-4 px-4">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-xl font-semibold text-ink-1 tracking-tight">Surfaces</h2>
            <p className="text-xs text-ink-4 mt-0.5">Real rows, one number each · swipe up</p>
          </div>
          <span className="text-2xs text-ink-4 font-mono">{num(cards.length)} surfaces</span>
        </div>
      </div>
      {cards.length === 0 ? (
        <div className="px-4 py-10">
          <EmptyState icon={Package} title="Nothing on the surface yet"
            description="The feed fills as vendors state prices, clients post call-ups, stock moves and markets register members." />
        </div>
      ) : (
        cards.map((c) => <FeedCard key={c.id} c={c} onGo={onGo} />)
      )}
      <DoorsCard onGo={onGo} />
      <div className="h-8" />
    </div>
  );
}
