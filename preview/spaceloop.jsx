// ---------------------------------------------------------------------------
// BRIEF 2.0: SPACE, CHAT, MONEY & CARGO DISPATCH SUITE (Digital Landlord)
//
// Tests:
// 1. HomeSurface rendering & empty state
// 2. Space creation flow (Amina's Cakes)
// 3. SpaceHeader & concise 3-metrics
// 4. SpaceOffers & server-authoritative pricing
// 5. SpaceActivity stream
// 6. SpaceConversationThread (In-chat Quote & M-Pesa STK push rails)
// 7. SpacePeople with active customer chats & conversion badges
// 8. SpaceMoney (Daily Profit Meter, Expenses & DukaBook Lipa Pole Pole tabs)
// 9. SpaceDispatches (WAIRO Inter-County Cargo waybills & Sacco stages)
// 10. CreateDispatchModal (Cross-county Matatu Sacco parcel dispatch)
// 11. PublicOfferModal customer view
// 12. Navigation and AppShell integration
// ---------------------------------------------------------------------------

const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/'
});
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.HTMLElement = dom.window.HTMLElement;
global.Request = dom.window.Request || class {};
global.Response = dom.window.Response || class {};
// Bodies are answered through text() because that is the one read path
// briefApi.send() uses. The three derived reads Home renders get real-shaped
// EMPTY payloads, so Home must say "nothing pending" rather than invent a
// standing, a rank or a next step out of an empty ledger.
global.fetch = async (input) => {
  const url = String(typeof input === 'string' ? input : input?.url ?? input);
  const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
  if (url.includes('/api/pulse')) {
    return ok({
      asOf: null,
      sections: {
        demand: { open: 0, bySeverity: { no_supplier: 0, awaiting_quote: 0, awaiting_accept: 0 }, collective: 0 },
        closure: { windowDays: 30, closed: 0, topCategory: null },
        fill: { windowDays: 30, closed: 0, avgHoursToFill: null, hoursSampleCount: 0, avgValue: null },
        money: { windowDays: 30, settledOrders: 0, settledValue: null, settledCurrency: null, completedWorkOrders: 0, deliveredPickups: 0 },
        listings: { active: 0, snapshot: [] },
        events: { open: 0, newLast24h: { requests: 0, events: 0, listings: 0, orders: 0 } }
      },
      facts: [], empty: true, note: 'derived'
    });
  }
  if (url.includes('/api/me/position')) {
    return ok({ position: {
      decay: { expiringQuotes: [], waitlist: [], override: null, overdueInstallments: 0 },
      missedCapture: { count: 0, recent: [], value: null },
      nextMove: null,
      open: { total: 0, top: [] },
      derivedAt: '2026-09-15T00:00:00Z', note: 'derived'
    } });
  }
  if (url.includes('/api/me/commitments')) {
    return ok({ commitments: { owedByMe: [], owedToMe: [], fulfilled: [], lapsed: [], owedByMeKes: 0, owedToMeKes: 0, derivedAt: '2026-09-15T00:00:00Z', note: 'derived' } });
  }
  if (url.includes('/api/me/reciprocity')) {
    return ok({ reciprocity: { owedToMe: [], owedByMe: [], fulfilled: [], aging: [], windowDays: 14, derivedAt: '2026-09-15T00:00:00Z', note: 'derived' } });
  }
  if (url.includes('/api/auth/me')) {
    return ok({ user: { id: 'usr_amina', handle: 'amina', displayName: 'Amina' } });
  }
  if (url.includes('/api/circles')) return ok({ circles: [] });
  return ok({});
};

const { HomeSurface } = require('./src/features/home/HomeSurface.tsx');
const { SpaceShell } = require('./src/features/spaces/SpaceShell.tsx');
const { SpaceStorefrontHeader } = require('./src/features/spaces/SpaceStorefrontHeader.tsx');
const { SpaceOffers } = require('./src/features/spaces/SpaceOffers.tsx');
const { SpaceActivity } = require('./src/features/spaces/SpaceActivity.tsx');
const { SpacePeople } = require('./src/features/spaces/SpacePeople.tsx');
const { SpaceMoney } = require('./src/features/spaces/SpaceMoney.tsx');
const { SpaceDispatches } = require('./src/features/spaces/SpaceDispatches.tsx');
const { CreateDispatchModal } = require('./src/features/spaces/CreateDispatchModal.tsx');
const { SpaceConversationThread } = require('./src/features/spaces/SpaceConversationThread.tsx');
const { CreateFlowModal } = require('./src/features/spaces/CreateFlowModal.tsx');
const { CreateOfferModal } = require('./src/features/spaces/CreateOfferModal.tsx');
const { PublicOfferModal } = require('./src/features/offers/PublicOfferModal.tsx');
const { AppShell } = require('./src/app/AppShell.tsx');

let passed = 0;
let failed = 0;

function check(name, condition, extra = '') {
  if (condition) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.error(`  FAIL  ${name} ${extra}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n=== BRIEF 2.0: SPACES, CHAT, MONEY & CARGO RAILS SUITE ===');

  // --- 1. HomeSurface ---
  console.log('\n--- 1. HomeSurface Decision Screen ---');
  const host1 = document.createElement('div');
  document.body.appendChild(host1);
  const root1 = createRoot(host1);
  await act(async () => {
    root1.render(React.createElement(HomeSurface, {
      userName: 'Amina',
      onOpenSpace: () => {}
    }));
  });

  const text1 = host1.textContent;
  // Home does not greet and does not reprint the ledger. Those lines live on You.
  check('Home does not greet', !/Hi Amina/.test(text1) && !/Hi there/.test(text1));
  check('Home does not reprint offers-live or standing',
    !/offers live/.test(text1) && !/Nothing pending on your ledger/.test(text1));
  check('compact home names the network', text1.includes('Make things happen.'));
  check('work is reachable in one tap', Boolean(host1.querySelector('[data-testid="home-work"]')));
  check('three compact doorways', host1.querySelectorAll('nav[aria-label="Quick actions"] button').length === 3);
  check('secondary discovery is collapsed', host1.querySelector('details')?.open === false);
  check('no invented standing', !/Position #\d|Sector \d|Trust Score/i.test(text1));
  check('no oversized home hero', !host1.querySelector('.shop-brand-cover'));
  const createBtn = host1.querySelector('button[aria-label="Create a space"]');
  check('space creation stays reachable', Boolean(createBtn));
  const text1b = host1.textContent;
  check('no fabricated Today queue', !text1b.includes('Mary asked for a birthday cake') && !text1b.includes('Action Queue'));
  // Commerce is no longer mounted on Home.
  check('marketplace is off Home', !/Community Marketplace/i.test(text1b));

  await act(async () => { root1.unmount(); host1.remove(); });

  // --- 2. CreateFlowModal ---
  console.log('\n--- 2. CreateFlowModal (the live create flow) ---');
  const host2 = document.createElement('div');
  document.body.appendChild(host2);
  const root2 = createRoot(host2);
  await act(async () => {
    root2.render(React.createElement(CreateFlowModal, {
      isOpen: true,
      onClose: () => {},
      onCompleted: () => {}
    }));
  });

  const text2 = host2.textContent;
  check('renders Step 1: Make it your shop', text2.includes('Make it your shop'));
  check('shows space options: Physical shop, Online/home shop, Services, Team',
    text2.includes('Physical shop') && text2.includes('Online / home shop') && text2.includes('Services & studio') && text2.includes('Team / network'));
  check('asks for a brand cover, not a product photo', text2.includes('Shop brand cover') && text2.includes('not a product photo'));

  await act(async () => { root2.unmount(); host2.remove(); });

  // --- 3. SpaceHeader & SpaceState ---
  console.log('\n--- 3. SpaceHeader & Space Identity ---');
  const mockSpace = {
    id: 'spc_amina_cakes_1',
    ownerId: 'usr_amina',
    vendorId: 'vend_amina_1',
    name: "Amina's Cakes",
    type: 'business',
    goal: 'Get my first 20 customers',
    targetValueKes: 100000,
    status: 'active',
    capabilities: ['commerce', 'communication', 'ledger', 'activity'],
    metrics: {
      revenueKes: 84200,
      customerCount: 23,
      activeOrdersCount: 7,
      totalOrdersCount: 19,
      offersCount: 3
    },
    offers: [
      {
        id: 'list_bday_1',
        vendorId: 'vend_amina_1',
        title: 'Birthday Cake',
        description: 'Custom birthday cake for 10-15 people',
        price: 4500,
        currency: 'KES',
        type: 'product',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ],
    recentActivities: [
      {
        id: 'act_1',
        spaceId: 'spc_amina_cakes_1',
        kind: 'space_created',
        title: "Created Space: Amina's Cakes",
        description: 'Goal: Get my first 20 customers',
        createdAt: new Date().toISOString()
      },
      {
        id: 'act_2',
        spaceId: 'spc_amina_cakes_1',
        kind: 'offer_published',
        title: 'Published offer: Birthday Cake',
        description: 'KES 4,500 · Live and accepting orders',
        createdAt: new Date().toISOString()
      }
    ],
    recentConversations: [
      {
        id: 'cnv_1',
        spaceId: 'spc_amina_cakes_1',
        customerName: 'Mary',
        customerContact: '+254712345678',
        offerTitle: 'Birthday Cake',
        offerPriceKes: 4500,
        status: 'converted',
        messages: [
          { id: 'm1', from: 'customer', sender: 'Mary', text: 'Can you make it for Saturday?', at: new Date().toISOString() },
          {
            id: 'm2',
            from: 'owner',
            sender: "Amina's Cakes",
            text: 'Quotation: 2-Tier Chocolate Birthday Cake — KES 5,200',
            quote: {
              id: 'quot_1',
              title: '2-Tier Chocolate Birthday Cake',
              priceKes: 5200,
              notes: 'Including Saturday Kilimani delivery',
              status: 'sent',
              createdAt: new Date().toISOString()
            },
            at: new Date().toISOString()
          }
        ],
        quotes: [
          {
            id: 'quot_1',
            title: '2-Tier Chocolate Birthday Cake',
            priceKes: 5200,
            notes: 'Including Saturday Kilimani delivery',
            status: 'sent',
            createdAt: new Date().toISOString()
          }
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const host3 = document.createElement('div');
  document.body.appendChild(host3);
  const root3 = createRoot(host3);
  await act(async () => {
    root3.render(React.createElement(SpaceStorefrontHeader, {
      space: mockSpace,
      onAddOffer: () => {},
      onOpenInbox: () => {},
      onEdit: () => {},
      onShare: () => {}
    }));
  });

  const text3 = host3.textContent;
  check('renders space title correctly', text3.includes("Amina's Cakes"));
  check('renders space goal', text3.includes('Get my first 20 customers'));
  // THE FLIP: revenue is no longer the headline of a shopfront. The counter
  // (offers, inquiries, views) comes first and the money is the result, shown
  // in the money tab and the sticky bar, not as the identity of the business.
  check('does not lead with a revenue figure', !text3.includes('84,200'));
  check('drops the type-emoji costume for a real cover',
    !/🍰|🌱|🎨|🌸|🎉|🚀/.test(text3));
  check('shows the stats strip with dashes where nothing is measured',
    /views/i.test(text3) && text3.includes('inquiries') && text3.includes('—'));
  check('no invented conversion percentage without rows', !/%\b/.test(text3.replace('—', '')));
  check('offers the two real actions on a shopfront', text3.includes('Add offer') && /Inbox/.test(text3));
  check('names its own absences instead of implying a scoreboard',
    text3.includes('no sector averages') || text3.includes('No place or hours stated yet'));

  await act(async () => { root3.unmount(); host3.remove(); });

  // --- 4. SpaceOffers ---
  console.log('\n--- 4. SpaceOffers ---');
  const host4 = document.createElement('div');
  document.body.appendChild(host4);
  const root4 = createRoot(host4);
  await act(async () => {
    root4.render(React.createElement(SpaceOffers, {
      offers: mockSpace.offers,
      onAddOffer: () => {}
    }));
  });

  const text4 = host4.textContent;
  check('renders offer title', text4.includes('Birthday Cake'));
  check('renders offer price: KES 4,500', text4.includes('4,500'));
  check('renders offer status badge: active', text4.includes('active'));

  await act(async () => { root4.unmount(); host4.remove(); });

  // --- 5. SpaceActivity ---
  console.log('\n--- 5. SpaceActivity Stream ---');
  const host5 = document.createElement('div');
  document.body.appendChild(host5);
  const root5 = createRoot(host5);
  await act(async () => {
    root5.render(React.createElement(SpaceActivity, {
      activities: mockSpace.recentActivities
    }));
  });

  const text5 = host5.textContent;
  check('renders activity stream header', text5.includes('Recent Activity'));
  check('shows space creation event', text5.includes("Created Space: Amina's Cakes"));
  check('shows offer published event', text5.includes('Published offer: Birthday Cake'));

  await act(async () => { root5.unmount(); host5.remove(); });

  // --- 6. SpaceConversationThread (Phase 2 In-Chat Rails) ---
  console.log('\n--- 6. SpaceConversationThread & In-Chat Commerce Rails ---');
  const host6 = document.createElement('div');
  document.body.appendChild(host6);
  const root6 = createRoot(host6);
  await act(async () => {
    root6.render(React.createElement(SpaceConversationThread, {
      spaceId: mockSpace.id,
      conversation: mockSpace.recentConversations[0]
    }));
  });

  const text6 = host6.textContent;
  check('shows customer name and phone', text6.includes('Mary') && text6.includes('+254712345678'));
  check('shows contextual offer inquiry', text6.includes('Birthday Cake'));
  check('shows official quotation card in thread', text6.includes('Official Quote') && text6.includes('2-Tier Chocolate Birthday Cake'));
  check('shows quote price KES 5,200', text6.includes('5,200'));
  check('shows in-chat M-Pesa STK prompt button', text6.includes('Send M-Pesa STK Prompt'));

  await act(async () => { root6.unmount(); host6.remove(); });

  // --- 7. SpacePeople ---
  console.log('\n--- 7. SpacePeople with Active Chats & Conversion Badges ---');
  const host7 = document.createElement('div');
  document.body.appendChild(host7);
  const root7 = createRoot(host7);
  await act(async () => {
    root7.render(React.createElement(SpacePeople, {
      spaceId: mockSpace.id,
      conversations: mockSpace.recentConversations,
      customers: [{ name: 'Mary', contact: '+254712345678' }]
    }));
  });

  const text7 = host7.textContent;
  check('renders active inquiries header', text7.includes('Active Inquiries & WhatsApp Chats'));
  check('shows customer name and message preview', text7.includes('Mary') && (text7.includes('Quotation') || text7.includes('Saturday')));
  check('shows order converted badge on converted conversation', text7.includes('Order Paid'));

  await act(async () => { root7.unmount(); host7.remove(); });

  // --- 8. SpaceMoney (Phase 3 Profit Meter & DukaBook Tabs) ---
  console.log('\n--- 8. SpaceMoney & DukaBook Credit Ledger ---');
  const host8 = document.createElement('div');
  document.body.appendChild(host8);
  const root8 = createRoot(host8);
  await act(async () => {
    root8.render(React.createElement(SpaceMoney, {
      spaceId: mockSpace.id,
      revenueKes: 84200
    }));
  });

  const text8 = host8.textContent;
  // The words were moved, not deleted: this panel used to print "Money In
  // (Sales)", "Money Out (Supplies)" and a "Net Profit" card over a subtraction
  // of hand-typed rows. What the numbers actually are is now on the tile, and
  // the long version lives on the How Trace works screen.
  check('renders the cash section without calling it profit', text8.includes('Cash in and out') && !/Profit & Cash Flow/.test(text8));
  check('money in is named by its basis', text8.includes('Marked settled') && text8.includes('84,200'));
  check('money out says who typed it', text8.includes('Recorded out') && text8.includes('you typed'));
  check('the subtraction is named as a subtraction', text8.includes('Marked in − recorded out') && !/Net Profit|Clear operator take-home/.test(text8));
  check('an empty out column admits it is self-made', text8.includes('a 0 of its own making'));
  check('shows + Record Expense button', text8.includes('Record Expense'));
  check('shows + Open DukaBook Tab button', text8.includes('Open DukaBook Tab'));
  check('renders DukaBook Credit section', text8.includes('DukaBook Credit'));
  check('renders Recent Supplies & Expenses section', text8.includes('Recent Supplies & Expenses'));

  await act(async () => { root8.unmount(); host8.remove(); });

  // --- 9. SpaceDispatches (Phase 4 Inter-County Cargo) ---
  console.log('\n--- 9. SpaceDispatches & WAIRO Cargo Waybills ---');
  const host9 = document.createElement('div');
  document.body.appendChild(host9);
  const root9 = createRoot(host9);
  await act(async () => {
    root9.render(React.createElement(SpaceDispatches, {
      spaceId: mockSpace.id,
      spaceName: "Amina's Cakes"
    }));
  });

  const text9 = host9.textContent;
  check('renders Cargo Dispatches header', text9.includes('Inter-County Cargo Dispatches'));
  check('shows Dispatch Parcel action button', text9.includes('Dispatch Parcel'));

  await act(async () => { root9.unmount(); host9.remove(); });

  // --- 10. CreateDispatchModal ---
  console.log('\n--- 10. CreateDispatchModal (Sacco & Stage Selector) ---');
  const host10 = document.createElement('div');
  document.body.appendChild(host10);
  const root10 = createRoot(host10);
  await act(async () => {
    root10.render(React.createElement(CreateDispatchModal, {
      isOpen: true,
      spaceId: mockSpace.id,
      defaultReceiverName: 'Mary Wanjiku',
      defaultReceiverPhone: '+254712345678',
      onClose: () => {},
      onDispatchCreated: () => {}
    }));
  });

  const text10 = host10.textContent;
  check('renders WAIRO Cargo Dispatch header', text10.includes('WAIRO Cargo Dispatch'));
  check('shows destination stage selector', text10.includes('Destination Stage'));
  check('shows carrier / matatu sacco selector', text10.includes('Carrier / Matatu Sacco'));
  check('shows generate waybill button', text10.includes('Generate Waybill & Dispatch'));

  await act(async () => { root10.unmount(); host10.remove(); });

  // --- 11. PublicOfferModal (Customer Contextual Inquiry) ---
  console.log('\n--- 11. PublicOfferModal (Customer View) ---');
  const host11 = document.createElement('div');
  document.body.appendChild(host11);
  const root11 = createRoot(host11);
  await act(async () => {
    root11.render(React.createElement(PublicOfferModal, {
      isOpen: true,
      offer: mockSpace.offers[0],
      spaceName: "Amina's Cakes",
      onClose: () => {}
    }));
  });

  const text11 = host11.textContent;
  check('shows public offer title and price', text11.includes('Birthday Cake') && text11.includes('4,500'));
  check('shows verified seller space name', text11.includes("Amina's Cakes"));
  check('shows customer action buttons: Ask about this & Order Now',
    text11.includes('Ask about this') && text11.includes('Order Now'));

  await act(async () => { root11.unmount(); host11.remove(); });

  // --- 12. AppShell Integration ---
  console.log('\n--- 12. AppShell Navigation ---');
  const host12 = document.createElement('div');
  document.body.appendChild(host12);
  const root12 = createRoot(host12);
  await act(async () => {
    root12.render(React.createElement(AppShell, {
      initialTab: 'home'
    }));
  });

  const text12 = host12.textContent;
  check('renders AppShell Home tab by default',
    Boolean(host12.querySelector('[data-testid="compact-home"]')) || /What’s moving/.test(text12));

  await act(async () => { root12.unmount(); host12.remove(); });

  console.log(`\nPASSED ${passed} / FAILED ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
