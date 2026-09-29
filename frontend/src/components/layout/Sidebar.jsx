import { NavLink, Link } from "react-router-dom";
import { LayoutDashboard, Package, Network, ListChecks, Users, MessageSquare, Wrench, CalendarDays, Plug, LogOut, PanelLeftClose, PanelLeftOpen, Crown } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import RoleSwitcher from "@/components/vendor/RoleSwitcher";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";

export const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/stock", label: "Stock Room", icon: Package },
  { to: "/network", label: "Network", icon: Network },
  { to: "/lists", label: "Vendor Lists", icon: ListChecks },
  { to: "/groups", label: "Groups", icon: Users },
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/tools", label: "Tools", icon: Wrench },
  { to: "/events", label: "Events", icon: CalendarDays },
  { to: "/pos", label: "POS Bridge", icon: Plug },
];

export function Brand({ collapsed }) {
  return (
    <Link to="/" className="flex items-center gap-2 px-1 h-8">
      <span className="font-mono text-lg font-bold text-brand-400 leading-none">B_</span>
      {!collapsed && (
        <span className="flex flex-col leading-none">
          <span className="text-sm font-semibold text-ink-1 tracking-tight">Brief_</span>
          <span className="text-2xs text-ink-4">vendor network</span>
        </span>
      )}
    </Link>
  );
}

/** Sidebar body — shared by the desktop rail and the mobile drawer. */
export function SidebarContent({ collapsed = false, onNavigate }) {
  const vendor = useAuthStore((s) => s.vendor);
  const logout = useAuthStore((s) => s.logout);

  return (
    <div className="flex flex-col h-full">
      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto" aria-label="Primary">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-2.5 h-9 text-sm font-medium transition-colors",
                collapsed && "justify-center px-0",
                isActive ? "bg-brand-950 text-brand-200" : "text-ink-3 hover:text-ink-1 hover:bg-surface-3"
              )
            }
          >
            <Icon size={16} className="shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className={cn("px-2 pt-3 border-t border-edge-1 space-y-3", collapsed && "px-1.5")}>
        {!collapsed && <p className="px-1 text-2xs uppercase tracking-wider text-ink-4">Current role</p>}
        <RoleSwitcher compact={collapsed} />

        {vendor && (
          <Link
            to={`/@${vendor.vendor_handle}`}
            onClick={onNavigate}
            className={cn("flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-surface-3 transition-colors", collapsed && "justify-center px-0")}
            title="Your profile"
          >
            <Avatar name={vendor.business_name} size="sm" />
            {!collapsed && (
              <span className="min-w-0 leading-tight">
                <span className="block text-xs font-medium text-ink-1 truncate">{vendor.business_name}</span>
                <span className="flex items-center gap-1 text-2xs text-ink-4 font-mono truncate">
                  @{vendor.vendor_handle}
                  {vendor.is_patron && <Crown size={10} className="text-amber-400" />}
                </span>
              </span>
            )}
          </Link>
        )}

        <button
          onClick={logout}
          title="Exit Network"
          className={cn(
            "w-full flex items-center gap-3 rounded-lg px-2.5 h-9 mb-2 text-xs font-medium text-ink-4 hover:text-red-300 hover:bg-red-500/10 transition-colors",
            collapsed && "justify-center px-0"
          )}
        >
          <LogOut size={15} />
          {!collapsed && "Exit Network"}
        </button>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleSidebar);
  return (
    <aside className={cn("hidden lg:flex flex-col shrink-0 border-r border-edge-1 bg-surface-1 transition-[width] duration-200", collapsed ? "w-16" : "w-60")}>
      <div className={cn("flex items-center h-14 px-3 border-b border-edge-1", collapsed ? "justify-center" : "justify-between")}>
        {!collapsed && <Brand />}
        <button onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="p-1.5 rounded-lg text-ink-4 hover:text-ink-1 hover:bg-surface-3">
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
      <div className="flex-1 py-3 overflow-hidden">
        <SidebarContent collapsed={collapsed} />
      </div>
    </aside>
  );
}
