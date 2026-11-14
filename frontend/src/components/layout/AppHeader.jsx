import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Menu, Search, X } from "lucide-react";
import Logo from "./Logo";
import GlobalSearch from "./GlobalSearch";
import AccountMenu from "./AccountMenu";
import { isPrimaryActive, PRIMARY_TABS } from "@/config/navigation";
import { useAuthStore } from "@/stores/authStore";
import { useOutsideStore } from "@/stores/outsideStore";
import { useUIStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";

/**
 * One header: the menu, the name, the five destinations and the account.
 *
 * Two things are deliberately gone:
 *
 *   · the browse rail under the header. It repeated five of the drawer's links
 *     on every discovery screen, and it made the header two storeys tall on a
 *     phone. Regions is one tab and one page; it does not need a second
 *     navigation of its own.
 *   · the create button beside the search. Create is the middle tab on the bar
 *     and a filled item in the desktop row, so a third copy in the header was
 *     the same action three times.
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

  const unread =
    (activity?.groups || []).reduce(
      (total, group) => total + group.items.filter((item) => !item.is_read).length,
      0,
    ) + (activity?.counts?.rooms_active_today || 0);

  const isHome = pathname === "/";

  return (
    <header className="sticky top-0 z-40 border-b border-edge-1 bg-surface-0/95 shadow-xs backdrop-blur supports-[backdrop-filter]:bg-surface-0/85">
      <div className="container-app">
        <div className="flex items-center gap-2.5" style={{ height: "var(--header-h)" }}>
          <button
            type="button"
            onClick={() => setSections(true)}
            aria-label="More"
            aria-expanded={sectionsOpen}
            aria-controls="secondary-sections"
            className="-ml-2 rounded-xl p-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Menu size={19} aria-hidden="true" />
          </button>

          <Logo />

          {!isHome && <GlobalSearch className="ml-1 hidden max-w-[17rem] flex-1 md:flex xl:max-w-[20rem]" />}
          <div className="flex-1 md:hidden" />

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

          <div className="ml-auto flex items-center gap-1 lg:ml-2">
            {!isHome && (
              <button
                type="button"
                onClick={() => setMobileSearch((value) => !value)}
                aria-label={mobileSearch ? "Close search" : "Search"}
                aria-expanded={mobileSearch}
                className="rounded-xl p-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1 md:hidden"
              >
                {mobileSearch ? <X size={19} /> : <Search size={19} />}
              </button>
            )}
            <AccountMenu />
          </div>
        </div>
      </div>

      {mobileSearch && !isHome && (
        <div className="animate-slide-down border-t border-edge-1 bg-surface-0 px-4 py-3 md:hidden">
          <GlobalSearch autoFocus onSubmitted={() => setMobileSearch(false)} />
        </div>
      )}
    </header>
  );
}
