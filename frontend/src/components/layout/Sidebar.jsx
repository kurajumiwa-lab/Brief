import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  Network,
  List,
  Users,
  MessageSquare,
  Calculator,
  CalendarDays,
  Terminal,
  Handshake,
  ShoppingBasket,
  ShieldCheck,
  LogOut,
} from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import RoleSwitcher from "@/components/vendor/RoleSwitcher";
import { toast } from "@/components/ui/Toast";
import { apiError } from "@/lib/api";
import { cn } from "@/lib/utils";

export const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/stock", label: "Stock Room", icon: Package },
  { to: "/network", label: "Network", icon: Network },
  { to: "/lists", label: "Vendor Lists", icon: List },
  { to: "/groups", label: "Groups", icon: Users },
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/pos", label: "POS Bridge", icon: Terminal },
  { to: "/locks", label: "Market Locks", icon: ShoppingBasket },
  { to: "/governance", label: "Our Network", icon: ShieldCheck },
  { to: "/events", label: "Events", icon: CalendarDays },
  { to: "/tools", label: "Tools", icon: Calculator },
];

export function Brand({ collapsed }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 flex items-center justify-center shadow-[0_0_20px_-2px_rgba(34,168,103,0.5)]">
        <span className="text-white font-bold text-xs">B</span>
      </div>
      {!collapsed && (
        <div>
          <p className="text-sm font-bold tracking-tight leading-none">Brief_</p>
          <p className="text-2xs text-ink-4 mt-0.5">Vendor Network</p>
        </div>
      )}
    </div>
  );
}

/** Exported for the vitest shell spec — rendered by <Shell> on desktop. */
export function SidebarContent({ onNavigate }) {
  const navigate = useNavigate();
  const vendor = useAuthStore((s) => s.vendor);
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = () => {
    logout();
    toast.success("You have exited the network.");
    navigate("/auth");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-5 pb-4">
        <Brand />
      </div>

      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto" aria-label="Primary">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-gradient-to-r from-brand-500/25 via-brand-500/12 to-transparent text-brand-100 shadow-[inset_0_0_24px_-8px_rgba(34,168,103,0.45)]"
                  : "text-ink-3 hover:text-ink-1 hover:bg-white/[0.05]"
              )
            }
          >
            <Icon size={17} className="shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 space-y-3">
        {vendor && <RoleSwitcher vendor={vendor} compact />}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-ink-4 hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <LogOut size={16} />
          Exit Network
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
