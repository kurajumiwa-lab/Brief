/**
 * REGIONAL METRICS — counts that are true, or nothing at all.
 *
 * The region screen wants to say something useful about a region: how many
 * listings, how many businesses, how many offers, how many kinds of thing.
 * The temptation is to write a number that sounds right. This module exists so
 * that temptation has nowhere to go.
 *
 * Three rules, enforced here rather than in the component that renders them:
 *
 *   1. **A count is only ever a count of records we actually hold.** The feed
 *      is a ranked, cursor-paged page of at most twenty items. A number taken
 *      from it is a number *in the results loaded*, and every place that shows
 *      one says so.
 *   2. **Unknown is not zero.** A feed that has not loaded, or that failed, has
 *      no count at all. The screen shows a dash and says why. Showing "0
 *      listings" when the request failed is how a marketplace convinces a
 *      person that their town is empty.
 *   3. **Empty is zero, and it is said plainly.** When the request succeeded
 *      and returned nothing, zero is the truth, and it is the useful truth:
 *      that is what tells a person to widen the radius or publish the first
 *      listing.
 *
 * The provenance (`sample`) travels with the numbers so the renderer never has
 * to guess how to describe them.
 */

/** The feed has not produced a page yet, or is still fetching one. */
export const METRIC_UNKNOWN = "unknown";
/** The request failed. There is no count, and saying so is the honest answer. */
export const METRIC_UNAVAILABLE = "unavailable";
/** The request succeeded. These numbers describe the page that came back. */
export const METRIC_LOADED = "loaded";

/** The kinds that are somebody's offer: something to buy, book, hire or lend. */
const OFFER_KINDS = new Set(["listing", "available", "service", "rental"]);

/** A record is "active" unless it says otherwise. Drafts are not active. */
function isActive(item) {
  const status = String(item?.status || "").toLowerCase();
  if (!status) return true;
  return ["published", "active", "live", "approved", "available"].includes(status);
}

/** The category a record belongs to, however the feed spelled it. */
function categoryOf(item) {
  const raw =
    item?.meta?.primary_category ||
    item?.primary_category ||
    item?.category ||
    "";
  const text = String(raw).trim();
  if (!text) return null;
  return text.toLowerCase().replace(/[\s_-]+/g, " ");
}

/** The page behind a record — the business, page or profile behind it. */
function ownerKey(item) {
  const owner = item?.owner || {};
  const id = owner.id || owner.handle || item?.owner_id || item?.vendor_id;
  return id ? String(id) : null;
}

/**
 * Count what the loaded page actually contains.
 *
 * @param {Array}  items    the records the feed returned
 * @param {object} options  { status, failed }
 *   status  the feed status ("idle" | "loading" | "ready" | "error" | …)
 *   failed  true when the request failed
 * @returns {{state, listings, businesses, offers, categories, sample}}
 *   Every count is null when the state is not METRIC_LOADED.
 */
export function regionMetrics(items = [], { status = "idle", failed = false } = {}) {
  const empty = {
    state: METRIC_UNKNOWN,
    listings: null,
    businesses: null,
    offers: null,
    categories: null,
    sample: 0,
  };

  if (failed || status === "error") {
    return { ...empty, state: METRIC_UNAVAILABLE };
  }
  if (status !== "ready" && status !== "loading_more") {
    return empty;
  }

  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const active = list.filter(isActive);

  const owners = new Set();
  const categories = new Set();
  let listings = 0;
  let offers = 0;

  for (const item of active) {
    const kind = String(item?.kind || "");
    if (kind === "listing") listings += 1;
    if (OFFER_KINDS.has(kind)) offers += 1;
    const owner = ownerKey(item);
    if (owner) owners.add(owner);
    const category = categoryOf(item);
    if (category) categories.add(category);
  }

  return {
    state: METRIC_LOADED,
    listings,
    businesses: owners.size,
    offers,
    categories: categories.size,
    sample: list.length,
  };
}

/**
 * How a count is written when it is not known.
 *
 * A dash is not "zero" and never is: it means the number is not on the screen
 * because the screen does not have it.
 */
export function metricValue(value) {
  return value == null ? "—" : String(value);
}

/**
 * The sentence that says where the numbers came from.
 *
 * `sample` is the number of records behind them. Without it a count would
 * read as a regional total, which it is not.
 */
export function metricProvenance(metrics, { regionLabel = "this region" } = {}) {
  if (!metrics || metrics.state === METRIC_UNAVAILABLE) {
    return "Live counts are unavailable — the results did not load.";
  }
  if (metrics.state === METRIC_UNKNOWN) {
    return "Live counts appear once the results below load.";
  }
  if (!metrics.sample) {
    return `No active records came back for ${regionLabel}.`;
  }
  const noun = metrics.sample === 1 ? "result" : "results";
  return `From the ${metrics.sample} ${noun} loaded for ${regionLabel}.`;
}

/**
 * The counts for the category cards.
 *
 * A card shows how many of the loaded records are its kind. `null` means the
 * card must show nothing at all rather than a zero.
 */
export function categoryCounts(items = []) {
  const list = Array.isArray(items) ? items.filter(isActive) : [];
  const counts = { all: list.length };
  for (const item of list) {
    const kind = String(item?.kind || "");
    const primary = item?.meta?.primary_category || "";
    if (kind === "listing" || primary === "goods") counts.goods = (counts.goods || 0) + 1;
    if (kind === "service" || kind === "provider" || primary === "service") {
      counts.services = (counts.services || 0) + 1;
    }
    if (kind === "rental" || primary === "rental") counts.rentals = (counts.rentals || 0) + 1;
    if (kind === "event" || kind === "scheduled") counts.rounds = (counts.rounds || 0) + 1;
    if (item?.feed_kind === "SPOTTED_DEAL") counts.spotted = (counts.spotted || 0) + 1;
  }
  return counts;
}
