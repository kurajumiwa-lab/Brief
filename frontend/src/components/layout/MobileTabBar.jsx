import { NavLink, useLocation } from "react-router-dom";
import { PRIMARY_TABS, isPrimaryActive } from "@/config/navigation";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

/**
 * The five destinations, sized for the thumb zone.
 *
 * Home · Explore · Create · Inbox · Profile
 *
 * Create IS the central tab, and the brief asks for it to be the prominent one:
 * a filled circle between Inbox and the rest, not a sixth equal-weight icon.
 * The `action` branch below renders that treatment.
 *
 * The combined Inbox badge is deliberately gone. Chats and Notifications
 * carry their own counts in the permanent header shortcuts; repeating one
 * ambiguous number here made the same attention twice and said less.
 */
export default function MobileTabBar() {
  const vendor = useAuthStore((s) => s.vendor);
  const { pathname } = useLocation();
  const isDiscovery = pathname === "/regions" || pathname.startsWith("/regions/") || pathname.startsWith("/discover");

  return (
    <nav
      aria-label="Primary mobile"
      className={cn(
        "lg:hidden fixed bottom-0 inset-x-0 z-40 border-t shadow-md pb-safe",
        isDiscovery ? "border-mk-line bg-mk-card" : "border-edge-1 bg-surface-0",
      )}
    >
      <ul className="flex items-stretch">
        {PRIMARY_TABS.map((item) => {
          const Icon = item.icon;
          const active = isPrimaryActive(item, pathname, vendor?.vendor_handle);

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
                      "grid h-11 w-11 place-items-center rounded-full shadow-sm ring-4 ring-surface-1 transition-colors",
                      active
                        ? "bg-accent-700 text-white"
                        : "bg-accent-600 text-white hover:bg-accent-700 active:bg-accent-800",
                    )}
                  >
                    <Icon size={20} strokeWidth={2.4} aria-hidden="true" />
                  </span>
                  <span
                    className={cn(
                      "truncate max-w-full text-2xs font-semibold",
                      active ? "text-accent-700 dark:text-accent-300" : "text-ink-2",
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
                    active || isActive
                      ? isDiscovery ? "text-mk-orange" : "text-brand-800 dark:text-brand-300"
                      : "text-ink-4 hover:text-ink-2"
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
