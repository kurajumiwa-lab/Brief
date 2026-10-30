import {
  Home, Compass, ClipboardList, Store, Map, Newspaper, Package,
  Truck, MapPin, Users, Wrench, CalendarDays, Terminal, UserRound, Building2,
  Plus, Bell, MessagesSquare, ShieldCheck, Layers3, BarChart3, FileCheck,
  Sparkles, Receipt, ShoppingBag, ShoppingCart, List, ListChecks, Inbox,
} from "lucide-react";

/**
 * OUTSIDE — five primary destinations (v4 IA).
 *
 * The previous map (Home · Browse · Work · Inbox · Business) was organised
 * around what a *trader* is doing. Outside is organised around what a *person*
 * is doing, because trading is now one thing among several:
 *
 *   Home      what is happening around you, in shelves
 *   Explore   search and browse across every content type, with distance
 *   Create    ONE publishing entry point for all six content types
 *   Activity  notifications, invitations, replies and what is waiting on you
 *   Profile   your identity, your published content, your settings
 *
 * Nothing was deleted to get here. Every v3 URL still resolves and still
 * highlights the right tab — the areas below absorb the old destinations:
 * Browse's discovery surfaces became Explore, and Work + Inbox became
 * Activity. See `docs/outside/01-route-map.md`.
 */
export const PRIMARY_NAV = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/explore", label: "Explore", icon: Compass, area: "explore" },
  // `action` marks the one visually prominent tab. It is deliberately
  // restrained — a filled pill, not a floating button competing with content.
  { to: "/create", label: "Create", icon: Plus, action: true },
  { to: "/activity", label: "Activity", icon: Bell, area: "activity", badge: "activity" },
  { to: "/me", label: "Profile", icon: UserRound, area: "me" },
];

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
];

const ME_ROOTS = [
  "/me", "/stock", "/analytics", "/pos", "/brief", "/passport", "/growth", "/billing",
  "/enterprise", "/governance", "/ops", "/portfolio", "/studio",
];

const inArea = (pathname, roots) => roots.some((root) => pathname === root || pathname.startsWith(`${root}/`));

export const isExplorePath = (pathname = "") => inArea(pathname, EXPLORE_ROOTS);

export const isActivityPath = (pathname = "") => inArea(pathname, ACTIVITY_ROOTS);

/** Kept under their v3 names so nothing importing them breaks. */
export const isBrowsePath = isExplorePath;
export const isWorkPath = isActivityPath;

export const isMePath = (pathname = "", vendorHandle = "") =>
  inArea(pathname, ME_ROOTS) || (vendorHandle && pathname === `/@${vendorHandle}`);

export const isPrimaryActive = (item, pathname, vendorHandle) => {
  if (item.area === "explore") return isExplorePath(pathname);
  if (item.area === "activity") return isActivityPath(pathname);
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
    title: "Community & network",
    items: [
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
      { to: "/payments", label: "Receipts", icon: Receipt },
      { to: "/tools", label: "Rentals & logistics", icon: Truck },
      { to: "/tasks", label: "Tasks", icon: ListChecks },
      { to: "/lists", label: "Vendor lists", icon: List },
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
