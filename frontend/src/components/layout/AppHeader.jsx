import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Menu, Search, X } from "lucide-react";
import Logo from "./Logo";
import GlobalSearch from "./GlobalSearch";
import AccountMenu from "./AccountMenu";
import NotificationBell from "@/components/notifications/NotificationBell";
import { BROWSE_NAV, isBrowsePath, isPrimaryActive, PRIMARY_NAV } from "@/config/navigation";
import { useStockStore, needsMyAction } from "@/stores/stockStore";
import { useChatStore } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";

/** One global frame: five clear destinations, one search, one account menu. */
export default function AppHeader() {
  const [mobileSearch, setMobileSearch] = useState(false);
  const setSections = useUIStore((s) => s.setMobileSidebar);
  const sectionsOpen = useUIStore((s) => s.mobileSidebarOpen);
  const movements = useStockStore((s) => s.movements);
  const rooms = useChatStore((s) => s.rooms);
  const vendor = useAuthStore((s) => s.vendor);
  const { pathname } = useLocation();

  const badges = {
    orders: movements.filter(needsMyAction).length,
    chat: rooms.reduce((n, r) => n + (r.unread_count || 0), 0),
  };
  const fullBleed = pathname.startsWith("/chat");
  const isHome = pathname === "/";

  return (
    <header className="sticky top-0 z-40 bg-surface-0/95 backdrop-blur-md border-b border-edge-1">
      <div className="container-app">
        <div className="flex items-center gap-2.5" style={{ height: "var(--header-h)" }}>
          <button
            type="button"
            onClick={() => setSections(true)}
            aria-label="More sections"
            aria-expanded={sectionsOpen}
            aria-controls="secondary-sections"
            className="p-2 -ml-2 rounded-xl text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Menu size={19} aria-hidden="true" />
            <span className="sr-only lg:not-sr-only lg:ml-1.5 lg:text-xs lg:font-semibold">More</span>
          </button>

          <Logo />

          {!isHome && <GlobalSearch className="hidden md:flex flex-1 max-w-[17rem] xl:max-w-[20rem] ml-1" />}
          <div className="flex-1 md:hidden" />

          <nav aria-label="Primary" className="hidden lg:flex items-center gap-0.5 ml-auto">
            {PRIMARY_NAV.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "relative inline-flex items-center gap-1.5 px-2.5 xl:px-3 py-2 rounded-xl text-xs font-semibold transition-colors",
                      isActive || isPrimaryActive(item, pathname, vendor?.vendor_handle)
                        ? "text-brand-800 dark:text-brand-300 bg-brand-50/80 dark:bg-brand-500/10"
                        : "text-ink-3 hover:text-ink-1 hover:bg-surface-2"
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon size={15} strokeWidth={isActive || isPrimaryActive(item, pathname, vendor?.vendor_handle) ? 2.3 : 1.9} aria-hidden="true" />
                      <span>{item.label}</span>
                      {item.badge && badges[item.badge] > 0 && (
                        <span className="min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-brand-700 text-white text-micro font-bold grid place-items-center tabular-nums">
                          {badges[item.badge] > 9 ? "9+" : badges[item.badge]}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>

          <div className="flex items-center gap-1 ml-auto lg:ml-2">
            {!isHome && (
              <button
                type="button"
                onClick={() => setMobileSearch((value) => !value)}
                aria-label={mobileSearch ? "Close search" : "Search"}
                aria-expanded={mobileSearch}
                className="md:hidden p-2 rounded-xl text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors"
              >
                {mobileSearch ? <X size={19} /> : <Search size={19} />}
              </button>
            )}
            <NotificationBell />
            <AccountMenu />
          </div>
        </div>
      </div>

      {mobileSearch && !isHome && (
        <div className="md:hidden border-t border-edge-1 bg-surface-0 px-4 py-3 animate-slide-down">
          <GlobalSearch autoFocus onSubmitted={() => setMobileSearch(false)} />
        </div>
      )}

      {isBrowsePath(pathname) && !fullBleed && <BrowseRail />}
    </header>
  );
}

function BrowseRail() {
  return (
    <div className="border-t border-edge-1 bg-surface-0/95">
      <div className="container-app">
        <nav aria-label="Browse sections" className="flex items-center gap-1 overflow-x-auto no-scrollbar py-1.5 -mx-1 px-1">
          {BROWSE_NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-2xs font-semibold whitespace-nowrap transition-colors",
                  isActive
                    ? "bg-ink-1 text-white dark:bg-brand-700"
                    : "text-ink-3 hover:text-ink-1 hover:bg-surface-2"
                )
              }
            >
              <Icon size={14} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
