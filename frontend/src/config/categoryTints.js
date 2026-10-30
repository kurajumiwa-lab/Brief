import {
  CalendarDays, ClipboardList, Layers, MessageSquare, Package, Truck,
  Users, UsersRound, Wrench,
} from "lucide-react";

/**
 * CATEGORY COLOUR — one vocabulary, every surface.
 *
 * A category is not a filter button that happens to be green. "Services" is
 * pale blue in the Explore selector, pale blue on the card that comes back from
 * that filter, and pale blue on a market's door list. If a person learns the
 * colour once, it keeps paying them back every time it appears — which is the
 * whole point of a visual language rather than decoration.
 *
 * The hues are deliberately restrained: a pastel wash and a darker matching
 * ink of the same family, never a saturated block. Everything below is a static
 * class string so Tailwind can see it at build time; arbitrary values are used
 * because these colours are not part of the marketplace's brand ramp.
 *
 * `wash`  — the background of a tile or badge
 * `ink`   — the matching text and icon colour; also the selection ring, via
 *           `ring-current`, so one value drives both
 * `dot`   — the solid colour, for a 4px marker where a wash would be too loud
 */
const hue = (label, icon, wash, ink, dot) => ({ label, icon, wash, ink, dot });

export const CATEGORY_TINTS = {
  goods: hue(
    "Goods", Package,
    "bg-[#E8F2EC] dark:bg-[#17332A]",
    "text-[#276A49] dark:text-[#A9D9BF]",
    "#276A49",
  ),
  people: hue(
    "People", Users,
    "bg-[#EAEAF8] dark:bg-[#232244]",
    "text-[#5953A5] dark:text-[#BEB9F1]",
    "#5953A5",
  ),
  services: hue(
    "Services", Truck,
    "bg-[#E6F1F7] dark:bg-[#16303A]",
    "text-[#36738E] dark:text-[#A6D3E6]",
    "#36738E",
  ),
  equipment: hue(
    "Equipment", Wrench,
    "bg-[#F5EEE2] dark:bg-[#33291B]",
    "text-[#7E5D2C] dark:text-[#E3C58E]",
    "#7E5D2C",
  ),
  events: hue(
    "Events", CalendarDays,
    "bg-[#F4EAF0] dark:bg-[#33222B]",
    "text-[#99516F] dark:text-[#E7B0C8]",
    "#99516F",
  ),
  communities: hue(
    "Communities", UsersRound,
    "bg-[#E9EFF0] dark:bg-[#223033]",
    "text-[#526D70] dark:text-[#B7D2D4]",
    "#526D70",
  ),
  collections: hue(
    "Collections", Layers,
    "bg-[#EFEFE7] dark:bg-[#2B2E22]",
    "text-[#63654B] dark:text-[#CACEA7]",
    "#63654B",
  ),
  rentals: hue(
    "Rentals", Truck,
    "bg-[#EDEDF4] dark:bg-[#25263A]",
    "text-[#5D6180] dark:text-[#B5B9D7]",
    "#5D6180",
  ),

  /* The four local posting types, plus a plain post. These are not categories
     — they describe what a person is doing, not what the thing is — but they
     appear on the same cards, so they share the vocabulary instead of
     inventing a second one. */
  available: hue(
    "Available", Package,
    "bg-[#E8F2EC] dark:bg-[#17332A]",
    "text-[#276A49] dark:text-[#A9D9BF]",
    "#276A49",
  ),
  wanted: hue(
    "Wanted", Wrench,
    "bg-[#F7EFE0] dark:bg-[#332A19]",
    "text-[#8A6320] dark:text-[#E6C68C]",
    "#8A6320",
  ),
  scheduled: hue(
    "Scheduled", CalendarDays,
    "bg-[#F2EAF3] dark:bg-[#2F2233]",
    "text-[#7C5185] dark:text-[#D5AFDC]",
    "#7C5185",
  ),
  opportunity: hue(
    "Opportunity", ClipboardList,
    "bg-[#F6EBE7] dark:bg-[#332420]",
    "text-[#9A5237] dark:text-[#E6B3A0]",
    "#9A5237",
  ),
  post: hue(
    "Post", MessageSquare,
    "bg-[#F0F1EE] dark:bg-[#242925]",
    "text-[#55605A] dark:text-[#BAC6BF]",
    "#55605A",
  ),
};

/**
 * Which colour a content `kind` wears.
 *
 * The feed's kinds and the Explore categories are not the same list, so this is
 * the one place the two are reconciled: a `listing` is Goods, a `person` is
 * People, a `service` is Services. Anything unrecognised falls back to the
 * neutral Post tint rather than to an invented colour.
 */
export const KIND_TO_CATEGORY = {
  listing: "goods",
  person: "people",
  service: "services",
  rental: "rentals",
  event: "events",
  community: "communities",
  collection: "collections",
  available: "available",
  wanted: "wanted",
  scheduled: "scheduled",
  opportunity: "opportunity",
  post: "post",
  place: "post",
  market: "goods",
};

export function tintForKind(kind) {
  return CATEGORY_TINTS[KIND_TO_CATEGORY[kind] || "post"] || CATEGORY_TINTS.post;
}

/**
 * The categories a person can actually filter Explore by.
 *
 * Seven, not the eight in the mockup: the discovery feed has no `equipment`
 * kind, so an Equipment tile would either duplicate Rentals or return nothing.
 * Its hue still exists in `CATEGORY_TINTS` and is used where equipment is real
 * (a market's Equipment door, the tools screens) — the vocabulary is complete
 * even where the filter is not.
 */
export const EXPLORE_CATEGORIES = [
  { key: "goods", kind: "listing" },
  { key: "people", kind: "person" },
  { key: "services", kind: "service" },
  { key: "rentals", kind: "rental" },
  { key: "events", kind: "event" },
  { key: "communities", kind: "community" },
  { key: "collections", kind: "collection" },
];
