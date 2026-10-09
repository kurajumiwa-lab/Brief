import { NavLink, useLocation } from "react-router-dom";
import { PRIMARY_NAV, isPrimaryActive } from "@/config/navigation";
import { useStockStore, needsMyAction } from "@/stores/stockStore";
import { useChatStore } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

/** The same five distinct destinations as desktop, sized for the thumb zone. */
export default function MobileTabBar() {
  const movements = useStockStore((s) => s.movements);
  const rooms = useChatStore((s) => s.rooms);
  const vendor = useAuthStore((s) => s.vendor);
  const { pathname } = useLocation();

  const counts = {
    orders: movements.filter(needsMyAction).length,
    chat: rooms.reduce((total, room) => total + (room.unread_count || 0), 0),
  };

  return (
    <nav
      aria-label="Primary mobile"
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface-0/95 backdrop-blur-md border-t border-edge-1 pb-safe"
    >
      <ul className="flex items-stretch">
        {PRIMARY_NAV.map((item) => {
          const Icon = item.icon;
          const active = isPrimaryActive(item, pathname, vendor?.vendor_handle);
          const count = item.badge ? counts[item.badge] : 0;
          return (
            <li key={item.to} className="min-w-0 flex-1">
              <NavLink
                to={item.to}
                end={item.end}
                aria-current={active ? "page" : undefined}
                className={({ isActive }) =>
                  cn(
                    "relative flex flex-col items-center justify-center gap-1 min-h-16 py-2 text-2xs font-semibold transition-colors",
                    active || isActive ? "text-brand-800 dark:text-brand-300" : "text-ink-4 hover:text-ink-2"
                  )
                }
              >
                <span
                  className={cn(
                    "relative grid place-items-center w-8 h-7 rounded-full transition-colors",
                    active && "bg-brand-100 dark:bg-brand-500/15"
                  )}
                >
                  <Icon size={19} strokeWidth={active ? 2.4 : 1.9} aria-hidden="true" />
                  {count > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-brand-700 text-white text-micro font-bold grid place-items-center tabular-nums ring-2 ring-surface-0">
                      {count > 9 ? "9+" : count}
                    </span>
                  )}
                </span>
                <span className="truncate max-w-full">{item.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
