// Real production AppShell + real isolated API. No elevated browser fixtures.
const assert = require('assert').strict;
const { JSDOM } = require('jsdom');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const realFetch = global.fetch;
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://brief.test/', pretendToBeVisual: true });
global.window = dom.window; global.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
global.localStorage = dom.window.localStorage;
global.HTMLElement = dom.window.HTMLElement; global.Element = dom.window.Element; global.Node = dom.window.Node;
global.getComputedStyle = dom.window.getComputedStyle; global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react'); const { act } = React; const { createRoot } = require('react-dom/client');
const api = require('./src/api/briefApi.ts');
window.scrollTo = () => {};
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const { WanderlyPage } = require('./src/features/wanderly/WanderlyPage.tsx');
const { wanderlyRoute, isTrip } = require('./src/features/wanderly/routes.ts');
const { AppShell } = require('./src/app/AppShell.tsx');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-wanderly-ui-'));
const port = 20000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.resolve(__dirname, '../server/src/index.js')], { env: { ...process.env, PORT: String(port), BRIEF_DATA_DIR: dir, BRIEF_ADMINS: '', BRIEF_DEV_AUTH: '0', NODE_ENV: 'development' }, stdio: ['ignore', 'ignore', 'pipe'] });
let log = '', root, passed = 0;
server.stderr.on('data', (d) => { log += d; });
let failBrowse = false, failPublish = false;
let campaignCreates = 0;
global.fetch = (url, init) => {
  const p = String(url?.url ?? url);
  if (failBrowse && /\/api\/events\?/.test(p)) return Promise.resolve(new Response(JSON.stringify({ error: 'Experiences temporarily unavailable' }), { status: 503 }));
  if (init?.method === 'POST' && p.endsWith('/api/campaigns')) campaignCreates++;
  if (failPublish && /\/api\/campaigns\/[^/]+\/publish$/.test(p)) return Promise.resolve(new Response(JSON.stringify({ error: 'Publishing temporarily unavailable' }), { status: 503 }));
  return realFetch(p.startsWith('/ingest') ? base + p.slice(7) : p, init);
};
const sleep = (n) => new Promise((r) => setTimeout(r, n));
const text = () => document.body.textContent.replace(/\s+/g, ' ').trim();
const by = (id) => document.querySelector(`[data-testid="${id}"]`);
const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const wait = async (fn, name) => { const deadline = Date.now() + 8000; while (Date.now() < deadline) { if (fn()) return fn(); await act(async () => { await sleep(20); }); } throw new Error(`Timeout: ${name}\n${text().slice(-2000)}`); };
const click = async (el) => { assert.ok(el, 'click target exists'); await act(async () => { el.click(); }); };
const type = async (el, value) => { assert.ok(el); await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }); };
const go = async (hash) => { await act(async () => { window.location.hash = hash; await sleep(20); }); };
const call = async (url, token, method = 'GET', body) => { const r = await realFetch(base + url, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); const json = await r.json(); assert.ok(r.ok, JSON.stringify(json)); return json; };
const mount = async (hash, token, publicSlug = null) => {
  if (root) act(() => root.unmount());
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState(null, '', '#' + hash);
  api.setSessionToken(token);
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(publicSlug ? React.createElement(WanderlyPage, { initialSlug: publicSlug }) : React.createElement(AppShell)); });
};
const pass = (s) => { passed++; console.log('PASS ' + s); };

(async () => {
  try {
    for (let n = 0; ; n++) { try { if ((await realFetch(base + '/api/auth/me')).status === 401) break; } catch {} if (n > 100) throw new Error('server startup ' + log); await sleep(50); }
    const host = await call('/api/auth/register', null, 'POST', { handle: 'wanderly_host', password: 'long-test-passphrase' });
    const guest = await call('/api/auth/register', null, 'POST', { handle: 'wanderly_guest', password: 'long-test-passphrase' });
    const future = (days, hours = 0) => new Date(Date.now() + days * 86400000 + hours * 3600000).toISOString();
    const create = async (data) => { const r = await call('/api/campaigns', host.token, 'POST', { type: 'event', startsAt: future(7), endsAt: future(7, 4), location: 'Nairobi', price: 0, ...data }); await call(`/api/campaigns/${r.campaign.id}/publish`, host.token, 'POST'); return r.campaign; };
    const party = await create({ title: 'Nairobi community night', festival: { faqs: [{ q: 'What should I bring?', a: 'Your ticket.' }], priceTiers: [{ name: 'Door option', price: 500, currency: 'KES' }] } });
    const trip = await create({ title: 'Naivasha weekend', location: 'Naivasha', endsAt: future(9), price: 4500 });
    const unlisted = await create({ title: 'Private gathering', unlisted: true });
    const full = await create({ title: 'Capacity test', capacity: 1 });
    await call(`/api/public/campaigns/${full.publicSlug}/register`, guest.token, 'POST', { attendeeRef: 'first-guest' });

    for (const alias of ['events', 'city/events', 'destinations/tokyo', 'tokyo', 'wanderly/tokyo']) assert.equal(wanderlyRoute(alias)?.page, 'explore');
    assert.equal(wanderlyRoute('host').page, 'host');
    assert.equal(wanderlyRoute('wanderly/experience/%zz'), null);
    assert.equal(isTrip({ startsAt: future(7), endsAt: future(7, 6) }), false);
    pass('legacy event and Tokyo doors share Wanderly; multi-day classification is factual');

    await mount('wanderly', null);
    await wait(() => document.querySelectorAll('.wl-card').length === 3, 'published plans');
    assert.ok(text().includes('Good nights.') && !text().includes('Tokyo'));
    assert.ok(!text().includes('Private gathering'));
    assert.equal(document.querySelectorAll('nav[aria-label="Wanderly"]').length, 1);
    await click(button('Multi-day trips'));
    assert.equal(document.querySelectorAll('.wl-card').length, 1);
    assert.ok(document.querySelector('.wl-card').textContent.includes('Naivasha weekend'));
    await click(button('Parties & day plans'));
    assert.equal(document.querySelectorAll('.wl-card').length, 2);
    await type(document.querySelector('[aria-label="Location"]'), 'Naivasha');
    await click(button('Find experiences'));
    await wait(() => text().includes('No plans here yet.'), 'filtered empty state');
    await click(button('All plans'));
    assert.equal(document.querySelectorAll('.wl-card').length, 1);
    failBrowse = true;
    await click(button('Find experiences'));
    await wait(() => text().includes('Experiences temporarily unavailable'), 'browse failure');
    assert.equal(document.querySelectorAll('.wl-card').length, 0);
    failBrowse = false;
    await click(button('Retry'));
    await wait(() => document.querySelectorAll('.wl-card').length === 1, 'browse retry');
    pass('real published feed, duration/location filters, honest empty/error states and retry');

    await mount('', null, party.publicSlug);
    await wait(() => button('Reserve my spot'), 'public /c-style landing');
    assert.ok(document.querySelector('[data-testid="wanderly"]'));
    assert.ok(!text().includes('Private gathering'), 'unlisted plans do not leak through context');
    assert.ok(text().includes('Door option') && text().includes('What should I bring?'));
    await click(button('Reserve my spot')); await click(button('Confirm'));
    await wait(() => text().includes('Sign in to reserve'), 'anonymous registration gate');
    assert.equal(document.querySelector('[role="dialog"]'), null);
    pass('public campaign links use Wanderly; tiered events retain a real registration form and sign-in');

    await mount('wanderly/experience/' + party.publicSlug, guest.token);
    await click(await wait(() => button('Reserve my spot'), 'free reservation'));
    await click(button('Confirm'));
    await wait(() => text().includes('Registration registered'), 'registered response');
    const regs = await call(`/api/campaigns/${party.id}/registrations`, host.token);
    assert.equal(regs.registrations.length, 1);
    assert.ok(regs.registrations[0].ticketCode);
    assert.ok(document.querySelector('a[href="#wanderly/tickets"]'));
    await mount('wanderly/experience/' + party.publicSlug, guest.token);
    await click(await wait(() => button('Reserve my spot'), 'same-tab reload'));
    await click(button('Confirm'));
    await wait(() => text().includes('Registration registered'), 'idempotent reservation');
    const repeated = await call(`/api/campaigns/${party.id}/registrations`, host.token);
    assert.equal(repeated.registrations.length, 1, 'same-tab reload does not consume another seat');
    const wallet = await call('/api/ticket-market/me/tickets', guest.token);
    const issued = wallet.tickets.find(t => t.eventSlug === party.publicSlug);
    assert.equal(issued.scanCode, repeated.registrations[0].ticketCode + '#1');
    pass('free reservations survive reload idempotently and issue the existing versioned admission ticket');

    await go('wanderly/experience/' + trip.publicSlug);
    await click(await wait(() => button('Reserve at the price above'), 'paid reservation'));
    await click(button('Confirm'));
    await wait(() => text().includes('Awaiting payment confirmation'), 'no fake paid ticket');
    const paid = await call(`/api/campaigns/${trip.id}/registrations`, host.token);
    assert.equal(paid.registrations[0].status, 'started');
    assert.ok(!text().includes(paid.registrations[0].ticketCode), 'pending code is not shown as admission');
    await go('wanderly/experience/' + full.publicSlug);
    assert.ok((await wait(() => button('Fully booked'), 'sold out state')).disabled);
    pass('paid reservations remain pending payment; capacity disables booking without invented settlement');

    await mount('host', null);
    await wait(() => text().includes('Sign in to Wanderly'), 'legacy host signin');
    await mount('wanderly/host', host.token);
    await wait(() => document.querySelector('[aria-label="Event title"]'), 'inline host form');
    assert.equal(document.querySelector('[role="dialog"]'), null);
    await type(document.querySelector('[aria-label="Event title"]'), 'Kampala long weekend');
    await type(document.querySelector('[aria-label="Event location"]'), 'Kampala');
    const starts = document.querySelector('input[type="datetime-local"]');
    const ends = document.querySelectorAll('input[type="datetime-local"]')[1];
    await type(starts, future(14).slice(0, 16)); await type(ends, future(16).slice(0, 16));
    const currency = document.querySelector('[aria-label="Currency"]');
    await act(async () => { currency.value = 'UGX'; currency.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    failPublish = true;
    await click(button('Publish plan'));
    await wait(() => text().includes('saved as a draft'), 'draft failure');
    assert.equal(campaignCreates, 1);
    failPublish = false;
    await click(button('Retry publishing'));
    await wait(() => document.querySelector('.wl-experience') && text().includes('Kampala long weekend'), 'published detail');
    assert.equal(campaignCreates, 1, 'publish retry reuses saved draft');
    const hosted = await call('/api/campaigns', host.token);
    const row = hosted.campaigns.find(c => c.title === 'Kampala long weekend');
    assert.equal(row.currency, 'UGX'); assert.equal(row.status, 'published');
    assert.ok(isTrip(row));
    assert.equal(window.location.hash, '#wanderly/experience/' + row.publicSlug);
    pass('host publishes from the same product; failed publish retries reuse the draft and preserve currency/dates');

    // ---------------------------------------------------------------------
    // EDIT + WITHDRAW. An offer can be edited after publication and withdrawn
    // at any time — but a withdrawal is a state, not a delete, so the people
    // and the money it touched keep their records.
    // ---------------------------------------------------------------------
    await mount('wanderly/hosting', host.token);
    await wait(() => by(`edit-${trip.id}`), 'hosting list with actions');
    await click(by(`edit-${trip.id}`));
    await wait(() => text().includes('Edit this plan'), 'edit sheet opens');
    assert.ok(await wait(() => document.querySelector('[aria-label="Event title"]'), 'prefilled title'),
      'the form opens on the row, not blank');
    assert.equal(document.querySelector('[aria-label="Event title"]').value, 'Naivasha weekend',
      'with the real title in it');
    assert.ok(document.querySelector('[aria-label="Team size"]').disabled,
      'and the capacity is locked, because publication already locked it');
    await type(document.querySelector('[aria-label="Event title"]'), 'Naivasha weekend (moved)');
    await click(button('Save changes'));
    await wait(() => by(`receipt-${trip.id}`) === null && text().includes('Naivasha weekend (moved)'), 'edit saved');
    assert.ok(!text().includes('Publish plan'), 'saving an edit does not republish it');
    const edits = await call(`/api/campaigns/${trip.id}/revisions`, host.token);
    assert.equal(edits.revisions.length, 1, 'the edit is on the record');
    assert.deepEqual(edits.revisions[0].fields, ['title']);
    assert.equal(edits.revisions[0].before.title, 'Naivasha weekend');
    const toldGuest = await call('/api/notifications', guest.token);
    assert.ok(toldGuest.notifications.some(n => n.type === 'event_changed'),
      'and the person holding a place is told the terms moved');

    // An edit form only writes what it can faithfully round-trip: the party has
    // a line-up and FAQ built by another form, and renaming it must leave every
    // one of those exactly as it was.
    await click(by(`edit-${party.id}`));
    await wait(() => text().includes('Edit this plan'), 'edit the festival plan');
    await type(document.querySelector('[aria-label="Event title"]'), 'Nairobi community night II');
    await click(button('Save changes'));
    await wait(() => text().includes('Nairobi community night II') && !text().includes('Save changes'), 'party renamed');
    const afterEdit = (await call(`/api/campaigns/${party.id}`, host.token)).campaign;
    assert.equal(afterEdit.festival.priceTiers[0].name, 'Door option', 'the line-up survived an unrelated edit');
    assert.equal(afterEdit.festival.faqs[0].q, 'What should I bring?', 'and so did the FAQ');
    assert.equal(afterEdit.startsAt, party.startsAt,
      'the start time is byte-for-byte what it was: an untouched field is not rewritten to the minute');
    const partyEdits = await call(`/api/campaigns/${party.id}/revisions`, host.token);
    assert.deepEqual(partyEdits.revisions[0].fields, ['title'], 'and only the field the host actually changed is recorded');

    await click(by(`withdraw-${trip.id}`));
    await wait(() => text().includes('Withdraw “Naivasha weekend (moved)”?'), 'withdraw confirmation');
    assert.ok(text().includes('1 held or registered place released'), 'the consequences are counted, not gestured at');
    assert.ok(text().includes('No money has been taken, so there is nothing to refund'),
      'and an unsettled reservation is not described as money coming back');
    assert.ok(text().includes('1 person is told'));
    await click(button('Withdraw this plan'));
    await wait(() => by(`receipt-${trip.id}`), 'receipt after withdrawing');
    assert.ok(text().includes('The record stays.'));
    const afterWithdrawal = await call(`/api/campaigns/${trip.id}/withdrawal`, host.token);
    assert.equal(afterWithdrawal.withdrawal.receipt.registrationsCancelled, 1, 'the seat was released');
    assert.equal(afterWithdrawal.withdrawal.receipt.owed.length, 0, 'nothing is owed');
    assert.equal((await call('/api/events?limit=100', null)).events.some(e => e.slug === trip.publicSlug), false,
      'and the withdrawn plan is gone from the public feed');
    const withdrawnGuest = await call('/api/notifications', guest.token);
    assert.ok(withdrawnGuest.notifications.some(n => n.type === 'event_withdrawn'),
      'the person who held a place was told it was withdrawn');

    // Delete is offered, but the server refuses it while records depend on the
    // row — and the surface repeats the reasons instead of hiding the failure.
    await click(by(`delete-${trip.id}`));
    await wait(() => text().includes('withdrawing it instead keeps those records'), 'refused delete is explained');
    assert.ok(text().includes('2 registrations') || text().includes('1 registration'),
      'and names what is actually in the way');
    assert.ok((await call('/api/campaigns', host.token)).campaigns.some(c => c.id === trip.id),
      'the row is still there after the refusal');

    // A draft nothing happened to can simply go.
    const throwaway = await call('/api/campaigns', host.token, 'POST', { title: 'Nothing happened yet', type: 'event', startsAt: future(30) });
    await click(button('Retry'));
    await wait(() => by(`delete-${throwaway.campaign.id}`), 'refreshed list');
    await click(by(`delete-${throwaway.campaign.id}`));
    await wait(() => by(`delete-${throwaway.campaign.id}`) === null, 'draft deleted');
    assert.equal((await call('/api/campaigns', host.token)).campaigns.some(c => c.id === throwaway.campaign.id), false);
    pass('an offer can be edited and withdrawn; a row with a history cannot be deleted, and says why');

    await mount('wanderly/tickets', guest.token);
    await wait(() => text().includes('Nairobi community night'), 'issued ticket in account');
    await act(async () => { api.setSessionToken(null); });
    await wait(() => text().includes('Sign in to Wanderly'), 'private tickets cleared');
    assert.ok(!text().includes('Nairobi community night'));
    pass('My tickets uses issued tickets and clears private content when the session changes');

    for (const alias of ['events', 'city/events', 'destinations/tokyo']) {
      await mount(alias, host.token);
      await wait(() => document.querySelector('[data-testid="wanderly"]'), alias);
      assert.equal(document.querySelector('[data-testid="seller-home"]'), null);
    }
    await go('home');
    localStorage.setItem('brief.firstRunDismissed', '1');
    await mount('home', host.token);
    await wait(() => document.querySelector('[data-testid="seller-home"]'), 'home');
    assert.equal(document.querySelectorAll('.compact-work-entry').length, 0);
    await click(await wait(() => document.querySelector('[aria-label="Open all sections"]'), 'menu'));
    await click(await wait(() => by('wanderly'), 'Wanderly menu entry'));
    await wait(() => document.querySelector('[data-testid="wanderly"]'), 'menu into Wanderly');
    assert.equal(document.querySelector('[data-testid="nav-sheet-panel"]'), null);
    pass('actual shell aliases and drawer open one product, bypass onboarding, and do not leave a modal behind');

    localStorage.setItem('brief.firstRunDismissed', '1');
    await mount('you/orders', host.token);
    await wait(() => window.location.hash === '#spaces/orders', 'legacy commerce redirect');
    await wait(() => text().includes('Offers and orders your business manages.'), 'legacy orders lands in the Selling workspace');
    assert.equal(document.querySelector('[aria-label="You"]'), null);
    await go('you');
    await wait(() => by('you-profile-head'), 'profile');
    assert.equal(document.querySelectorAll('[data-testid="you-tile-grid"] details').length, 3);
    assert.equal(document.querySelectorAll('[data-testid="you-tile-grid"] details[open]').length, 0);
    await click(by('standing'));
    await wait(() => by('you-detail'), 'inline detail');
    assert.equal(document.querySelector('[data-testid="you-tile-grid"]'), null);
    assert.equal(document.querySelector('[data-testid="sheet"]'), null);
    await click(document.querySelector('[aria-label="Back to You"]'));
    await wait(() => by('you-profile-head'), 'back to You');
    pass('You has three collapsed groups and inline details; the legacy Orders/Selling URL resolves to Selling');

    console.log(`PASSED ${passed} FAILED 0`);
  } finally { if (root) act(() => root.unmount()); server.kill(); await sleep(80); fs.rmSync(dir, { recursive: true, force: true }); }
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
