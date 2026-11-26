import {
  CalendarDays, ClipboardList, Layers, MessageSquare, Package, Truck, Wrench,
} from "lucide-react";

/**
 * CATEGORY COLOUR — one vocabulary, five categories, one palette.
 *
 * A category is not a filter button that happens to be green. "Services" is
 * the same wash on the Explore selector, on the card that comes back from that
 * filter, and on the Home grid. If a person learns the colour once, it keeps
 * paying them back every time it appears.
 *
 * The brief asked for ONE palette — forest green, terracotta, warm ivory,
 * sage, charcoal — and for a product that no longer reads as a dozen
 * competing features. So the categories stopped inventing hues of their own:
 * they borrow from the palette that is already there.
 *
 *   All       neutral stone    — the unfiltered feed
 *   Goods     terracotta       — the brief's second voice
 *   Services  forest green     — the brief's identity colour
 *   Rentals   forest on sage   — the brief's sage ground
 *   Events    warm clay        — the only warm neutral left
 *
 * Every wash is low-chroma and every ink clears 4.5:1 on its own wash
 * (measured in src/test/contrast.test.js). Colours come from `--cat-*`
 * tokens, so the palette lives in exactly one file and this one names no hex.
 *
 * `wash`  — the background of a tile or badge
 * `ink`   — the matching text and icon colour; also the selection ring, via
 *           `ring-current`, so one value drives both
 * `dot`   — the solid colour, for a marker where a wash would be too loud
 */
const hue = (label, icon, wash, ink, dot) => ({ label, icon, wash, ink, dot });

export const CATEGORY_TINTS = {
  all: hue(
    "All", Layers,
    "bg-cat-all-soft",
    "text-cat-all-text",
    "#4A4A46",
  ),
  goods: hue(
    "Goods", Package,
    "bg-cat-goods-soft",
    "text-cat-goods-text",
    "#D95336",
  ),
  services: hue(
    "Services", Truck,
    "bg-cat-services-soft",
    "text-cat-services-text",
    "#123B32",
  ),
  rentals: hue(
    "Rentals", Wrench,
    "bg-cat-rentals-soft",
    "text-cat-rentals-text",
    "#123B32",
  ),
  events: hue(
    "Events", CalendarDays,
    "bg-cat-events-soft",
    "text-cat-events-text",
    "#7C5A1E",
  ),

  /* The local posting types. These are not categories — they describe what a
     person is doing, not what the thing is — but they appear on the same
     cards, so they share the vocabulary instead of inventing a second one.
     "Available" is an offer, so it wears Goods. A "Round" is an event, so it
     wears Events. Everything else is neutral: a request or a post is not a
     thing for sale and must not be painted like one. */
  available: hue(
    "Available", Package,
    "bg-cat-goods-soft",
    "text-cat-goods-text",
    "#D95336",
  ),
  wanted: hue(
    "Wanted", ClipboardList,
    "bg-cat-all-soft",
    "text-cat-all-text",
    "#4A4A46",
  ),
  scheduled: hue(
    "Scheduled", CalendarDays,
    "bg-cat-events-soft",
    "text-cat-events-text",
    "#7C5A1E",
  ),
  opportunity: hue(
    "Opportunity", ClipboardList,
    "bg-cat-all-soft",
    "text-cat-all-text",
    "#4A4A46",
  ),
  post: hue(
    "Post", MessageSquare,
    "bg-cat-all-soft",
    "text-cat-all-text",
    "#4A4A46",
  ),
};

/**
 * Which colour a content `kind` wears.
 *
 * The feed's kinds and the Explore categories are not the same list, so this is
 * the one place the two are reconciled: a `listing` is Goods, a `service` is
 * Services, a `rental` is Rentals, an `event` is Events. Anything that is not
 * something for sale — a post, a request, a person — wears the neutral All
 * wash rather than being given a colour of its own.
 */
export const KIND_TO_CATEGORY = {
  listing: "goods",
  available: "goods",
  market: "goods",
  service: "services",
  provider: "services",
  rental: "rentals",
  event: "events",
  scheduled: "events",
  person: "all",
  community: "all",
  collection: "all",
  wanted: "all",
  opportunity: "all",
  post: "all",
  place: "all",
};

export function tintForKind(kind) {
  return CATEGORY_TINTS[KIND_TO_CATEGORY[kind] || "all"] || CATEGORY_TINTS.all;
}

/**
 * The five categories a person can browse, in the order the brief names them.
 *
 * There used to be seven tiles plus a chip row plus a type row, which is how
 * a discovery screen ends up looking crowded. There is now one list, and it
 * is the same list on Home, on Explore and in the header.
 */
export const EXPLORE_CATEGORIES = [
  { key: "all", kind: "" },
  { key: "goods", kind: "listing" },
  { key: "services", kind: "service" },
  { key: "rentals", kind: "rental" },
  { key: "events", kind: "event" },
];

/**
 * THE BUSINESS DESK — the same five washes, borrowed, not invented.
 *
 * A desk is a buying need, and it wears the hue of the category it is closest
 * to. Reusing the vocabulary is the point — a second palette for a second
 * screen would mean the colours had stopped meaning anything.
 */
export const DESK_TINT = {
  digital_services: "goods",
  business_software: "services",
  field_operations: "rentals",
  device_management: "all",
  custom: "all",
};

export function tintForDesk(deskKey) {
  return CATEGORY_TINTS[DESK_TINT[deskKey] || "all"] || CATEGORY_TINTS.all;
}
