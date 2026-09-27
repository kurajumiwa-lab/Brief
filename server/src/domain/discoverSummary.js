// ---------------------------------------------------------------------------
// DISCOVER SUMMARY — the tiles' counts and the one thing worth a big card.
//
// Why this exists: the layout it feeds was previously a mock. The old
// screens (preview/src/screens/DiscoverScreen.tsx) shipped a hardcoded
// INITIAL_DISCOVER_POSTS array — "Kilimani Weekend Creators Market… Over 40
// verified creative vendors", an Unsplash photo of somebody else's market, a
// phone number that belongs to no one and a Telegram handle nobody runs. It
// looked full because it was fiction, and it was never reachable from the
// production entry (main.jsx mounts AppShell, not that shell).
//
// So this module supplies the same SHAPE from rows only:
//   * a tile's number is a count of rows that exist, and a zero is printed as a
//     zero — an empty Marketplace is a true fact about a young network, not a
//     bug to paper over;
//   * the featured slot is chosen by a stated rule, applied in order, and the
//     card says which rule fired. Not "highest-value" (that would be a price
//     judgement we have no right to make) but:
//       1. the seller pinned it to the front of their counter,
//       2. otherwise the active listing with the most SETTLED orders,
//       3. otherwise the newest active listing,
//       4. otherwise a published event with counted registrations,
//       5. otherwise nothing — and the client shows an honest empty hero.
//   * there is no "verified" badge here, because Brief verifies identity for
//     payment/compliance rails and nothing about a market stall's vibe;
//   * no refresh timer is implied: the read is a snapshot, stamped with the
//     newest row time it actually saw.
// ---------------------------------------------------------------------------

import { store } from '../store.js';
import { listListings, canonicalMediaUrl } from './listing.js';
import { browseEvents } from './events.js';
import { flowSummary, routesFor, unmappedDemand } from './flows.js';
import { listCircles } from './circle.js';
import { listPublicSpaces } from './space.js';

const HOUR = 3600000;

/** A listing's own photo, resolved the way the media rail serves them. */
function mediaUrl(listing) {
  return canonicalMediaUrl((listing.media ?? [])[0] ?? listing.image ?? null);
}

/** A short, unambiguous date stamp for a card: "Sat 20 Sep", never a bare ISO. */
function shortDate(iso) {
  const ms = Date.parse(iso ?? '');
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${day} ${d.getUTCDate()} ${month}`;
}

function newestTimestamp(values) {
  let best = null;
  for (const v of values) {
    const ms = Date.parse(v ?? '');
    if (Number.isFinite(ms) && (best === null || ms > best)) best = ms;
  }
  return best === null ? null : new Date(best).toISOString();
}

export function discoverSummary({ viewerId = null, now = Date.now() } = {}) {
  const listings = listListings({ status: 'active', limit: 200 });

  // Only spaces the owner pinned AND that are still active here. A pin pointing
  // at an archived offer is not promoted by a stale preference.
  const pinnedIds = new Set();
  for (const space of store.filter('spaces', (s) => s.status === 'active' && Array.isArray(s.featured))) {
    for (const id of space.featured) pinnedIds.add(id);
  }

  const settledCount = (listingId) =>
    store.filter('orders', (o) => o.listingId === listingId && o.status === 'settled').length;

  const picked =
    listings.find((l) => pinnedIds.has(l.id))
      ?? [...listings]
        .map((l) => ({ l, n: settledCount(l.id) }))
        .sort((a, b) => b.n - a.n || (a.l.createdAt < b.l.createdAt ? 1 : -1))
        .find((x) => x.n > 0)?.l
      ?? listings[0]
      ?? null;

  const events = browseEvents({ limit: 100, sort: 'date', viewerId });

  // The feed itself: the same rows the tiles count, in the shape the old
  // Discover screen drew them. Contact is carried ONLY when the seller wrote
  // it on their own listing — never borrowed, never defaulted, never guessed.
  const feed = [
    ...listings.map((l) => {
      const orders = settledCount(l.id);
      return {
        kind: 'listing',
        id: l.id,
        title: l.title,
        description: l.description || null,
        priceLabel: l.price === 0 ? 'Free' : `${l.currency ?? 'KES'} ${Number(l.price).toLocaleString('en-KE')}`,
        dateLabel: null,
        location: l.locationName ?? l.vendor?.location ?? null,
        mediaUrl: mediaUrl(l),
        // The row's own timestamp. A card may say "listed 2h ago" because the
        // listing was written 2h ago; where there is no timestamp the card says
        // nothing at all rather than inventing "new".
        listedAt: l.createdAt ?? null,
        seller: l.vendor?.displayName ?? null,
        stock: l.quantityAvailable ?? null,
        orderable: l.orderable !== false,
        contact: l.vendor?.contactMethod ?? null,
        contactNote: l.vendor?.contactMethod
          ? 'The seller listed this contact themselves; Brief did not look it up or fill it in.'
          : null,
        flow: l.flow ?? null,
        origin: l.originName ?? null,
        originKind: l.originKind ?? null,
        destination: l.destinationName ?? null,
        destinationKind: l.destinationKind ?? null,
        unit: l.unitLabel ?? null,
        minOrder: l.minOrderQuantity ?? null,
        commodity: l.commodity ?? null,
        interest: { label: 'settled orders', count: orders },
        why: pinnedIds.has(l.id)
          ? 'pinned by the seller'
          : orders > 0
            ? `${orders} settled order${orders === 1 ? '' : 's'}`
            : 'newest live listing'
      };
    }),
    ...(events.events ?? []).map((e) => ({
      kind: 'event',
      id: e.slug,
      title: e.title,
      description: e.description || null,
      priceLabel: e.goalAmount != null ? 'Contribution pot' : (e.price === 0 ? 'Free' : `${e.currency ?? 'KES'} ${Number(e.price).toLocaleString('en-KE')}`),
      dateLabel: e.startsAt ? shortDate(e.startsAt) : null,
      location: e.location ?? null,
      mediaUrl: e.coverImageUrl ?? null,
      listedAt: e.publishedAt ?? e.startsAt ?? null,
      seller: e.hostName ?? null,
      recurrence: e.recurrence ?? null,
      stock: null,
      orderable: null,
      contact: null,
      contactNote: null,
      flow: null,
      origin: null,
      originKind: null,
      destination: null,
      destinationKind: null,
      unit: null,
      minOrder: null,
      commodity: null,
      // Decision 6: an event row carries no social proof and no prominence.
      // No registration count, no featured claim -- the only reason an event is
      // here is that it is happening soonest.
      interest: null,
      why: 'soonest date'
    }))
  ];
  const circles = listCircles(viewerId);
  const joinable = circles.filter((c) => c.canJoin).length;
  const openErrands = store.filter('errands', (e) => e.status === 'open').length;

  let featured = null;
  let featuredFrom = null;

  if (picked) {
    const orders = settledCount(picked.id);
    const byPin = pinnedIds.has(picked.id);
    featured = {
      kind: 'listing',
      id: picked.id,
      title: picked.title,
      description: picked.description ?? null,
      price: picked.price,
      currency: picked.currency ?? 'KES',
      type: picked.type ?? 'product',
      location: picked.locationName ?? picked.vendor?.location ?? null,
      mediaUrl: mediaUrl(picked),
      seller: picked.vendor?.displayName ?? null,
      stock: picked.quantityAvailable ?? null,
      interest: { label: 'settled orders', count: orders },
      // The rule is printed on the card, so "featured" is never a mystery or a
      // claim about quality.
      why: byPin
        ? 'pinned by the seller'
        : orders > 0
          ? `${orders} settled order${orders === 1 ? '' : 's'} — the most on the board`
          : 'the newest listing, nothing has settled yet'
    };
    featuredFrom = byPin ? 'seller-pin' : orders > 0 ? 'settled-orders' : 'newest';
  } else if ((events.events ?? []).length > 0) {
    // browseEvents already sorts startsAt ascending, so the soonest event is
    // the first row. Decision 6 removed the popularity sort that used to
    // promote "the busiest thing on" into this slot.
    const e = (events.events ?? [])[0];
    featured = {
      kind: 'event',
      id: e.slug,
      title: e.title,
      description: e.description ?? null,
      price: e.price,
      currency: e.currency ?? 'KES',
      location: e.location ?? null,
      startsAt: e.startsAt ?? null,
      mediaUrl: e.coverImageUrl ?? null,
      // No registrations count, no "busiest thing on", and no "N from your
      // circle" -- all three are social proof, which Decision 6 forbids.
      interest: null,
      why: 'the soonest event',
      group: null
    };
    featuredFrom = 'soonest';
  }

  const publicSpaces = listPublicSpaces(100);

  const tiles = [
    { key: 'marketplace', label: 'Marketplace', count: listings.length, unit: 'live offer' },
    { key: 'shops', label: 'Shops', count: publicSpaces.length, unit: 'public storefront' },
    { key: 'events', label: 'Events', count: (events.total ?? events.events?.length) ?? 0, unit: 'published' },
    { key: 'circles', label: 'Groups', count: joinable, unit: 'you could join' },
    { key: 'errands', label: 'Errands', count: openErrands, unit: 'open' }
  ];

  const board = flowSummary();

  return {
    // The flow board: four tiles, the routes sellers have declared, and the
    // open demand no declared route covers.
    tiles,
    // The board is the country's: there is no area filter, so a zero means
    // "nobody has declared this", never "nothing is happening near you".
    scope: board.scope,
    areaFiltered: board.areaFiltered,
    flows: board.flows,
    untagged: board.untagged,
    totals: board.totals,
    routes: routesFor(null, { limit: 24 }),
    unmapped: unmappedDemand({ limit: 8 }),
    boardNote: board.note,
    // Newest first (the feed was built from listings sorted on createdAt, then
    // the events sorted on their start date). There is deliberately no re-sort
    // here on ids or on any score: nothing on this board is ranked, and no
    // popularity could be computed anyway — a listing has no views, no saves
    // and no seller rating to divide by.
    feed,
    featured,
    featuredFrom,
    counts: {
      listings: listings.length,
      shops: publicSpaces.length,
      events: events.total ?? (events.events ?? []).length,
      circles: joinable,
      errands: openErrands
    },
    asOf: newestTimestamp([
      ...listings.map((l) => l.updatedAt ?? l.createdAt),
      ...(events.events ?? []).map((e) => e.publishedAt ?? e.startsAt),
      ...store.all('errands').map((e) => e.updatedAt ?? e.createdAt)
    ]),
    note:
      'Every number here is a count of rows, computed on read. A zero is shown as a zero: nothing is seeded, no "verified" badge is attached to a '
      + 'seller, and no popularity is implied without a registrations or orders row behind it. This is a snapshot with the newest row time stamped on it, '
      + 'not a live feed — there is no socket and none is claimed.'
  };
}
