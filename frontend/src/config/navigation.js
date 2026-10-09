import {
  Home, Compass, ClipboardList, MessageSquare, Store, Map, Newspaper, Package,
  Truck, MapPin, Users, Wrench, CalendarDays, Terminal, UserRound,
} from "lucide-react";

/**
 * The business action network (v2.9 IA).
 *
 * Five primary doors, one job each, organised around what an owner is trying
 * to *do* — not around our databases:
 *
 *   Home      your business overview and urgent actions
 *   Browse    the business action center: goods, people, services, equipment —
 *             one search, one results system, with the map and markets as
 *             views of the same results
 *   Work      orders, requests, bookings, rentals and jobs — what you owe and
 *             what is owed to you
 *   Inbox     calls, quotes, chat and coordination
 *   Business  profile, stock, team, trust and settings
 *
 * What used to be separate destinations (Stock / Suppliers / Around you /
 * Map / Markets / News) are now filters and views inside Browse. Their URLs
 * all still resolve — nothing was deleted, only duplicated navigation.
 */
export const PRIMARY_NAV = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/browse", label: "Browse", icon: Compass, area: "browse" },
  { to: "/work", label: "Work", icon: ClipboardList, area: "work", badge: "orders" },
  { to: "/chat", label: "Inbox", icon: MessageSquare, badge: "chat" },
  { to: "/me", label: "Business", icon: Store, area: "me" },
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

const BROWSE_ROOTS = [
  "/browse", "/network", "/nearby", "/map", "/markets", "/news",
  "/search", "/listing", "/place",
];

/** Work owns everything you owe or are owed: orders, tasks, locks, rentals,
    bookings. Deep links stay; the aggregation lives at /work. */
const WORK_ROOTS = ["/work", "/orders", "/tasks", "/locks", "/tools"];

const ME_ROOTS = [
  "/me", "/stock", "/analytics", "/pos", "/brief",
  "/groups", "/lists", "/events", "/governance", "/ops", "/feed",
];

const inArea = (pathname, roots) => roots.some((root) => pathname === root || pathname.startsWith(`${root}/`));

export const isBrowsePath = (pathname = "") => inArea(pathname, BROWSE_ROOTS);

export const isWorkPath = (pathname = "") => inArea(pathname, WORK_ROOTS);

export const isMePath = (pathname = "", vendorHandle = "") =>
  inArea(pathname, ME_ROOTS) || (vendorHandle && pathname === `/@${vendorHandle}`);

export const isPrimaryActive = (item, pathname, vendorHandle) => {
  if (item.area === "browse") return isBrowsePath(pathname);
  if (item.area === "work") return isWorkPath(pathname);
  if (item.area === "me") return isMePath(pathname, vendorHandle);
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
};

/** Long-tail tools that do not need a permanent primary tab. */
export const SECTION_GROUPS = [
  {
    title: "Community",
    items: [
      { to: "/groups", label: "Groups & collectives", icon: Users },
      { to: "/events", label: "Events", icon: CalendarDays },
    ],
  },
  {
    title: "Administration",
    items: [{ to: "/ops", label: "Ops console", icon: Terminal, quiet: true }],
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
