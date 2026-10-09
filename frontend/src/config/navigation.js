import {
  Home, Compass, Map, Newspaper, Network, Package, Truck, MapPin, Users,
  CalendarDays, MessageSquare, Terminal, Store, Receipt, UserRound,
} from "lucide-react";

/**
 * Ogallo's information architecture.
 *
 * The five primary doors have one job each. Browse owns discovery surfaces;
 * Me owns the signed-in trader's workspace. The secondary drawer is reserved
 * for supporting sections and never contains a second Home or a mode switch.
 */
export const PRIMARY_NAV = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/browse", label: "Browse", icon: Compass, area: "browse" },
  { to: "/orders", label: "Orders", icon: Receipt, badge: "orders" },
  { to: "/chat", label: "Inbox", icon: MessageSquare, badge: "chat" },
  { to: "/me", label: "Me", icon: UserRound, area: "me" },
];

/** Browse-only destinations. They stay in the same visual context. */
export const BROWSE_NAV = [
  { to: "/browse", label: "Stock", icon: Package, end: true },
  { to: "/network", label: "Suppliers", icon: Network },
  { to: "/nearby", label: "Around you", icon: Compass },
  { to: "/map", label: "Map", icon: Map },
  { to: "/markets", label: "Markets", icon: MapPin },
  { to: "/news", label: "News", icon: Newspaper },
];

const BROWSE_ROOTS = [
  "/browse", "/network", "/nearby", "/map", "/markets", "/news",
  "/search", "/listing", "/place",
];

const ME_ROOTS = [
  "/me", "/stock", "/analytics", "/pos", "/tasks", "/brief", "/tools",
  "/groups", "/lists", "/locks", "/events", "/governance", "/ops", "/feed",
];

const inArea = (pathname, roots) => roots.some((root) => pathname === root || pathname.startsWith(`${root}/`));

export const isBrowsePath = (pathname = "") => inArea(pathname, BROWSE_ROOTS);

export const isMePath = (pathname = "", vendorHandle = "") =>
  inArea(pathname, ME_ROOTS) || (vendorHandle && pathname === `/@${vendorHandle}`);

export const isPrimaryActive = (item, pathname, vendorHandle) => {
  if (item.area === "browse") return isBrowsePath(pathname);
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

/** Search scopes route to existing screens and endpoints. */
export const SEARCH_SCOPES = [
  { value: "stock", label: "Listings", to: (q) => `/browse?search=${encodeURIComponent(q)}`, icon: Package },
  { value: "vendors", label: "Vendors", to: (q) => `/network?search=${encodeURIComponent(q)}`, icon: Store },
  { value: "markets", label: "Markets", to: (q) => `/markets?tab=all&search=${encodeURIComponent(q)}`, icon: MapPin },
  { value: "rentals", label: "Rentals", to: (q) => `/tools?search=${encodeURIComponent(q)}`, icon: Truck },
];
