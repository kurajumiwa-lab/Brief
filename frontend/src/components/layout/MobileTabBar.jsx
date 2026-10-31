import { NavLink, useLocation } from "react-router-dom";
import { PRIMARY_NAV, isPrimaryActive } from "@/config/navigation";
import { useStockStore, needsMyAction } from "@/stores/stockStore";
import { useChatStore } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";
import { useOutsideStore } from "@/stores/outsideStore";
import { cn } from "@/lib/utils";

/**
 * The five Outside destinations, sized for the thumb zone.
 *
 *   Home · Explore · Create · Activity · Profile
 *
 * Create sits in the middle and is the one visually distinct item — a filled
 * pill rather than a floating button. It is prominent because publishing is
 * the thing that makes a discovery network work, and restrained because a
 * floating action button competes with the content it is supposed to serve.
 *
 * Badges are only shown where they mean work is waiting: Activity carries
 * unread notifications plus conversations that moved today. A count that
 * doesn't ask anything of you is noise, so nothing else is badged.
 */
export default function MobileTabBar() {
  const movements = useStockStore((s) => s.movements);
  const rooms = useChatStore((s) => s.rooms);
  const vendor = useAuthStore((s) => s.vendor);
  const activity = useOutsideStore((s) => s.activity);
  const { pathname } = useLocation();

  // Unread notifications, plus rooms that had a message today — the same two
  // numbers the Activity screen shows, so the badge never disagrees with it.
  const unreadNotifications = (activity?.groups || []).reduce(
    (total, group) => total + group.items.filter((i) => !i.is_read).length, 0);
  const counts = {
    activity: unreadNotifications + (activity?.counts?.rooms_active_today || 0),
    // Kept so a caller that still asks for the old keys gets a real number.
    orders: movements.filter(needsMyAction).length,
    chat: rooms.reduce((total, room) => total + (room.unread_count || 0), 0),
  };

  return (
    <nav
      aria-label="Primary mobile"
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface-0 border-t border-edge-1 shadow-md pb-safe"
    >
      <ul className="flex items-stretch">
        {PRIMARY_NAV.map((item) => {
          const Icon = item.icon;
          const active = isPrimaryActive(item, pathname, vendor?.vendor_handle);
          const count = item.badge ? counts[item.badge] : 0;

          if (item.action) {
            return (
              <li key={item.to} className="min-w-0 flex-1">
                <NavLink
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  data-testid="tab-create"
                  className="flex flex-col items-center justify-center gap-1 min-h-16 py-2"
                >
                  <span
                    className={cn(
                      "grid h-10 w-10 place-items-center rounded-full shadow-sm transition-colors",
                      active
                        ? "bg-brand-700 text-white"
                        : "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800",
                    )}
                  >
                    <Icon size={20} strokeWidth={2.4} aria-hidden="true" />
                  </span>
                  <span
                    className={cn(
                      "truncate max-w-full text-2xs font-semibold",
                      active ? "text-brand-800 dark:text-brand-300" : "text-ink-2",
                    )}
                  >
                    {item.label}
                  </span>
                </NavLink>
              </li>
            );
          }

          return (
            <li key={item.to} className="min-w-0 flex-1">
              <NavLink
                to={item.to}
                end={item.end}
                aria-current={active ? "page" : undefined}
                // Keyed by route, not by label: renaming a tab ("Explore" →
                // "Discover") must not rename a test hook.
                data-testid={`tab-${item.to === "/" ? "home" : item.to.replace(/\W+/g, "")}`}
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
