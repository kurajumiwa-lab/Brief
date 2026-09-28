// ---------------------------------------------------------------------------
// POSITION AS HERO — the You screen's opening, built from Chess.com's SHAPE
// (position first, bio later) with the rating taken out.
//
// Pinned here:
//   * every tile is a count over real rows, and the row reference is
//     copy-on-tap so a figure can be taken to whoever you are arguing with;
//   * the "defended" figure is fulfilled ÷ closed, sample size included, and
//     the 7-day cohort version is explicitly NOT shown because Brief has no
//     decay-event log to divide by;
//   * no rating, tier, badge, streak, percentile, follower or profile-view
//     count appears anywhere;
//   * a closed ledger that is genuinely empty says "nothing pending", and a
//     FAILED read says it could not be read — never a flattering zero;
//   * copy-on-tap claims success only when the clipboard accepted the write.
// ---------------------------------------------------------------------------
const assert = require('assert').strict;
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://brief.test/', pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.HTMLInputElement = dom.window.HTMLInputElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.MouseEvent = dom.window.MouseEvent;
global.getComputedStyle = dom.window.getComputedStyle;
global.IS_REACT_ACT_ENVIRONMENT = true;
global.localStorage = dom.window.localStorage;

const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react-dom/test-utils');
const { PositionHero } = require('./src/features/you/PositionHero.tsx');
const { CopyId } = require('./src/ui/CopyId.tsx');
const { YouSurface } = require('./src/features/you/YouSurface.tsx');

let count = 0;
const pass = (n) => { count++; console.log('PASS ' + n); };
const flush = (ms = 60) => new Promise((r) => setTimeout(r, ms));
function mount(el) {
  document.body.innerHTML = '';
  const c = document.createElement('div');
  document.body.appendChild(c);
  const root = createRoot(c);
  act(() => root.render(el));
  return { container: c, root };
}
const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
const btn = (want) => Array.from(document.querySelectorAll('button')).find((b) => text(b) === want || text(b).startsWith(want));
const click = (el) => act(() => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));

let clipboardWrites = [];
Object.defineProperty(dom.window.navigator, 'clipboard', {
  configurable: true,
  value: { writeText: async (v) => { clipboardWrites.push(String(v)); } }
});

const POSITION = {
  decay: {
    expiringQuotes: [{ quoteId: 'q1', requestId: 'req_9', title: 'Catering for 50', validUntil: '2026-09-20', hoursLeft: 24 }],
    waitlist: [], override: null, overdueInstallments: 0
  },
  missedCapture: {
    count: 2,
    recent: [{ requestId: 'req_5', title: 'Trays of bread', at: '2026-09-10T00:00:00Z', value: { minor: 1500000, amount: 15000, currency: 'KES' }, evidence: { table: 'requestQuotes', id: 'q_lost' } }],
    value: { amount: 24000, currency: 'KES', over: '30 days', sampleCount: 2 }
  },
  nextMove: null,
  open: { total: 3, top: [{ requestId: 'req_9', title: '200kg of Irish potatoes', category: 'produce', location: 'Wakulima', severityLabel: 'Suppliers matched; no quote yet', collective: false, closesMonthly: 2 }] },
  derivedAt: '2026-09-15T00:00:00Z', note: 'derived'
};

const COMMITMENTS = {
  owedByMe: [{ id: 'c1', kind: 'payment', value: { amount: 850, currency: 'KES' }, deadline: null, status: 'open', evidence: { table: 'orders', id: 'ord_41' } }],
  owedToMe: [
    { id: 'c2', kind: 'delivery', value: null, deadline: '2026-09-19', status: 'open', evidence: { table: 'workOrders', id: 'wo_7' } },
    { id: 'c3', kind: 'payment', value: { amount: 1240, currency: 'KES' }, deadline: null, status: 'open', evidence: { table: 'orders', id: 'ord_42' } }
  ],
  fulfilled: [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }, { id: 'f4' }],
  lapsed: [{ id: 'l1' }],
  owedByMeKes: 850, owedToMeKes: 1240, derivedAt: '', note: 'derived'
};

const RECIPROCITY = {
  owedToMe: [{ id: 'r1', kind: 'loan_guarantee', status: 'open', evidence: { table: 'tableBankingLoans', id: 'loan_3' } }],
  owedByMe: [{ id: 'r2', kind: 'recommendation', status: 'open', evidence: { table: 'coopPartnerships', id: 'p_1' } }],
  fulfilled: [], aging: [{ id: 'r2' }], windowDays: 14, derivedAt: '', note: 'derived'
};

const PRECEDENT = {
  category: null,
  closure: { windowDays: 30, byCategory: [{ category: 'produce', closed: 3 }] },
  fill: { category: null, windowDays: 30, closed: 4, avgHoursToFill: 5.7, hoursSampleCount: 4, avgValue: { amount: 1955, currency: 'KES', sampleCount: 3 }, note: 'Precedent is counted from closed rows.' },
  movement: { windowDays: 30, settledOrders: 6, settledOrdersKes: 12400, settledCurrency: 'KES', completedWorkOrders: 3, deliveredPickups: 9 },
  note: 'Derived from real rows on read.'
};

const SPACES = [
  { id: 'spc_1', name: 'Tilapia at Wakulima', status: 'active', editorialOpen: 3, maintenance: { state: 'stale', ageHours: 240, answered: 5, unanswered: 3, due: 0, overdue: 1, fields: [], facts: [], note: '' } },
  { id: 'spc_2', name: 'Weekend Bakery', status: 'active', editorialOpen: 0, maintenance: { state: 'fresh', ageHours: 5, answered: 8, unanswered: 0, due: 0, overdue: 0, fields: [], facts: [], note: '' } }
];

async function main() {
  // --- 1. the hero, on real derived data -----------------------------------
  {
    const { container } = mount(React.createElement(PositionHero, {
      position: POSITION, commitments: COMMITMENTS, reciprocity: RECIPROCITY, spaces: SPACES, precedent: PRECEDENT
    }));
    await flush();
    const t = text(container);
    assert.ok(t.includes('Your position'), 'the hero names itself');
    assert.ok(t.includes('1 proposal of yours is losing validity'), 'the headline is the heaviest real fact, not a score');
    assert.ok(t.includes('Catering for 50'), 'naming the row it came from');
    assert.ok(btn('Defend it now'), 'and offers the real action');
    click(btn('Defend it now'));
    assert.ok(String(dom.window.location.hash).includes('requests/req_9'), 'the action goes to the request');

    // Tiles.
    assert.ok(t.includes('went to someone else'), 'the missed tile exists');
    assert.ok(t.includes('KES 24,000 of your own priced offers'), 'and its money is your own offers only');
    assert.ok(t.includes('demand you could answer'), 'open demand tile');
    assert.ok(t.includes('top: 200kg of Irish potatoes'), 'with the real top row named');
    assert.ok(t.includes('KES 1,240'), 'owed-to-you money is the real sum');

    // Space pills: derived state + age + open items.
    // The pill is uppercased by CSS (text-transform), so the DOM text is the
    // derived word as-is; assert the styling that makes it a status pill.
    assert.ok(t.includes('Tilapia at Wakulima'), 'the space is named');
    assert.ok(/stale/i.test(t) && t.includes('10d'), 'a stale space is labelled with its real age');
    const pill = Array.from(container.querySelectorAll('span')).find((x) => /stale/.test(x.textContent) && (x.getAttribute('class') || '').includes('uppercase'));
    assert.ok(pill, 'the state renders as an uppercase status pill');
    assert.ok(t.includes('3 questions to answer'), 'and its derived open items, in words');
    assert.ok(t.includes('Weekend Bakery') && /fresh/i.test(t), 'a maintained space reads fresh');

    // Defended, with its denominator.
    assert.ok(t.includes('4 fulfilled · 1 lapsed · 80% defended across 5 closed commitments'), 'the defense figure is arithmetic over closed rows');
    // The cohort caveat no longer sits in the flow — but it must exist, on the
    // one page that holds explanations. Moved, not deleted.
    assert.ok(!/decay-event log/.test(t), 'no paragraph about what is not measured on the hero');
    const { HowBriefWorks } = require('./src/features/you/HowBriefWorks.tsx');
    {
      const c2 = document.createElement('div');
      document.body.appendChild(c2);
      const r2 = createRoot(c2);
      act(() => r2.render(React.createElement(HowBriefWorks, {})));
      const a = text(c2);
      assert.ok(/no decay-event log or cohort table to divide by/.test(a), 'the audit page carries the cohort reason');
      assert.ok(/A commitment is a promise someone is waiting on/.test(a), 'and the definition, once');
      assert.ok(/never a stored score|not a score, a rank or a tier|No seeded activity|never shows/.test(a), 'and the refusals');
      r2.unmount(); c2.remove();
    }

    // Precedent band, counted not claimed.
    assert.ok(t.includes('4 requests reached an accepted quote'), 'platform precedent renders');
    assert.ok(t.includes('6 orders settled for KES 12,400'), 'with settled money from real rows');
    assert.ok(t.includes('took 5.7h on average across 4 rows'), 'and the sample size behind the average');

    // Copy-on-tap references.
    const copyBtn = Array.from(container.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') ?? '').includes('Copy orders ord_41'));
    assert.ok(copyBtn, 'a commitment row exposes its source row id');
    click(copyBtn);
    await flush();
    assert.deepEqual(clipboardWrites.slice(-1), ['ord_41'], 'tapping copies the exact id, nothing decorated');
    assert.ok(text(container).includes('copied'), 'and success is reported only after the write');

    // The fiction ban.
    // Bounded words, so "operating" never trips a check for "rating".
    for (const banned of ['rating', 'tier', 'streak', 'badge', 'percentile', 'leaderboard', 'followers', 'points', 'medal', 'level']) {
      assert.ok(!new RegExp(`\\b${banned}\\b`, 'i').test(t), `no ${banned} anywhere`);
    }
    assert.ok(!/top \d/.test(t), 'no percentile vanity');
    assert.ok(!/profile views/i.test(t), 'no view counter');
  }
  pass('PositionHero renders derived standing, real space states, honest defense math and copy-on-tap evidence');

  // --- 2. a genuinely quiet ledger reads as quiet, not as an achievement ----
  {
    const empty = {
      decay: { expiringQuotes: [], waitlist: [], override: null, overdueInstallments: 0 },
      missedCapture: { count: 0, recent: [], value: null },
      nextMove: null, open: { total: 0, top: [] }, derivedAt: '', note: ''
    };
    const { container } = mount(React.createElement(PositionHero, {
      position: empty,
      commitments: { owedByMe: [], owedToMe: [], fulfilled: [], lapsed: [], owedByMeKes: 0, owedToMeKes: 0, derivedAt: '', note: '' },
      reciprocity: { owedToMe: [], owedByMe: [], fulfilled: [], aging: [], windowDays: 14, derivedAt: '', note: '' },
      spaces: [], precedent: null
    }));
    const t = text(container);
    assert.ok(t.includes('Nothing pending on your ledger.'), 'the empty state is stated plainly');
    assert.ok(/No commitments closed yet/.test(t), 'the empty is five words, not a definition paragraph');
    assert.ok(!/A commitment is a promise someone is waiting on/.test(t), 'the teaching moved to the audit page');
    assert.ok(!/\b0%/.test(t), 'and no 0% is manufactured out of an empty set');
    assert.ok(!/0%/.test(t), 'a zero rate never appears');
    assert.ok(!t.includes('Perfect'), 'no reward language for an empty ledger');
  }
  pass('An empty ledger is described as empty, never as a score or an award');

  // --- 3. a failed read is an error; no session is silence-with-words -------
  {
    const { container, root } = mount(React.createElement(PositionHero, { position: null, commitments: null, reciprocity: null, denied: false, onRetry: () => {} }));
    assert.ok(text(container).includes('could not be read'), 'a failed read says so');
    assert.ok(btn('Try again'), 'and offers the retry');
    assert.ok(!text(container).includes('Nothing pending'), 'never a flattering all-clear');
    root.unmount();

    const second = mount(React.createElement(PositionHero, { position: null, commitments: null, reciprocity: null, denied: true }));
    assert.ok(text(second.container).includes('No session, so there is no position to read.'), 'a signed-out visitor is told what is missing');
    assert.ok(!btn('Try again'), 'and is not offered a pointless retry');
    second.root.unmount();
  }
  pass('PositionHero distinguishes a failed read from a missing session');

  // --- 4. CopyId honesty when the clipboard refuses ------------------------
  {
    const saved = dom.window.navigator.clipboard;
    Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true, value: undefined });
    const { container } = mount(React.createElement(CopyId, { value: 'req_9', label: 'requests' }));
    click(btn('Copy reference req_9') ?? container.querySelector('button'));
    await flush();
    const t = text(container);
    assert.ok(t.includes('req_9'), 'the full value is revealed so it can be copied by hand');
    assert.ok(!t.includes('copied'), 'and no success is claimed for a write that never happened');
    Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true, value: saved });
  }
  pass('CopyId never claims a copy it could not make');

  // --- 5. You is titles; Standing is the overlay that holds position --------
  {
    const ok = (b) => ({ ok: true, status: 200, text: async () => JSON.stringify(b) });
    global.fetch = async (input) => {
      const url = String(input?.url ?? input ?? '');
      if (url.includes('/api/auth/me')) return ok({ user: { id: 'u1', handle: 'amina', displayName: 'Amina O.' } });
      if (url.includes('/api/person/me')) return ok({ person: { id: 'p1', displayName: 'Amina O.', tags: [], aliases: [] }, standing: { hosted: 2, bought: 5, arrived: 3, registered: 1, vendor: null, personId: 'p1', displayName: 'Amina O.' } });
      if (url.includes('/api/me/acquisition')) return ok({ acquisition: null, provenance: null, activity: { verifiedCommercialKes: 0, currency: 'KES' } });
      if (url.includes('/api/me/position')) return ok({ position: POSITION });
      if (url.includes('/api/me/commitments')) return ok({ commitments: COMMITMENTS });
      if (url.includes('/api/me/reciprocity')) return ok({ reciprocity: RECIPROCITY });
      if (url.includes('/api/precedent')) return ok(PRECEDENT);
      if (url.includes('/api/spaces')) return ok({ spaces: SPACES });
      return { ok: false, status: 404, text: async () => JSON.stringify({}) };
    };
    const { container } = mount(React.createElement(YouSurface, { onOpenEntity: () => {}, onRequireAuth: () => {} }));
    await flush();
    let t = text(container);
    assert.ok(!t.includes('Your position'), 'You is a list of titles, not a position hero');
    const standing = document.querySelector('[data-testid="standing"]');
    assert.ok(standing, 'Standing is a tile');
    click(standing);
    await flush();
    t = text(container);
    assert.ok(document.querySelector('[data-testid="you-shelf-standing"]'), 'Standing opens as a sheet on You');
    assert.ok(document.querySelector('[data-testid="you-detail"]') && !document.querySelector('[data-testid="sheet"]'), 'Standing is an inline detail, not a nested sheet');
    assert.ok(t.includes('Your position'), 'and the position cards live there');
    assert.equal(document.querySelector('[data-testid="you-tile-grid"]'), null, 'the detail replaces the group list');
    click(document.querySelector('[aria-label="Back to You"]')); await flush();
    const profile = document.querySelector('[data-testid="you-profile-head"]');
    click(profile);
    await flush();
    t = text(container);
    assert.ok(t.includes('Amina O.'), 'the session name is on Profile');
  }
  pass('YouSurface is titles; Standing is the overlay that holds position');

  console.log('\nPASS ' + count);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
