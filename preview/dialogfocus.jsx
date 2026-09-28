const assert = require('assert').strict;
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://brief.test/', pretendToBeVisual: true });
global.window = dom.window; global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const { Sheet } = require('./src/ui/Sheet.tsx');
const { NavSheet } = require('./src/app/NavSheet.tsx');
const root = createRoot(document.querySelector('#root'));
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }
const key = async (name, shiftKey = false) => {
  await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true })));
};
const click = async (selector) => { await act(async () => { const button = document.querySelector(selector); button.focus(); button.click(); }); };
function Example() {
  const [outer, setOuter] = React.useState(false);
  const [inner, setInner] = React.useState(false);
  const [menu, setMenu] = React.useState(false);
  return <>
    <button id="open-outer" onClick={() => setOuter(true)}>Open sheet</button>
    <button id="open-menu" onClick={() => setMenu(true)}>Open menu</button>
    <NavSheet open={menu} onClose={() => setMenu(false)} onGo={() => {}} place="" onSetPlace={() => {}} />
    <Sheet open={outer} title="First" onClose={() => setOuter(false)}>
      <button id="open-inner" onClick={() => setInner(true)}>Open inner</button>
      <button id="last-outer">Last outer</button>
      <Sheet open={inner} title="Second" onClose={() => setInner(false)}>
        <button id="first-inner">First inner</button>
        <button id="last-inner">Last inner</button>
      </Sheet>
    </Sheet>
  </>;
}
(async () => {
  await act(async () => root.render(<Example />));
  await click('#open-outer');
  check('opening a sheet focuses inside and preserves dialog semantics', () => {
    assert.equal(document.activeElement.id, 'open-inner');
    assert.equal(document.querySelector('[data-testid="sheet"]').getAttribute('aria-modal'), 'true');
  });
  document.querySelector('#last-outer').focus(); await key('Tab');
  check('Tab wraps to first control', () => assert.equal(document.activeElement.id, 'open-inner'));
  await key('Tab', true);
  check('Shift+Tab wraps to last control', () => assert.equal(document.activeElement.id, 'last-outer'));
  await click('#open-inner');
  check('nested dialog moves focus to its own content', () => assert.equal(document.activeElement.id, 'first-inner'));
  document.querySelector('#last-inner').focus(); await key('Tab');
  check('nested dialog traps Tab rather than jumping to its parent', () => assert.equal(document.activeElement.id, 'first-inner'));
  await key('Escape');
  check('Escape closes only the top sheet and restores the nested invoker', () => {
    assert.equal(document.querySelectorAll('[data-testid="sheet"]').length, 1);
    assert.equal(document.activeElement.id, 'open-inner');
  });
  await key('Escape');
  check('closing the outer sheet returns focus to the opener', () => {
    assert.equal(document.querySelectorAll('[data-testid="sheet"]').length, 0);
    assert.equal(document.activeElement.id, 'open-outer');
  });
  await click('#open-menu');
  check('menu starts inside its dialog', () => {
    assert.equal(document.querySelector('[aria-label="Menu"]').getAttribute('aria-modal'), 'true');
    assert.equal(document.activeElement.getAttribute('aria-label'), 'Close the menu');
  });
  await key('Escape');
  check('menu Escape restores invoking button', () => assert.equal(document.activeElement.id, 'open-menu'));
  await act(async () => root.unmount());
  console.log(`PASSED ${checks} FAILED 0`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
