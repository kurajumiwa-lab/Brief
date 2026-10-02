import { NavLink } from "react-router-dom";
import { Home, Newspaper, Package, MoreHorizontal } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { useStockStore } from "@/stores/stockStore";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/news", label: "News", icon: Newspaper },
  { to: "/stock", label: "Stock", icon: Package },
];

export default function MobileNav() {
  const openMore = useUIStore((s) => s.setMobileSidebar);
  const movements = useStockStore((s) => s.movements);
  const pending = movements.filter((m) => m.actionable).length;
  const cls = (active) =>
    cn(
      "relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-2xs font-medium transition-colors",
      active ? "text-brand-300" : "text-ink-4"
    );

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 glass-strong flex items-stretch pb-[env(safe-area-inset-bottom)]" aria-label="Mobile">
      {TABS.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => cls(isActive)}>
          {({ isActive }) => (
            <>
              {label === "Stock" && pending > 0 && <span className="notif-dot notif-dot-amber" aria-hidden="true" />}
              <Icon size={18} />
              {label}
              {isActive && <span className="absolute top-0 w-8 h-0.5 rounded-full bg-brand-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />}
            </>
          )}
        </NavLink>
      ))}
      <button onClick={() => openMore(true)} className={cn(cls(false), "text-ink-4")} aria-label="More">
        <MoreHorizontal size={18} />
        More
      </button>
    </nav>
  );
}
