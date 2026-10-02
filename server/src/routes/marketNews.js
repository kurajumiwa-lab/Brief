// ---------------------------------------------------------------------------
// MARKET NEWS + SHOP HOME — information, not commentary.
//
// Both routes derive everything from rows that already exist. Nothing here is
// authored, seeded or "aggregated" from a feed:
//
//   /api/market-news?days=7   short report lines built from real rows that
//                             were created or updated inside the window:
//                             active listings (new + re-listed), public
//                             shopfronts, group orders, published events.
//                             Each item carries its source, location and the
//                             row's own timestamp — the way a trader checks
//                             whether a note on the board is still fresh.
//
//   /api/shop-home            the counts behind the home shelf tiles and the
//                             "new today" band. Every number is a count of
//                             real rows; a tile with nothing underneath gets
//                             zero, and the shelf renders that as "—".
//
// No headline is invented. A price is only ever stated as "listed KES x"
// (what the row says right now), never as "price rose", because a listing is
// a single price point, not a time series — the same rule priceSignals
// refuses to break.
// ---------------------------------------------------------------------------

import { store } from '../store.js';
import { priceSignals } from '../domain/priceSignals.js';
import { formatAnswer } from '../domain/spaceProfile.js';

const DAY = 86_400_000;

const within = (iso, ms) => {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && Date.now() - t <= ms;
};

const spaceLocation = (space) => {
  if (!space) return null;
  const answer = formatAnswer('operatingFrom', space.profile?.fields?.operatingFrom?.value) ?? null;
  return typeof answer === 'string' && answer.trim() ? answer.trim() : null;
};

/** The news lines, newest first, capped. Derived on every call. */
export function newsItems(windowMs) {
  const items = [];

  // Active listings created or touched inside the window. Drafts are invisible
  // to buyers, so they are not news either.
  for (const l of store.filter('listings', (x) => x.status === 'active')) {
    if (!within(l.createdAt, windowMs) && !within(l.updatedAt, windowMs)) continue;
    const space = l.spaceId ? store.find('spaces', (s) => s.id === l.spaceId) : null;
    const isNew = within(l.createdAt, windowMs);
    items.push({
      id: `listing-${l.id}`,
      kind: isNew ? 'listing' : 'price',
      headline: isNew
        ? `New: ${l.title}`
        : `${l.title} — listed ${l.currency ?? 'KES'} ${Number(l.price).toLocaleString('en-KE')}`,
      source: space ? space.name : 'Listed prices',
      location: l.locationName ?? spaceLocation(space),
      date: isNew ? l.createdAt : l.updatedAt,
      price: Number.isFinite(l.price) ? l.price : null,
      currency: l.currency ?? 'KES',
      link: space?.slug ? { type: 'space', slug: space.slug } : null
    });
  }

  // Public shopfronts opened inside the window.
  for (const s of store.filter('spaces', (x) =>
    x.visibility === 'public' && x.status === 'active' && within(x.createdAt, windowMs))) {
    items.push({
      id: `space-${s.id}`,
      kind: 'shop',
      headline: `New shop: ${s.name}`,
      source: 'The directory',
      location: spaceLocation(s),
      date: s.createdAt,
      price: null,
      currency: 'KES',
      link: s.slug ? { type: 'space', slug: s.slug } : null
    });
  }

  // Group orders opened inside the window — unfinished business, the kind the
  // product exists to surface.
  for (const g of store.filter('groupBuys', (x) => within(x.createdAt, windowMs))) {
    items.push({
      id: `buy-${g.id}`,
      kind: 'group',
      headline: `Group order: ${g.title}`,
      source: 'Group orders',
      location: null,
      date: g.createdAt,
      price: Number.isFinite(g.targetAmount) ? g.targetAmount : null,
      currency: 'KES',
      link: null
    });
  }

  // Published events inside the window.
  for (const c of store.filter('campaigns', (x) => x.status === 'published' && within(x.createdAt, windowMs))) {
    items.push({
      id: `event-${c.id}`,
      kind: 'event',
      headline: `Event: ${c.title}`,
      source: 'Events',
      location: typeof c.location === 'string' && c.location.trim() ? c.location.trim() : null,
      date: c.createdAt,
      price: null,
      currency: 'KES',
      link: c.slug ? { type: 'event', slug: c.slug } : null
    });
  }

  return items
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 30);
}

export function register(app) {
  // The news lines, with the price snapshot riding along so a section can
  // show "what is listed right now" without a second round trip.
  app.get('/api/market-news', (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
    res.json({
      items: newsItems(days * DAY),
      windowDays: days,
      signals: priceSignals().signals
    });
  });

  // The home shelf's numbers. One pass per table, counts only.
  app.get('/api/shop-home', (_req, res) => {
    const active = store.filter('listings', (l) => l.status === 'active');
    const vendors = store.filter('vendors', (v) =>
      !v.enterprise || (v.enterprise.publication === 'public' && v.enterprise.operatingStatus === 'active'));

    res.json({
      newToday: active.filter((l) => within(l.createdAt, DAY)).length,
      tiles: {
        news: newsItems(7 * DAY).length,
        // Suppliers that actually have something listed — a registered name
        // with zero stock is not an answer to "who has it?".
        suppliers: vendors.filter((v) => active.some((l) => l.vendorId === v.id)).length,
        stock: active.filter((l) => l.type === 'product').length,
        shops: store.filter('spaces', (s) => s.visibility === 'public' && s.status === 'active').length,
        groups: store.filter('circles', () => true).length,
        // Open work: a request waiting on a worker, or mid-match.
        brief: store.filter('requests', (r) => r.status === 'open' || r.status === 'matching').length
      }
    });
  });
}
