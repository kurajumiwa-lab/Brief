/**
 * THE FIVE CATEGORIES — one list, used by Home, Explore and the header.
 *
 * The brief asks for a single search experience with the categories built
 * into it: All, Goods, Services, Rentals, Events. Before this there were
 * three competing answers to "what am I looking for?" — a seven-tile grid on
 * Explore, a chip row under the search bar, a posting-type row, and a
 * four-item grid on Home. A person had to work out which one was real.
 *
 * So there is one list, in one file, and every screen reads it. The URL
 * parameter it maps to is `kind`, because that is what the backend's feed
 * contract already understands: `listing`, `service`, `rental`, `event`.
 *
 * `kinds` is what the FEED is asked for. `kind` is what the URL says. They
 * differ for Goods, because an "available" posting is an offer of goods and
 * must not fall out of the Goods door when a seller says "Available" instead
 * of "Listing".
 */
export const SEARCH_CATEGORIES = [
  {
    key: "all",
    label: "All",
    kind: "",
    kinds: null,
    hint: "Everything the network has",
  },
  {
    key: "goods",
    label: "Goods",
    kind: "listing",
    kinds: ["listing", "available"],
    hint: "Produce, stock and wares",
  },
  {
    key: "services",
    label: "Services",
    kind: "service",
    kinds: ["service"],
    hint: "Trades and professionals",
  },
  {
    key: "rentals",
    label: "Rentals",
    kind: "rental",
    kinds: ["rental"],
    hint: "Tools, rooms and vans",
  },
  {
    key: "events",
    label: "Events",
    kind: "event",
    kinds: ["event", "scheduled"],
    hint: "Rounds, meetups and gatherings",
  },
];

const BY_KEY = Object.fromEntries(SEARCH_CATEGORIES.map((item) => [item.key, item]));
const BY_KIND = Object.fromEntries(
  SEARCH_CATEGORIES.filter((item) => item.kind).map((item) => [item.kind, item]),
);

/** The category a URL `kind` belongs to. Unknown kinds fall back to All. */
export function categoryForKind(kind) {
  return BY_KIND[kind]?.key || "all";
}

/** The category object for a key. Unknown keys fall back to All. */
export function categoryByKey(key) {
  return BY_KEY[key] || BY_KEY.all;
}

/**
 * The feed kinds a category asks for. `null` means "do not narrow the feed",
 * which is different from "ask for nothing".
 */
export function kindsForCategory(key) {
  return BY_KEY[key]?.kinds ?? null;
}

/**
 * The search route. One address for the dedicated results experience, so a
 * search from Home, from Explore and from the header all land in the same
 * place with the same meaning.
 */
export function resultsHref({ q = "", category = "all" } = {}) {
  const params = new URLSearchParams();
  const term = String(q || "").trim();
  if (term) params.set("q", term);
  const kind = categoryByKey(category).kind;
  if (kind) params.set("kind", kind);
  const search = params.toString();
  return search ? `/regions?${search}` : "/regions";
}
