import {
  Bike, CalendarDays, GraduationCap, HeartPulse, ShoppingBasket, Users, Wrench,
} from "lucide-react";

/**
 * ONE VISUAL LANGUAGE FOR CONTENT WITHOUT A PHOTOGRAPH.
 *
 * The same category must look the same on the Home shelf, the Regions grid and
 * anywhere else a card appears. A missing photo is a design state, not a broken
 * image: the category picks a warm gradient and a line icon.
 */
export const PALETTES = [
  { key: "groceries", from: "#0F3D2E", to: "#2B7A5A", ink: "#D7F1E2", Icon: ShoppingBasket },
  { key: "events", from: "#6B3F12", to: "#B8792B", ink: "#FBEBD5", Icon: CalendarDays },
  { key: "trips", from: "#1E3A5F", to: "#3E6E9E", ink: "#DBEBFA", Icon: Bike },
  { key: "community", from: "#4A2C5A", to: "#7E5497", ink: "#F0E5F7", Icon: Users },
  { key: "repairs", from: "#4C2A1E", to: "#9A5A3A", ink: "#F8E6DC", Icon: Wrench },
  { key: "learning", from: "#23423A", to: "#4F7F5C", ink: "#E1F3E4", Icon: GraduationCap },
  { key: "health", from: "#5A1F2E", to: "#A3485F", ink: "#FBE2E8", Icon: HeartPulse },
];

const KEYWORDS = [
  { match: ["grocery", "groceries", "bulk", "food", "market", "produce", "vegetable", "maize"], palette: 0 },
  { match: ["brunch", "party", "wedding", "celebration", "music", "event", "festival"], palette: 1 },
  { match: ["bike", "ride", "trip", "travel", "tour", "hike", "transport", "boda"], palette: 2 },
  { match: ["community", "chama", "group", "meet", "neighbour", "neighbor", "association"], palette: 3 },
  { match: ["repair", "fundi", "service", "fix", "maintenance", "plumber", "electrician"], palette: 4 },
  { match: ["learn", "class", "training", "session", "workshop", "school", "tuition"], palette: 5 },
  { match: ["health", "clinic", "pharmacy", "nurse", "doctor", "dawa", "hospital"], palette: 6 },
];

const KIND_DEFAULT = {
  event: 1, scheduled: 2, wanted: 4, service: 4, provider: 4, rental: 4,
  opportunity: 3, community: 3, post: 3,
};

export function paletteFor(item = {}) {
  const text = `${item.category || ""} ${item.title || ""} ${item.meta?.inferred_template || ""}`.toLowerCase();
  for (const entry of KEYWORDS) {
    if (entry.match.some((word) => text.includes(word))) return PALETTES[entry.palette];
  }
  return PALETTES[KIND_DEFAULT[item.kind] ?? 0] || PALETTES[0];
}

const KIND_LABEL = {
  available: "Offer", listing: "Offer", wanted: "Wanted", scheduled: "Round",
  event: "Event", service: "Service", provider: "Service", rental: "Rental",
  opportunity: "Opportunity",
  post: "Post", community: "Community", collection: "Collection", person: "Person",
};

export const kindLabel = (kind) => KIND_LABEL[kind] || "Listed";

export const priceLabel = (value) => {
  if (value === null || value === undefined || value === "") return "Open";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Open";
  return `KSh ${new Intl.NumberFormat("en-KE").format(amount)}`;
};

export const momentumLabel = (item = {}) => {
  const joined = Number(item.counts?.booked ?? item.counts?.attending ?? item.counts?.responses ?? 0);
  const capacity = Number(item.meta?.capacity || 0);
  if (capacity > 0) return { text: `${Math.min(joined, capacity)}/${capacity} joined`, joined, capacity };
  if (joined > 0) return { text: `${joined} joined`, joined, capacity: 0 };
  return null;
};
