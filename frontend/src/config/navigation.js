import {
  Home, Compass, ClipboardList, Store, Map, Newspaper, Package,
  Truck, MapPin, Users, Wrench, CalendarDays, UserRound, Building2,
  Plus, MessagesSquare, ShieldCheck, Layers3, BarChart3, FileCheck,
  Sparkles, Receipt, ShoppingBag, ShoppingCart, List, ListChecks, Inbox,
  ScanLine, Mail, Search, ClipboardCheck, Settings, BookOpen, HeartHandshake,
  Ruler, KeyRound, SlidersHorizontal, FolderOpen,
} from "lucide-react";
import { BRIEF_LANDING_ENABLED, DESK_ENABLED, MAIL_ENABLED } from "@/config/flags";

/**
 * THE NEW MAP — five destinations, seven drawer links, one identity.
 *
 * The app used to answer "what can I do here?" with thirty-five links in a
 * drawer, five tabs, a browse rail, three shelves and a settings page per
 * feature. The count was not the real problem; the *duplication* was. Home,
 * Local network, Mall, Browse, Markets, Map and Search were seven doors into
 * the same four results, and My World, Business desk, Shop front, Passport and
 * Settings were five names for one page.
 *
 * This map collapses them into what a person is actually doing:
 *
 *   Home      what is happening for *me* today
 *   Regions   what is happening *here* (the old network + mall + markets + map)
 *   Create    publish one thing
 *   Inbox     what is waiting on me (notifications + messages + trades)
 *   You       my page, my rank, my identity (the old My World + desk + settings)
 *
 * Everything else is a row inside one of those five. The drawer keeps only the
 * things a person opens from a standing start, and the long tail lives in one
 * Settings page rather than in the navigation.
 *
 * Routes did not vanish. Old URLs still resolve — see App.jsx — because a link
 * in a WhatsApp thread must keep working. What changed is that only five are
 * *navigation*.
 */

export const PRIMARY_NAV = [
  // "/" is Today. BRIEF_LANDING_ENABLED used to swap this for the Morning Brief;
  // the Brief is now the first block of Today, so the flag no longer moves the tab.
  { to: "/", label: "Home", icon: Home, end: true, area: "home" },
  { to: "/regions", label: "Regions", icon: MapPin, area: "regions" },
  { to: "/create", label: "Create", icon: Plus, action: true, area: "create" },
  { to: "/inbox", label: "Inbox", icon: Inbox, area: "inbox", badge: "activity" },
  { to: "/you", label: "You", icon: UserRound, area: "you" },
];

/** Kept as an alias for older imports. There is only one tab shape now. */
export const PRIMARY_NAV_FIVE = PRIMARY_NAV;
export const PRIMARY_TABS = PRIMARY_NAV;

/** Create is a tab again. It stays exported because the header also uses it. */
export const CREATE_NAV = { to: "/create", label: "Create", icon: Plus };

/**
 * The drawer. Seven rows, in the order a person reaches for them:
 * the workspace they belong to, the work in progress, then the rest.
 *
 * Home office is first because it is a *place you belong to*, not a tool. It
 * used to be item 31 of 35 under "Workspace tools", which is the same as not
 * shipping it.
 */
export const SECTION_GROUPS = [
  {
    title: "Your office",
    items: [
      { to: "/office", label: "Home office", icon: Building2, hint: "The institution or team you belong to" },
      { to: "/orders", label: "Orders & trades", icon: ShoppingBag },
      { to: "/calendar", label: "Calendar", icon: CalendarDays },
    ],
  },
  {
    title: "Learn & meet",
    items: [
      { to: "/learn", label: "Learn", icon: BookOpen },
      { to: "/groups", label: "Groups", icon: Users },
      { to: "/events", label: "Events", icon: CalendarDays },
    ],
  },
  {
    title: "Everything else",
    items: [
      { to: "/more", label: "Settings & records", icon: Settings, hint: "Receipts, plans, analytics and the long tail" },
    ],
  },
];

/** Flat inventory, kept for tests and anything counting the drawer. */
export const SECONDARY_NAV = SECTION_GROUPS.flatMap((group) => group.items);

/* ── Area helpers ────────────────────────────────────────────────────────── */

const inArea = (pathname, roots) =>
  roots.some((root) => pathname === root || pathname.startsWith(`${root}/`));

/**
 * Regions absorbs the discovery surfaces. A listing, a supplier, an event and a
 * map pin are all "something in a region"; they were never four products.
 */
const REGION_ROOTS = [
  "/regions", "/explore", "/browse", "/network", "/nearby", "/map", "/news",
  "/search", "/listing", "/place", "/feed", "/events", "/groups", "/lists",
  "/markets", "/community", "/parks", "/mall",
];

/** Inbox absorbs everything waiting on a person or on someone else. */
const INBOX_ROOTS = [
  "/inbox", "/activity", "/activities", "/work", "/orders", "/chat", "/tasks", "/scout",
  "/locks", "/tools", "/payments", "/logistics", "/calendar", "/book", "/mail",
  "/requests",
];

/** You is the workspace: page, identity, rank, records and the long tail. */
const YOU_ROOTS = [
  "/you", "/me", "/stock", "/analytics", "/pos", "/brief", "/passport", "/growth",
  "/billing", "/enterprise", "/governance", "/ops", "/membership", "/office",
  "/referrals", "/referral-index", "/merchant", "/receipt-rewards",
  "/more", "/settings", "/legal", "/storefront", "/desk", "/today",
];

const HOME_ROOTS = ["/home"];

export const isHomePath = (pathname = "") => pathname === "/" || inArea(pathname, HOME_ROOTS);
export const isRegionPath = (pathname = "") => inArea(pathname, REGION_ROOTS);
export const isInboxPath = (pathname = "") => inArea(pathname, INBOX_ROOTS);
export const isYouPath = (pathname = "", vendorHandle = "") =>
  inArea(pathname, YOU_ROOTS) || (vendorHandle && pathname === `/@${vendorHandle}`);
export const isCreatePath = (pathname = "") => inArea(pathname, ["/create"]);

// Legacy aliases: pages and tests import these names.
export const isExplorePath = isRegionPath;
export const isBrowsePath = isRegionPath;
export const isActivityPath = isInboxPath;
export const isWorkPath = isInboxPath;
export const isMePath = isYouPath;
export const isMallPath = isRegionPath;
export const isMailPath = (pathname = "") => inArea(pathname, ["/mail", "/chat"]);

export const isPrimaryActive = (item, pathname, vendorHandle) => {
  if (item.area === "home") return isHomePath(pathname);
  if (item.area === "regions") return isRegionPath(pathname);
  if (item.area === "inbox") return isInboxPath(pathname) || (!MAIL_ENABLED && isMailPath(pathname));
  if (item.area === "you") return isYouPath(pathname, vendorHandle);
  if (item.area === "create") return isCreatePath(pathname);
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
};

/* ── Content types and discovery ─────────────────────────────────────────── */

/** What a person can publish. Four doors, not six tabs. */
export const PRIMARY_POSTING_TYPES = [
  { value: "available", label: "Available", icon: Package, hint: "An offer attached to a good, a service or a rental" },
  { value: "wanted", label: "Wanted", icon: Wrench, hint: "Ask for a fundi, a repair, a group buy or local help" },
  { value: "scheduled", label: "Scheduled", icon: CalendarDays, hint: "A round, a session or a collection window" },
  { value: "opportunity", label: "Opportunity", icon: ClipboardList, hint: "Work, an apprenticeship or a youth task" },
];

export const CREATE_TYPES = [
  { value: "post", label: "Post", icon: Newspaper, hint: "An update, a question or a recommendation" },
  { value: "event", label: "Event", icon: CalendarDays, hint: "A party, meetup, trip or workshop" },
  { value: "listing", label: "Goods", icon: Package, hint: "Something to sell, lend or give away" },
  { value: "community", label: "Community", icon: Users, hint: "A group around a place or an interest" },
  { value: "collection", label: "Collection", icon: Store, hint: "A curated shelf or a guide" },
  { value: "opportunity", label: "Opportunity", icon: ClipboardList, hint: "A request, an offer or help wanted" },
];

/**
 * The four business jobs, retained on the region screen as filters. Each one is
 * a view of ONE result set, so choosing a job never changes which screen you
 * are on — it narrows what is already there.
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

/** Legacy aliases. The region screen is where these now point. */
export const DISCOVERY_SHORTCUTS = [
  { to: "/regions?filter=goods", label: "Goods", icon: Package },
  { to: "/network?tab=suggested", label: "People", icon: Users },
  { to: "/regions?filter=services", label: "Services", icon: Wrench },
  { to: "/regions?filter=equipment", label: "Equipment", icon: Truck },
  { to: "/regions?filter=opportunities", label: "Opportunities", icon: ClipboardList },
];

export const BROWSE_NAV = [
  { to: "/regions?filter=goods", label: "Goods", icon: Package },
  { to: "/network?tab=suggested", label: "People", icon: Users },
  { to: "/regions?filter=services", label: "Services", icon: Wrench },
  { to: "/regions?filter=equipment", label: "Equipment", icon: Truck },
  { to: "/map", label: "Map", icon: Map },
];

export const EXPLORE_NAV = [
  { to: "/regions", label: "Everything", icon: Compass },
  { to: "/regions?filter=goods", label: "Goods", icon: Package },
  { to: "/regions?filter=services", label: "Services", icon: Wrench },
  { to: "/network?tab=suggested", label: "People", icon: Users },
  { to: "/map", label: "Map", icon: Map },
];

/** Search scopes route into the ONE results system. Markets are gone. */
export const SEARCH_SCOPES = [
  { value: "stock", label: "Goods", to: (q) => `/regions?filter=goods&search=${encodeURIComponent(q)}`, icon: Package },
  { value: "vendors", label: "Pages", to: (q) => `/regions?search=${encodeURIComponent(q)}`, icon: Store },
  { value: "services", label: "Services", to: (q) => `/regions?filter=services&search=${encodeURIComponent(q)}`, icon: Wrench },
  { value: "rentals", label: "Rentals", to: (q) => `/regions?filter=equipment&search=${encodeURIComponent(q)}`, icon: Truck },
];

/**
 * The Settings page, grouped so the long tail is still findable. This is the
 * only place the old destinations are listed, and it is reached deliberately.
 */
export const SETTINGS_GROUPS = [
  {
    title: "Your records",
    items: [
      { to: "/orders", label: "Orders & trades", icon: ShoppingBag },
      { to: "/orders/records", label: "Trade record", icon: ClipboardCheck },
      { to: "/payments", label: "Receipts", icon: Receipt },
      { to: "/calendar", label: "Calendar", icon: CalendarDays },
    ],
  },
  {
    title: "Your page",
    items: [
      { to: "/you/page", label: "Edit page", icon: FileCheck },
      { to: "/you/identity", label: "Identity & claims", icon: ShieldCheck },
      { to: "/you/rank", label: "Rank & exposure", icon: Sparkles },
      { to: "/stock", label: "Stock", icon: Package },
    ],
  },
  {
    title: "Tools",
    items: [
      { to: "/analytics", label: "Analytics", icon: BarChart3 },
      { to: "/tools", label: "Rentals & logistics", icon: Truck },
      { to: "/lists", label: "Lists", icon: List },
      { to: "/locks", label: "Market locks", icon: ShoppingCart },
      { to: "/tasks", label: "Tasks", icon: ListChecks },
      { to: "/referrals", label: "Referral network", icon: Users },
      { to: "/referral-index", label: "Referral index", icon: Users },
      { to: "/receipt-rewards", label: "Receipt rewards", icon: Receipt },
      { to: "/scout", label: "Scout work", icon: ListChecks },
      { to: "/merchant", label: "Merchant dashboard", icon: Store },
      { to: "/growth", label: "Growth planner", icon: Sparkles },
      { to: "/pos", label: "POS bridge", icon: ScanLine },
      { to: "/integrations", label: "Records & links", icon: FolderOpen },
    ],
  },
  {
    title: "Plans & governance",
    items: [
      { to: "/membership", label: "Membership", icon: HeartHandshake },
      { to: "/billing", label: "Plan & billing", icon: Receipt },
      { to: "/enterprise", label: "Enterprise workspace", icon: Building2 },
      { to: "/governance", label: "Our network", icon: ShieldCheck },
      { to: "/legal", label: "Trust & data", icon: ShieldCheck },
    ],
  },
  {
    title: "Operators",
    items: [
      { to: "/ops", label: "Ops console", icon: SlidersHorizontal, quiet: true },
      { to: "/ops/commerce", label: "Commerce moderation", icon: SlidersHorizontal, quiet: true },
      { to: "/storefront/inbox", label: "Enquiry inbox", icon: Inbox, quiet: true },
      { to: "/market-data", label: "Market data", icon: BarChart3, quiet: true },
      { to: "/intake", label: "Intake", icon: ScanLine, quiet: true },
      { to: "/trust/staff", label: "Trust desk", icon: ShieldCheck, quiet: true },
      { to: "/identity/ops", label: "Identity claims", icon: Ruler, quiet: true },
    ],
  },
];

/** Kept for pages that still render a "surfaces" door. */
export const LEGACY_TOOLS = [
  { to: "/desk", label: "Desk", icon: ClipboardCheck },
  { to: "/today", label: "Today", icon: ListChecks },
  { to: "/mail", label: "Mail", icon: Mail },
  { to: "/search", label: "Search", icon: Search },
  { to: "/feed", label: "Surfaces", icon: Layers3 },
  { to: "/community", label: "Community", icon: MessagesSquare },
  { to: "/news", label: "News", icon: Newspaper },
  { to: "/mall", label: "Mall", icon: Store },
  { to: "/markets", label: "Markets", icon: MapPin },
  { to: "/key", label: "Access", icon: KeyRound },
];

export const FLAGS_IN_NAV = { BRIEF_LANDING_ENABLED, DESK_ENABLED, MAIL_ENABLED };
