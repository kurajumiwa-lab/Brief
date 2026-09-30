import { NavLink } from "react-router-dom";
import { Home, Package, MessageSquare, ShoppingBasket, MoreHorizontal } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/stock", label: "Stock", icon: Package },
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/locks", label: "Locks", icon: ShoppingBasket },
];

export default function MobileNav() {
  const openMore = useUIStore((s) => s.setMobileSidebar);
  const cls = (active) => cn("flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-2xs font-medium", active ? "text-brand-400" : "text-ink-4");
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 h-14 glass border-t flex items-stretch pb-[env(safe-area-inset-bottom)]" aria-label="Mobile">
      {TABS.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => cls(isActive)}>
          <Icon size={18} />
          {label}
        </NavLink>
      ))}
      <button onClick={() => openMore(true)} className={cls(false)} aria-label="More">
        <MoreHorizontal size={18} />
        More
      </button>
    </nav>
  );
}
