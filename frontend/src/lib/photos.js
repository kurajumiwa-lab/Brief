/**
 * THE PHOTOGRAPH LIBRARY.
 *
 * One place that knows which photograph stands for which kind of thing, so a
 * service provider looks like a service provider on the Home shelf, in the
 * Regions grid and on a category banner. Components ask for a *subject*, never
 * a file path.
 *
 * ── The visual identity lives here ──────────────────────────────────────────
 * The interface is deliberately untouched. The identity Brief carries is carried
 * by these photographs: contemporary Nairobi, glass towers, matatu-filled
 * streets, a technician mid-install, a conference stage. Metropolitan, ambitious,
 * connected — a real African city now, not a diorama of scarcity.
 *
 * The earlier set was roadside kiosks and rural markets. Authentic, but it read
 * as a development project or an NGO appeal, which is not what this product is.
 * "Authentic" and "the right story" are different tests, and only the second one
 * matters for a brand.
 *
 * It is not a sci-fi concept either: every frame is a place someone could walk
 * into today. Believable beats futuristic.
 *
 * Three rules, and they are the whole design:
 *
 * 1. **These are decorative.** Every one of these images sits beside or behind
 *    real text that already says what the thing is. So they carry `alt=""` and
 *    are hidden from assistive technology. A photograph repeating the heading is
 *    noise; one replacing the heading would be a bug.
 *
 * 2. **A missing photo is a designed state.** `photoFor()` returns null when
 *    there is no honest photograph, and the caller renders its category colour
 *    and Lucide icon instead (`lib/categoryArt`).
 *
 * 3. **No subject is faked.** A card with a real `item.image` always wins. These
 *    are city atmosphere and category signal — never evidence that a specific
 *    listing was photographed.
 */

const BASE = "/photos/kenya";

/** Subject → file. Keys are what callers ask for; values are what exists. */
const LIBRARY = {
  // Metropolis: skyline, CBD, the city as infrastructure.
  "city-skyline": "banner-skyline.jpg",
  "city-cbd": "city-cbd.jpg",
  "city-street": "city-street.jpg",
  "city-hero": "hero-market.jpg",

  // Commerce: streets where trade actually happens.
  "commerce-street": "commerce-street.jpg",
  "commerce-traffic": "commerce-traffic.jpg",
  "commerce-goods": "commerce-goods.jpg",
  "rental-tools": "rental-tools.jpg",

  // People at work in modern settings.
  "work-technician": "work-technician.jpg",
  "people-street": "people-street.jpg",

  // Gatherings and culture.
  "culture-conference": "culture-conference.jpg",

  // Wide crops for banners and the hero.
  "banner-street": "banner-street.jpg",
  "banner-produce": "banner-produce.jpg",
  "banner-people": "banner-people.jpg",
  "banner-skyline": "banner-skyline.jpg",
  "hero-market": "hero-market.jpg",
};

export function photoUrl(subject) {
  const file = LIBRARY[subject];
  return file ? `${BASE}/${file}` : null;
}

/**
 * A stable-but-rotating pick, so a feed of five listings does not show the same
 * photograph five times.
 *
 * Keyed on the item's own identity, which means the same listing keeps the same
 * picture between renders and page loads — churn would look like the data
 * changed. It rotates only *across* different items.
 */
function pick(pool, seed) {
  if (!pool.length) return null;
  const text = String(seed ?? "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return pool[Math.abs(hash) % pool.length];
}

const POOLS = {
  goods: ["commerce-goods", "commerce-street", "commerce-traffic", "city-cbd"],
  service: ["work-technician", "people-street", "commerce-street"],
  rental: ["rental-tools", "city-cbd", "commerce-street"],
  event: ["culture-conference", "city-street", "people-street"],
  person: ["people-street", "work-technician"],
  community: ["city-street", "commerce-street", "culture-conference"],
  post: ["commerce-street", "city-cbd", "banner-street"],
};

/**
 * The photograph for a piece of content, or null.
 *
 * `item.image` always wins upstream: that is a real photograph of the actual
 * thing. Everything here is category atmosphere.
 */
export function photoFor(item = {}) {
  if (!item || typeof item !== "object") return null;

  const kind = String(item.kind || "").toLowerCase();
  const primary = String(item.meta?.primary_category || "").toLowerCase();

  // An "Available" offer belongs to a good, service or rental; read the
  // sub-category before the umbrella kind.
  const resolved = { goods: "goods", service: "service", rental: "rental" }[primary] || kind;
  const pool = POOLS[resolved] || POOLS.goods;

  const subject = pick(pool, `${item.id || ""}:${item.title || ""}`);
  return photoUrl(subject);
}

export default LIBRARY;
