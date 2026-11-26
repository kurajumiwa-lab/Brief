import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Bell, Menu, MessageCircle, Search, X } from "lucide-react";
import Logo from "./Logo";
import AccountMenu from "./AccountMenu";
import MarketplaceSearch from "@/components/search/MarketplaceSearch";
import { isPrimaryActive, PRIMARY_TABS } from "@/config/navigation";
import useAttentionCounts from "@/hooks/useAttentionCounts";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { resultsHref } from "@/config/searchCategories";
import { cn } from "@/lib/utils";

/**
 * THE HEADER — logo, search, Chats, Notifications, profile. One row.
 *
 * The brief asks for a compact, communication-first bar. What changed:
 *
 *   · **A search is never missing, and never doubled.** The header keeps the
 *     field on every screen that does not own one. Home and Explore own theirs
 *     in the page, where the person is already looking — and on those two the
 *     header stands down, because two fields answering the same question on
 *     one screen is the "repeated search area" this app was asked to lose.
 *   · **Two shortcuts, two separate counts.** Chats and Notifications stay
 *     one tap away on every screen. A combined badge cannot tell a person
 *     which messages need a reply, so the Inbox's own two counts are used.
 *   · **The mark is compact.** On a phone it is the glyph alone; the wordmark
 *     returns at `sm`, leaving room for the actions that need attention.
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
  const attention = useAttentionCounts();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // Close the phone search row when the route changes, or it follows the
  // person to a screen they opened by searching.
  useEffect(() => {
    setMobileSearch(false);
  }, [pathname]);

  // The shopfront keeps one warm chrome across its header, so the catalogue
  // does not open under a cool grey bar that belongs to the trade screens.
  const isDiscovery = pathname === "/regions" || pathname.startsWith("/regions/")
    || pathname.startsWith("/explore") || pathname.startsWith("/discover");
  const isHome = pathname === "/" || pathname === "/home";

  // ONE SEARCH, NOT TWO — and never zero.
  //
  // Home and Explore each own a search of their own, and they own it in the
  // page, where the person is already looking. The header field routes the
  // same words to the same results screen, so keeping both on screen meant
  // two search boxes answering the same question — which is what "repeated
  // search areas" meant. On those two screens the page's field is the one.
  // Everywhere else the header keeps it, so a search is never missing.
  const showHeaderSearch = !isDiscovery && !isHome;

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
            // The panel is the workspace menu, and it says so now: "More" was
            // the old drawer's heading and it described a list of leftovers.
            aria-label="Workspace menu"
            aria-expanded={sectionsOpen}
            aria-controls="secondary-sections"
            className="-ml-2 grid h-11 w-11 shrink-0 place-items-center rounded-btn text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Menu size={19} aria-hidden="true" />
          </button>

          <Logo className="shrink-0" />

          {/* The field is the widest thing in the row on every screen, which is
              what "compact logo + search + bell + profile" asks for. */}
          {showHeaderSearch && (
            <MarketplaceSearch
              enableShortcut
              idPrefix="global-search-"
              className="ml-0.5 hidden min-w-0 flex-1 md:flex md:max-w-[22rem] lg:max-w-[26rem]"
              variant="compact"
              showCategories={false}
              placeholder="Search the marketplace"
              aria-label="Search everything"
              onSubmit={(term) => navigate(resultsHref({ q: term }))}
            />
          )}

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
              className={cn(
                "rounded-xl p-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-brand-500 md:hidden",
                showHeaderSearch ? "" : "hidden",
              )}
            >
              {mobileSearch ? <X size={19} aria-hidden="true" /> : <Search size={19} aria-hidden="true" />}
            </button>

            {/* Chats and Notifications are permanent, one-tap destinations.
                Two separate counts answer "who needs a reply?" without making
                the user open a combined dashboard to discover which is which. */}
            <Link
              to="/inbox?tab=chats"
              data-testid="header-chats"
              aria-label={attention.chats > 0
                ? `Chats, ${attention.chats} unread message${attention.chats === 1 ? "" : "s"}`
                : "Chats, no unread messages"}
              className="relative rounded-xl p-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <MessageCircle size={19} aria-hidden="true" />
              {attention.chats > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand-700 px-1 text-[0.625rem] font-bold leading-none tabular-nums text-white"
                >
                  {attention.chats > 9 ? "9+" : attention.chats}
                </span>
              )}
            </Link>
            <Link
              to="/inbox?tab=notifications"
              data-testid="header-notifications"
              aria-label={attention.notifications > 0
                ? `Notifications, ${attention.notifications} unread`
                : "Notifications, none unread"}
              className="relative rounded-xl p-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <Bell size={19} aria-hidden="true" />
              {attention.notifications > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent-600 px-1 text-[0.625rem] font-bold leading-none tabular-nums text-white"
                >
                  {attention.notifications > 9 ? "9+" : attention.notifications}
                </span>
              )}
            </Link>

            <AccountMenu />
          </div>
        </div>
      </div>

      {showHeaderSearch && mobileSearch && (
        <div id="mobile-search" className="animate-slide-down border-t border-edge-1 bg-surface-0 px-4 py-3 md:hidden">
          <MarketplaceSearch
            enableShortcut
            idPrefix="global-search-"
            variant="compact"
            showCategories={false}
            placeholder="Search the marketplace"
            aria-label="Search everything"
            onSubmit={(term) => {
              setMobileSearch(false);
              navigate(resultsHref({ q: term }));
            }}
          />
        </div>
      )}
    </header>
  );
}
