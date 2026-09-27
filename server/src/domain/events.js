// ---------------------------------------------------------------------------
// EVENTS HUB (Tikiti T4)
//
// One honest browsing surface over the events that actually exist: published
// campaigns (with their types as categories) + calendar entries. It creates
// NO second event table -- a category is a campaign type. Filters that match
// nothing return nothing, with counts the caller can trust.
//
// DECISION 6 (docs/DECISIONS.md) scopes this surface hard, and the scoping is
// enforced by server/test/decisions.mjs:
//   * NO featured events, NO promoted events, NO featured slot. There is no
//     `setFeatured` here and no featured filter; prominence is neither the
//     organiser's to claim nor the platform's to sell.
//   * NO social proof. No "X going", no attendee names, no registration count,
//     no view count. The only number an event surface may print is seats:
//     "27 of 40 seats remaining."
//   * Sorting is `startsAt` ascending. Period -- there is no other order.
// The rationale is the operator's: these mechanics drive FOMO, and FOMO does
// not pay the host.
//
// T4 detail model: the rich detail screen needs context that is DERIVED, never
// stored -- a host's other events, related events, and series occurrences are
// all scanned from real campaign rows on read. There is no `host` table, no
// `series` table, no `eventContext` cache. See `relatedEvents`,
// `hostEvents` and `seriesOccurrences` below.
// ---------------------------------------------------------------------------

import { store } from '../store.js';

export const EVENT_CATEGORIES = ['popup', 'session', 'drop', 'event', 'contribution'];

export const CATEGORY_LABELS = {
  popup: 'Popups & markets',
  session: 'Sessions & classes',
  drop: 'Drops',
  event: 'Events',
  contribution: 'Causes & pots'
};

/**
 * NATURAL EXPIRY — a dated event that has passed ends itself on the calendar,
 * not on someone remembering to close it. Derived from endsAt, never a stored
 * "expired" flag that could drift:
 *   - endsAt passed → ended (the owner stated the end);
 *   - no endsAt, startsAt more than a day old → ended (the day is over);
 *   - neither date, published over a week ago → ended (unstaged listings
 *     do not sit on "what's on" forever; the host re-posts a fresh row).
 * Windows are stated here and in the product — never silent.
 */
export function hasEnded(campaign) {
  const now = Date.now();
  const rec = campaign.metadata?.recurrence ?? campaign.recurrence;
  if (rec && rec.frequency && rec.frequency !== 'none') {
    if (rec.until && Date.parse(rec.until) <= now) return true;
    return false;
  }
  if (campaign.endsAt && Date.parse(campaign.endsAt) <= now) return true;
  const started = campaign.startsAt ? Date.parse(campaign.startsAt) : NaN;
  if (Number.isFinite(started) && started <= now - 24 * 3600 * 1000) return true;
  const born = campaign.createdAt ? Date.parse(campaign.createdAt) : NaN;
  if (!campaign.startsAt && !campaign.endsAt && Number.isFinite(born) && born <= now - 7 * 24 * 3600 * 1000)
    return true;
  return false;
}

// ---------------------------------------------------------------------------
// NO CIRCLE OVERLAP (Decision 6)
//
// This module used to derive "3 from your Circle going" by scanning the
// viewer's own table-banking groups against an event's registrations. The rows
// were real and the count was honest -- and it is still social proof, which is
// what Decision 6 forbids: "No 'X going.' No attendee names." The decision's
// supersession note settles it explicitly, so this is not an open judgement
// call: "'no attendee names' also ends the record's sparing of the per-viewer
// circle overlap."
//
// What an event may still say about itself: when it starts, where it is, what
// it costs, and how many seats are left.
// ---------------------------------------------------------------------------

/**
 * The public listing identity of a campaign. This is the ONE shape a feed
 * card, a related-events rail and a host rail all share -- the internal id
 * never appears. It carries no featured flag, no registration count and no
 * circle overlap: Decision 6 allows an event to state when, where, how much,
 * and how many seats are left -- nothing that pressures a reader.
 */
export function listingView(campaign) {
  return {
    slug: campaign.publicSlug,
    title: campaign.title,
    description: campaign.description ?? null,
    // A cover image is surfaced only when it actually exists; the client
    // derives a deterministic gradient fallback, never renders an empty box.
    coverImageUrl: campaign.metadata?.image ?? null,
    category: campaign.type,
    categoryLabel: CATEGORY_LABELS[campaign.type] ?? campaign.type,
    location: campaign.location ?? null,
    startsAt: campaign.startsAt ?? null,
    endsAt: campaign.endsAt ?? null,
    price: campaign.price,
    currency: campaign.currency,
    goalAmount: campaign.goalAmount ?? null,
    // The row's own timestamp, so a surface can honestly say "published 2d ago"
    // instead of implying realtime it does not have.
    publishedAt: campaign.createdAt ?? null,
    // The organiser, by the name on their own account — allowed explicitly by
    // the operator. Attribution, not social proof: no counts, no ranks, and a
    // missing owner row yields null (the line hides) rather than a stand-in.
    hostName: campaign.ownerId
      ? (store.find('users', (x) => x.id === campaign.ownerId)?.displayName ??
        store.find('users', (x) => x.id === campaign.ownerId)?.handle ??
        null)
      : null,
    recurrence: campaign.metadata?.recurrence ?? (campaign.recurrence ?? null)
    // No `popularity`, no `featured`, no `tableBankingOverlap` -- Decision 6.
  };
}

/**
 * Browse events. Filters: category (campaign type), location (substring,
 * case-insensitive), from/to (date window on startsAt).
 *
 * Sort: `startsAt` ascending. There is no other option. `sort` and `featured`
 * are deliberately NOT parameters -- a caller that passes them is ignored
 * rather than served a different order, which is what Decision 6 means by
 * "Sorting is startsAt ascending. Period." `viewerId` went with the circle
 * overlap it existed to resolve.
 */
export function browseEvents({
  category = null,
  location = null,
  from = null,
  to = null,
  limit = 50
} = {}) {
  if (category != null && !EVENT_CATEGORIES.includes(category)) {
    throw new Error(`category must be one of ${EVENT_CATEGORIES.join(', ')}`);
  }
  let rows = store.filter('campaigns', (c) => c.status === 'published' || c.status === 'live');

  if (category != null) rows = rows.filter((c) => c.type === category);
  if (location != null) {
    const needle = String(location).trim().toLowerCase();
    rows = rows.filter((c) => String(c.location ?? '').toLowerCase().includes(needle));
  }
  if (from != null) {
    const t = Date.parse(from);
    if (Number.isFinite(t)) rows = rows.filter((c) => !c.startsAt || Date.parse(c.startsAt) >= t);
  }
  if (to != null) {
    const t = Date.parse(to);
    if (Number.isFinite(t)) rows = rows.filter((c) => !c.startsAt || Date.parse(c.startsAt) <= t);
  }
  // Natural expiry: a dated event whose endsAt has passed no longer belongs in
  // "what's on". It stays resolvable by its slug; it just stops being advertised.
  rows = rows.filter((c) => !hasEnded(c));

  const views = rows.map((c) => listingView(c));

  // The only order this surface has. Undated events sort last rather than
  // floating to the top of "what's on".
  views.sort((a, b) => String(a.startsAt ?? '9999').localeCompare(String(b.startsAt ?? '9999')));

  return { events: views.slice(0, Math.min(limit, 100)), total: views.length };
}

/**
 * RELATED EVENTS — derived, never seeded. A related event is one that shares
 * the event's category, or shares its exact location, and is itself public.
 * Empty when there genuinely are none.
 */
export function relatedEvents(campaign, limit = 6) {
  if (!campaign) return [];
  const same = (c) =>
    (c.status === 'published' || c.status === 'live') &&
    c.id !== campaign.id &&
    !hasEnded(c) &&
    (c.type === campaign.type || (campaign.location != null && c.location === campaign.location));
  return store.filter('campaigns', same)
    .sort((a, b) => String(a.startsAt ?? '9999').localeCompare(String(b.startsAt ?? '9999')))
    .slice(0, limit)
    .map(listingView);
}

/**
 * MORE FROM THIS HOST — the organiser's other events (past and upcoming),
 * scanned from real campaign rows. Never includes the event itself, never a
 * fabricated host. Most recent first.
 */
export function hostEvents(ownerId, excludeId, limit = 6) {
  if (!ownerId) return [];
  return store.filter('campaigns', (c) =>
    c.ownerId === ownerId &&
    c.id !== excludeId &&
    ['published', 'live', 'closed', 'completed'].includes(c.status)
  )
    .sort((a, b) => String(b.startsAt ?? '').localeCompare(String(a.startsAt ?? '')))
    .slice(0, limit)
    .map(listingView);
}

/**
 * SERIES OCCURRENCES — the other instalments of a recurring series. Derived
 * from the `seriesId` an organiser sets; empty (honestly) until a series is
 * actually in use.
 */
export function seriesOccurrences(seriesId, excludeId, limit = 12) {
  if (!seriesId) return [];
  return store.filter('campaigns', (c) =>
    c.seriesId === seriesId &&
    c.id !== excludeId &&
    ['published', 'live', 'closed', 'completed'].includes(c.status) &&
    !hasEnded(c)
  )
    .sort((a, b) => String(a.startsAt ?? '').localeCompare(String(b.startsAt ?? '')))
    .slice(0, limit)
    .map(listingView);
}

// ---------------------------------------------------------------------------
// NO setFeatured (Decision 6)
//
// This module used to export `setFeatured(ownerId, campaignId, featured)` --
// "the organiser's explicit choice; never derived, never seeded". The Events
// record allowed it and banned only platform-sold slots. The operator decided
// stronger, and the supersession note in docs/DECISIONS.md says so plainly:
// "no featured slot anywhere." So there is nothing to set and nothing to
// unset, and server/test/decisions.mjs fails if this export comes back.
// ---------------------------------------------------------------------------
