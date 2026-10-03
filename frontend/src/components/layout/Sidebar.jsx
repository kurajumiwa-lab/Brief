import { NavLink, useNavigate } from "react-router-dom";
import {
  Home, Newspaper, Package, Network, List, Users, MessageSquare, Terminal,
  CalendarDays, Briefcase, Truck, ShoppingBasket, ShieldCheck, BarChart3, LogOut, Store, MapPin, Trophy,
} from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import RoleSwitcher from "@/components/vendor/RoleSwitcher";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

// The shelf — the sections a shop checks every day, one question each.
export const NAV = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/news", label: "News", icon: Newspaper },
  { to: "/network", label: "Suppliers", icon: Network },
  { to: "/stock", label: "Stock", icon: Package },
  { to: "/tools", label: "Rentals", icon: Truck },
  { to: "/markets", label: "Markets", icon: MapPin },
  { to: "/groups", label: "Groups", icon: Users },
  { to: "/events", label: "Events", icon: CalendarDays },
  { to: "/squad", label: "Squad", icon: Trophy },
];

// Brief — the vendor's own workspace, kept as a feature inside My Shop App.
export const NAV_BRIEF = [
  { to: "/brief", label: "Brief", icon: Briefcase },
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/lists", label: "Vendor Lists", icon: List },
  { to: "/locks", label: "Market Locks", icon: ShoppingBasket },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/pos", label: "POS Bridge", icon: Terminal },
  { to: "/governance", label: "Our Network", icon: ShieldCheck },
];

export function Brand({ collapsed }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-xl bg-[#0A0E14] ring-1 ring-brand-500/40 flex items-center justify-center shadow-[0_0_20px_-2px_rgba(245,158,11,0.45)]">
        <Store size={15} className="text-brand-400" />
      </div>
      {!collapsed && (
        <div>
          <p className="text-sm font-bold tracking-tight leading-none text-ink-1">My Shop App</p>
          <p className="text-2xs text-ink-4 mt-0.5 tracking-[0.14em] uppercase">Trade info</p>
        </div>
      )}
    </div>
  );
}

const linkCls = ({ isActive }) =>
  cn(
    "group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
    isActive
      ? "bg-brand-500/15 text-brand-200 shadow-[inset_0_0_24px_-10px_rgba(245,158,11,0.55)]"
      : "text-ink-3 hover:text-ink-1 hover:bg-white/[0.05]"
  );

/** Exported for the vitest shell spec — rendered by <Shell> on desktop. */
export function SidebarContent({ onNavigate }) {
  const navigate = useNavigate();
  const vendor = useAuthStore((s) => s.vendor);
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = () => {
    logout();
    toast.success("You have exited My Shop App.");
    navigate("/auth");
  };

  const renderNav = (items) =>
    items.map(({ to, label, icon: Icon, end }) => (
      <NavLink key={to} to={to} end={end} onClick={onNavigate} className={linkCls}>
        <Icon size={17} className="shrink-0" />
        {label}
      </NavLink>
    ));

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-5 pb-4">
        <Brand />
      </div>

      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto" aria-label="Primary">
        {renderNav(NAV)}
        <p className="px-3 pt-4 pb-1.5 text-2xs uppercase tracking-[0.16em] text-ink-4 font-semibold">Brief · your workspace</p>
        {renderNav(NAV_BRIEF)}
      </nav>

      <div className="p-3 space-y-3">
        {vendor && <RoleSwitcher vendor={vendor} compact />}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-ink-4 hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <LogOut size={16} />
          Exit App
        </button>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const setMobileSidebar = useUIStore((s) => s.setMobileSidebar);
  const mobileOpen = useUIStore((s) => s.mobileSidebarOpen);

  return (
    <>
      {/* Desktop: glass rail, no drawn line */}
      <aside className="hidden lg:flex flex-col w-60 shrink-0 h-screen sticky top-0 glass-strong">
        <SidebarContent />
      </aside>

      {/* Mobile: slide-in drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileSidebar(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 glass-strong animate-slide-right">
            <SidebarContent onNavigate={() => setMobileSidebar(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
