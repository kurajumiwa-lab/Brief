// ---------------------------------------------------------------------------
// THREE-PILLAR TRADE — fixtures for the mobile-fitted concept surface.
//
// Every figure here is a FIXTURE. Nothing in this file is market data, and no
// row in it is connected to a live order, batch, pool, stall or payment. The
// surface is a design artefact for docs/THREE-PILLAR-PRIMARY-ARCHITECTURE.md,
// in the same spirit as features/cloudbites: a preview that says what it is.
// ---------------------------------------------------------------------------

export type TabId = 'map' | 'supply' | 'shop' | 'gather' | 'scout';
export type PillarId = 'p1' | 'p2' | 'p3';

export type Availability = 'now' | 'week' | 'seasonal' | 'confirmed' | 'out';

export const AVAILABILITY: Record<Availability, { label: string; dot: string }> = {
  now: { label: 'Available now', dot: 'live' },
  week: { label: 'Available this week', dot: 'soon' },
  seasonal: { label: 'Seasonal', dot: 'cool' },
  confirmed: { label: 'Supplier-confirmed', dot: 'calm' },
  out: { label: 'Currently unavailable', dot: 'off' }
};

export interface ScreenSpec {
  id: string;
  tab: TabId;
  pillar: PillarId;
  /** The Brief door that owns this screen in the five-door shell. */
  door: string;
  hash: string;
  title: string;
  who: string;
  summary: string;
  fit: string[];
  model: string[];
  api: string[];
  ussd?: string;
  edges: string[];
}

export const PILLARS: Record<PillarId, { name: string; line: string }> = {
  p1: {
    name: 'P1 · Supply',
    line: 'Ugandan vendors and farmers onboarded, verified, consolidated at the border, cleared under the EAC Simplified Trade Regime, delivered into Kenyan hubs, paid in UGX.'
  },
  p2: {
    name: 'P2 · Shop',
    line: 'Ordering for the people who buy small and often: dukas on app and USSD, institutions on credit and POs, families on one shared basket.'
  },
  p3: {
    name: 'P3 · Gather',
    line: 'Events, pop-ups and markets, plus the Market Scout network that keeps the index of who-sells-what-where alive.'
  }
};

export const TABS: { id: TabId; label: string; kicker: string; icon: string }[] = [
  { id: 'map', label: 'Map', kicker: 'Home', icon: 'map' },
  { id: 'supply', label: 'Supply', kicker: 'Trade', icon: 'truck' },
  { id: 'shop', label: 'Shop', kicker: 'Duka', icon: 'bag' },
  { id: 'gather', label: 'Gather', kicker: 'Market', icon: 'tent' },
  { id: 'scout', label: 'Scout', kicker: 'You', icon: 'compass' }
];

export const SCREENS: ScreenSpec[] = [
  {
    id: 'home-map',
    tab: 'map',
    pillar: 'p1',
    door: 'Home',
    hash: '#home',
    title: 'Trade Map',
    who: 'Anyone',
    summary:
      'The index front door: what exists where, who has it, what changed since you last opened the app, and one button that sources anything you name.',
    fit: [
      'Map fills the top 55% of the screen; clusters are 48dp tap targets',
      'Region availability opens as a bottom sheet, so the map stays as context',
      '“3 things changed” is one card above the fold — the reason to return',
      'Search is the first focusable element on the screen'
    ],
    model: ['regions', 'listings (active)', 'priceSignals (derived)', 'spotlight_events (derived on read)'],
    api: ['GET /api/discover/summary', 'GET /api/price-signals', 'GET /api/public/feed'],
    edges: [
      'A region with no listings says so and offers the nearest regions instead',
      'A price with no recent confirmation reads “Request current quote”, never a stale number',
      'Signal loss keeps the last read on screen rather than emptying the map'
    ]
  },
  {
    id: 'region-detail',
    tab: 'map',
    pillar: 'p1',
    door: 'Home',
    hash: '#home/map/kisii',
    title: 'What Kisii has',
    who: 'Buyer, scout',
    summary:
      'A region as an index entry: supplier counts, live availability, price recency, and the honest fallback when there is no reliable price.',
    fit: [
      'Each product is three stacked rows: name + supplier count, status + recency, quote action',
      'The spec’s four-column table reflows to rows — nothing scrolls sideways on a phone',
      '“Request current quote” is the fallback, not a zero price'
    ],
    model: ['listings', 'vendors', 'supply capabilities', 'verification ladder states'],
    api: ['GET /api/supply/vendors?district=kisii', 'POST /api/requests', 'GET /api/price-signals?county=kisii'],
    edges: [
      'Zero suppliers in a category shows the sourcing route from the nearest region',
      'A listing nobody confirmed in 60 days is demoted and says when it was last touched'
    ]
  },
  {
    id: 'find-for-me',
    tab: 'map',
    pillar: 'p1',
    door: 'Home',
    hash: '#home/find',
    title: 'Find it for me',
    who: 'Buyer',
    summary:
      'Three fields — where, what, how much — then sources with delivery options folded underneath each. The platform orchestrates; licensed couriers carry.',
    fit: [
      'A three-field sheet over the keyboard, not a three-page wizard',
      'Courier options sit inside each source card, so cost and ETA are compared together',
      '“Book delivery” is disabled and says why — referral booking is not live'
    ],
    model: ['requests', 'matching (explained)', 'courier_operators (licensed)', 'shipments'],
    api: ['POST /api/requests', 'GET /api/matching/:requestId', 'GET /api/couriers?from=&to='],
    edges: [
      'No source within range returns the nearest three with their delivery cost, never “No results”',
      'A courier without a current licence class is not listed at all'
    ]
  },
  {
    id: 'vendor-onboarding',
    tab: 'supply',
    pillar: 'p1',
    door: 'Trade',
    hash: '#trade/supply/vendors/new',
    title: 'Vendor onboarding',
    who: 'Ugandan vendor / field agent',
    summary:
      'Six steps, one screen each: identity, type and district, products and capacity, documents, payout, review. A field agent can complete any step for a vendor with no smartphone.',
    fit: [
      'Progress bar pinned under the app bar; every step is resumable',
      'Document capture is camera-first with an “agent completes this for me” path',
      'Tier benefits are explained before the vendor pays for verification'
    ],
    model: ['vendors', 'verification_status', 'verification_tier', 'badge_expiry', 'payout'],
    api: ['POST /api/supply/vendors', 'POST /api/supply/vendors/:id/verification'],
    edges: [
      'A duplicate phone number is blocked and flagged for manual review',
      'A document mismatch names the specific reason instead of “rejected”',
      'A border-town vendor may submit either country’s documents'
    ]
  },
  {
    id: 'consolidation',
    tab: 'supply',
    pillar: 'p1',
    door: 'Trade',
    hash: '#trade/supply/batches',
    title: 'Consolidation desk',
    who: 'Field agent at Busia / Malaba',
    summary:
      'One batch per border post: vendor consignments, the US$2,000 STR ceiling enforced on every write, SCOO drafting, then lock and dispatch.',
    fit: [
      'Batch list first; consignment entry is one thumb-scroll form',
      'The STR ceiling is a blocking sheet with the two legal options, not a toast',
      'Lock & dispatch is the single bottom action once every consignment is loaded'
    ],
    model: ['consolidation_batches', 'consignments', 'declared_value_usd', 'str_eligible', 'scoo_ref'],
    api: ['POST /api/supply/consignments', 'POST /api/supply/batches/:id/scoo', 'POST /api/supply/batches/:id/lock'],
    edges: [
      'Above US$2,000 the write is refused: split into sub-consignments or escalate to full declaration',
      'A batch that crosses the ceiling is refused at lock, never at dispatch',
      'A rejected consignment returns goods to the consolidation point and notifies the vendor'
    ]
  },
  {
    id: 'shipment',
    tab: 'supply',
    pillar: 'p1',
    door: 'Trade',
    hash: '#trade/supply/shipments/SHP-2291',
    title: 'Shipment tracking',
    who: 'Buyer, vendor',
    summary:
      'The border crossing as a timeline a buyer can read: consolidated, at border, cleared, at hub, out for delivery — with ETA and the reason for any delay both visible.',
    fit: [
      'Vertical timeline; the current leg is expanded, the rest are one line each',
      '“Call driver” is a 44dp app-bar button, not a buried link',
      'A delay shows the new ETA and the reason together — never a silently moved date'
    ],
    model: ['shipments', 'legs[]', 'eta', 'actual_arrival', 'delay_reason'],
    api: ['POST /api/supply/shipments/:id/legs', 'GET /api/public/order-tracking/:ref'],
    edges: [
      'A border delay over 24 hours auto-notifies every buyer on the batch',
      'A breakdown reassigns a backup vehicle and notifies with the new ETA',
      'Damage in transit attaches driver photo evidence and opens a claim'
    ]
  },
  {
    id: 'payout',
    tab: 'supply',
    pillar: 'p1',
    door: 'Trade',
    hash: '#trade/supply/vendors/:id/payout',
    title: 'Vendor payout',
    who: 'Ugandan vendor',
    summary:
      'UGX earnings derived from settled rows, the exact FX row used, and a payout request that is manual and finance-confirmed.',
    fit: [
      'Balance and arithmetic are printed together — the number is never alone',
      'The rate row names the timestamp and the buffer, so the conversion is auditable',
      'Early payout is priced in the open (1.5%) and still requires finance confirmation'
    ],
    model: ['ledgerTransactions', 'fx_rates (appended, never edited)', 'settlements'],
    api: ['GET /api/supply/fx?pair=UGX_KES', 'POST /api/supply/vendors/:id/payout'],
    edges: [
      'Automated UGX B2C payout is blocked; the button says so instead of pretending',
      'A rate that moved more than 3% before dispatch raises a buyer-approval flag'
    ]
  },
  {
    id: 'duka-home',
    tab: 'shop',
    pillar: 'p2',
    door: 'Shop',
    hash: '#duka',
    title: 'Duka home',
    who: 'Duka owner',
    summary:
      'Reorder is the largest target on the screen. Categories, pooled price alerts, and a USSD pairing row for the phone that has no app.',
    fit: [
      '“Reorder last order” is one tap and the biggest button present',
      'Categories are a two-column grid of 56dp tiles',
      'Pooled alerts sit above the fold because they are the saving'
    ],
    model: ['orders', 'procurement (repeat patterns)', 'demand_pools', 'listings'],
    api: ['GET /api/duka/reorder', 'GET /api/duka/pools', 'POST /api/duka/pools/:id/join'],
    edges: [
      'An out-of-stock line offers “notify me” instead of disappearing',
      'A member with no history gets the category grid, not an empty reorder card'
    ]
  },
  {
    id: 'pool-save',
    tab: 'shop',
    pillar: 'p2',
    door: 'Shop',
    hash: '#duka/pool/maize-flour-2kg',
    title: 'Pool & Save',
    who: 'Duka owner',
    summary:
      'Demand pooling: the pool fills, the wholesale tier drops, and the price a duka pays is derived from the tier table rather than typed by anyone.',
    fit: [
      'One card: fill level, current price, next break — then the join action at the bottom',
      'The saving is shown in money first, percentage second',
      'The “pool did not fill” outcome is stated before joining, not after'
    ],
    model: ['demand_pools', 'tiers[]', 'lines[]', 'current_unit_price (derived)'],
    api: ['POST /api/duka/pools/:id/join', 'GET /api/duka/pools/:id', 'POST /api/duka/pools/:id/close'],
    edges: [
      'A pool that misses its minimum is cancelled with no charge to anyone',
      'A vendor who cannot fill the pool gets partial fulfilment with refund or waitlist per line'
    ]
  },
  {
    id: 'checkout',
    tab: 'shop',
    pillar: 'p2',
    door: 'Shop',
    hash: '#duka/checkout',
    title: 'Checkout',
    who: 'Duka owner, family',
    summary:
      'Cart, delivery slot, then an M-Pesa STK sheet that reports waiting honestly and never invents a success.',
    fit: [
      'Delivery slot is a horizontal chip row (controls, not content)',
      'The STK sheet states “waiting for your PIN” and offers a way out',
      'A disabled action always carries the reason beside it'
    ],
    model: ['orders', 'order lines', 'escrow', 'ledgerTransactions'],
    api: ['POST /api/duka/checkout', 'M-Pesa STK push (configured connector)'],
    edges: [
      'An unconfigured rail returns 503 with a reason, not a fake “paid”',
      'Pay on delivery is first-time buyers only and capped',
      'A perishable mix suggests a split delivery before payment, not after'
    ]
  },
  {
    id: 'ussd',
    tab: 'shop',
    pillar: 'p2',
    door: 'Shop',
    hash: '#duka/ussd',
    title: 'USSD ordering',
    who: 'Feature-phone duka owner',
    summary:
      'The same order, dialled. Plain text, CON/END, no styling — parity, not a parody. Sessions time out; a half-finished order is saved as a draft.',
    fit: [
      'Rendered as the real thing: monochrome, no images, 180-column plain text',
      'Keypad is the input method; every menu is reachable in three taps',
      '“My Orders” resumes a draft after a session timeout'
    ],
    model: ['huduma session state machine', 'orders', 'drafts'],
    api: ['USSD gateway → POST /api/huduma/ussd (session machine)'],
    ussd:
      'Welcome to Brief.\n1. Order Stock  2. Check Prices  3. My Orders\n4. Request Delivery  5. Help',
    edges: [
      'A session that times out mid-order keeps the order as a resumable draft',
      'The session never reads an amount from the keypad; totals come from rows',
      'Insufficient M-Pesa balance offers retry or pay-on-delivery for first-timers'
    ]
  },
  {
    id: 'institution',
    tab: 'shop',
    pillar: 'p2',
    door: 'Shop',
    hash: '#duka/institution',
    title: 'Institutional desk',
    who: 'School, hospital, hotel, caterer',
    summary:
      'Bulk ordering with procurement discipline: requisition, approval, purchase order, proof of delivery, invoice, credit terms.',
    fit: [
      'Cards, not spreadsheets: requisitions, approvals, credit, due dates',
      'Approval is two taps; a rejection requires a reason',
      'Credit used / limit is a bar, with overdue days named beside it'
    ],
    model: ['institutions', 'requisitions', 'purchase_orders', 'invoices', 'credit_accounts'],
    api: ['POST /api/institutions/:id/requisitions', 'POST …/approve', 'POST …/po', 'GET /api/duka/credit/:id'],
    edges: [
      'Exceeding the credit limit blocks the order and says why',
      'An approval timeout escalates to the backup approver — it never auto-approves',
      'A partial delivery adjusts the invoice and creates a visible backorder'
    ]
  },
  {
    id: 'basket',
    tab: 'shop',
    pillar: 'p2',
    door: 'Shop',
    hash: '#duka/basket/BKT-7741',
    title: 'Family basket',
    who: 'Household',
    summary:
      'One basket across produce, household, farm and dairy, shareable with a link, delivered in one window — or split when shelf lives disagree.',
    fit: [
      'Category tabs keep the basket one column deep',
      'The shared link is a revocable token, copyable in one tap',
      'The split-delivery suggestion appears before payment, not as a surprise after'
    ],
    model: ['family_baskets', 'share_token', 'lines[]', 'perishable_mix'],
    api: ['POST /api/family-baskets', 'POST /api/family-baskets/:token/lines', 'POST …/checkout'],
    edges: [
      'A revoked token refuses the write and says the basket closed',
      'Free delivery above KES 3,000 is stated as a rule, not a countdown'
    ]
  },
  {
    id: 'event-feed',
    tab: 'gather',
    pillar: 'p3',
    door: 'Market',
    hash: '#market/events',
    title: 'Vendor event feed',
    who: 'Vendor',
    summary:
      'Events a vendor could actually sell at, filtered by category, county, date and fee. Stalls remaining is the only number printed.',
    fit: [
      'Filter chips scroll horizontally — filters are controls, content never is',
      'Event cards carry name, date, place, stalls remaining and one action',
      'A matching opportunity arrives as a notification with an Apply link'
    ],
    model: ['events', 'categories (campaign types)', 'vendor preferences'],
    api: ['GET /api/events?category=&county=&from=', 'POST /api/events/:id/stall-applications'],
    edges: [
      'A cancelled event notifies every applicant and refunds stall fees automatically',
      'Oversubscription creates a waitlist with a position — no favoured stall'
    ]
  },
  {
    id: 'stall-application',
    tab: 'gather',
    pillar: 'p3',
    door: 'Market',
    hash: '#market/events/EVT-3391/apply',
    title: 'Stall application',
    who: 'Vendor',
    summary:
      'Three fields, one photo picker, one payment sheet, then a QR stall pass that works offline at the gate.',
    fit: [
      'Requirements are chips (power, water, space), not a text field',
      'The fee sheet states the refund rule before payment',
      'The stall pass is a QR plus the essentials, readable in sunlight'
    ],
    model: ['stall_applications', 'fee_minor', 'payment_ref', 'stall_pass'],
    api: ['POST /api/events/:id/stall-applications', 'POST …/applications/:a/decide'],
    edges: [
      'A rejection requires a reason and refunds the fee automatically',
      'A waitlisted vendor sees their position, not a vague “pending”'
    ]
  },
  {
    id: 'organizer-desk',
    tab: 'gather',
    pillar: 'p3',
    door: 'Market',
    hash: '#market/events/EVT-3391/desk',
    title: 'Organiser desk',
    who: 'Event organiser',
    summary:
      'Applications in one list: approve, waitlist or reject with a reason, with stall counts that stay honest about capacity.',
    fit: [
      'Three actions per row, all ≥44dp, no swipe gestures to discover',
      'Reject opens a required reason field',
      'Capacity is shown as stalls taken of total, never as a growth number'
    ],
    model: ['stall_applications', 'events (vendor_stalls_total / available)'],
    api: ['GET /api/events/:id/applications', 'POST /api/events/:id/applications/:a/decide'],
    edges: [
      'Approving beyond capacity is refused with the remaining count',
      'A cancellation refunds every approved applicant in one pass'
    ]
  },
  {
    id: 'blueprint',
    tab: 'gather',
    pillar: 'p3',
    door: 'Market',
    hash: '#market/events/blueprint',
    title: 'Event blueprint',
    who: 'Event organiser',
    summary:
      '“A farmers market in Mombasa for 40 vendors” becomes a blueprint: recommended categories, potential vendors already on the platform, sourcing areas, nearby logistics.',
    fit: [
      'The blueprint is four stacked sections, each independently actionable',
      '“Invite these vendors” sends real invitations from the platform’s own records',
      'Nothing in the blueprint is presented as confirmed attendance'
    ],
    model: ['events', 'vendors', 'supply capabilities', 'courier_operators'],
    api: ['POST /api/events/:id/blueprint', 'POST /api/events/:id/invitations'],
    edges: [
      'A category with no vendors on the platform says so and names the nearest region',
      'Blueprint counts are live queries, not a cached “potential” figure'
    ]
  },
  {
    id: 'scout-today',
    tab: 'scout',
    pillar: 'p3',
    door: 'You',
    hash: '#you/scout',
    title: 'Scout today',
    who: 'Market Scout',
    summary:
      'A territory, a short list of missions, one demand signal, and earnings derived from approved outcomes with the arithmetic printed beside them.',
    fit: [
      'Territory is the header; missions are the body; earnings are one derived card',
      'Each mission is a single tap into the thing to verify',
      'Earnings show “KES 150 × 8 approved missions” — never a bare total'
    ],
    model: ['scout_missions', 'territories (workforce)', 'fieldAgent fees', 'verification ladder'],
    api: ['GET /api/scout/today?territory=kisii', 'POST /api/scout/missions/:id/submit'],
    edges: [
      'A rejected mission pays nothing and the reason is shown to the scout',
      'First-touch-wins: a second scout cannot overwrite a verified listing',
      'Depth stays at one — a scout never earns from a scout they recruited'
    ]
  }
];

export const SCREENS_BY_ID: Record<string, ScreenSpec> = Object.fromEntries(
  SCREENS.map((screen) => [screen.id, screen])
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export interface RegionProduct {
  name: string;
  emoji: string;
  suppliers: number;
  status: Availability;
  price: string;
  updated: string;
}

export interface Region {
  id: string;
  name: string;
  country: string;
  emoji: string;
  suppliers: number;
  x: number;
  y: number;
  products: RegionProduct[];
}

export const REGIONS: Region[] = [
  {
    id: 'kisii',
    name: 'Kisii',
    country: 'KE',
    emoji: '🥑',
    suppliers: 24,
    x: 27,
    y: 66,
    products: [
      { name: 'Avocado (Hass)', emoji: '🥑', suppliers: 14, status: 'now', price: 'KES 61–66 / kg', updated: 'updated 3 hours ago' },
      { name: 'Bananas', emoji: '🍌', suppliers: 9, status: 'week', price: 'KES 38–44 / kg', updated: 'updated yesterday' },
      { name: 'Vegetables', emoji: '🥬', suppliers: 21, status: 'now', price: 'Request current quote', updated: '21 listings, no recent confirmation' },
      { name: 'Dairy', emoji: '🥛', suppliers: 6, status: 'seasonal', price: 'Request current quote', updated: 'seasonal — confirmed in season' }
    ]
  },
  {
    id: 'mombasa',
    name: 'Mombasa',
    country: 'KE',
    emoji: '🐟',
    suppliers: 61,
    x: 78,
    y: 74,
    products: [
      { name: 'Fish (fresh)', emoji: '🐟', suppliers: 23, status: 'now', price: 'KES 780–860 / kg', updated: 'updated 5 hours ago' },
      { name: 'Seafood', emoji: '🦐', suppliers: 17, status: 'now', price: 'KES 900–1,150 / kg', updated: 'updated this morning' },
      { name: 'Coconut products', emoji: '🥥', suppliers: 12, status: 'confirmed', price: 'KES 40–70 / pc', updated: 'supplier confirmed 2 days ago' },
      { name: 'Coastal produce', emoji: '🌴', suppliers: 9, status: 'week', price: 'Request current quote', updated: 'updated 6 days ago' }
    ]
  },
  {
    id: 'nakuru',
    name: 'Nakuru',
    country: 'KE',
    emoji: '🥔',
    suppliers: 52,
    x: 44,
    y: 47,
    products: [
      { name: 'Potatoes', emoji: '🥔', suppliers: 19, status: 'now', price: 'KES 42–55 / kg', updated: 'updated 4 hours ago' },
      { name: 'Horticulture', emoji: '🌻', suppliers: 18, status: 'now', price: 'KES 60–90 / kg', updated: 'updated this morning' },
      { name: 'Dairy', emoji: '🥛', suppliers: 15, status: 'now', price: 'KES 48–56 / ltr', updated: 'updated 7 hours ago' }
    ]
  },
  {
    id: 'kisumu',
    name: 'Kisumu',
    country: 'KE',
    emoji: '🌽',
    suppliers: 37,
    x: 20,
    y: 55,
    products: [
      { name: 'Fish (tilapia)', emoji: '🐟', suppliers: 14, status: 'now', price: 'KES 520–600 / kg', updated: 'updated 2 hours ago' },
      { name: 'Maize', emoji: '🌽', suppliers: 13, status: 'week', price: 'KES 38–46 / kg', updated: 'updated yesterday' },
      { name: 'Rice', emoji: '🍚', suppliers: 10, status: 'seasonal', price: 'Request current quote', updated: 'seasonal' }
    ]
  },
  {
    id: 'garissa',
    name: 'Garissa',
    country: 'KE',
    emoji: '🐪',
    suppliers: 12,
    x: 74,
    y: 33,
    products: [
      { name: 'Livestock', emoji: '🐄', suppliers: 7, status: 'confirmed', price: 'Request current quote', updated: 'supplier confirmed 4 days ago' },
      { name: 'Camel products', emoji: '🐪', suppliers: 5, status: 'out', price: 'Currently unavailable', updated: 'last confirmed 41 days ago' }
    ]
  },
  {
    id: 'mbale',
    name: 'Mbale',
    country: 'UG',
    emoji: '🌱',
    suppliers: 18,
    x: 55,
    y: 22,
    products: [
      { name: 'Coffee', emoji: '☕', suppliers: 8, status: 'confirmed', price: 'UGX 6,200–7,400 / kg', updated: 'supplier confirmed 3 days ago' },
      { name: 'Maize flour', emoji: '🌽', suppliers: 6, status: 'now', price: 'UGX 3,100–3,600 / kg', updated: 'updated 9 hours ago' },
      { name: 'Beans', emoji: '🫘', suppliers: 4, status: 'week', price: 'UGX 3,800–4,200 / kg', updated: 'updated yesterday' }
    ]
  }
];

export const SPOTLIGHT = [
  { emoji: '🥑', text: 'Avocado in Kisii is 8% below the comparable range this week.' },
  { emoji: '🐟', text: 'A new fish supplier joined Mombasa — 23 active listings.' },
  { emoji: '🚚', text: 'A licensed courier route opened Mombasa → Nairobi.' }
];

export const TRENDING = [
  { emoji: '🥑', label: 'Avocado · Kisii', meta: '14 suppliers' },
  { emoji: '🐟', label: 'Fish · Mombasa', meta: '23 suppliers' },
  { emoji: '🥔', label: 'Potatoes · Nakuru', meta: '19 suppliers' }
];

export const FIND_SOURCES = [
  { town: 'Mombasa', supplier: 'Baharini Fresh Ltd', qty: '100 kg available', km: '485 km', couriers: 3 },
  { town: 'Kilifi', supplier: 'Kilifi Catch Co-op', qty: '150 kg available', km: '512 km', couriers: 2 },
  { town: 'Malindi', supplier: 'Malindi Marine', qty: '80 kg available', km: '548 km', couriers: 2 }
];

export const COURIERS = [
  { name: 'Registered courier A', eta: '1 day', cost: 'KES 4,200', reliability: '96%', licensed: 'National' },
  { name: 'Registered courier B', eta: '2 days', cost: 'KES 3,600', reliability: '98%', licensed: 'National' },
  { name: 'Registered courier C', eta: '1 day', cost: 'KES 4,700', reliability: '91%', licensed: 'Courier hailing' }
];

export const ONBOARDING_STEPS = [
  'Business name',
  'Type & district',
  'Products & capacity',
  'Documents',
  'Payout details',
  'Review & submit'
];

export const VERIFICATION_TIERS = [
  { tier: 'Basic', needs: 'Phone + ID', badge: 'Grey check', gets: 'List up to 5 products' },
  { tier: 'Silver', needs: 'ID + business document + product photos', badge: 'Blue check', gets: 'Unlimited listings, priority in search' },
  { tier: 'Gold', needs: 'Silver + field visit + bank account', badge: 'Gold shield', gets: 'Trusted supplier, curated lists, credit terms eligible' }
];

export const BATCHES = [
  {
    id: 'BUSIA-118',
    post: 'Busia one-stop border post',
    vendors: 6,
    value: 'US$ 1,840 declared',
    ceiling: 'US$ 2,000 per consignment',
    status: 'Open',
    cutoff: 'cutoff in 5h 20m',
    lines: [
      { vendor: 'Mbale Grain Co-op', item: 'Maize flour · 40 bags', value: 'US$ 960' },
      { vendor: 'Jinja Processors Ltd', item: 'Soybean flour · 18 bags', value: 'US$ 520' },
      { vendor: 'Tororo Farms', item: 'Beans · 22 bags', value: 'US$ 360' }
    ]
  },
  {
    id: 'MALABA-042',
    post: 'Malaba one-stop border post',
    vendors: 3,
    value: 'US$ 1,120 declared',
    ceiling: 'US$ 2,000 per consignment',
    status: 'Locked',
    cutoff: 'dispatched 09:40',
    lines: [{ vendor: 'Eldoret Dairy', item: 'Dairy · 6 crates', value: 'US$ 1,120' }]
  }
];

export const SHIPMENT_LEGS = [
  { label: 'Ordered', at: 'Mon 07:12', done: true },
  { label: 'Consolidated · Busia', at: 'Mon 16:40', done: true },
  { label: 'At border · OSBP', at: 'Tue 08:05', done: true, current: true, note: 'Queue at Busia OSBP — 6 vehicles ahead.' },
  { label: 'Cleared', at: 'expected Tue 14:00', done: false },
  { label: 'At hub · Nairobi', at: 'expected Tue 19:30', done: false },
  { label: 'Out for delivery', at: 'expected Wed 08:00', done: false }
];

export const PAYOUT_ROWS = [
  { ref: 'WO-88121', settled: 'KES 48,200', rate: '1 KES = 28.4 UGX', ugx: 'UGX 1,368,880' },
  { ref: 'WO-88104', settled: 'KES 21,600', rate: '1 KES = 28.4 UGX', ugx: 'UGX 613,440' },
  { ref: 'WO-88077', settled: 'KES 12,400', rate: '1 KES = 28.3 UGX', ugx: 'UGX 350,920' }
];

export const POOL = {
  product: 'Maize flour 2 kg',
  vendor: 'Mbale Grain Co-op',
  filled: 340,
  next: 500,
  unit: 'kg',
  priceNow: 120,
  priceNext: 112,
  members: 17,
  cutoff: '48h'
};

export const DUKA_CATEGORIES = [
  { emoji: '🌾', label: 'Grains & flour', count: 24 },
  { emoji: '🥬', label: 'Farm produce', count: 31 },
  { emoji: '🥛', label: 'Dairy', count: 9 },
  { emoji: '🧴', label: 'Household', count: 18 },
  { emoji: '🍚', label: 'Rice & pulses', count: 12 },
  { emoji: '📦', label: 'Manufactured', count: 7 }
];

export const CART = [
  { name: 'Maize flour 2 kg', qty: 20, price: 120, pooled: true },
  { name: 'Beans 1 kg', qty: 12, price: 95, pooled: false },
  { name: 'Rice 5 kg', qty: 4, price: 450, pooled: false }
];

export const SLOTS = ['Tomorrow 08–12', 'Tomorrow 12–16', 'Thu 08–12', 'Thu 12–16'];

export const INSTITUTION = {
  name: 'Rift Valley Girls Secondary',
  type: 'School · verified',
  creditUsed: 184000,
  creditLimit: 500000,
  due: 'Invoice #INV-2210 due in 9 days',
  requisitions: [
    { ref: 'REQ-441', items: 'Maize flour 50kg · 12, Rice 5kg · 20', total: 'KES 96,400', state: 'Pending approval' },
    { ref: 'REQ-438', items: 'Beans 1kg · 60, Cooking oil 5l · 8', total: 'KES 41,250', state: 'Approved · PO raised' },
    { ref: 'REQ-430', items: 'Vegetables · weekly crate', total: 'KES 18,900', state: 'Delivered · invoiced' }
  ]
};

export const EVENTS = [
  {
    id: 'EVT-3391',
    name: 'Mombasa Coastal Food Market',
    type: 'Farmers market',
    where: 'Mombasa · Bamburi',
    when: 'Sat 11 Oct · 08:00–18:00',
    fee: 'KES 500',
    stalls: '12 of 40 remaining',
    visitors: '3,000 expected',
    categories: ['🥥 Coconut products', '🐟 Seafood', '🌴 Coastal produce', '🥭 Fruits']
  },
  {
    id: 'EVT-3388',
    name: 'Kisii Avocado Growers Fair',
    type: 'Trade show',
    where: 'Kisii · Town stadium',
    when: 'Sat 18 Oct · 09:00–17:00',
    fee: 'Free',
    stalls: '5 of 60 remaining',
    visitors: '1,200 expected',
    categories: ['🥑 Avocado', '🍌 Bananas', '🌱 Inputs & seedlings']
  },
  {
    id: 'EVT-3372',
    name: 'Nairobi Makers Pop-up',
    type: 'Pop-up',
    where: 'Nairobi · Kilimani',
    when: 'Sun 26 Oct · 10:00–18:00',
    fee: 'KES 1,200',
    stalls: '0 of 30 remaining',
    visitors: '900 expected',
    categories: ['👗 Fashion', '🎨 Art', '🧺 Home']
  }
];

export const APPLICATIONS = [
  { vendor: 'Baharini Fresh Ltd', offer: 'Fresh fish, dried fish, samosas', fee: 'KES 500', state: 'pending' as const },
  { vendor: 'Kilifi Catch Co-op', offer: 'Tilapia, crab, octopus', fee: 'KES 500', state: 'pending' as const },
  { vendor: 'Coconut Coast Ltd', offer: 'Coconut oil, baskets, thatch', fee: 'KES 500', state: 'waitlisted' as const },
  { vendor: 'Malindi Marine', offer: 'Prawns, lobster', fee: 'KES 500', state: 'approved' as const }
];

export const BLUEPRINT = {
  ask: 'Farmers market in Mombasa for 40 vendors',
  categories: ['🥥 Coconut products', '🐟 Seafood', '🌴 Coastal produce', '🥭 Fruits', '🌱 Organic produce', '🍯 Honey'],
  vendors: 12,
  sourcing: ['Mombasa', 'Kilifi', 'Kwale', 'Taita-Taveta'],
  logistics: '3 licensed courier operators cover the county; 1 cold-storage depot within 6 km of the venue.'
};

export const SCOUT = {
  territory: 'Kisii',
  missions: [
    { type: 'Verify listing', target: '4 avocado suppliers near Suneka', fee: 'KES 150 each' },
    { type: 'Refresh availability', target: '2 dairy suppliers, Kisii town', fee: 'KES 150 each' },
    { type: 'Confirm demand', target: 'Nakuru buyer asking for bananas', fee: 'KES 150 each' }
  ],
  signal: { emoji: '📈', text: 'Mombasa demand for Kisii avocado is up 28% this week.' },
  earnings: { approved: 8, each: 150 }
};
