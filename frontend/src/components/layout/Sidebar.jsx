import { NavLink, useNavigate } from "react-router-dom";
import {
  Home, Newspaper, Package, Network, List, Users, MessageSquare, Terminal,
  CalendarDays, Briefcase, Truck, ShoppingBasket, ShieldCheck, BarChart3, LogOut,
  MapPin, ListChecks, Search, Map, Compass, Moon, Sun, LayoutGrid, Receipt,
} from "lucide-react";
import Logo from "./Logo";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import RoleSwitcher from "@/components/vendor/RoleSwitcher";
import { LevelBadge } from "@/components/trust/TrustSignals";
import Avatar from "@/components/ui/Avatar";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════════════════
   ALL SECTIONS
   ---------------------------------------------------------------------------
   v2 shipped this list as a permanent 20-item desktop rail — every destination
   shouting at the same volume. v3 keeps EVERY destination (nothing was cut)
   but moves the long tail into a panel opened from the header, so the chrome
   can spend its pixels on the core loop instead.

   NAV / NAV_BRIEF are still exported, still in the same order, and still the
   contract the shell spec asserts against.
   ═══════════════════════════════════════════════════════════════════════════ */

// The shelf — the sections a shop checks every day, one question each.
export const NAV = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/nearby", label: "Around you", icon: Compass },
  { to: "/search", label: "Search", icon: Search },
  { to: "/map", label: "Map", icon: Map },
  { to: "/news", label: "News", icon: Newspaper },
  { to: "/network", label: "Suppliers", icon: Network },
  { to: "/stock", label: "Stock", icon: Package },
  { to: "/tools", label: "Rentals", icon: Truck },
  { to: "/markets", label: "Markets", icon: MapPin },
  { to: "/groups", label: "Groups", icon: Users },
  { to: "/events", label: "Events", icon: CalendarDays },
  { to: "/feed", label: "Surfaces", icon: Newspaper },
  // The one door into the task loops (Squad league + Brief workspace).
  { to: "/tasks", label: "Tasks", icon: ListChecks },
];

// Brief — the vendor's own workspace, kept as a feature inside the app.
export const NAV_BRIEF = [
  { to: "/brief", label: "Brief", icon: Briefcase },
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/lists", label: "Vendor Lists", icon: List },
  { to: "/locks", label: "Market Locks", icon: ShoppingBasket },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/pos", label: "POS Bridge", icon: Terminal },
  { to: "/governance", label: "Our Network", icon: ShieldCheck },
];

// The core loop gets its own block at the top of the panel, mirroring the
// header so the two navigations never disagree.
const NAV_LOOP = [
  { to: "/browse", label: "Browse stock", icon: LayoutGrid },
  { to: "/orders", label: "Orders", icon: Receipt },
];

export function Brand({ collapsed }) {
  return <Logo compact={collapsed} />;
}

const linkCls = ({ isActive }) =>
  cn(
    "group flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors",
    isActive ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" : "text-ink-2 hover:text-ink-1 hover:bg-surface-2"
  );

/** The panel body — rendered by <Shell> inside the All-sections drawer. */
export function SidebarContent({ onNavigate }) {
  const navigate = useNavigate();
  const vendor = useAuthStore((s) => s.vendor);
  const logout = useAuthStore((s) => s.logout);
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);

  const handleLogout = () => {
    logout();
    toast.success("You have exited My Shop App.");
    navigate("/auth");
  };

  const renderNav = (items) =>
    items.map(({ to, label, icon: Icon, end }) => (
      <NavLink key={to + label} to={to} end={end} onClick={onNavigate} className={linkCls}>
        <Icon size={17} className="shrink-0" aria-hidden="true" />
        {label}
      </NavLink>
    ));

  const heading = "px-3 pt-5 pb-1.5 text-micro uppercase tracking-[0.12em] text-ink-4 font-bold";

  return (
    <div className="flex flex-col h-full bg-surface-0">
      {vendor && (
        <NavLink
          to={`/@${vendor.vendor_handle}`}
          onClick={onNavigate}
          className="flex items-center gap-3 px-5 py-4 border-b border-edge-1 hover:bg-surface-1 transition-colors"
        >
          <Avatar name={vendor.business_name} size="md" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink-1 truncate">{vendor.business_name}</p>
            <div className="mt-1">
              <LevelBadge vendor={vendor} />
            </div>
          </div>
        </NavLink>
      )}

      <nav className="flex-1 px-3 pb-3 space-y-0.5 overflow-y-auto" aria-label="Primary">
        <p className={cn(heading, "pt-3")}>The loop</p>
        {renderNav(NAV_LOOP)}
        <p className={heading}>Everything</p>
        {renderNav(NAV)}
        <p className={heading}>Brief · your workspace</p>
        {renderNav(NAV_BRIEF)}
      </nav>

      <div className="p-3 space-y-3 border-t border-edge-1">
        {vendor && (
          <div>
            <p className="px-1 pb-1.5 text-micro uppercase tracking-[0.12em] text-ink-4 font-bold">I am currently</p>
            <RoleSwitcher vendor={vendor} />
          </div>
        )}
        <button
          type="button"
          onClick={toggleTheme}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-ink-2 hover:text-ink-1 hover:bg-surface-2 transition-colors"
        >
          {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          {theme === "dark" ? "Light theme" : "Dark theme"}
        </button>
        <button
          type="button"
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-ink-3 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
        >
          <LogOut size={16} aria-hidden="true" />
          Exit App
        </button>
      </div>
    </div>
  );
}

/** Standalone panel (also what the shell spec mounts). */
export default function Sidebar() {
  const setMobileSidebar = useUIStore((s) => s.setMobileSidebar);
  return <SidebarContent onNavigate={() => setMobileSidebar(false)} />;
}
