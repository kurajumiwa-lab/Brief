// ---------------------------------------------------------------------------
// WORKFORCE DESK SUITE — the real UI against the REAL server.
//
// No canned JSON: the suite boots server/src/index.js on a scratch data dir
// and bridges the client's `/ingest/*` fetches to it, so every screen renders
// what the domain actually returns. Two people drive the desk:
//
//   Owner   creates a workforce, a territory and a program, publishes it,
//           activates the worker (placing them in one step), returns a
//           submission with a reason, approves the correction and the visit.
//   Worker  sets up a profile, accepts terms, joins by code, reads the
//           briefing, takes a task, submits, corrects after a return, takes
//           the field step (photos, location, consent) and sees earnings.
//
// Money assertions are exact: KES 300 per approved merchant, 20% provisional
// Brief fee -> KES 240 to workers, split 60 (call) + 180 (visit). Nothing is
// payable until the whole merchant is approved.
// ---------------------------------------------------------------------------
const assert = require('assert').strict;
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const { JSDOM } = require('jsdom');

const realFetch = globalThis.fetch;
const NodeFile = globalThis.File;
const NodeURL = globalThis.URL;

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://brief.test/#workforce', pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.MouseEvent = dom.window.MouseEvent;
global.getComputedStyle = dom.window.getComputedStyle;
global.IS_REACT_ACT_ENVIRONMENT = true;
global.localStorage = dom.window.localStorage;
// Photo previews use object URLs; jsdom has none, Node's URL does.
dom.window.URL.createObjectURL = NodeURL.createObjectURL;
dom.window.URL.revokeObjectURL = NodeURL.revokeObjectURL;
// The phone is standing inside the Westlands territory.
Object.defineProperty(dom.window.navigator, 'geolocation', {
  configurable: true,
  value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: -1.2680, longitude: 36.8110, accuracy: 9 } }), 5) }
});

const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react-dom/test-utils');
const api = require('./src/api/briefApi.ts');
const { WorkforceDesk } = require('./src/features/workforce/WorkforceDesk.tsx');

let count = 0;
const pass = (name) => { count++; console.log('PASS ' + name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the real server ──────────────────────────────────────────────────────────
const PORT = 20000 + Math.floor(Math.random() * 20000);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-workforce-ui-'));
const BASE = `http://127.0.0.1:${PORT}`;
const serverProc = spawn(process.execPath, [path.resolve(__dirname, '../server/src/index.js')], {
  env: { ...process.env, PORT: String(PORT), BRIEF_DATA_DIR: DATA, NODE_ENV: 'development', BRIEF_DEV_AUTH: '0', LOG_LEVEL: 'error' },
  stdio: ['ignore', 'ignore', 'pipe']
});
let serverErr = '';
serverProc.stderr.on('data', (d) => { serverErr += d; });
const shutdown = async () => {
  // Wait for the server to exit before removing its data dir: it may still be flushing.
  const exited = new Promise((r) => (serverProc.exitCode !== null ? r() : serverProc.once('exit', r)));
  try { serverProc.kill('SIGTERM'); } catch { /* gone */ }
  await Promise.race([exited, sleep(3000)]);
  try { fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ }
};

// The client calls `/ingest/api/...`; forward to the server with the body and
// headers untouched (FormData included, so photo uploads are real uploads).
global.fetch = (input, init = {}) => {
  const url = String(input?.url ?? input);
  const target = url.startsWith('/ingest') ? BASE + url.slice('/ingest'.length) : url;
  return realFetch(target, init);
};
const http = async (p, token, method = 'GET', body) => {
  const r = await realFetch(BASE + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};

// ── DOM helpers ──────────────────────────────────────────────────────────────
let root = null;
function mount(hash) {
  if (root) act(() => root.unmount());
  document.body.innerHTML = '';
  dom.window.history.replaceState(null, '', hash);
  const c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
  act(() => root.render(React.createElement(WorkforceDesk)));
}
const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const page = () => text(document.body);
const all = (sel, scope = document) => Array.from(scope.querySelectorAll(sel));
const byTestId = (id, scope = document) => scope.querySelector(`[data-testid="${id}"]`);
const button = (label, scope = document) => all('button', scope).find((b) => text(b) === label || text(b).startsWith(label));
async function waitFor(fn, what, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    let v;
    try { v = fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}\n--- page ---\n${page().slice(0, 1500)}`);
    await act(async () => { await sleep(25); });
  }
}
async function click(el, what = 'element') {
  assert.ok(el, `click: no ${what}`);
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); await sleep(10); });
}
async function type(el, value, what = 'field') {
  assert.ok(el, `type: no ${what}`);
  const proto = el.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new dom.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}
// The input inside the <Field> whose caption starts with `label`.
const field = (label, scope = document) => {
  const l = all('label', scope).find((x) => text(x.querySelector('span')).startsWith(label));
  return l?.querySelector('input:not([type=checkbox]), textarea, select') ?? null;
};
const checkbox = (labelText, scope = document) => all('label', scope).find((l) => text(l).startsWith(labelText))?.querySelector('input[type=checkbox]');
const tab = (name) => all('[role=tab]').find((b) => text(b).startsWith(name));
const as = (session) => api.setSessionToken(session.token);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

(async () => {
  try {
    // Wait for the server.
    for (let i = 0; ; i++) {
      try { if ((await realFetch(BASE + '/api/work-templates')).status === 401) break; } catch { /* booting */ }
      if (i > 150) throw new Error('server did not start\n' + serverErr.slice(-2000));
      await sleep(100);
    }
    const reg = async (handle) => (await http('/api/auth/register', null, 'POST', { handle, password: 'a long ui test passphrase' })).body;
    const owner = await reg('ui_owner');
    const worker = await reg('ui_worker');
    assert.ok(owner?.token && worker?.token, 'registered');

    // ── signed out ──
    api.setSessionToken(null);
    mount('#workforce');
    await waitFor(() => page().includes('Sign in to see your work'), 'signed-out worker view');
    await click(tab('Organisation'), 'Organisation tab');
    await waitFor(() => page().includes('Sign in to manage a workforce'), 'signed-out org view');
    assert.equal(dom.window.location.hash, '#workforce/org');
    pass('signed out: both views say to sign in instead of showing an empty desk');

    // ── owner: workforce, territory, program ──
    as(owner);
    mount('#workforce/org');
    await waitFor(() => byTestId('create-workforce'), 'create workforce card');
    await type(document.querySelector('input[aria-label="Workforce name"]'), 'Westlands Field Team');
    await click(byTestId('create-workforce-btn'), 'create workforce');
    await waitFor(() => page().includes('Westlands Field Team') && tab('Programs'), 'desk header');
    await click(tab('People'), 'People tab');
    const code = text(await waitFor(() => byTestId('join-code'), 'join code'));
    assert.match(code, /^[A-Z2-9]{8}$/);
    assert.ok(page().includes('No one has joined yet'));
    pass('owner: creates a workforce and gets a shareable 8-letter join code');

    await click(tab('Territories'), 'Territories tab');
    await waitFor(() => byTestId('new-territory'), 'territory form');
    await type(field('Name'), 'Westlands');
    await type(field('Areas inside it'), 'Westlands, Parklands');
    await type(field('Centre latitude'), '-1.2676');
    await type(field('Centre longitude'), '36.8108');
    await type(field('Radius (km)'), '3');
    await click(byTestId('create-territory'), 'create territory');
    await waitFor(() => page().includes('Parklands') && !field('Name')?.value, 'territory in the list');
    pass('owner: draws a territory with a centre and radius');

    await click(tab('Programs'), 'Programs tab');
    await click(await waitFor(() => byTestId('new-program-btn'), 'new program button'));
    const form = await waitFor(() => byTestId('new-program'), 'program form');
    await type(field('Task type', form), 'merchant_onboarding');
    await type(field('Title', form), 'Sign up 5 shops in Westlands');
    await type(field('Target', form), '5');
    await type(field('KES per approved unit', form), '300');
    await type(field('Deadline', form), new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10));
    await act(async () => { checkbox('Westlands', form).click(); });
    await click(byTestId('create-program'), 'create program');
    const card = await waitFor(() => byTestId('program-card'), 'program card');
    assert.ok(text(card).includes('Sign up 5 shops in Westlands'));
    await click(card.querySelector('button'), 'open program');
    await waitFor(() => byTestId('publish-program'), 'publish button');
    // The rate card is the server's, in whole shillings.
    assert.ok(page().includes('KES 240') || page().includes('KES 60'), 'rate card shows worker shares');
    await click(byTestId('publish-program'), 'publish');
    await waitFor(() => page().includes('Program open'), 'published notice');
    pass('owner: creates a draft program from a template and publishes it');

    // ── worker: onboarding on the phone ──
    as(worker);
    mount('#workforce');
    const profileForm = await waitFor(() => byTestId('worker-profile-form'), 'profile form');
    await type(field('Your name', profileForm), 'Wanjiku Kamau');
    await type(field('Mobile number', profileForm), '0712345678');
    await act(async () => { checkbox('From home', profileForm).click(); checkbox('In the field', profileForm).click(); checkbox('My phone can share', profileForm).click(); });
    await click(byTestId('save-worker-profile'), 'save profile');
    await waitFor(() => page().includes('Hello, Wanjiku') && byTestId('work-terms'), 'terms after profile');
    await click(byTestId('accept-terms'), 'accept terms');
    await waitFor(() => page().includes('Terms accepted'), 'terms accepted');
    await type(document.querySelector('input[aria-label="Workforce code"]'), code.toLowerCase());
    await click(byTestId('join-workforce'), 'join');
    const membership = await waitFor(() => byTestId('membership'), 'membership card');
    assert.ok(text(membership).includes('Westlands Field Team'));
    assert.ok(text(membership).includes('applied'));
    assert.ok(text(membership).includes('Placed in a territory'), 'checklist names the territory step');
    await click(button('Merchant onboarding'), 'briefing chip');
    await waitFor(() => byTestId('work-briefing'), 'briefing card');
    assert.ok(page().includes('recorded consent'), 'briefing states the evidence');
    await click(byTestId('ack-briefing'), 'acknowledge briefing');
    await waitFor(() => page().includes('Briefed on merchant onboarding'), 'briefed');
    // Not active yet: the program is listed under "needs a step first" with the exact reason.
    await waitFor(() => page().includes('Needs a step first'), 'blocked section');
    assert.ok(!byTestId('claim-work'), 'cannot claim before activation');
    pass('worker: profile, terms, join by code (any case), briefing — and is told exactly why they cannot take work yet');

    // ── owner: activation (placement + activation in one tap) ──
    as(owner);
    mount('#workforce/org');
    await waitFor(() => tab('People'), 'desk');
    await click(tab('People'));
    const member = await waitFor(() => byTestId('member-card'), 'member card');
    assert.ok(text(member).includes('Wanjiku Kamau'));
    assert.ok(text(member).includes('onboarding 3/5'), text(member));
    await click(member.querySelector('button'), 'open member');
    await act(async () => { checkbox('Westlands', member).click(); });
    await click(byTestId('activate-member'), 'activate');
    await waitFor(() => page().includes('activate done'), 'activated notice');
    assert.ok(text(byTestId('member-card')).includes('active'));
    assert.ok(text(byTestId('member-card')).includes('Westlands'));
    pass('owner: ticks a territory and activates in one step; the roster shows the placement');

    // ── worker: take the call step and submit ──
    as(worker);
    mount('#workforce');
    const avail = await waitFor(() => byTestId('available-work'), 'available work');
    assert.ok(text(avail).includes('Sign up 5 shops in Westlands'));
    assert.ok(text(avail).includes('KES 60'), 'first step pays its stated share: ' + text(avail));
    await click(byTestId('claim-work'), 'claim');
    await click(await waitFor(() => byTestId('open-task'), 'held task'), 'start task');
    let runner = await waitFor(() => byTestId('task-runner'), 'task runner');
    // Fill every answer: yes/no pills get "Yes", text gets a value, phone a number.
    const fillStep = async (scope) => {
      for (const l of all('label', scope)) {
        const pills = all('button[aria-pressed]', l);
        if (pills.length) { await click(pills.find((b) => text(b) === 'Yes')); continue; }
        const inp = l.querySelector('input:not([type=checkbox]):not([type=file])');
        if (inp && !inp.value) await type(inp, inp.inputMode === 'tel' ? '0722333444' : inp.inputMode === 'decimal' ? '4' : 'Mama Njeri Hardware');
      }
    };
    await fillStep(runner);
    await click(byTestId('submit-proof'), 'submit');
    await waitFor(() => page().includes('Submitted'), 'submitted notice');
    pass('worker: accepts the call step, answers it and submits');

    // ── owner: return with a reason ──
    as(owner);
    mount('#workforce/org');
    await waitFor(() => tab('Review (1)'), 'review tab with a count');
    await click(tab('Review'));
    let item = await waitFor(() => byTestId('review-item'), 'review item');
    assert.ok(text(item).includes('Wanjiku Kamau'));
    await click(button('Return', item), 'return without reason');
    await waitFor(() => text(byTestId('review-item')).includes('say why') , 'reason required');
    assert.ok(byTestId('review-item'), 'still in the queue after a reasonless return');
    await type(item.querySelector('input[aria-label="Reason"], textarea[aria-label="Reason"]'), 'Please add the owner phone number you called');
    await click(button('Return', item), 'return');
    await waitFor(() => !byTestId('review-item'), 'queue emptied');
    pass('owner: a return needs a reason the worker can read; with one it leaves the queue');

    // ── worker: sees the reason and corrects ──
    as(worker);
    mount('#workforce');
    await click(await waitFor(() => all('[data-testid="open-task"]').find((b) => text(b) === 'Correct'), 'Correct button'), 'correct');
    runner = await waitFor(() => byTestId('task-runner'), 'runner');
    assert.ok(text(runner).includes('Returned for correction'));
    assert.ok(text(runner).includes('Please add the owner phone number you called'));
    await fillStep(runner);
    await click(byTestId('submit-proof'), 'resubmit');
    await waitFor(() => page().includes('Submitted'), 'resubmitted');
    pass('worker: reads the return reason on the task and resubmits');

    // ── owner: approve the call; the visit step opens ──
    as(owner);
    mount('#workforce/org');
    await click(await waitFor(() => tab('Review (1)'), 'review'), 'review tab');
    item = await waitFor(() => byTestId('review-item'), 'item');
    assert.ok(text(item).match(/return/i), 'earlier review is shown');
    await click(byTestId('approve-task'), 'approve');
    await waitFor(() => !byTestId('review-item'), 'approved');
    pass('owner: sees the earlier return next to the correction and approves');

    // ── worker: the field step with real photo uploads, location and consent ──
    as(worker);
    mount('#workforce');
    await waitFor(() => page().includes('KES 60') && page().includes('waiting for the outcome'), 'earnings: step 1 awaiting outcome');
    {
      // Stat cards read "value label": check the value right before each label, and the rows.
      const before = (label) => (page().match(new RegExp('(KES [\\d,]+)\\s*' + label)) || [])[1];
      console.log('    earnings on screen:', JSON.stringify({ payable: before('approved outcomes'), awaiting: before('waiting for the outcome'), confirmed: before('confirmed by finance') }));
      assert.equal(before('approved outcomes'), 'KES 0', 'nothing payable until the merchant is approved');
      assert.equal(before('waiting for the outcome'), 'KES 60');
      const mid = (await http('/api/me/work', worker.token)).body.earnings;
      assert.deepEqual([mid.payableKes, mid.awaitingOutcomeKes], [0, 60]);
    }
    await waitFor(() => page().includes('Next steps near you'), 'next step');
    await click(all('button').find((b) => text(b) === 'Accept'), 'accept visit');
    runner = await waitFor(() => byTestId('task-runner'), 'visit runner');
    assert.ok(text(runner).includes('Photos — at least 2'));
    // Submitting without the evidence is refused by the server, and said plainly.
    await click(byTestId('submit-proof'), 'submit empty');
    await waitFor(() => text(byTestId('task-runner')).match(/photo/i) && !page().includes('Submitted'), 'refusal shown');
    const fileInput = runner.querySelector('input[type=file]');
    const files = [1, 2].map((i) => new NodeFile([Buffer.concat([PNG, Buffer.from('ui' + i)])], `shop${i}.png`, { type: 'image/png' }));
    Object.defineProperty(fileInput, 'files', { configurable: true, value: files });
    await act(async () => { fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    await waitFor(() => all('button[aria-label="Remove photo"]', byTestId('task-runner')).length === 2, 'two photos uploaded');
    await click(button('Capture location', byTestId('task-runner')), 'capture location');
    await waitFor(() => text(byTestId('task-runner')).includes('-1.26800, 36.81100'), 'location shown');
    await fillStep(byTestId('task-runner'));
    await type(all('input', byTestId('task-runner')).find((i) => i.placeholder === 'Name of the person consenting'), 'Njeri Wambui');
    await act(async () => { checkbox('They agreed', byTestId('task-runner')).click(); });
    await click(byTestId('submit-proof'), 'submit visit');
    await waitFor(() => page().includes('All automatic checks passed'), 'clean submission');
    pass('worker: uploads two private photos, captures location inside the territory, records consent — all checks pass');

    // ── owner: reviews the visit with photos and checks, approves ──
    as(owner);
    mount('#workforce/org');
    await click(await waitFor(() => tab('Review (1)'), 'review'), 'review tab');
    item = await waitFor(() => byTestId('review-item'), 'visit item');
    assert.ok(text(item).includes('Njeri Wambui'), 'consent shown to the reviewer');
    await waitFor(() => all('img', byTestId('review-item')).filter((i) => (i.getAttribute('src') || '').startsWith('blob:')).length === 2, 'private photos fetched with auth');
    assert.ok(all('a', item).some((a) => (a.href || '').includes('openstreetmap.org')), 'map link for the location');
    await click(byTestId('approve-task'), 'approve visit');
    await waitFor(() => !byTestId('review-item'), 'approved visit');
    await click(tab('Programs'));
    await click((await waitFor(() => byTestId('program-card'), 'card')).querySelector('button'));
    await waitFor(() => page().includes('KES 300') && page().includes('KES 1,500'), 'dashboard money: verified 300 of 1,500');
    pass('owner: approves with photos, map link and consent in view; the dashboard shows KES 300 verified of KES 1,500');

    // ── worker: now it is payable, and exactly the stated fees ──
    as(worker);
    mount('#workforce');
    await waitFor(() => page().includes('KES 240'), 'payable 240');
    const home = await http('/api/me/work', worker.token);
    assert.equal(home.body.earnings.payableKes, 240);
    assert.deepEqual(home.body.earnings.rows.map((r) => r.feeKes).sort((a, b) => a - b), [60, 180]);
    assert.equal(home.body.earnings.confirmedKes, 0, 'nothing is "paid" until finance confirms');
    pass('worker: KES 240 payable (60 + 180) once the merchant is approved; confirmed stays 0 until finance acts');

    console.log(`\nPASSED ${count}   FAILED 0`);
  } catch (e) {
    console.error(e && e.stack ? e.stack : e);
    if (serverErr) console.error('--- server stderr ---\n' + serverErr.slice(-1500));
    console.log(`\nPASSED ${count}   FAILED 1`);
    process.exitCode = 1;
  } finally {
    if (root) act(() => root.unmount());
    await shutdown();
    process.exit(process.exitCode ?? 0);
  }
})();
