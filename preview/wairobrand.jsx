// ---------------------------------------------------------------------------
// WAIRO BRAND — the card is the mark and the four hues. The mockups are not.
//
// The knot and wordmark stay distinct from the seller workspace navigation:
// Home · Selling · Spaces · You. Trust-score screens, fabricated bids and
// stock photos remain refused.
// ---------------------------------------------------------------------------
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://brief.test/', pretendToBeVisual: true });
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

const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react-dom/test-utils');
const { WairoMark } = require('./src/components/WairoMark.tsx');
const { AppBelt } = require('./src/app/AppBelt.tsx');
const { BOTTOM_BAR_ITEMS } = require('./src/app/Navigation.tsx');
const { YOU_SECTION_IDS, SECTION_TITLES } = require('./src/features/you/YouSurface.tsx');

let passed = 0;
let failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name); }
};
const flush = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const text = (el) => (el && el.textContent ? el.textContent : '').replace(/\s+/g, ' ').trim();
const src = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ banners: [] }) });

async function main() {
  {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(React.createElement(WairoMark, { size: 28, title: 'Wairo' })));
    const svg = host.querySelector('svg');
    check('the knot renders as an image named Wairo', Boolean(svg) && svg.getAttribute('aria-label') === 'Wairo');
    check('the knot is the blue-into-chama-green pair from the card',
      /#2563EB/.test(host.innerHTML) && /#10B981/.test(host.innerHTML));
    root.unmount(); host.remove();
  }

  {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(React.createElement(AppBelt, { onOpenSheet: () => {}, onHome: () => {}, onSearch: () => {} }));
    });
    await flush();
    const t = text(host);
    const mark = host.querySelector('[data-testid="wairo-wordmark"]');
    const avenue = host.querySelector('[data-testid="wairo-avenue"]');
    check('the band wordmark is Wairo', Boolean(mark) && text(mark) === 'Wairo');
    check('Blue Avenue sits on the band with the wordmark', Boolean(avenue) && text(avenue) === 'Blue Avenue');
    check('the band no longer says Trace as the product name', !/\bTrace\b/.test(t));
    check('the home control is labelled Wairo home',
      Boolean(host.querySelector('[aria-label="Wairo home"]')));
    root.unmount(); host.remove();
  }

  {
    const doors = BOTTOM_BAR_ITEMS.filter((i) => i.type === 'destination').map((d) => d.label);
    check('the bar is Market · Shops · Trade · You', doors.join('·') === 'Market·Shops·Trade·You');
    check('no Errands door, no Trust door, no Wallet door',
      !BOTTOM_BAR_ITEMS.some((i) => /errand|trust|wallet/i.test(i.label)));
    check('How Wairo works is the audit tile', SECTION_TITLES.how === 'How Wairo works' && YOU_SECTION_IDS.includes('how'));
  }

  {
    const theme = src('src/ui/theme.css');
    check('Chama Green is a token, not a restyle of the room',
      /--wairo-green:\s*#10B981/.test(theme) && /--wairo-slate:\s*#1E293B/.test(theme) && /--wairo-blue:\s*#2563EB/.test(theme));
    check('the room ground stays the cool near-white, not a dark shell',
      /--brief-bg:\s*#F7F8FA/.test(theme));
  }

  {
    const walk = [];
    const rootDir = path.join(__dirname, 'src');
    const visit = (d) => {
      for (const n of fs.readdirSync(d)) {
        const fp = path.join(d, n);
        if (fs.statSync(fp).isDirectory()) { if (n !== 'node_modules') visit(fp); continue; }
        if (!/\.(tsx|ts|css)$/.test(n)) continue;
        if (n === 'HowBriefWorks.tsx') continue;
        if (fp.includes(`${path.sep}components${path.sep}wairo${path.sep}`)) continue;
        walk.push(fs.readFileSync(fp, 'utf8'));
      }
    };
    visit(rootDir);
    const all = walk.join('\n');
    check('no Trust Score / 85/100 / 88/100 in product source',
      !/Trust Score/.test(all) && !/\b85\/100\b/.test(all) && !/\b88\/100\b/.test(all));
    check('no SACCO credit of KES 50,000 in product source',
      !/SACCO Credit Eligible/.test(all) && !/Supplier Credit/.test(all));
    check('no “3 Bids” theatre and no bid countdown',
      !/3 Bids/.test(all) && !/Time Left: 00:48/.test(all) && !/Live Bidding Ticker/.test(all));
    check('TraceMark remains in the tree (added, not replaced)',
      fs.existsSync(path.join(__dirname, 'src/components/TraceMark.tsx')));
  }

  {
    const audit = src('src/features/you/HowBriefWorks.tsx');
    check('the audit page names the mockups so they cannot sneak in as product',
      /trust score out of 100/.test(audit) && /KES 50,000/.test(audit) && /3 Bids/.test(audit));
    check('the audit page names the four primary destinations, market first',
      /primary bar is Market · Shops · Trade · You/.test(audit) && /There is no Trust tab and no Errands tab/.test(audit));
  }

  console.log(`\nPASSED ${passed} / FAILED ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
