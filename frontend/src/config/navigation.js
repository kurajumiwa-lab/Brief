import {
  Home, Compass, ClipboardList, Store, Map, Newspaper, Package,
  Truck, MapPin, Users, Wrench, CalendarDays, Terminal, UserRound, Building2,
  Plus, Bell, MessagesSquare, ShieldCheck, Layers3, BarChart3, FileCheck,
  Sparkles, Receipt, ShoppingBag, ShoppingCart, List, ListChecks, Inbox, ScanLine,
  Mail, Search, ClipboardCheck,
} from "lucide-react";
import { DESK_ENABLED, FIVE_TAB_NAV_ENABLED } from "@/config/flags";

/**
 * THE FIVE DESTINATIONS — three activities, one anchor and one door (v2.18).
 *
 * The previous map was organised around what a *trader* is doing. Direction C
 * organises it around what a *participant* is doing, because a school, a
 * household and an artisan do the same three things here:
 *
 *   Discover   find vendors, suppliers, services and products
 *   Connect    contact, request a quotation, establish a relationship
 *   My World   manage your identity, vendor front, clients and purchases
 *
 * Home stays as the anchor — it is where the three are explained in one
 * screenful — and Create stays as the one publishing door, which is how a
 * household becomes a supplier on the same day it buys something.
 *
 * The *routes* did not change. Discover is `/explore`, Connect is `/activity`
 * and My World is `/me`; renaming a tab is not worth breaking a link someone
 * saved, and the areas below still absorb every older URL:
 * Browse's discovery surfaces are Discover, and Work + Inbox are Connect.
 * See `docs/outside/01-route-map.md`.
 */
export const PRIMARY_NAV = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/explore", label: "Local network", icon: Compass, area: "explore" },
  { to: "/mall", label: "Mall", icon: Store, area: "mall" },
  { to: "/activity", label: "Connect", icon: Bell, area: "activity", badge: "activity" },
  { to: "/me", label: "My World", icon: UserRound, area: "me" },
];

/**
 * FIVE TABS, FLAGGED (Phase 2). Desk, Nearby, Mail, Search, Me.
 *
 * Every tab points at an existing screen; no route is added or renamed:
 *   Desk    /desk when DESK_ENABLED, otherwise Home (/), so the tab is never dead
 *   Nearby  /explore (the local-network screen)
 *   Mail    /activity (Connect, renamed in the UI only)
 *   Search  /search
 *   Me      /me
 * Mall is not a tab in this shape. It stays reachable from the drawer.
 */
export const PRIMARY_NAV_FIVE = [
  { to: DESK_ENABLED ? "/desk" : "/", label: "Desk", icon: ClipboardCheck, end: DESK_ENABLED ? false : true, area: "desk" },
  { to: "/explore", label: "Nearby", icon: Compass, area: "nearby" },
  { to: "/activity", label: "Mail", icon: Mail, area: "activity", badge: "activity" },
  { to: "/search", label: "Search", icon: Search, area: "search" },
  { to: "/me", label: "Me", icon: UserRound, area: "me" },
];

/** The tabs the app shows right now. Off the flag, this is exactly PRIMARY_NAV. */
export const PRIMARY_TABS = FIVE_TAB_NAV_ENABLED ? PRIMARY_NAV_FIVE : PRIMARY_NAV;

/**
 * Create is not a tab. Publishing is still one tap away: a header action on
 * every screen and the first item of the drawer. It stays a separate export so
 * the five tabs describe destinations, and the one publishing door is named
 * once, here.
 */
export const CREATE_NAV = { to: "/create", label: "Create", icon: Plus };

/** Explore: every discovery surface, old and new. */
export const EXPLORE_NAV = [
  { to: "/explore", label: "Everything", icon: Compass },
  { to: "/explore?kind=event", label: "Events", icon: CalendarDays },
  { to: "/community", label: "Community", icon: MessagesSquare },
  { to: "/explore?kind=community", label: "Communities", icon: Users },
  { to: "/explore?kind=opportunity", label: "Opportunities", icon: ClipboardList },
  { to: "/explore?kind=listing", label: "Goods", icon: Package },
  { to: "/explore?kind=service", label: "Services", icon: Truck },
  { to: "/map", label: "Map", icon: Map },
  { to: "/markets", label: "Markets", icon: MapPin },
  { to: "/news", label: "News", icon: Newspaper },
];

/** Four primary local activity posting types (Local Activity Ledger). */
export const PRIMARY_POSTING_TYPES = [
  { value: "available", label: "Available", icon: Package, hint: "Skills, produce, tools to lend, or home shelf items" },
  { value: "wanted", label: "Wanted", icon: Wrench, hint: "Ask for a fundi, repair, group buy, or local help" },
  { value: "scheduled", label: "Scheduled", icon: CalendarDays, hint: "Travelling artisan rounds, learning, or collection windows" },
  { value: "opportunity", label: "Opportunity", icon: ClipboardList, hint: "Work, apprenticeships, or supervised youth tasks" },
];

/** Content types the single Create page can publish. Order = display order. */
export const CREATE_TYPES = [
  { value: "post", label: "Post", icon: Newspaper, hint: "An update, a question or a recommendation" },
  { value: "event", label: "Event", icon: CalendarDays, hint: "A party, meetup, trip or workshop" },
  { value: "listing", label: "Listing", icon: Package, hint: "Something to sell, lend or give away" },
  { value: "community", label: "Community", icon: Users, hint: "A group around a place or an interest" },
  { value: "collection", label: "Collection", icon: Store, hint: "A curated shelf or a guide" },
  { value: "opportunity", label: "Opportunity", icon: ClipboardList, hint: "A request, an offer or help wanted" },
];

/**
 * The four business jobs, as views of ONE results system. Every tile routes
 * into `/browse?type=…` — the same search, the same result contract — with
 * map and markets kept as context views, not competing doors.
 */
export const JOB_TILES = [
  {
    type: "goods", label: "Find stock", icon: Package,
    blurb: "Products and wholesale deals",
    tint: "bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300",
  },
  {
    type: "people", label: "Find people", icon: Users,
    blurb: "Fundis, casuals and specialists",
    tint: "bg-accent-50 text-accent-700 dark:bg-accent-500/10 dark:text-accent-300",
  },
  {
    type: "services", label: "Move goods", icon: Truck,
    blurb: "Riders, pickups and delivery",
    tint: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
  },
  {
    type: "equipment", label: "Get equipment", icon: Wrench,
    blurb: "Tools, machinery and rentals",
    tint: "bg-orchid-50 text-orchid-700 dark:bg-orchid-500/10 dark:text-orchid-300",
  },
];

/**
 * Compact discovery shortcuts for Home (v3.1).
 *
 * Six doors into six REAL destinations — the same URLs Browse's tiles and the
 * Work area already use. This row is a set of links, not a taxonomy: it adds no
 * category, and every item resolves to a screen that already exists, so the
 * Browse taxonomy stays the only taxonomy.
 */
export const DISCOVERY_SHORTCUTS = [
  { to: "/browse?type=goods", label: "Goods", icon: Package },
  { to: "/browse?type=people", label: "People", icon: Users },
  { to: "/browse?type=services", label: "Services", icon: Truck },
  { to: "/browse?type=equipment", label: "Equipment", icon: Wrench },
  { to: "/tools", label: "Rentals & logistics", icon: Building2 },
  { to: "/tasks", label: "Jobs & opportunities", icon: ClipboardList },
];

/** Browse-area destinations. Job views first; context views after. */
export const BROWSE_NAV = [
  { to: "/browse?type=goods", label: "Goods", icon: Package },
  { to: "/browse?type=people", label: "People", icon: Users },
  { to: "/browse?type=services", label: "Services", icon: Truck },
  { to: "/browse?type=equipment", label: "Equipment", icon: Wrench },
  { to: "/map", label: "Map", icon: Map },
  { to: "/markets", label: "Markets", icon: MapPin },
  { to: "/news", label: "News", icon: Newspaper },
];

const EXPLORE_ROOTS = [
  "/explore", "/browse", "/network", "/nearby", "/map", "/markets", "/news",
  "/search", "/listing", "/place", "/feed", "/post", "/events", "/groups", "/lists",
];

/** Activity owns everything waiting on you or waiting on someone else:
    notifications, chat, orders, tasks, rentals and bookings. Deep links stay;
    the aggregation lives at /activity. */
const ACTIVITY_ROOTS = [
  "/activity", "/activities", "/work", "/orders", "/chat", "/tasks", "/locks", "/tools", "/payments",
  "/logistics", "/calendar", "/book",
];

// `/portfolio` and `/studio` were retired in v2.16: the showcase now lives on
// the shop front and the price list on the Business Desk, so both URLs redirect
// to /me rather than holding a destination of their own.
/** The Mall is a curated directory of verified, staff-approved businesses. */
const MALL_ROOTS = ["/mall"];

const ME_ROOTS = [
  "/me", "/stock", "/analytics", "/pos", "/brief", "/passport", "/growth", "/billing",
  "/enterprise", "/governance", "/ops", "/membership",
];

const inArea = (pathname, roots) => roots.some((root) => pathname === root || pathname.startsWith(`${root}/`));

export const isExplorePath = (pathname = "") => inArea(pathname, EXPLORE_ROOTS);

export const isActivityPath = (pathname = "") => inArea(pathname, ACTIVITY_ROOTS);

export const isMallPath = (pathname = "") => inArea(pathname, MALL_ROOTS);

/** Kept under their v3 names so nothing importing them breaks. */
export const isBrowsePath = isExplorePath;
export const isWorkPath = isActivityPath;

export const isMePath = (pathname = "", vendorHandle = "") =>
  inArea(pathname, ME_ROOTS) || (vendorHandle && pathname === `/@${vendorHandle}`);

const SEARCH_ROOTS = ["/search"];
const isSearchPath = (pathname = "") => inArea(pathname, SEARCH_ROOTS);

export const isPrimaryActive = (item, pathname, vendorHandle) => {
  // Nearby and Search share the explore roots. Search wins for /search so the two tabs never both light up.
  if (item.area === "nearby") return isExplorePath(pathname) && !isSearchPath(pathname);
  if (item.area === "search") return isSearchPath(pathname);
  if (item.area === "explore") return isExplorePath(pathname);
  if (item.area === "activity") return isActivityPath(pathname);
  if (item.area === "mall") return isMallPath(pathname);
  if (item.area === "me") return isMePath(pathname, vendorHandle);
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
};

/**
 * The drawer, grouped by what a person is trying to do.
 *
 * The five primary destinations are NOT repeated here: on a phone they are
 * already the tab bar under the drawer, and on desktop they are already in the
 * header. A second copy of the same five links would be navigation duplicated,
 * not navigation added.
 *
 * What lives here is everything else, in three groups — who you trade with,
 * the tools of the trade, and administration. It is a list of destinations,
 * not a dashboard: no counters, no cards, no calls to action.
 */
export const SECTION_GROUPS = [
  {
    title: "Start",
    items: [
      { to: "/create", label: "Create something new", icon: Plus },
    ],
  },
  {
    title: "Community & network",
    items: [
      ...(FIVE_TAB_NAV_ENABLED ? [{ to: "/mall", label: "Mall", icon: Store }] : []),
      { to: "/groups", label: "Groups & collectives", icon: Users },
      { to: "/events", label: "Events", icon: CalendarDays },
      { to: "/markets", label: "Markets", icon: MapPin },
      { to: "/network", label: "Find suppliers", icon: Store },
      { to: "/governance", label: "Our network", icon: ShieldCheck },
      { to: "/feed", label: "Surfaces", icon: Layers3 },
    ],
  },
  {
    title: "Workspace tools",
    items: [
      { to: "/stock", label: "My shelf", icon: Package },
      // Filled in at render time: a shop front is a person's own handle.
      { to: "/@", label: "Shop front", icon: Building2, dynamic: "shop" },
      { to: "/orders", label: "Orders & trades", icon: ShoppingBag },
      { to: "/analytics", label: "Analytics", icon: BarChart3 },
      { to: "/storefront", label: "Business desk", icon: ShoppingBag },
      { to: "/passport", label: "Business passport", icon: FileCheck },
      { to: "/growth", label: "Growth planner", icon: Sparkles },
      { to: "/membership", label: "Membership", icon: UserRound },
      { to: "/logistics", label: "Group orders", icon: Truck },
      { to: "/calendar", label: "Calendar", icon: CalendarDays },
      { to: "/office", label: "Home office", icon: Building2 },
      { to: "/today", label: "Today", icon: ListChecks },
      { to: "/learn", label: "Learn", icon: UserRound },
      { to: "/templates", label: "Free templates", icon: FileCheck },
      { to: "/payments", label: "Receipts", icon: Receipt },
      { to: "/tools", label: "Rentals & logistics", icon: Truck },
      { to: "/tasks", label: "Tasks", icon: ListChecks },
      { to: "/lists", label: "Business lists", icon: List },
      { to: "/locks", label: "Market Locks", icon: ShoppingCart },
      { to: "/pos", label: "POS Bridge", icon: Terminal },
    ],
  },
  {
    // /me is a primary tab, so it is deliberately NOT repeated here. Profile
    // settings are reached from the identity panel on /me itself.
    title: "Administration",
    items: [
      { to: "/ops", label: "Ops console", icon: Terminal, quiet: true },
      { to: "/storefront/inbox", label: "Enquiry inbox", icon: Inbox, quiet: true },
      { to: "/market-data", label: "Market data", icon: BarChart3 },
      { to: "/intake", label: "Market intake", icon: ScanLine, quiet: true },
    ],
  },
];

/** Search scopes route into the ONE results system. */
export const SEARCH_SCOPES = [
  { value: "stock", label: "Goods", to: (q) => `/browse?type=goods&search=${encodeURIComponent(q)}`, icon: Package },
  { value: "vendors", label: "Suppliers", to: (q) => `/network?search=${encodeURIComponent(q)}`, icon: Store },
  { value: "people", label: "People", to: (q) => `/browse?type=people&search=${encodeURIComponent(q)}`, icon: UserRound },
  { value: "markets", label: "Markets", to: (q) => `/markets?tab=all&search=${encodeURIComponent(q)}`, icon: MapPin },
  { value: "rentals", label: "Rentals", to: (q) => `/browse?type=equipment&search=${encodeURIComponent(q)}`, icon: Truck },
];
