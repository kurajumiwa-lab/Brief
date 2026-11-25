import { NavLink } from "react-router-dom";
import { BarChart3, ChevronRight, ListChecks, Terminal } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import { useAuthStore } from "@/stores/authStore";
import { useIdentityStore } from "@/stores/identityStore";
import { LogoMark } from "./Logo";
import { SECTION_GROUPS } from "@/config/navigation";
import { useUIStore } from "@/stores/uiStore";
import { rankFor } from "@/config/identity";
import { cn } from "@/lib/utils";
import { BRAND } from "@/config/brand";

// Kept as a small exported inventory for tests and other tooling.
export const NAV = SECTION_GROUPS.flatMap((group) => group.items);
// Retained as a non-rendered compatibility inventory; these now live in You.
export const NAV_BRIEF = [
  { to: "/tasks", label: "Tasks & Workspace", icon: ListChecks },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/pos", label: "POS Bridge", icon: Terminal },
];

const linkCls = ({ isActive }) =>
  cn(
    "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold transition-colors",
    isActive
      ? "bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-300"
      : "text-ink-2 hover:bg-surface-2 hover:text-ink-1",
  );

/**
 * MORE — seven rows, not thirty-five.
 *
 * The drawer used to be an alphabetical-ish dump of every route the app owned:
 * Groups, Events, Markets, Find suppliers, Our network, Surfaces, My shelf, Shop
 * front, Orders, Analytics, Business desk, Passport, Growth, Membership, Group
 * orders, Calendar, Home office, Today, Learn, Templates, Receipts, Rentals,
 * Tasks, Lists, Locks, POS, Ops, Enquiries, Market data, Intake…
 *
 * Most of those were the same page twice, and the rest were settings. What
 * remains is the places a person opens from a standing start. The identity card
 * at the top is the drawer's real job: reminding you which page you are on and
 * what it is called.
 */
export function SidebarContent({ onNavigate }) {
  const vendor = useAuthStore((s) => s.vendor);
  const identity = useIdentityStore();
  const rank = rankFor({ vendor, identity });

  return (
    <div className="flex h-full flex-col bg-surface-1">
      <div className="border-b border-edge-1 bg-surface-0 px-5 py-4">
        <div className="flex items-center gap-3">
          <LogoMark size={30} />
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold tracking-tight text-ink-1">{BRAND.name}</p>
            <p className="text-2xs text-ink-4">Everything else, in one place</p>
          </div>
        </div>
      </div>

      {vendor && (
        <div className="flex items-center gap-3 border-b border-edge-1 px-4 py-3">
          <Avatar name={vendor.business_name} src={vendor.avatar_url || vendor.logo_url} size="md" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-bold text-ink-1">{vendor.business_name}</span>
            <span className="block truncate font-mono text-micro text-ink-4">/p/{vendor.vendor_handle}</span>
          </span>
          <span className="shrink-0 rounded-full border border-edge-1 bg-surface-1 px-2 py-0.5 text-micro font-bold text-ink-3">
            {rank.label}
          </span>
        </div>
      )}

      <nav id="secondary-sections" className="flex-1 overflow-y-auto px-3 pb-4" aria-label="More">
        {SECTION_GROUPS.map((group) => (
          <section key={group.title}>
            <h2 className="px-3 pb-1 pt-4 text-micro font-bold uppercase tracking-[0.12em] text-ink-4">
              {group.title}
            </h2>
            <div className="space-y-0.5">
              {group.items.map(({ to, label, icon: Icon }) => (
                <NavLink key={label} to={to} onClick={onNavigate} className={linkCls}>
                  <Icon size={17} className="shrink-0" aria-hidden="true" />
                  <span className="flex-1">{label}</span>
                  <ChevronRight size={14} className="shrink-0 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                </NavLink>
              ))}
            </div>
          </section>
        ))}

      </nav>

      <div className="border-t border-edge-1 px-5 py-3">
        <p className="text-micro leading-relaxed text-ink-4">
          The five daily destinations — Home, Regions, Create, Inbox, You — stay
          on the bar. This drawer is for everything else.
        </p>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const setMobileSidebar = useUIStore((s) => s.setMobileSidebar);
  return <SidebarContent onNavigate={() => setMobileSidebar(false)} />;
}
