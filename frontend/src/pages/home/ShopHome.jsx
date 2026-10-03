import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Newspaper, Network, Package, Truck, Users, CalendarDays, Briefcase, Trophy,
} from "lucide-react";
import DigitalNumber from "@/components/ui/DigitalNumber";
import EmptyState from "@/components/ui/EmptyState";
import { newsAPI, squadAPI, apiError } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { useStockStore } from "@/stores/stockStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { VENDOR_ROLES } from "@/config/constants";
import { num, relativeTime } from "@/lib/formatters";

// ─────────────────────────────────────────────────────────────────────────────
// MY SHOP APP — the home shelf.
//
// The home is a shelf, not a feed. Each tile is a section that answers one
// business question (what changed, who has stock, what's listed, what can be
// rented, who's buying together, what's on, and your own workspace — Brief).
// The number on a tile is a count of real rows from /api/news; zero renders
// as "—" because a section with nothing underneath must read empty, not
// decorated. No explanatory copy on this screen — details live inside the
// section you tap.
// ─────────────────────────────────────────────────────────────────────────────

export default function ShopHome() {
  const navigate = useNavigate();
  const vendor = useAuthStore((s) => s.vendor);
  const { movements, actionable, fetchMovements } = useStockStore();
  const { unreadCount, fetch: fetchNotifications } = useNotificationStore();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [openCalls, setOpenCalls] = useState(null);

  useEffect(() => {
    fetchMovements().catch(() => {});
    fetchNotifications({ limit: 1 }).catch(() => {});
    newsAPI
      .feed(7)
      .then((r) => setData(r.data))
      .catch((e) => setError(apiError(e, "The board could not be loaded")));
    // The Squad tile shows real open call-ups — a count that can never pad itself.
    squadAPI.calls().then((r) => setOpenCalls(r.data.calls.length)).catch(() => {});
  }, [fetchMovements, fetchNotifications]);

  if (error) return <EmptyState icon={Newspaper} title="The board is down" description={error} />;

  const counts = data?.counts ?? null;
  const briefCount = (typeof unreadCount === "number" ? unreadCount : 0) + (actionable()?.length ?? 0);
  const role = VENDOR_ROLES.find((r) => r.value === vendor?.current_role);

  const tiles = [
    { to: "/news", label: "News", icon: Newspaper, count: counts?.news, tint: "text-ink-1" },
    { to: "/network", label: "Suppliers", icon: Network, count: counts?.suppliers, tint: "text-brand-300" },
    { to: "/stock", label: "Stock", icon: Package, count: counts?.stock, tint: "text-amber-300" },
    { to: "/tools", label: "Rentals", icon: Truck, count: counts?.rentals, tint: "text-blue-300" },
    { to: "/groups", label: "Groups", icon: Users, count: counts?.groups, tint: "text-violet-300" },
    { to: "/events", label: "Events", icon: CalendarDays, count: counts?.events, tint: "text-brand-300" },
    { to: "/brief", label: "Brief", icon: Briefcase, count: briefCount, tint: "text-brand-300" },
    { to: "/squad", label: "Squad", icon: Trophy, count: openCalls, tint: "text-brand-300" },
  ];

  return (
    <div className="space-y-6">
      {/* ── The plate — brand, place-day, and today's real count. Dark glass
          with the gold wordmark; nothing below it carries the brand. ── */}
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

      {/* ── The shelf — seven doors, one question each ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {tiles.map(({ to, label, icon: Icon, count, tint }) => {
          const has = typeof count === "number" && count > 0;
          return (
            <button
              key={to}
              onClick={() => navigate(to)}
              className="glass glass-hover rounded-3xl p-4 text-left transition-transform active:scale-[0.985] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
              aria-label={`${label} — ${has ? count : "none yet"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="w-10 h-10 rounded-2xl bg-white/[0.05] flex items-center justify-center shrink-0">
                  <Icon size={18} className={tint} />
                </span>
                <span className="pt-1">
                  {data === null ? (
                    <span className="text-ink-4 text-lg">·</span>
                  ) : (
                    <DigitalNumber value={has ? num(count) : "—"} size="sm" className={has ? "" : "opacity-40"} />
                  )}
                </span>
              </div>
              <p className="mt-3 text-sm font-semibold text-ink-1 tracking-tight">{label}</p>
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
