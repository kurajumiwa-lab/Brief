import { NavLink } from "react-router-dom";
import { User } from "lucide-react";
import { PRIMARY_NAV } from "@/config/navigation";
import { useStockStore, needsMyAction } from "@/stores/stockStore";
import { useChatStore } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";
import Avatar from "@/components/ui/Avatar";
import { cn } from "@/lib/utils";

/**
 * Five thumb-sized doors instead of "three doors and an overflow drawer".
 *
 * v2's mobile bar was Home · News · Stock · More — two of the four openings
 * were not in the core loop and the loop's other half lived behind "More".
 * v3 puts the whole loop on the bar and moves the long tail into the
 * All-sections sheet reachable from the header.
 */
export default function MobileTabBar() {
  const movements = useStockStore((s) => s.movements);
  const rooms = useChatStore((s) => s.rooms);
  const vendor = useAuthStore((s) => s.vendor);

  const counts = {
    orders: movements.filter(needsMyAction).length,
    chat: rooms.reduce((n, r) => n + (r.unread_count || 0), 0),
  };
  const tabs = PRIMARY_NAV.filter((t) => t.mobile);

  return (
    <nav
      aria-label="Primary mobile"
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface-0/95 backdrop-blur-sm border-t border-edge-1 pb-safe"
    >
      <ul className="flex items-stretch">
        {tabs.map(({ to, label, icon: Icon, end, badge }) => {
          const count = badge ? counts[badge] : to === "/chat" ? counts.chat : 0;
          return (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "relative flex flex-col items-center justify-center gap-1 h-14 text-micro font-semibold transition-colors",
                    isActive ? "text-brand-700 dark:text-brand-400" : "text-ink-4 hover:text-ink-2"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="relative">
                      <Icon size={20} strokeWidth={isActive ? 2.4 : 1.9} aria-hidden="true" />
                      {count > 0 && (
                        <span className="absolute -top-1 -right-2 min-w-[1rem] h-4 px-1 rounded-full bg-brand-600 text-white text-[0.625rem] font-bold grid place-items-center tabular-nums ring-2 ring-surface-0">
                          {count > 9 ? "9+" : count}
                        </span>
                      )}
                    </span>
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
        <li className="flex-1">
          <NavLink
            to={vendor ? `/@${vendor.vendor_handle}` : "/auth"}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center justify-center gap-1 h-14 text-micro font-semibold transition-colors",
                isActive ? "text-brand-700 dark:text-brand-400" : "text-ink-4 hover:text-ink-2"
              )
            }
          >
            {vendor ? <Avatar name={vendor.business_name} size="xs" /> : <User size={20} aria-hidden="true" />}
            Me
          </NavLink>
        </li>
      </ul>
    </nav>
  );
}
