import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Bell, Menu, Search, X } from "lucide-react";
import Logo from "./Logo";
import GlobalSearch from "./GlobalSearch";
import AccountMenu from "./AccountMenu";
import { isPrimaryActive, PRIMARY_TABS } from "@/config/navigation";
import { useAuthStore } from "@/stores/authStore";
import { useOutsideStore } from "@/stores/outsideStore";
import { useUIStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";

/**
 * THE HEADER — logo, search, bell, profile. One row, every screen.
 *
 * The brief asks for a compact bar and this is it. What changed:
 *
 *   · **Search is always present.** It used to appear only off Home, on the
 *     theory that Home was the place you browsed. That was wrong: Home is where
 *     a person most often knows exactly what they want. A search box that hides
 *     on the busiest screen is a search box that is not there.
 *   · **A bell, not a menu item.** Anything waiting on a reply is an action, so
 *     it gets an icon with a count and a route to the Inbox, rather than being
 *     one line inside an account dropdown.
 *   · **The mark is compact.** On a phone it is the glyph alone; the wordmark
 *     returns at `sm`. The brief's row is logo · search · actions, and the
 *     wordmark was costing the search field a third of its width.
 *
 * The desktop tab row is unchanged. It duplicates the bottom bar on purpose:
 * one bar is for thumbs, the other for a mouse, and they are never both the
 * primary navigation at the same time.
 */
export default function AppHeader() {
  const [mobileSearch, setMobileSearch] = useState(false);
  const setSections = useUIStore((s) => s.setMobileSidebar);
  const sectionsOpen = useUIStore((s) => s.mobileSidebarOpen);
  const vendor = useAuthStore((s) => s.vendor);
  const activity = useOutsideStore((s) => s.activity);
  const loadActivity = useOutsideStore((s) => s.loadActivity);
  const { pathname } = useLocation();

  useEffect(() => {
    if (!activity) loadActivity();
  }, [activity, loadActivity]);

  // Close the phone search row when the route changes, or it follows the
  // person to a screen they opened by searching.
  useEffect(() => {
    setMobileSearch(false);
  }, [pathname]);

  const unread =
    (activity?.groups || []).reduce(
      (total, group) => total + group.items.filter((item) => !item.is_read).length,
      0,
    ) + (activity?.counts?.rooms_active_today || 0);

  // The shopfront keeps one warm chrome across its header, so the catalogue
  // does not open under a cool grey bar that belongs to the trade screens.
  const isDiscovery = pathname === "/regions" || pathname.startsWith("/regions/") || pathname.startsWith("/discover");

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b shadow-xs backdrop-blur",
        isDiscovery
          ? "border-mk-line bg-mk-cream/95 supports-[backdrop-filter]:bg-mk-cream/85"
          : "border-edge-1 bg-surface-0/95 supports-[backdrop-filter]:bg-surface-0/85",
      )}
    >
      <div className="container-app">
        <div className="flex items-center gap-2.5" style={{ height: "var(--header-h)" }}>
          <button
            type="button"
            onClick={() => setSections(true)}
            aria-label="More"
            aria-expanded={sectionsOpen}
            aria-controls="secondary-sections"
            className="-ml-2 shrink-0 rounded-xl p-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Menu size={19} aria-hidden="true" />
          </button>

          <Logo className="shrink-0" />

          {/* The field is the widest thing in the row on every screen, which is
              what "compact logo + search + bell + profile" asks for. */}
          <GlobalSearch className="ml-0.5 hidden min-w-0 flex-1 md:flex md:max-w-[22rem] lg:max-w-[26rem]" />

          <nav aria-label="Primary" className="ml-auto hidden items-center gap-0.5 lg:flex">
            {PRIMARY_TABS.map((item) => {
              const Icon = item.icon;
              const active = isPrimaryActive(item, pathname, vendor?.vendor_handle);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={cn(
                    "relative inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold transition-colors xl:px-3",
                    item.action
                      ? "bg-brand-700 text-white hover:bg-brand-800"
                      : active
                        ? "bg-brand-50/80 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300"
                        : "text-ink-3 hover:bg-surface-2 hover:text-ink-1",
                  )}
                >
                  <Icon size={15} strokeWidth={active && !item.action ? 2.3 : 1.9} aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.badge === "activity" && unread > 0 && (
                    <span className="grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-brand-700 px-1 text-micro font-bold tabular-nums text-white">
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-0.5 lg:ml-2">
            <button
              type="button"
              onClick={() => setMobileSearch((value) => !value)}
              aria-label={mobileSearch ? "Close search" : "Search"}
              aria-expanded={mobileSearch}
              aria-controls="mobile-search"
              className="rounded-xl p-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-brand-500 md:hidden"
            >
              {mobileSearch ? <X size={19} aria-hidden="true" /> : <Search size={19} aria-hidden="true" />}
            </button>

            {/* Anything waiting on a reply is an action, so it is an icon with a
                count and its own route — not a line inside a menu. */}
            <Link
              to="/inbox"
              aria-label={unread > 0 ? `Inbox, ${unread} waiting` : "Inbox"}
              className="relative rounded-xl p-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <Bell size={19} aria-hidden="true" />
              {unread > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent-600 px-1 text-[0.625rem] font-bold leading-none tabular-nums text-white"
                >
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>

            <AccountMenu />
          </div>
        </div>
      </div>

      {mobileSearch && (
        <div id="mobile-search" className="animate-slide-down border-t border-edge-1 bg-surface-0 px-4 py-3 md:hidden">
          <GlobalSearch autoFocus onSubmitted={() => setMobileSearch(false)} />
        </div>
      )}
    </header>
  );
}
