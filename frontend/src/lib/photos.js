/**
 * THE PHOTOGRAPH LIBRARY.
 *
 * One place that knows which photograph stands for which kind of thing, so a
 * tailor looks like a tailor on the Home shelf, in the Regions grid and on a
 * category banner. Components ask for a *subject*, never a file path.
 *
 * Three rules, and they are the whole design:
 *
 * 1. **These are decorative.** Every one of these images sits behind or beside
 *    real text that already says what the thing is. So they carry `alt=""` and
 *    are hidden from assistive technology. A photograph that repeats the heading
 *    is noise to a screen reader; one that replaces the heading would be a bug.
 *
 * 2. **A missing photo is a designed state.** `photoFor()` returns `null` when
 *    there is no honest photograph for a subject, and the caller renders its
 *    category colour and Lucide icon instead (`lib/categoryArt`). Nothing
 *    pretends to have a picture it does not have.
 *
 * 3. **No subject is faked.** These are real Kenyan and East African scenes,
 *    credited in `public/photos/kenya/CREDITS.md`. They are atmosphere and
 *    category signal — not evidence that a specific listing was photographed.
 *    A card with a real `item.image` always wins over any of these.
 */

const BASE = "/photos/kenya";

/** Subject → file. Keys are what callers ask for; values are what exists. */
const LIBRARY = {
  // Goods: produce, kiosks, what is actually sold in a market.
  "goods-produce": "goods-produce.jpg",
  "goods-kiosk": "goods-kiosk.jpg",
  "goods-bananas": "goods-bananas.jpg",
  "goods-fruit": "goods-fruit-stall.jpg",
  "goods-tomatoes": "goods-tomatoes.jpg",

  // Services: people doing the work.
  "services-tailor": "services-tailor.jpg",
  "services-boda": "services-boda.jpg",
  "services-artisan": "services-artisan.jpg",

  // Events: gatherings.
  "events-gathering": "events-gathering.jpg",
  "events-dance": "events-dance.jpg",

  // Wide crops for banners and the hero.
  "banner-street": "banner-street.jpg",
  "banner-produce": "banner-produce.jpg",
  "banner-community": "banner-community.jpg",
  "hero-market": "hero-market.jpg",
};

export function photoUrl(subject) {
  const file = LIBRARY[subject];
  return file ? `${BASE}/${file}` : null;
}

/**
 * A stable-but-rotating pick, so a feed of five produce listings does not show
 * the same photograph five times.
 *
 * It is keyed on the item's own identity, which means the same listing keeps the
 * same picture between renders and page loads — churn would look like the data
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
  goods: ["goods-produce", "goods-kiosk", "goods-bananas", "goods-fruit", "goods-tomatoes"],
  service: ["services-tailor", "services-boda", "services-artisan"],
  rental: ["goods-kiosk", "services-artisan"],   // equipment and premises; no invented warehouse
  event: ["events-gathering", "events-dance"],
  person: ["services-artisan", "services-tailor", "services-boda"],
  community: ["events-gathering", "banner-community"],
  post: ["goods-kiosk", "banner-street"],
};

/**
 * The photograph for a piece of content, or `null`.
 *
 * `item.image` always wins: that is a real photograph of the actual thing, and
 * no library image can compete with it. Everything else is category atmosphere.
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
