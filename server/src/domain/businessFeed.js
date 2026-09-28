// One discovery projection over existing commerce, matching and execution.
// A ranking score is explainable content relevance, never worker reputation.
import { store, newId } from '../store.js';
import { isEnabled } from '../features.js';
import { product as publicProduct } from './productReviews.js';
import { canonicalMediaUrl } from './listing.js';
import { relevantRequests } from './matching.js';
import { discoveryPrograms } from './workExecution.js';
import { PLAYBOOKS } from './businessPlaybooks.js';
import * as v from './supplyValidation.js';

export const TOPICS = [
  {
    id: 'software',
    label: 'Software',
    pattern: /\b(software|saas|crm|plugin|automation|api|digital tool)\b/i
  },
  {
    id: 'sales',
    label: 'Sales',
    pattern: /\b(sales|outreach|leads?|customers?|calling|onboarding)\b/i
  },
  {
    id: 'marketing',
    label: 'Marketing',
    pattern:
      /\b(marketing|design|content|brand|flyers?|reviews?|advertising)\b/i
  },
  {
    id: 'operations',
    label: 'Operations',
    pattern:
      /\b(operations?|logistics|delivery|sourcing|inventory|task|supply|packaging)\b/i
  },
  {
    id: 'finance',
    label: 'Finance',
    pattern: /\b(accounting|finance|bookkeeping|invoic\w*|payments?)\b/i
  }
];
export const DEFAULT_CONTROLS = {
  topic: '',
  location: '',
  stage: '',
  budget: null,
  rememberActivity: false
};
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const stateRow = (actor) =>
  actor ? store.find('businessFeedStates', (r) => r.userId === actor) : null;
function state(actor) {
  return {
    controls: { ...DEFAULT_CONTROLS },
    saved: [],
    hidden: [],
    following: [],
    activity: [],
    ...stateRow(actor)
  };
}
function write(actor, patch) {
  v.actor(actor);
  const row = stateRow(actor);
  return row
    ? store.update('businessFeedStates', row.id, patch)
    : store.insert('businessFeedStates', {
        ...state(actor),
        ...patch,
        id: newId('bfd'),
        userId: actor
      });
}
export function preferences(actor) {
  const s = state(actor);
  return {
    ...s.controls,
    hiddenCount: s.hidden.length,
    followingCount: s.following.length,
    activityCount: s.activity.length
  };
}
function controls(input) {
  v.fields(input, Object.keys(DEFAULT_CONTROLS));
  const out = {};
  if ('topic' in input)
    out.topic = v.choice(
      input.topic,
      ['', ...TOPICS.map((t) => t.id)],
      'topic'
    );
  if ('location' in input)
    out.location = v.text(input.location, 80, 'location');
  if ('stage' in input)
    out.stage = v.choice(
      input.stage,
      ['', 'starting', 'growing', 'established'],
      'stage'
    );
  if ('budget' in input) out.budget = v.num(input.budget, 'budget', 0, 1e9);
  if ('rememberActivity' in input)
    out.rememberActivity = v.boolean(
      input.rememberActivity,
      'remember activity'
    );
  return out;
}
export function updatePreferences(actor, input) {
  const patch = { controls: { ...state(actor).controls, ...controls(input) } };
  if (patch.controls.rememberActivity === false) patch.activity = [];
  write(actor, patch);
  return preferences(actor);
}
export function reset(actor, what) {
  v.choice(what, ['hidden', 'activity', 'following', 'all'], 'reset');
  write(
    actor,
    what === 'all'
      ? {
          controls: { ...DEFAULT_CONTROLS },
          saved: [],
          hidden: [],
          following: [],
          activity: []
        }
      : { [what]: [] }
  );
  return preferences(actor);
}
const money = (n, c) =>
  Number.isFinite(n)
    ? `${c} ${n.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`
    : null;
const topicsFor = (text) =>
  TOPICS.filter((t) => t.pattern.test(text)).map((t) => t.id);
const base = (key, kind, title, summary) => ({
  key,
  kind,
  title,
  summary,
  scope: 'public',
  source: '',
  location: '',
  image: null,
  vendorId: null,
  price: null,
  priceNote: '',
  spend: null,
  topics: [],
  stages: [],
  createdAt: null,
  href: null,
  cta: '',
  reviews: null,
  steps: null,
  action: null,
  blockers: []
});
export function candidates(actor) {
  const cards = PLAYBOOKS.map((b) => ({
    ...base(`playbook:${b.id}`, 'playbook', b.title, b.summary),
    source: 'Wairo editorial',
    topics: [b.topic],
    stages: b.stages,
    steps: b.steps,
    action: b.action,
    cta: 'Read playbook'
  }));
  if (isEnabled('commerce')) {
    const reviewStats = new Map();
    for (const r of store.filter(
      'productReviews',
      (r) => r.status === 'published'
    )) {
      const s = reviewStats.get(r.listingId) || { count: 0, sum: 0 };
      s.count++;
      s.sum += r.rating;
      reviewStats.set(r.listingId, s);
    }
    for (const l of store.all('listings')) {
      if (!['product', 'service'].includes(l.type)) continue;
      try {
        publicProduct(l.id);
      } catch (e) {
        if (e.status === 404) continue;
        throw e;
      }
      const vendor = store.find('vendors', (v) => v.id === l.vendorId);
      const topics = topicsFor(
        `${l.title} ${l.description} ${l.commodity || ''}`
      );
      const stat = reviewStats.get(l.id);
      const min = l.minOrderQuantity || 1;
      cards.push({
        ...base(
          `listing:${l.id}`,
          topics.includes('software') && l.type === 'product'
            ? 'tool'
            : 'offer',
          l.title,
          (l.description || '').slice(0, 500)
        ),
        source: vendor.displayName,
        vendorId: vendor.id,
        location: l.locationName || '',
        image: canonicalMediaUrl(l.media?.[0] || null),
        topics,
        createdAt: l.createdAt,
        price: money(l.price, l.currency || 'KES'),
        priceNote: `${l.unitLabel ? `per ${l.unitLabel}` : 'listed price'}${min > 1 ? ` · minimum ${min}` : ''}`,
        spend: (l.currency || 'KES') === 'KES' ? l.price * min : null,
        href: `/#offer/${encodeURIComponent(l.id)}`,
        cta: l.type === 'service' ? 'View service' : 'View offer',
        reviews: stat
          ? {
              count: stat.count,
              average: Math.round((stat.sum / stat.count) * 10) / 10,
              href: `/reviews/${encodeURIComponent(l.id)}`
            }
          : {
              count: 0,
              average: null,
              href: `/reviews/${encodeURIComponent(l.id)}`
            }
      });
    }
  }
  if (
    actor &&
    isEnabled('requests') &&
    isEnabled('supply') &&
    isEnabled('request_matching')
  ) {
    // "Public" Requests are limited briefs shared with MATCHED businesses,
    // not permission to broadcast the underlying request into a public feed.
    for (const r of relevantRequests(actor).requests)
      cards.push({
        ...base(`match:${r.matchId}`, 'request', r.title, r.reason),
        source: 'Matched business request',
        scope: 'private',
        location: r.location,
        topics: topicsFor(`${r.title} ${r.category}`),
        href: `/#supply/mine?match=${encodeURIComponent(r.matchId)}`,
        cta: 'Review matched brief',
        priceNote: 'Scope and terms need confirmation'
      });
  }
  if (actor && isEnabled('workforce'))
    for (const {
      program: p,
      createdAt,
      remaining,
      firstStep,
      eligibility
    } of discoveryPrograms(actor)) {
      cards.push({
        ...base(
          `program:${p.id}`,
          p.target > 1 ? 'campaign' : 'task',
          p.title,
          (p.objective || '').slice(0, 500)
        ),
        scope: 'private',
        source: p.workforceName || 'Work network',
        topics: topicsFor(`${p.title} ${p.objective} ${p.templateLabel}`),
        location:
          p.mode === 'home'
            ? 'Remote'
            : p.territories.map((t) => t.name).join(', '),
        createdAt,
        price: money(firstStep.feeKes, 'KES'),
        priceNote: `Offered per approved first step: ${firstStep.label}. Not earnings or a payment guarantee.`,
        href: `/#workforce/program/${encodeURIComponent(p.id)}`,
        cta: 'Review work & eligibility',
        blockers: eligibility.blockers,
        work: {
          mode: p.mode,
          remaining,
          deadline: p.deadline,
          eligible: eligibility.eligible
        }
      });
    }
  return cards;
}
function decorate(c, s) {
  return {
    ...c,
    saved: s.saved.includes(c.key),
    hidden: s.hidden.includes(c.key),
    following: Boolean(c.vendorId && s.following.includes(c.vendorId))
  };
}
function ranked(cards, s, prefs, sort) {
  const savedKinds = new Map(),
    activeKinds = new Set();
  for (const c of cards) {
    if (s.saved.includes(c.key))
      savedKinds.set(c.kind, (savedKinds.get(c.kind) || 0) + 1);
    if (prefs.rememberActivity && s.activity.some((a) => a.key === c.key))
      activeKinds.add(c.kind);
  }
  let out = cards
    .map((c) => {
      let score = 0;
      const reasons = [];
      const boost = (points, label) => {
        score += points;
        reasons.push({ points, label });
      };
      const age = (Date.now() - Date.parse(c.createdAt)) / 86400000;
      if (Number.isFinite(age) && age >= 0 && age < 30)
        boost(
          Math.round((3 - age / 10) * 10) / 10,
          'Published within the last 30 days'
        );
      if (c.vendorId && s.following.includes(c.vendorId))
        boost(6, 'You follow this provider');
      if (prefs.topic && c.topics.includes(prefs.topic))
        boost(
          5,
          `Matches your ${prefs.topic} interest${c.kind === 'playbook' ? '' : ' by keywords'}`
        );
      if (
        prefs.location &&
        c.location.toLowerCase().includes(prefs.location.toLowerCase())
      )
        boost(3, 'Matches your chosen location');
      if (prefs.budget !== null && c.spend !== null && c.spend <= prefs.budget)
        boost(2, 'Minimum listed spend fits your KES budget');
      if (prefs.stage && c.stages.includes(prefs.stage))
        boost(2, 'Editorial guide for your business stage');
      if ((savedKinds.get(c.kind) || 0) >= 2)
        boost(2, 'You saved at least two cards of this format');
      if (prefs.rememberActivity && activeKinds.has(c.kind))
        boost(1, 'A format you opened or shared (opt-in history)');
      if (!reasons.length)
        reasons.push({
          points: 0,
          label:
            c.kind === 'playbook'
              ? 'Wairo editorial guidance to explore'
              : c.scope === 'private'
                ? 'Available in your existing workspace'
                : 'Active public offer to explore'
        });
      return { ...decorate(c, s), score: Math.round(score * 10) / 10, reasons };
    })
    .sort(
      (a, b) =>
        (sort === 'latest' ? 0 : b.score - a.score) ||
        (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) ||
        a.key.localeCompare(b.key)
    );
  if (sort === 'latest') return out;
  // Diversity is applied BEFORE pagination, so pages do not repeat cards.
  const mixed = [];
  while (out.length) {
    const last = mixed[mixed.length - 1]?.kind;
    const index =
      mixed.length > 1 && mixed[mixed.length - 2].kind === last
        ? out.findIndex((c) => c.kind !== last)
        : 0;
    mixed.push(out.splice(Math.max(0, index), 1)[0]);
  }
  return mixed;
}
export function feed(actor, query = {}) {
  const s = state(actor),
    overrides = {};
  for (const key of ['topic', 'location', 'stage', 'budget'])
    if (key in query)
      overrides[key] =
        key === 'budget'
          ? query[key] === ''
            ? null
            : Number(query[key])
          : query[key];
  const prefs = { ...s.controls, ...controls(overrides) };
  const q =
    typeof query.q === 'string'
      ? query.q.trim().slice(0, 120).toLowerCase()
      : '';
  const kind = v.choice(
    query.kind || 'all',
    ['all', 'tool', 'offer', 'campaign', 'task', 'request', 'playbook'],
    'kind'
  );
  const sort = v.choice(query.sort || 'foryou', ['foryou', 'latest'], 'sort');
  const tab = v.choice(
    query.tab || 'feed',
    ['feed', 'saved', 'following'],
    'tab'
  );
  const all = candidates(actor);
  const focused =
    typeof query.card === 'string'
      ? all.find((c) => c.key === query.card)
      : null;
  const rankedCards = ranked(all, s, prefs, sort);
  const filtered = rankedCards.filter(
    (c) =>
      (tab === 'saved'
        ? c.saved
        : !c.hidden && (tab !== 'following' || c.following)) &&
      (kind === 'all' || c.kind === kind) &&
      (!q ||
        `${c.title} ${c.summary} ${c.source} ${c.location}`
          .toLowerCase()
          .includes(q))
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 12));
  const page = Math.min(pages, Math.max(1, parseInt(query.page, 10) || 1));
  return {
    items: filtered.slice((page - 1) * 12, page * 12),
    total: filtered.length,
    page,
    pages,
    focus: focused ? rankedCards.find((c) => c.key === focused.key) : null,
    focusUnavailable: Boolean(query.card && !focused),
    preferences: preferences(actor),
    applied: prefs,
    authenticated: Boolean(actor),
    topics: TOPICS.map(({ id, label }) => ({ id, label })),
    availability: {
      commerce: isEnabled('commerce'),
      workforce: isEnabled('workforce'),
      matching:
        isEnabled('requests') &&
        isEnabled('supply') &&
        isEnabled('request_matching')
    },
    rankingVersion: 1
  };
}
export function act(actor, input) {
  v.actor(actor);
  v.fields(input, ['key', 'action', 'value']);
  const key = v.text(input.key, 160, 'card key', 1);
  const action = v.choice(
    input.action,
    ['save', 'hide', 'follow', 'open', 'share'],
    'action'
  );
  const s = state(actor);
  // Removal must remain possible even after a saved source becomes unavailable.
  if (!['open', 'share'].includes(action)) v.boolean(input.value, 'value');
  if (input.value === false && ['save', 'hide'].includes(action)) {
    const field = action === 'save' ? 'saved' : 'hidden';
    write(actor, { [field]: s[field].filter((k) => k !== key) });
    return { ok: true };
  }
  const c = candidates(actor).find((c) => c.key === key);
  if (!c) fail('This card is no longer available.', 404);
  if (action === 'share' && c.scope !== 'public')
    fail('Private opportunities cannot be shared publicly.', 403);
  if (['save', 'hide', 'follow'].includes(action)) {
    const field =
      action === 'save' ? 'saved' : action === 'hide' ? 'hidden' : 'following';
    const ref = action === 'follow' ? c.vendorId : key;
    if (!ref) fail('Only public offer providers can be followed.');
    const next = s[field].filter((k) => k !== ref);
    if (input.value) {
      if (next.length >= 500)
        fail('This list is full. Remove an item before adding another.', 409);
      next.push(ref);
    }
    write(actor, { [field]: next });
  } else if (s.controls.rememberActivity) {
    write(actor, {
      activity: [
        ...s.activity.filter((a) => !(a.key === key && a.action === action)),
        { key, action, at: new Date().toISOString() }
      ].slice(-100)
    });
  }
  return { ok: true };
}
