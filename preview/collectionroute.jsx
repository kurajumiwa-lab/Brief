// The production entry routes public collection URLs to the real read-only
// collection component, not to the test-harness App.tsx.
const assert = require('assert').strict;
const fs = require('fs');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://brief.test/collections/pcol_public' });
global.window = dom.window; global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.HTMLElement = dom.window.HTMLElement;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const { CollectionPage } = require('./src/components/CollectionPage.tsx');
let reads = [], missing = false, count = 0;
global.fetch = async (url, init) => {
  reads.push({ url: String(url), token: init?.headers?.authorization });
  return { ok: !missing, status: missing ? 404 : 200, text: async () => JSON.stringify(missing ? { error: 'not found' }
    : { collection: { id: 'pcol_public', name: 'Public shelf', description: '', visibility: 'public', cover: { kind: 'none' }, items: [], count: 0, locations: { areas: [], counties: [] } } }) };
};
const check = (name, fn) => { fn(); count++; console.log('PASS ' + name); };
(async () => {
  const entry = fs.readFileSync(require('path').resolve(__dirname, 'src/main.jsx'), 'utf8');
  check('actual production entry dispatches /collections/:id without App.tsx', () => {
    assert.match(entry, /collections\\\/\(\[A-Za-z0-9_-/);
    assert.match(entry, /<CollectionPage collectionId=\{collection\} mode="public"/);
    assert.doesNotMatch(entry, /import\s+App\s+from\s+['"]\.\/App/);
  });
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(<CollectionPage collectionId="pcol_public" mode="public" onClose={() => {}} onOpenObject={() => {}} />));
  check('public page reads only the public projection and shows real shelf name', () => {
    assert.equal(reads[0].url, '/ingest/api/collections/personal/pcol_public');
    assert.equal(reads[0].token, undefined);
    assert.match(document.body.textContent, /Public shelf/);
    assert.equal(document.querySelector('button[aria-label="Delete"]'), null);
  });
  missing = true;
  await act(async () => root.render(<CollectionPage collectionId="pcol_private" mode="public" onClose={() => {}} onOpenObject={() => {}} />));
  check('private/unknown URL has a generic unavailable state', () => {
    assert.equal(reads.at(-1).url, '/ingest/api/collections/personal/pcol_private');
    assert.match(document.body.textContent, /isn't available/);
  });
  await act(async () => root.unmount());
  console.log(`PASSED ${count} FAILED 0`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
