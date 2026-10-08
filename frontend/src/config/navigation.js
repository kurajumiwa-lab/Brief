import {
  Home, Search, Compass, Map, Newspaper, Network, Package, Truck, MapPin, Users,
  CalendarDays, ListChecks, Briefcase, MessageSquare, List, ShoppingBasket,
  BarChart3, Terminal, ShieldCheck, Store, Receipt, LayoutGrid,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════════════════════
   INFORMATION ARCHITECTURE — one source of truth
   ---------------------------------------------------------------------------
   v2 shipped 20 equal-weight sidebar items and a 3-tab mobile bar. Nothing was
   removed in v3; the change is WEIGHTING.

     PRIMARY    the core loop — browse → source → order → talk  (header + tabs)
     DISCOVERY  the ten original home doors, now a category rail with counts
     SECTIONS   everything else, grouped, one tap away in the All-sections menu

   Every route that existed still resolves. See docs/PRODUCT-ARCHAEOLOGY.md §13.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The loop. These are the only destinations in the header and the tab bar. */
export const PRIMARY_NAV = [
  { to: "/", label: "Home", icon: Home, end: true, mobile: true },
  { to: "/browse", label: "Browse", icon: LayoutGrid, mobile: true, hint: "What the network has on its shelves" },
  { to: "/orders", label: "Orders", icon: Receipt, mobile: true, hint: "Movements in and out", badge: "orders" },
  { to: "/chat", label: "Inbox", icon: MessageSquare, mobile: true, hint: "Deal rooms, groups and direct messages" },
  { to: "/stock", label: "My shelf", icon: Package, hint: "The stock you show the network" },
];

/** The ten doors from the original home hub — preserved verbatim, re-ranked. */
export const DISCOVERY_NAV = [
  { to: "/nearby", label: "Around you", icon: Compass, countKey: "nearby" },
  { to: "/map", label: "Map", icon: Map, countKey: "places" },
  { to: "/news", label: "News", icon: Newspaper, countKey: "news" },
  { to: "/network", label: "Suppliers", icon: Network, countKey: "suppliers" },
  { to: "/browse", label: "Stock", icon: Package, countKey: "stock" },
  { to: "/tools", label: "Rentals", icon: Truck, countKey: "rentals" },
  { to: "/markets", label: "Markets", icon: MapPin, countKey: "markets" },
  { to: "/groups", label: "Groups", icon: Users, countKey: "groups" },
  { to: "/events", label: "Events", icon: CalendarDays, countKey: "events" },
  { to: "/tasks", label: "Tasks", icon: ListChecks, countKey: "calls" },
];

/** Everything else, grouped by the job it does. Nothing is hidden, only tiered. */
export const SECTION_GROUPS = [
  {
    title: "Trade",
    items: [
      { to: "/browse", label: "Browse stock", icon: LayoutGrid },
      { to: "/stock", label: "My shelf", icon: Package },
      { to: "/orders", label: "Orders", icon: Receipt },
      { to: "/network", label: "Suppliers", icon: Network },
      { to: "/locks", label: "Flash Locks", icon: ShoppingBasket },
    ],
  },
  {
    title: "Community",
    items: [
      { to: "/groups", label: "Groups & collectives", icon: Users },
      { to: "/lists", label: "Vendor lists", icon: List },
      { to: "/events", label: "Events", icon: CalendarDays },
      { to: "/tasks", label: "Tasks", icon: ListChecks },
      { to: "/governance", label: "Our Network", icon: ShieldCheck },
    ],
  },
  {
    title: "Around you",
    items: [
      { to: "/nearby", label: "Around you", icon: Compass },
      { to: "/map", label: "Map", icon: Map },
      { to: "/markets", label: "Markets", icon: MapPin },
      { to: "/news", label: "News", icon: Newspaper },
      { to: "/search", label: "Search", icon: Search },
    ],
  },
  {
    title: "Your business",
    items: [
      { to: "/brief", label: "Dashboard", icon: Briefcase },
      { to: "/analytics", label: "Analytics", icon: BarChart3 },
      { to: "/tools", label: "Rentals & logistics", icon: Truck },
      { to: "/pos", label: "POS Bridge", icon: Terminal },
      { to: "/ops", label: "Ops console", icon: Terminal, quiet: true },
    ],
  },
];

/** Search scopes — each maps onto an endpoint that already exists. */
export const SEARCH_SCOPES = [
  { value: "stock", label: "Listings", to: (q) => `/browse?search=${encodeURIComponent(q)}`, icon: Package },
  { value: "vendors", label: "Vendors", to: (q) => `/network?search=${encodeURIComponent(q)}`, icon: Store },
  { value: "markets", label: "Markets", to: (q) => `/markets?search=${encodeURIComponent(q)}`, icon: MapPin },
  { value: "rentals", label: "Rentals", to: (q) => `/tools?search=${encodeURIComponent(q)}`, icon: Truck },
];
