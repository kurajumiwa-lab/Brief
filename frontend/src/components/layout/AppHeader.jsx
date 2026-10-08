import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Menu, Search, X } from "lucide-react";
import Logo from "./Logo";
import GlobalSearch from "./GlobalSearch";
import AccountMenu from "./AccountMenu";
import NotificationBell from "@/components/notifications/NotificationBell";
import { DISCOVERY_NAV, PRIMARY_NAV } from "@/config/navigation";
import { useStockStore, needsMyAction } from "@/stores/stockStore";
import { useChatStore } from "@/stores/chatStore";
import { useUIStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";

/**
 * The marketplace header.
 *
 * v2 put a decorative clock in the most valuable row of the app and buried
 * discovery behind a 20-item sidebar. v3 spends that row on the two things a
 * trader does: SEARCH, and the four doors of the core loop.
 *
 * Mobile keeps logo · search · bell · avatar; the loop lives in the tab bar.
 */
export default function AppHeader() {
  const [mobileSearch, setMobileSearch] = useState(false);
  const openSections = useUIStore((s) => s.setMobileSidebar);
  const movements = useStockStore((s) => s.movements);
  const rooms = useChatStore((s) => s.rooms);
  const { pathname } = useLocation();

  const badges = {
    orders: movements.filter(needsMyAction).length,
    chat: rooms.reduce((n, r) => n + (r.unread_count || 0), 0),
  };

  return (
    <header className="sticky top-0 z-40 bg-surface-0/95 backdrop-blur-sm border-b border-edge-1">
      <div className="container-app">
        <div className="h-15 flex items-center gap-3" style={{ height: "var(--header-h)" }}>
          {/* All sections — the full IA, never more than one tap away */}
          <button
            type="button"
            onClick={() => openSections(true)}
            aria-label="All sections"
            className="p-2 -ml-2 rounded-xl text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors lg:hidden"
          >
            <Menu size={20} />
          </button>

          <Logo />

          {/* Search owns the middle of the header on desktop */}
          <GlobalSearch className="hidden md:flex flex-1 max-w-xl ml-2" />

          <div className="flex-1 md:hidden" />

          {/* The loop */}
          <nav aria-label="Main" className="hidden lg:flex items-center gap-0.5 ml-1">
            {PRIMARY_NAV.map(({ to, label, end, badge }) => (
              <NavLink
                key={to + label}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "relative px-3 py-2 rounded-lg text-xs font-semibold transition-colors",
                    isActive ? "text-ink-1" : "text-ink-3 hover:text-ink-1 hover:bg-surface-2"
                  )
                }
              >
                {({ isActive }) => (
                  <span className="relative inline-flex items-center gap-1.5">
                    {label}
                    {badge && badges[badge] > 0 && (
                      <span className="min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-brand-600 text-white text-micro font-bold grid place-items-center tabular-nums">
                        {badges[badge] > 9 ? "9+" : badges[badge]}
                      </span>
                    )}
                    {isActive && <span className="absolute -bottom-2 inset-x-0 h-0.5 rounded-full bg-brand-600 dark:bg-brand-400" aria-hidden="true" />}
                  </span>
                )}
              </NavLink>
            ))}
            <button
              type="button"
              onClick={() => openSections(true)}
              className="ml-1 px-3 py-2 rounded-lg text-xs font-semibold text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors inline-flex items-center gap-1.5"
            >
              <Menu size={15} aria-hidden="true" />
              All sections
            </button>
          </nav>

          <div className="flex items-center gap-1 ml-auto lg:ml-2">
            <button
              type="button"
              onClick={() => setMobileSearch((v) => !v)}
              aria-label={mobileSearch ? "Close search" : "Search"}
              aria-expanded={mobileSearch}
              className="md:hidden p-2 rounded-xl text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors"
            >
              {mobileSearch ? <X size={19} /> : <Search size={19} />}
            </button>
            <NotificationBell />
            <AccountMenu />
          </div>
        </div>
      </div>

      {/* Mobile search drops down rather than stealing a permanent row */}
      {mobileSearch && (
        <div className="md:hidden border-t border-edge-1 bg-surface-0 px-4 py-3 animate-slide-down">
          <GlobalSearch autoFocus onSubmitted={() => setMobileSearch(false)} />
        </div>
      )}

      {/* Category rail — the ten original home doors, kept as navigation */}
      {!pathname.startsWith("/chat") && <CategoryRail />}
    </header>
  );
}

function CategoryRail() {
  return (
    <div className="border-t border-edge-1 bg-surface-0">
      <div className="container-app">
        <nav aria-label="Categories" className="flex items-center gap-1 overflow-x-auto no-scrollbar py-1.5 -mx-1 px-1">
          {DISCOVERY_NAV.map(({ to, label }) => (
            <NavLink
              key={label}
              to={to}
              className={({ isActive }) =>
                cn(
                  "shrink-0 px-3 py-1.5 rounded-lg text-2xs font-semibold whitespace-nowrap transition-colors",
                  isActive ? "bg-surface-2 text-ink-1" : "text-ink-3 hover:text-ink-1 hover:bg-surface-2"
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
