// Every list here mirrors a value set the API validates against.
// backend/app/models/vendor.py · VendorRole
export const VENDOR_ROLES = [
  { value: "sourcing", label: "Sourcing", emoji: "🔍", color: "text-blue-400", hint: "Buying from the network" },
  { value: "selling", label: "Selling", emoji: "📦", color: "text-amber-400", hint: "Supplying the network" },
  { value: "both", label: "Both", emoji: "🔄", color: "text-brand-400", hint: "Sourcing and selling" },
  { value: "dormant", label: "Dormant", emoji: "💤", color: "text-ink-4", hint: "Watching, not trading" },
];

export const ROLE_BADGE = { sourcing: "blue", selling: "amber", both: "brand", dormant: "gray" };

// backend/app/models/groups.py · GroupType
export const GROUP_TYPES = [
  { value: "open", label: "Open" },
  { value: "niche", label: "Niche" },
  { value: "regional", label: "Regional" },
  { value: "trade", label: "Trade" },
  { value: "sourcing", label: "Sourcing Collective" },
  { value: "event", label: "Event" },
];

// backend/app/models/tools.py · ToolCategory
export const TOOL_CATEGORIES = [
  { value: "warehouse", label: "Warehouse", icon: "Warehouse" },
  { value: "transport", label: "Transport", icon: "Truck" },
  { value: "courier", label: "Courier", icon: "Package" },
  { value: "popup_shop", label: "Popup Shop", icon: "Store" },
  { value: "hotel_sourcing", label: "Hotel Sourcing", icon: "Hotel" },
  { value: "equipment", label: "Equipment", icon: "Wrench" },
  { value: "packaging", label: "Packaging", icon: "Box" },
  { value: "cold_storage", label: "Cold Storage", icon: "Snowflake" },
];

// backend/app/routes/events.py · EVENT_TYPES
export const EVENT_TYPES = [
  { value: "networking", label: "Networking" },
  { value: "trade_show", label: "Trade Show" },
  { value: "trade_fair", label: "Trade Fair" },
  { value: "sourcing_trip", label: "Sourcing Trip" },
  { value: "market_day", label: "Market Day" },
  { value: "popup_market", label: "Popup Market" },
  { value: "workshop", label: "Workshop" },
  { value: "auction", label: "Auction" },
];

// backend/app/config.py · ALLOWED_POS_SYSTEMS  (mode from services/pos_sync.py)
export const POS_SYSTEMS = [
  { value: "manual", label: "Manual Entry", desc: "Enter or push stock by hand", mode: "push" },
  { value: "csv", label: "CSV Import", desc: "Upload your till's spreadsheet export", mode: "push" },
  { value: "square", label: "Square POS", desc: "Auto-sync from Square", mode: "pull" },
  { value: "shopify", label: "Shopify", desc: "Auto-sync from Shopify", mode: "pull" },
  { value: "custom_api", label: "Custom API", desc: "Your system posts stock to Ogallo", mode: "push" },
];

export const PRICE_UNITS = [
  { value: "per_hour", label: "/ hour" },
  { value: "per_day", label: "/ day" },
  { value: "per_week", label: "/ week" },
  { value: "per_month", label: "/ month" },
  { value: "per_trip", label: "/ trip" },
  { value: "per_kg", label: "/ kg" },
  { value: "per_sqm", label: "/ m²" },
  { value: "flat", label: "flat" },
];

export const STOCK_UNITS = ["units", "pieces", "kg", "bunches", "crates", "boxes", "bales", "pallets", "litres", "metres", "cartons", "dozens", "trays"];

// backend/app/models/stock.py · MovementStatus
export const MOVEMENT_BADGE = { pending: "amber", confirmed: "blue", in_transit: "blue", received: "brand", cancelled: "red" };

export const MESSAGE_TYPES = [
  { value: "text", label: "Message" },
  { value: "stock_share", label: "Share Stock" },
  { value: "deal_proposal", label: "Propose Deal" },
];

// backend/app/models/stock.py · QualityStatus (v2.1)
export const QUALITY_STATUSES = [
  { value: "unverified", label: "Unverified", variant: "gray", hint: "No provenance on file" },
  { value: "self_declared", label: "Self-declared", variant: "blue", hint: "Batch and origin declared by the vendor" },
  { value: "patron_verified", label: "Patron-verified", variant: "purple", hint: "Checked by the patron of a list this vendor is on" },
  { value: "lab_certified", label: "Lab-certified", variant: "brand", hint: "Certificate / spec sheet attached" },
];

// backend/app/routes/chat.py · DealProposalData (v2.1)
export const DELIVERY_TERMS = [
  { value: "pickup", label: "Pickup" },
  { value: "delivery", label: "Seller delivers" },
  { value: "courier", label: "Courier" },
];
export const PAYMENT_TERMS = [
  { value: "on_delivery", label: "On delivery" },
  { value: "advance", label: "In advance" },
  { value: "credit_30", label: "30-day credit" },
];
export const DEAL_STATUS_BADGE = { proposed: "amber", countered: "blue", accepted: "brand", declined: "red" };

// backend/app/models/tools.py · SHIPMENT_STATUSES (v2.1)
export const SHIPMENT_STATUSES = [
  { value: "picked_up", label: "Picked up", variant: "gray" },
  { value: "in_transit", label: "In transit", variant: "blue" },
  { value: "out_for_delivery", label: "Out for delivery", variant: "amber" },
  { value: "delivered", label: "Delivered", variant: "brand" },
  { value: "failed", label: "Failed", variant: "red" },
];

// backend/app/models/collective.py · COLLECTIVE_STATUSES (v2.1)
export const COLLECTIVE_STATUSES = [
  { value: "gathering", label: "Gathering pledges", variant: "amber" },
  { value: "quota_met", label: "Quota met", variant: "brand" },
  { value: "negotiating", label: "Negotiating", variant: "blue" },
  { value: "ordered", label: "Ordered", variant: "purple" },
  { value: "fulfilled", label: "Fulfilled", variant: "brand" },
  { value: "cancelled", label: "Cancelled", variant: "red" },
];

// backend/app/models/patron.py · PatronTier + services/patron_service.py TIER_REQUIREMENTS (v2.1)
export const PATRON_TIERS = [
  { value: "starter", label: "Starter", next: "established", requirements: null },
  { value: "established", label: "Established", next: "mogul", requirements: { vendors: 20, events: 3, reputation: 50 } },
  { value: "mogul", label: "Mogul", next: "legend", requirements: { vendors: 100, events: 10, reputation: 80 } },
  { value: "legend", label: "Legend", next: null, requirements: { vendors: 500, events: 25, reputation: 95 } },
];

// backend/app/models/notification.py · NotificationType → where a click should land
export const NOTIFICATION_ROUTES = {
  source_request: "/stock?tab=movements&direction=outgoing",
  source_accepted: "/stock?tab=movements&direction=incoming",
  source_shipped: "/stock?tab=movements&direction=incoming",
  source_received: "/stock?tab=movements&direction=outgoing",
  source_cancelled: "/stock?tab=movements",
  deal_proposal: "/chat",
  deal_accepted: "/chat",
  deal_countered: "/chat",
  deal_declined: "/chat",
  group_invite: "/groups",
  group_join_request: "/groups?tab=mine",
  group_approved: "/groups?tab=mine",
  list_registration: "/lists?tab=mine",
  list_approved: "/lists",
  list_rejected: "/lists",
  collective_update: "/groups?tab=mine",
  event_registration: "/events?tab=mine",
  event_reminder: "/events",
  stock_low: "/stock",
  stock_verified: "/stock",
  parasitism_milestone: "/network",
  patron_promotion: "/profile",
  shipment_update: "/tools?tab=shipments",
  system: "/",
};
