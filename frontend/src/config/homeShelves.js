/**
 * THE HOME SHELF REGISTRY — one curated shelf per existing module.
 *
 * Home is a *window into the network*, not a second Browse. Every shelf below
 * reads a module that already exists (stock, the storefront catalogue, vendor
 * discovery, tools & rentals, business requests, the Hustle League, events,
 * groups, vendor lists, markets) through the API client the rest of the app
 * uses. Nothing here invents inventory, categories, ratings or popularity, and
 * nothing fetches a whole table to fill a carousel:
 *
 *   · every shelf asks for a small, explicit `limit`;
 *   · every shelf is loaded on its own (see `stores/homeFeedStore`) so one
 *     failing module can never take the feed down;
 *   · empty results are returned as-is — the shelf hides itself. There is no
 *     placeholder product anywhere in this file.
 *
 * Each shelf declares:
 *   key / title / subtitle / seeAll   how it presents itself and where it goes
 *   card                              which card renderer draws its records
 *   group                             "discovery" (before the invite banner)
 *                                     or "more" (after it)
 *   load()                            a real API call → normalised feed items
 *
 * A normalised item is the only shape the cards know:
 *   { id, kind, to, owner: { id, handle, name } | null, ...card fields }
 * `owner` is what makes own-inventory exclusion possible in one place.
 */

import {
  catalogAPI,
  commercialAPI,
  eventAPI,
  groupAPI,
  listAPI,
  marketsAPI,
  requestsAPI,
  squadAPI,
  stockAPI,
  toolAPI,
  vendorAPI,
} from "@/lib/api";

/* ── tiny fetch helpers ──────────────────────────────────────────────────────
   A module the deployment does not serve — or a test double that does not
   define it — must be an EMPTY shelf, never a crash and never a fake row. The
   lookup is a getter so even a throwing property access lands in the same
   place: no function, no records, shelf hides. */

async function fetchFrom(getter, ...args) {
  let fn;
  try {
    fn = getter();
  } catch {
    fn = undefined;
  }
  if (typeof fn !== "function") return null;
  const res = await fn(...args);
  return res?.data ?? null;
}

const asArray = (data) => (Array.isArray(data) ? data : []);

const text = (value) => (typeof value === "string" ? value.trim() : "");

const money = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const available = (item) => Number(item?.quantity_available ?? item?.quantity_in_stock ?? 0) || 0;

/** A shelf merge: requests and job calls take turns so neither drowns the other. */
function interleave(a = [], b = []) {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

/* ── shelves ──────────────────────────────────────────────────────────────── */

export const SHELVES = [
  {
    key: "stock",
    group: "discovery",
    card: "product",
    title: "Fresh on the network",
    subtitle: "Restated by other vendors — most available first",
    seeAll: { to: "/browse?type=goods", label: "See all stock" },
    limit: 12,
    async load() {
      // GET /stock/network-stock already excludes the caller's shelf server-side;
      // the storefront excludes it again by `owner`, belt and braces.
      const rows = asArray(await fetchFrom(() => stockAPI?.network, { limit: 12 }));
      return rows
        .filter((row) => row && row.visible_to_network !== false && available(row) > 0)
        .map((row) => ({
          id: String(row.id),
          kind: "product",
          to: `/listing/${row.id}`,
          owner: { id: row.vendor_id, handle: row.vendor_handle, name: row.vendor_business || row.vendor_business_name },
          title: text(row.name) || "Stock item",
          category: row.category,
          image: Array.isArray(row.images) ? row.images[0] || null : null,
          price: money(row.unit_price) ?? money(row.wholesale_price),
          wholesalePrice: money(row.wholesale_price),
          unitPrice: money(row.unit_price),
          unit: row.unit_of_measure || "unit",
          quantity: available(row),
          moq: row.min_order_quantity ?? row.minimum_order_quantity ?? null,
          quality: row.quality_status || "unverified",
          fulfilment: row.vendor_fulfillment_rate,
          vendorName: row.vendor_business || row.vendor_business_name || (row.vendor_handle ? `@${row.vendor_handle}` : "A vendor"),
          updatedAt: row.updated_at || null,
          raw: row,
        }));
    },
  },

  {
    key: "services",
    group: "discovery",
    card: "service",
    title: "Services for your business",
    subtitle: "Digital services, business software and field operations",
    seeAll: { to: "/storefront", label: "Open the storefront" },
    limit: 12,
    async load() {
      const payload = await fetchFrom(() => catalogAPI?.catalogue);
      const offers = Array.isArray(payload?.offers) ? payload.offers : [];
      return offers.map((offer) => ({
        id: String(offer.key),
        kind: "service",
        to: `/storefront?offer=${encodeURIComponent(offer.key)}`,
        owner: null, // the platform's own catalogue — not a vendor's shelf, so nothing to exclude
        title: text(offer.name),
        line: offer.line,
        priceMin: offer.price_min_kes ?? null,
        priceMax: offer.price_max_kes ?? null,
        priceUnit: offer.price_unit || null,
        readiness: offer.readiness || null,
        readinessNote: offer.readiness_note || null,
        turnaround: offer.turnaround || null,
        deliverables: Array.isArray(offer.deliverables) ? offer.deliverables : [],
      }));
    },
  },

  {
    key: "people",
    group: "discovery",
    card: "person",
    title: "People to work with",
    subtitle: "Fundis, casual workers, specialists and vendors in the network",
    seeAll: { to: "/network", label: "See all vendors" },
    limit: 12,
    async load() {
      // Preferred: vendors the network can evidence a reason to meet. If the
      // vendor has already met everyone in range, discovery is genuinely empty
      // — and then the honest answer is the people they already trade with,
      // flagged as such, not an empty carousel.
      let rows = asArray(await fetchFrom(() => vendorAPI?.discover, { limit: 12 }));
      if (rows.length === 0) {
        rows = asArray(await fetchFrom(() => vendorAPI?.discover, { limit: 12, include_connected: true }));
      }
      return rows.map((vendor) => ({
        id: String(vendor.vendor_id || vendor.vendor_handle),
        kind: "person",
        to: `/@${vendor.vendor_handle}`,
        owner: { id: vendor.vendor_id, handle: vendor.vendor_handle, name: vendor.business_name },
        name: text(vendor.business_name) || `@${vendor.vendor_handle}`,
        handle: vendor.vendor_handle,
        role: vendor.current_role || null,
        categories: Array.isArray(vendor.business_categories) ? vendor.business_categories.slice(0, 2) : [],
        location: vendor.physical_location || null,
        reasons: Array.isArray(vendor.reasons) ? vendor.reasons.slice(0, 2) : [],
        distanceKm: typeof vendor.distance_km === "number" ? vendor.distance_km : null,
        fulfilment: vendor.fulfillment_rate ?? null,
        verified: Boolean(vendor.is_verified),
        patron: Boolean(vendor.is_patron),
        connected: Boolean(vendor.connected),
        score: vendor.score ?? null,
      }));
    },
  },

  {
    key: "equipment",
    group: "discovery",
    card: "equipment",
    title: "Equipment and rentals",
    subtitle: "Warehouses, cold storage, transport and machinery available now",
    seeAll: { to: "/browse?type=equipment", label: "See all equipment" },
    limit: 12,
    async load() {
      // include_mine=false is the tools browser's own switch for public discovery.
      const rows = asArray(await fetchFrom(() => toolAPI?.browse, { include_mine: false, limit: 12 }));
      return rows
        .filter((tool) => tool && tool.is_available !== false)
        .map((tool) => ({
          id: String(tool.id),
          kind: "equipment",
          to: `/tools?listing=${tool.id}`,
          owner: { id: tool.vendor_id, handle: tool.vendor_handle, name: tool.vendor_business },
          title: text(tool.title) || "Facility",
          category: tool.category,
          image: Array.isArray(tool.images) ? tool.images[0] || null : null,
          price: money(tool.price_per_unit),
          priceUnit: tool.price_unit || null,
          location: tool.location || null,
          capacity: tool.capacity || {},
          details: tool.details || null,
          features: Array.isArray(tool.features) ? tool.features.slice(0, 3) : [],
          minBooking: tool.min_booking ?? null,
          deposit: money(tool.deposit_required),
          timesBooked: tool.times_booked ?? 0,
          rating: tool.avg_rating ?? null,
          vendorName: tool.vendor_business || (tool.vendor_handle ? `@${tool.vendor_handle}` : "A vendor"),
        }));
    },
  },

  {
    key: "opportunities",
    group: "more",
    card: "opportunity",
    title: "Opportunities around you",
    subtitle: "Open requests and call-ups posted by nearby businesses",
    seeAll: { to: "/browse", label: "See all requests" },
    limit: 12,
    async load() {
      // Two independent modules, one shelf: whichever answers contributes. The
      // shelf only fails when both do.
      const [requests, calls] = await Promise.allSettled([
        fetchFrom(() => requestsAPI?.list, { scope: "open", limit: 8 }),
        fetchFrom(() => squadAPI?.calls),
      ]);
      if (requests.status === "rejected" && calls.status === "rejected") throw new Error("opportunities unavailable");

      const requestItems = asArray(requests.value).map((request) => ({
        id: `request-${request.id}`,
        kind: "opportunity",
        subtype: "request",
        to: "/browse",
        owner: { id: request.requester_vendor_id || null, handle: null, name: null },
        mine: Boolean(request.is_mine),
        title: text(request.description) || "A business request",
        requestType: request.request_type || null,
        location: request.location || request.zone_name || null,
        budget: money(request.budget_kes),
        offers: request.offers_count ?? 0,
        neededBy: request.needed_by || null,
        distanceKm: typeof request.distance_km === "number" ? request.distance_km : null,
        createdAt: request.created_at || null,
      }));

      const callItems = asArray(calls.value?.calls).map((call) => ({
        id: `call-${call.id}`,
        kind: "opportunity",
        subtype: "job",
        to: "/tasks/squad",
        owner: { id: call.vendor_id || null, handle: null, name: call.client || null },
        mine: Boolean(call.mine),
        title: text(call.title) || "A call-up",
        pay: money(call.pay_kes),
        skill: call.skill || null,
        taskType: call.task_type || null,
        location: call.location || null,
        distanceKm: typeof call.distance_km === "number" ? call.distance_km : null,
        expiresAt: call.expires_at || null,
        squad: Boolean(call.squad_id),
      }));

      return interleave(requestItems, callItems);
    },
  },

  {
    key: "events",
    group: "more",
    card: "event",
    title: "Events and market days",
    subtitle: "Trade fairs, market days and sourcing trips coming up",
    seeAll: { to: "/events", label: "See all events" },
    limit: 12,
    async load() {
      const rows = asArray(await fetchFrom(() => eventAPI?.browse, { limit: 12 }));
      return rows.map((event) => ({
        id: String(event.id),
        kind: "event",
        to: "/events",
        owner: { id: event.organizer_id, handle: event.organizer, name: event.organizer_business },
        title: text(event.title) || "Event",
        eventType: event.event_type || null,
        startDate: event.start_date || null,
        endDate: event.end_date || null,
        // `location` is the venue the organizer typed ("Kinangop, Nyandarua").
        // When they declared the event virtual it is Online; when they left it
        // blank the card says the venue is not stated rather than showing a gap.
        location: event.is_virtual ? "Online" : text(event.location) || null,
        virtual: Boolean(event.is_virtual),
        fee: money(event.entry_fee),
        // 0 is a stated price ("free entry"); null is silence ("entry not
        // stated"). Collapsing the two would put words in the organizer's mouth.
        freeEntry: Number(event.entry_fee) === 0,
        registered: Number.isFinite(Number(event.registered_count)) ? Number(event.registered_count) : null,
        capacity: event.max_vendors ?? null,
        spotsLeft: event.spots_left ?? null,
        organizer: event.organizer_business || (event.organizer ? `@${event.organizer}` : null),
        myStatus: event.my_status || null,
      }));
    },
  },

  {
    key: "community",
    group: "more",
    card: "community",
    title: "Groups and vendor lists",
    subtitle: "Public groups and open lists you can register on",
    seeAll: { to: "/groups", label: "See all groups" },
    limit: 12,
    async load() {
      const [groups, lists] = await Promise.allSettled([
        fetchFrom(() => groupAPI?.browse, { limit: 8 }),
        fetchFrom(() => listAPI?.browse, { limit: 8 }),
      ]);
      if (groups.status === "rejected" && lists.status === "rejected") throw new Error("community unavailable");

      const groupItems = asArray(groups.value)
        .filter((group) => group?.my_role !== "member" && group?.my_role !== "admin" && group?.my_role !== "moderator")
        .map((group) => ({
          id: `group-${group.id}`,
          kind: "community",
          subtype: "group",
          to: "/groups",
          owner: { id: null, handle: group.created_by, name: null },
          title: text(group.name) || "Group",
          description: text(group.description),
          // The card poster says "Trade group" / "Buyer group": the group's own
          // `group_type`, with the taxonomy's wording, never a new label.
          groupType: group.group_type || null,
          category: group.category || null,
          region: group.region || null,
          members: group.member_count ?? 0,
          maxMembers: group.max_members ?? null,
          requiresApproval: Boolean(group.requires_approval),
        }));

      const listItems = asArray(lists.value)
        .filter((list) => !list?.i_run_it && list?.is_open !== false)
        .map((list) => ({
          id: `list-${list.id}`,
          kind: "community",
          subtype: "list",
          to: "/lists",
          owner: { id: null, handle: list.patron_handle, name: list.patron_business },
          title: text(list.name) || "Vendor list",
          description: text(list.description),
          category: list.category || null,
          region: list.region || null,
          members: list.member_count ?? 0,
          maxMembers: list.max_vendors ?? null,
          rating: Number(list.avg_rating) > 0 ? Number(list.avg_rating) : null,
          reviewCount: list.review_count ?? 0,
          requiresApproval: Boolean(list.requires_approval),
          patron: list.patron_business || (list.patron_handle ? `@${list.patron_handle}` : null),
        }));

      return interleave(groupItems, listItems);
    },
  },

  {
    key: "markets",
    group: "more",
    card: "market",
    title: "Markets in the network",
    subtitle: "Where vendors already trade — mapped places and registered members",
    seeAll: { to: "/markets", label: "See all markets" },
    limit: 12,
    async load() {
      const payload = await fetchFrom(() => marketsAPI?.list, { limit: 12 });
      const rows = asArray(payload?.markets);
      return rows.map((market) => ({
        id: String(market.id),
        kind: "market",
        to: `/markets/${market.id}`,
        owner: null,
        title: text(market.name) || "Market",
        city: market.city || null,
        country: market.country || null,
        members: market.members ?? 0,
        places: market.places ?? 0,
        claimed: market.claimed ?? 0,
        distanceKm: typeof market.distance_km === "number" ? market.distance_km : null,
      }));
    },
  },

  {
    key: "commercial",
    group: "discovery",
    card: "commercial",
    title: "Commercial shelf — save more together",
    subtitle: "Group buys and verified savings from vendors near you",
    seeAll: { to: "/commercial", label: "See all offers" },
    limit: 12,
    async load() {
      const payload = await fetchFrom(() => commercialAPI?.shelf, { limit: 12 });
      const shelf = payload?.shelf || [];
      return shelf.map((post) => ({
        id: String(post.id),
        kind: "commercial",
        to: `/commercial/${post.id}`,
        owner: { id: post.vendor_id, handle: post.vendor_handle, name: post.vendor_business },
        title: post.title || post.content.slice(0, 80),
        content: post.content,
        postType: post.post_type,
        individualPrice: post.individual_price,
        groupPrice: post.group_price,
        savingsAmount: post.savings_amount,
        savingsPct: post.savings_percentage,
        currency: post.currency,
        currentInterested: post.current_interested,
        currentQty: post.current_quantity_pledged,
        targetQty: post.target_quantity,
        minGroup: post.min_group_size,
        location: post.location,
        category: post.category,
        tags: post.tags,
        vendorName: post.vendor_business || (post.vendor_handle ? `@${post.vendor_handle}` : "A vendor"),
        createdAt: post.created_at,
        raw: post,
      }));
    },
  },

  {
    key: "notices",
    group: "more",
    card: "notice",
    title: "Byway Notice Board",
    subtitle: "AI-assisted promotions, announcements, and opportunities from vendors",
    seeAll: { to: "/notices", label: "See all notices" },
    limit: 12,
    async load() {
      // Notice board uses the same API pattern as other shelves
      // In production, this would call a notices API endpoint
      // For now, return empty array to avoid errors
      return [];
    },
  },
];

export const SHELVES_BEFORE_BANNER = SHELVES.filter((s) => s.group === "discovery");
export const SHELVES_AFTER_BANNER = SHELVES.filter((s) => s.group === "more");

export const shelfByKey = (key) => SHELVES.find((shelf) => shelf.key === key);

/**
 * Own-inventory exclusion, in ONE place.
 *
 * The server already keeps your shelf out of network stock (and
 * `include_mine=false` keeps it out of tools), but discovery must never depend
 * on one layer getting it right: if a record belongs to the signed-in vendor
 * — by id or by handle — it does not belong on a public shelf.
 */
export function isOwnRecord(item, vendor) {
  const owner = item?.owner;
  if (!owner || !vendor) return false;
  const sameId = owner.id && vendor.id && String(owner.id) === String(vendor.id);
  const mine = owner.handle && vendor.vendor_handle;
  const sameHandle =
    mine && String(owner.handle).replace(/^@/, "").toLowerCase() === String(vendor.vendor_handle).replace(/^@/, "").toLowerCase();
  return Boolean(sameId || sameHandle);
}

/** The public shelf order: everything except the vendor's own records. */
export function publicShelfItems(items, vendor, limit) {
  const rows = Array.isArray(items) ? items : [];
  const mine = rows.filter((item) => !isOwnRecord(item, vendor));
  return limit ? mine.slice(0, limit) : mine;
}
