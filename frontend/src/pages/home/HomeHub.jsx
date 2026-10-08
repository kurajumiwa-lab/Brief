import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Newspaper, Network, Package, Truck, Users, CalendarDays, MapPin, ListChecks,
  Compass, Map as MapIcon, ChevronRight,
} from "lucide-react";
import DigitalNumber from "@/components/ui/DigitalNumber";
import EmptyState from "@/components/ui/EmptyState";
import { newsAPI, squadAPI, marketsAPI, mapAPI, nearbyAPI, apiError } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { VENDOR_ROLES } from "@/config/constants";
import { num, relativeTime } from "@/lib/formatters";
import { formatCount } from "@/lib/mapViewport";

// ─────────────────────────────────────────────────────────────────────────────
// HOME — a hub, not a terminal screen.
//
// The home is a shelf: one tile per capability, and every tile opens a
// SECONDARY SCREEN that owns the detail. Nothing is decided here. This is what
// "home with secondary screens" means in practice:
//
//     Home (hub)          →  secondary screen           →  detail
//     Around you          →  /nearby                    →  /nearby/food-drink
//                                                       →  /place/{id} · /@handle
//     News                →  /news                      →  /news/stock
//     Suppliers           →  /network                   →  /@handle
//     Stock · Rentals · Groups · Events → their own screens
//     Markets             →  /markets                   →  /markets/{id}
//     Tasks               →  /tasks                     →  /tasks/squad · /tasks/brief
//     Map                 →  /map                       →  bottom sheet
//
// The number on a tile is a count of real rows: it can be zero ("—") but it is
// never padded, and it is never a badge of importance. A tile with nothing
// under it still opens — an empty section says so inside, not by disappearing.
//
// The near-you list that used to BE the home is now /nearby, where it can have
// the drill-downs a list on a home screen cannot: category screens and a real
// place profile (before, tapping a business went to the map — a dead end).
// ─────────────────────────────────────────────────────────────────────────────

export default function HomeHub() {
  const navigate = useNavigate();
  const vendor = useAuthStore((s) => s.vendor);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [extras, setExtras] = useState({ calls: null, markets: null, places: null, nearby: null });

  useEffect(() => {
    let live = true;
    newsAPI
      .feed(7)
      .then((r) => live && setData(r.data))
      .catch((e) => live && setError(apiError(e, "The board could not be loaded")));
    // Three counts that are cheap enough to sit on a shelf: open call-ups, the
    // markets you are registered for, and the mapped directory.
    squadAPI.calls().then((r) => live && setExtras((x) => ({ ...x, calls: r.data.calls.length }))).catch(() => {});
    marketsAPI.mine().then((r) => live && setExtras((x) => ({ ...x, markets: r.data.markets.length }))).catch(() => {});
    mapAPI.counts().then((r) => live && setExtras((x) => ({ ...x, places: r.data.places }))).catch(() => {});
    // The "Around you" tile counts what is actually around you, not the whole
    // directory: one row back, and the total is the truth.
    nearbyAPI.list({ radius_km: 5, limit: 1 }).then((r) => live && setExtras((x) => ({ ...x, nearby: r.data.total }))).catch(() => {});
    return () => { live = false; };
  }, []);

  if (error) return <EmptyState icon={Newspaper} title="The board is down" description={error} />;

  const counts = data?.counts ?? null;
  const role = VENDOR_ROLES.find((r) => r.value === vendor?.current_role);

  const tiles = [
    { to: "/nearby", label: "Around you", icon: Compass, count: extras.nearby, tint: "text-brand-300" },
    { to: "/map", label: "Map", icon: MapIcon, count: extras.places, tint: "text-blue-300" },
    { to: "/news", label: "News", icon: Newspaper, count: counts?.news, tint: "text-ink-1" },
    { to: "/network", label: "Suppliers", icon: Network, count: counts?.suppliers, tint: "text-brand-300" },
    { to: "/stock", label: "Stock", icon: Package, count: counts?.stock, tint: "text-amber-300" },
    { to: "/tools", label: "Rentals", icon: Truck, count: counts?.rentals, tint: "text-blue-300" },
    { to: "/markets", label: "Markets", icon: MapPin, count: extras.markets, tint: "text-amber-300" },
    { to: "/groups", label: "Groups", icon: Users, count: counts?.groups, tint: "text-violet-300" },
    { to: "/events", label: "Events", icon: CalendarDays, count: counts?.events, tint: "text-brand-300" },
    { to: "/tasks", label: "Tasks", icon: ListChecks, count: extras.calls, tint: "text-brand-300" },
  ];

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* ── The plate — brand, place-day, and today's real count ── */}
      <div className="glass-strong rounded-3xl px-5 py-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-2xs font-bold uppercase tracking-[0.3em] text-brand-400">My Shop App</p>
          <h2 className="text-2xl font-semibold text-ink-1 tracking-tight mt-1 truncate">
            {vendor?.business_name || "The market"}
          </h2>
          <p className="text-xs text-ink-4 mt-0.5">
            {new Date().toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long" })}
            {role ? ` · ${role.emoji} ${role.label.toLowerCase()}` : ""}
          </p>
        </div>
        <div className="text-right shrink-0">
          <DigitalNumber value={data ? num(data.new_today) : "—"} tone="brand" size="2xl" />
          <p className="text-2xs text-ink-4 mt-1.5">new today</p>
        </div>
      </div>

      {/* ── The shelf — one door per question ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {tiles.map(({ to, label, icon: Icon, count, tint }) => {
          const has = typeof count === "number" && count > 0;
          return (
            <button
              key={to}
              type="button"
              onClick={() => navigate(to)}
              className="group glass glass-hover rounded-3xl p-4 text-left transition-transform active:scale-[0.985] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 cursor-pointer"
              aria-label={`${label} — ${has ? num(count) : "none yet"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="w-10 h-10 rounded-2xl bg-white/[0.05] flex items-center justify-center shrink-0">
                  <Icon size={18} className={tint} />
                </span>
                <span className="pt-1">
                  {data === null && count === null ? (
                    <span className="text-ink-4 text-lg">·</span>
                  ) : (
                    <DigitalNumber
                      value={has ? formatCount(count) : "—"}
                      size="sm"
                      className={has ? "" : "opacity-40"}
                    />
                  )}
                </span>
              </div>
              <p className="mt-3 text-sm font-semibold text-ink-1 tracking-tight flex items-center gap-1">
                {label}
                <ChevronRight size={12} className="text-ink-4 opacity-30 group-hover:opacity-100 transition-opacity" />
              </p>
            </button>
          );
        })}
      </div>

      {/* The one line that keeps the numbers honest */}
      <p className="text-2xs text-ink-4 px-1">
        Counts are live rows · prices are vendor-stated, shown with when they were stated
        {data ? ` · board read ${relativeTime(data.generated_at)}` : ""}
      </p>
    </div>
  );
}
