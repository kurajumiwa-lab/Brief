// Reviews are opinions, not economic events. Counts, badges and recommendations
// are derived from visible review rows and authoritative commerce records.
import { store, newId } from '../store.js';
import { hasCapability } from '../identity.js';
import { recordAudit } from '../routes/helpers.js';
import * as uploads from './upload.js';

const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const text = (value, max) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
const now = () => new Date().toISOString();
export const CATEGORIES = {
  quality: 'Quality',
  value: 'Value for money',
  ease: 'Ease of use',
  durability: 'Durability',
  shipping: 'Shipping & packaging'
};
export const THEMES = [
  {
    id: 'quality',
    label: 'Quality',
    pattern: /\b(quality|well[- ]made|craftsmanship)\b/i
  },
  {
    id: 'shipping',
    label: 'Shipping & delivery',
    pattern: /\b(shipping|delivery|arrived|arrival|packaging)\b/i
  },
  {
    id: 'value',
    label: 'Value for money',
    pattern: /\b(value|affordable|worth (the )?(price|money))\b/i
  },
  {
    id: 'ease',
    label: 'Ease of use',
    pattern:
      /\b(ease of use|easy to use|difficult to use|hard to use|simple to use|user[- ]friendly)\b/i
  },
  {
    id: 'durability',
    label: 'Durability',
    pattern: /\b(durable|durability|long[- ]lasting|sturdy)\b/i
  }
];
const reviewText = (r) => [r.title, r.body, ...r.pros, ...r.cons].join(' ');
function visibleListing(row) {
  if (!row || row.status !== 'active') return false;
  const vendor = store.find('vendors', (v) => v.id === row.vendorId);
  if (
    !vendor ||
    vendor.status !== 'active' ||
    (vendor.enterprise &&
      (vendor.enterprise.publication !== 'public' ||
        vendor.enterprise.operatingStatus !== 'active'))
  )
    return false;
  if (row.spaceId) {
    const space = store.find('spaces', (s) => s.id === row.spaceId);
    if (!space || space.status !== 'active' || space.visibility !== 'public')
      return false;
  }
  return true;
}
export function product(id) {
  const listing = store.find('listings', (l) => l.id === id);
  if (!visibleListing(listing)) throw fail('Product not found.', 404);
  return listing;
}
const reviewsFor = (id) =>
  store.filter(
    'productReviews',
    (r) => r.listingId === id && r.status === 'published'
  );
function paidOrder(order) {
  return Boolean(
    order &&
    order.transactionId &&
    store.find('ledgerTransactions', (t) => t.id === order.transactionId)
      ?.status === 'settled'
  );
}
function verified(r) {
  const order = store.find(
    'orders',
    (o) =>
      o.id === r.orderId &&
      o.buyerId === r.authorId &&
      o.listingId === r.listingId
  );
  return paidOrder(order);
}
function mediaFor(r) {
  return (r.uploadIds || [])
    .map((id) =>
      store.find(
        'uploads',
        (u) =>
          u.id === id &&
          u.ownerId === r.authorId &&
          u.purpose === 'review_media'
      )
    )
    .filter(Boolean)
    .map((u) => ({
      id: u.id,
      url: u.url,
      kind: u.mimeType.startsWith('video/') ? 'video' : 'image',
      alt: u.alt || 'Customer review media'
    }));
}
const votesFor = (id) =>
  store.filter('productReviewVotes', (v) => v.reviewId === id);
function reviewView(r, actor = null) {
  const votes = votesFor(r.id);
  const listing = store.find('listings', (l) => l.id === r.listingId);
  const vendor = store.find('vendors', (v) => v.id === listing?.vendorId);
  // No author IDs, order IDs, email, addresses, upload owners or reporter IDs.
  return {
    id: r.id,
    rating: r.rating,
    title: r.title,
    body: r.body,
    createdAt: r.createdAt,
    name: r.anonymous ? 'Anonymous' : r.displayName,
    verifiedPurchase: verified(r),
    incentivized: r.incentivized,
    recommend: r.recommend,
    categories: r.categories,
    pros: r.pros,
    cons: r.cons,
    size: r.size,
    color: r.color,
    variantSource: 'reviewer-stated',
    media: mediaFor(r),
    helpful: votes.filter((v) => v.vote === 'yes').length,
    notHelpful: votes.filter((v) => v.vote === 'no').length,
    myVote: votes.find((v) => v.userId === actor)?.vote || null,
    isMine: actor === r.authorId,
    canRespond: Boolean(actor && vendor?.ownerId === actor),
    canVote: Boolean(
      actor && actor !== r.authorId && actor !== vendor?.ownerId
    ),
    response:
      r.response && r.response.authorId === vendor?.ownerId
        ? {
            body: r.response.body,
            at: r.response.at,
            seller: vendor.displayName,
            verifiedSeller: true
          }
        : null
  };
}
function aggregate(rows) {
  const count = rows.length,
    recommendations = rows.filter((r) => typeof r.recommend === 'boolean');
  return {
    count,
    average: count
      ? Number((rows.reduce((n, r) => n + r.rating, 0) / count).toFixed(1))
      : null,
    recommendPercent: recommendations.length
      ? Math.round(
          (recommendations.filter((r) => r.recommend).length /
            recommendations.length) *
            100
        )
      : null,
    recommendCount: recommendations.length,
    breakdown: [5, 4, 3, 2, 1].map((rating) => {
      const total = rows.filter((r) => r.rating === rating).length;
      return {
        rating,
        count: total,
        percent: count ? Math.round((total / count) * 100) : 0
      };
    }),
    categories: Object.entries(CATEGORIES).map(([id, label]) => {
      const given = rows.filter((r) => r.categories[id]);
      return {
        id,
        label,
        count: given.length,
        average: given.length
          ? Number(
              (
                given.reduce((n, r) => n + r.categories[id], 0) / given.length
              ).toFixed(1)
            )
          : null
      };
    })
  };
}
function productView(l) {
  return {
    id: l.id,
    name: l.title,
    type: l.type,
    category:
      l.commodity ||
      {
        product: 'Products',
        service: 'Services',
        experience: 'Experiences',
        event: 'Events'
      }[l.type] ||
      'Products',
    price: l.price,
    currency: l.currency,
    image: l.media?.[0] || null,
    seller:
      store.find('vendors', (v) => v.id === l.vendorId)?.displayName ||
      'Seller',
    summary: aggregate(reviewsFor(l.id))
  };
}
export function catalog(query = {}) {
  const q = text(query.q, 120).toLowerCase();
  let rows = store
    .all('listings')
    .filter(visibleListing)
    .filter(
      (l) =>
        (!query.type || l.type === query.type) &&
        (!q || l.title.toLowerCase().includes(q))
    );
  rows.sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)
  );
  const page = Math.max(
    1,
    Math.min(Math.ceil(rows.length / 12) || 1, parseInt(query.page, 10) || 1)
  );
  return {
    products: rows.slice((page - 1) * 12, page * 12).map(productView),
    total: rows.length,
    page,
    pages: Math.ceil(rows.length / 12) || 1
  };
}
export function page(id, query = {}, actor = null) {
  const l = product(id),
    rows = reviewsFor(id),
    summary = aggregate(rows);
  const selected = String(query.stars || '')
    .split(',')
    .map(Number)
    .filter((n) => [1, 2, 3, 4, 5].includes(n));
  const q = text(query.q, 120).toLowerCase(),
    theme = THEMES.find((t) => t.id === query.theme);
  const views = rows.map((r) => reviewView(r, actor));
  let filtered = views.filter(
    (r) =>
      (!selected.length || selected.includes(r.rating)) &&
      (query.verified !== '1' || r.verifiedPurchase) &&
      (query.media !== '1' || r.media.length) &&
      (!q || reviewText(r).toLowerCase().includes(q)) &&
      (!query.size || r.size === query.size) &&
      (!query.color || r.color === query.color) &&
      (!theme || theme.pattern.test(reviewText(r))) &&
      (query.recent !== '1' ||
        Date.parse(r.createdAt) >= Date.now() - 90 * 86400000)
  );
  const recent = (a, b) =>
    b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  const sort = query.sort || 'recent';
  filtered.sort(
    (a, b) =>
      (sort === 'helpful'
        ? b.helpful - a.helpful
        : sort === 'highest'
          ? b.rating - a.rating
          : sort === 'lowest'
            ? a.rating - b.rating
            : sort === 'images'
              ? b.media.filter((m) => m.kind === 'image').length -
                a.media.filter((m) => m.kind === 'image').length
              : 0) || recent(a, b)
  );
  const total = filtered.length,
    pages = Math.max(1, Math.ceil(total / 10)),
    current = Math.max(1, Math.min(pages, parseInt(query.page, 10) || 1));
  const phrases = (field) => {
    const counts = new Map();
    rows.forEach((r) =>
      new Set(r[field].map((p) => p.toLowerCase())).forEach((p) =>
        counts.set(p, (counts.get(p) || 0) + 1)
      )
    );
    return [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 4)
      .map(([text, count]) => ({ text, count }));
  };
  const authors = new Set(rows.map((r) => r.authorId));
  const related = store
    .all('listings')
    .filter(
      (other) =>
        other.id !== id && other.type === l.type && visibleListing(other)
    )
    .map((other) => ({
      product: productView(other),
      shared: new Set(
        reviewsFor(other.id)
          .filter((r) => authors.has(r.authorId))
          .map((r) => r.authorId)
      ).size
    }))
    .sort(
      (a, b) =>
        b.shared - a.shared ||
        (b.product.summary.average || 0) - (a.product.summary.average || 0) ||
        a.product.id.localeCompare(b.product.id)
    );
  const overlapping = related.filter((r) => r.shared > 0);
  const media = views
    .flatMap((r) =>
      r.media.map((m) => ({
        ...m,
        reviewId: r.id,
        title: r.title,
        name: r.name,
        rating: r.rating,
        body: r.body.slice(0, 400)
      }))
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    product: productView(l),
    summary,
    reviews: filtered.slice((current - 1) * 10, current * 10),
    total,
    page: current,
    pages,
    pageSize: 10,
    from: total ? (current - 1) * 10 + 1 : 0,
    to: Math.min(current * 10, total),
    featured: views
      .filter((r) => r.helpful > 0)
      .sort((a, b) => b.helpful - a.helpful || recent(a, b))
      .slice(0, 2),
    focus: query.review
      ? views.find((r) => r.id === query.review) || null
      : null,
    highlights: {
      kind: 'counted_themes',
      themes: THEMES.map((t) => ({
        id: t.id,
        label: t.label,
        count: rows.filter((r) => t.pattern.test(reviewText(r))).length
      }))
        .filter((t) => t.count)
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      pros: phrases('pros'),
      cons: phrases('cons')
    },
    gallery: media.slice(0, 8),
    galleryTotal: media.length,
    photoCount: media.filter((m) => m.kind === 'image').length,
    videoCount: media.filter((m) => m.kind === 'video').length,
    variants: {
      sizes: [...new Set(rows.map((r) => r.size).filter(Boolean))].sort(),
      colors: [...new Set(rows.map((r) => r.color).filter(Boolean))].sort()
    },
    related: (overlapping.length ? overlapping : related)
      .slice(0, 4)
      .map((r) => r.product),
    relatedLabel: overlapping.length
      ? 'Customers also reviewed'
      : 'More in this category',
    capabilities: { aiSummary: false, photos: true, videos: true }
  };
}
export function context(id, actor) {
  const l = product(id);
  const mine = store.find(
    'productReviews',
    (r) =>
      r.listingId === id &&
      r.authorId === actor &&
      (r.status !== 'withdrawn' || r.moderationHidden)
  );
  return {
    isSeller:
      store.find('vendors', (v) => v.id === l.vendorId)?.ownerId === actor,
    canModerate: hasCapability(actor, 'moderate'),
    myReview: mine ? { id: mine.id, status: mine.status } : null,
    orders: store
      .filter(
        'orders',
        (o) => o.listingId === id && o.buyerId === actor && paidOrder(o)
      )
      .map((o) => ({ id: o.id, date: o.createdAt, quantity: o.quantity })),
    uploadLimit: uploads.maxBytes()
  };
}
function checkActor(actor) {
  if (!actor || store.find('users', (u) => u.id === actor)?.status !== 'active')
    throw fail('Sign in to continue.', 401);
}
function listInput(input) {
  return Array.isArray(input)
    ? [...new Set(input.map((v) => text(v, 80)).filter(Boolean))].slice(0, 3)
    : [];
}
export function create(id, actor, input) {
  checkActor(actor);
  const l = product(id);
  if (store.find('vendors', (v) => v.id === l.vendorId)?.ownerId === actor)
    throw fail('Sellers cannot review their own products.', 403);
  const key = text(input.key, 100);
  if (!key) throw fail('A submission reference is required.');
  const duplicate = store.find(
    'productReviews',
    (r) => r.listingId === id && r.authorId === actor && r.key === key
  );
  if (duplicate) {
    if (duplicate.status !== 'published')
      throw fail('This review is no longer public.', 409);
    return reviewView(duplicate, actor);
  }
  if (
    store.find(
      'productReviews',
      (r) =>
        r.listingId === id &&
        r.authorId === actor &&
        (r.status !== 'withdrawn' || r.moderationHidden)
    )
  )
    throw fail('You have already reviewed this product.', 409);
  const rating = input.rating,
    title = text(input.title, 120),
    body = text(input.body, 5000);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    throw fail('Choose a rating from 1 to 5.');
  if (title.length < 3)
    throw fail('Add a review title of at least 3 characters.');
  if (body.length < 50)
    throw fail('Write at least 50 characters about your experience.');
  if (typeof input.recommend !== 'boolean')
    throw fail('Choose whether you would recommend this product.');
  if (input.consent !== true)
    throw fail('Agree to publish your review and media.');
  let orderId = null;
  if (input.orderId) {
    const o = store.find(
      'orders',
      (o) => o.id === input.orderId && o.listingId === id && o.buyerId === actor
    );
    if (!paidOrder(o))
      throw fail(
        'That order is not a settled purchase for this product and account.',
        403
      );
    orderId = o.id;
  }
  const categories = {};
  for (const category of Object.keys(CATEGORIES)) {
    if (
      input.categories?.[category] != null &&
      input.categories[category] !== ''
    ) {
      const n = input.categories[category];
      if (!Number.isInteger(n) || n < 1 || n > 5)
        throw fail('Category ratings must be between 1 and 5.');
      categories[category] = n;
    }
  }
  const uploadIds = Array.isArray(input.uploadIds)
    ? [...new Set(input.uploadIds)]
    : [];
  if (uploadIds.length > 6) throw fail('Attach up to 6 photos or videos.');
  for (const uploadId of uploadIds) {
    const u = store.find(
      'uploads',
      (u) =>
        u.id === uploadId && u.ownerId === actor && u.purpose === 'review_media'
    );
    if (!u || !uploads.readFile(uploadId).ok)
      throw fail('Use your own available review uploads.', 403);
  }
  const r = store.insert('productReviews', {
    id: newId('rev'),
    listingId: id,
    authorId: actor,
    displayName: text(
      store.find('users', (u) => u.id === actor)?.displayName || 'Member',
      80
    ),
    anonymous: input.anonymous === true,
    rating,
    title,
    body,
    orderId,
    categories,
    uploadIds,
    recommend: input.recommend,
    pros: listInput(input.pros),
    cons: listInput(input.cons),
    size: l.type === 'product' ? text(input.size, 40) : '',
    color: l.type === 'product' ? text(input.color, 40) : '',
    incentivized: input.incentivized === true,
    key,
    status: 'published',
    createdAt: now(),
    response: null
  });
  return reviewView(r, actor);
}
function target(id) {
  const r = store.find(
    'productReviews',
    (r) => r.id === id && r.status === 'published'
  );
  if (!r) throw fail('Review not found.', 404);
  product(r.listingId);
  return r;
}
export function vote(id, actor, value) {
  checkActor(actor);
  const r = target(id);
  const l = product(r.listingId);
  if (
    r.authorId === actor ||
    store.find('vendors', (v) => v.id === l.vendorId)?.ownerId === actor
  )
    throw fail('Authors and the seller cannot vote on this review.', 403);
  if (!['yes', 'no', null].includes(value))
    throw fail('Choose Yes, No, or remove your vote.');
  const existing = store.find(
    'productReviewVotes',
    (v) => v.reviewId === id && v.userId === actor
  );
  if (existing) {
    if (value === null) store.remove('productReviewVotes', existing.id);
    else store.update('productReviewVotes', existing.id, { vote: value });
  } else if (value)
    store.insert('productReviewVotes', {
      id: newId('rvv'),
      reviewId: id,
      userId: actor,
      vote: value,
      createdAt: now()
    });
  return reviewView(r, actor);
}
export function respond(id, actor, body) {
  checkActor(actor);
  const r = target(id),
    l = product(r.listingId);
  if (store.find('vendors', (v) => v.id === l.vendorId)?.ownerId !== actor)
    throw fail('Only this product’s seller can respond.', 403);
  const message = text(body, 2000);
  if (message.length < 10)
    throw fail('Write a response of at least 10 characters.');
  const updated = store.update('productReviews', r.id, {
    response: { authorId: actor, body: message, at: now() }
  });
  return reviewView(updated, actor);
}
export function report(id, actor, input) {
  checkActor(actor);
  const r = target(id);
  if (
    !['spam', 'abuse', 'privacy', 'irrelevant', 'other'].includes(input.reason)
  )
    throw fail('Choose a report reason.');
  const note = text(input.note, 500);
  if (note.length < 10)
    throw fail('Add at least 10 characters explaining the concern.');
  const old = store.find(
    'productReviewReports',
    (v) => v.reviewId === id && v.reporterId === actor
  );
  if (old) return { reported: true };
  store.insert('productReviewReports', {
    id: newId('rpt'),
    reviewId: r.id,
    reporterId: actor,
    reason: input.reason,
    note,
    status: 'open',
    createdAt: now()
  });
  return { reported: true };
}
export function withdraw(id, actor) {
  checkActor(actor);
  const r = store.find(
    'productReviews',
    (r) => r.id === id && r.authorId === actor
  );
  if (!r) throw fail('Review not found.', 404);
  store.update('productReviews', id, { status: 'withdrawn' });
  return { removed: true };
}
export function moderation(actor) {
  if (!hasCapability(actor, 'moderate'))
    throw fail('Review moderation requires moderator access.', 403);
  return {
    reports: store
      .all('productReviewReports')
      .slice()
      .sort(
        (a, b) =>
          (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) ||
          b.createdAt.localeCompare(a.createdAt)
      )
      .slice(0, 100)
      .map(({ reporterId, ...r }) => {
        const review = store.find('productReviews', (v) => v.id === r.reviewId);
        return {
          ...r,
          review: review
            ? {
                ...reviewView(review, actor),
                status: review.status,
                listingId: review.listingId
              }
            : null
        };
      })
  };
}
export function moderate(id, actor, input) {
  if (!hasCapability(actor, 'moderate'))
    throw fail('Review moderation requires moderator access.', 403);
  const r = store.find('productReviews', (r) => r.id === id);
  if (!r) throw fail('Review not found.', 404);
  if (!['hide', 'restore', 'dismiss'].includes(input.action))
    throw fail('Invalid moderation action.');
  if (r.status === 'withdrawn' && input.action === 'restore')
    throw fail('An author-withdrawn review cannot be restored.', 409);
  const reason = text(input.reason, 300);
  if (reason.length < 10)
    throw fail('Record a reason of at least 10 characters.');
  const before = r.status;
  const status =
    input.action === 'hide'
      ? 'hidden'
      : input.action === 'restore'
        ? 'published'
        : r.status;
  store.update('productReviews', id, {
    status,
    ...(input.action !== 'dismiss'
      ? { moderationHidden: input.action === 'hide' }
      : {})
  });
  for (const report of store.filter(
    'productReviewReports',
    (p) => p.reviewId === id && p.status === 'open'
  ))
    store.update('productReviewReports', report.id, {
      status: 'resolved',
      resolution: input.action,
      resolvedAt: now()
    });
  recordAudit('product_review.' + input.action, {
    actorId: actor,
    objectType: 'product_review',
    objectId: id,
    before: { status: before },
    after: { status },
    reason
  });
  return { status };
}
export function canReadReviewMedia(upload, actor) {
  if (!upload || upload.purpose !== 'review_media') return false;
  if (actor === upload.ownerId || (actor && hasCapability(actor, 'moderate')))
    return true;
  return store
    .filter(
      'productReviews',
      (r) =>
        r.status === 'published' &&
        r.uploadIds.includes(upload.id) &&
        r.authorId === upload.ownerId
    )
    .some((r) =>
      visibleListing(store.find('listings', (l) => l.id === r.listingId))
    );
}

export function gallery(id, query = {}) {
  product(id);
  const all = reviewsFor(id)
    .slice()
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)
    )
    .flatMap((r) =>
      mediaFor(r).map((m) => ({
        ...m,
        reviewId: r.id,
        title: r.title,
        name: r.anonymous ? 'Anonymous' : r.displayName,
        rating: r.rating,
        body: r.body.slice(0, 400)
      }))
    );
  const pages = Math.max(1, Math.ceil(all.length / 24)),
    page = Math.max(1, Math.min(pages, parseInt(query.page, 10) || 1));
  return {
    items: all.slice((page - 1) * 24, page * 24),
    page,
    pages,
    total: all.length
  };
}
