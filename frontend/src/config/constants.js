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
  { value: "custom_api", label: "Custom API", desc: "Your system posts stock to Brief_", mode: "push" },
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
