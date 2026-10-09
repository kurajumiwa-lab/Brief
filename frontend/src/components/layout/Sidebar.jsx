import { NavLink } from "react-router-dom";
import { BarChart3, ListChecks, Terminal } from "lucide-react";
import { LogoMark } from "./Logo";
import { SECTION_GROUPS } from "@/config/navigation";
import { useUIStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";

// Kept as a small exported inventory for tests and other tooling.
export const NAV = SECTION_GROUPS.flatMap((group) => group.items);
// Retained as a non-rendered compatibility inventory; these now live in Me.
export const NAV_BRIEF = [
  { to: "/tasks", label: "Tasks & Brief", icon: ListChecks },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/pos", label: "POS Bridge", icon: Terminal },
];

const linkCls = ({ isActive }) =>
  cn(
    "group flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors",
    isActive
      ? "bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-300"
      : "text-ink-2 hover:text-ink-1 hover:bg-surface-2"
  );

/** Secondary routes only: no Home, primary tabs, or operating-mode controls. */
export function SidebarContent({ onNavigate }) {
  return (
    <div className="flex flex-col h-full bg-surface-0">
      <div className="px-5 py-5 border-b border-edge-1 bg-surface-1">
        <div className="flex items-center gap-3">
          <LogoMark size={32} />
          <div>
            <p className="text-sm font-bold text-ink-1">More from Ogallo</p>
            <p className="text-2xs text-ink-4">Community and supporting tools</p>
          </div>
        </div>
      </div>

      <nav id="secondary-sections" className="flex-1 px-3 pb-5 overflow-y-auto" aria-label="More sections">
        {SECTION_GROUPS.map((group) => (
          <section key={group.title} aria-labelledby={`more-${group.title.toLowerCase().replaceAll(" ", "-")}`}>
            <h2
              id={`more-${group.title.toLowerCase().replaceAll(" ", "-")}`}
              className="px-3 pt-5 pb-1.5 text-micro uppercase tracking-[0.12em] text-ink-4 font-bold"
            >
              {group.title}
            </h2>
            <div className="space-y-0.5">
              {group.items.map(({ to, label, icon: Icon, quiet }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={onNavigate}
                  className={(state) => cn(linkCls(state), quiet && "text-ink-4")}
                >
                  <Icon size={17} className="shrink-0" aria-hidden="true" />
                  <span className="flex-1">{label}</span>
                  {quiet && <span className="text-micro font-medium">admin</span>}
                </NavLink>
              ))}
            </div>
          </section>
        ))}
      </nav>

      <div className="px-5 py-3 border-t border-edge-1">
        <p className="text-2xs text-ink-4">Your main destinations stay in the five-tab navigation.</p>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const setMobileSidebar = useUIStore((s) => s.setMobileSidebar);
  return <SidebarContent onNavigate={() => setMobileSidebar(false)} />;
}
