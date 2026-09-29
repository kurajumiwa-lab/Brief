import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  ArrowRight, BadgeCheck, Building2, CalendarDays, Check, ChevronLeft, CircleAlert,
  ClipboardList, Clock, Compass, Copy, CreditCard, FileText, Globe, Image as ImageIcon,
  Info, Layers, MapPin, MessageSquare, Navigation, Package, Phone, Plus, Radio,
  Search, Send, ShieldCheck, ShoppingBag, Smartphone, Sparkles, Store,
  Ticket, TrendingUp, Truck, Users, Wallet, X, Zap
} from 'lucide-react';
import { useDialogFocus } from '../../ui/useDialogFocus';
import {
  APPLICATIONS, AVAILABILITY, BATCHES, BLUEPRINT, CART, COURIERS, DUKA_CATEGORIES,
  EVENTS, FIND_SOURCES, INSTITUTION, ONBOARDING_STEPS, PAYOUT_ROWS, PILLARS, POOL,
  REGIONS, SCOUT, SCREENS, SCREENS_BY_ID, SHIPMENT_LEGS, SLOTS, SPOTLIGHT,
  TABS, TRENDING, VERIFICATION_TIERS, type Region, type ScreenSpec, type TabId
} from './pillarsData';
import './pillars.css';

const money = (n: number) => `KES ${n.toLocaleString('en-KE')}`;
const cls = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

// ---------------------------------------------------------------------------
// Phone primitives
// ---------------------------------------------------------------------------

function AppBar({ title, sub, onBack, action }: { title: string; sub?: string; onBack?: () => void; action?: React.ReactNode }) {
  return (
    <header className="pp-appbar">
      {onBack ? (
        <button type="button" className="pp-iconbtn" onClick={onBack} aria-label="Back">
          <ChevronLeft size={22} />
        </button>
      ) : (
        <span className="pp-appbar-mark" aria-hidden="true"><Compass size={17} /></span>
      )}
      <div className="pp-appbar-text">
        <strong>{title}</strong>
        {sub ? <small>{sub}</small> : null}
      </div>
      {action}
    </header>
  );
}

function Btn({
  children, onClick, kind = 'primary', disabled, note, full
}: {
  children: React.ReactNode; onClick?: () => void; kind?: 'primary' | 'ghost' | 'quiet';
  disabled?: boolean; note?: string; full?: boolean;
}) {
  return (
    <div className={cls('pp-btnwrap', full && 'is-full')}>
      <button type="button" className={cls('pp-btn', `pp-btn-${kind}`)} onClick={onClick} disabled={disabled}>
        {children}
      </button>
      {note ? <small className="pp-btnnote">{note}</small> : null}
    </div>
  );
}

function Dot({ status }: { status: keyof typeof AVAILABILITY }) {
  return <span className={cls('pp-dot', `pp-dot-${AVAILABILITY[status].dot}`)} aria-hidden="true" />;
}

function Sheet({ open, title, note, children, onClose }: {
  open: boolean; title: string; note?: string; children: React.ReactNode; onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(open, panel, onClose);
  if (!open) return null;
  return (
    <div className="pp-sheetlayer">
      <button type="button" className="pp-scrim" aria-label="Close sheet" onClick={onClose} />
      <div className="pp-sheet" role="dialog" aria-modal="true" aria-label={title} ref={panel} tabIndex={-1}>
        <span className="pp-sheetgrip" aria-hidden="true" />
        <h3>{title}</h3>
        {note ? <p className="pp-sheetnote">{note}</p> : null}
        <div className="pp-sheetbody">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// USSD session machine — the spec's menu tree, dialled for real
// ---------------------------------------------------------------------------

type UssdNode = 'dial' | 'root' | 'category' | 'product' | 'qty' | 'confirm' | 'pay' | 'prices' | 'orders' | 'delivery' | 'help' | 'done' | 'ended';

const USSD_TEXT: Record<UssdNode, string> = {
  dial: 'Dial *483*88# to order stock on any phone.',
  root: 'CON Welcome to Brief.\n1. Order Stock\n2. Check Prices\n3. My Orders\n4. Request Delivery\n5. Help\n0. Exit',
  category: 'CON Select category:\n1. Farm Produce\n2. Grains & Flour\n3. Dairy\n4. Household\n5. Manufactured Goods\n0. Back',
  product: 'CON Select product:\n1. Maize Flour 2kg - KES 120 (pool 340kg)\n2. Beans 1kg - KES 95\n3. Rice 5kg - KES 450\n0. Back',
  qty: 'CON Enter quantity for Maize Flour 2kg\n(Pooled price now: KES 120 - drops at 500kg)',
  confirm: 'CON Confirm: 20 x Maize Flour 2kg\nTotal: KES 2,400\n1. Confirm\n2. Change quantity\n3. Cancel',
  pay: 'CON Pay KES 2,400 via M-Pesa?\n1. Yes - enter PIN on your phone\n2. Pay on delivery (first order only)\n0. Back',
  prices: 'CON Farm Produce in your county:\n14 listings - KES 61 to 66\nUpdated 3 hours ago\n0. Back',
  orders: 'CON My Orders\n1. DKA-4821 Maize flour - out for delivery\n2. DKA-4790 Beans - delivered\n3. Draft order - resume\n0. Back',
  delivery: 'CON Registered couriers, Mombasa to Nairobi:\n1. Courier A - 1 day - KES 4,200\n2. Courier B - 2 days - KES 3,600\n0. Back',
  help: 'CON Help\nPrices are what suppliers listed, updated when they say so.\nCall 0800 000 000, Mon-Sat 8am-6pm.\n0. Back',
  done: 'END Order #DKA-4821 confirmed.\nDelivery: tomorrow 10:00-14:00.\nSMS receipt sent.',
  ended: 'END Session ended. Dial *483*88# to start again.'
};

function ussdNext(state: { node: UssdNode; category: string; product: string }, value: string) {
  const v = value.trim();
  switch (state.node) {
    case 'dial':
      return v === '*483*88#' ? { node: 'root' as UssdNode, category: '', product: '' }
        : { node: 'ended' as UssdNode, category: '', product: '' };
    case 'root':
      if (v === '1') return { node: 'category' as UssdNode, category: '', product: '' };
      if (v === '2') return { node: 'prices' as UssdNode, category: '', product: '' };
      if (v === '3') return { node: 'orders' as UssdNode, category: '', product: '' };
      if (v === '4') return { node: 'delivery' as UssdNode, category: '', product: '' };
      if (v === '5') return { node: 'help' as UssdNode, category: '', product: '' };
      return { node: 'ended' as UssdNode, category: '', product: '' };
    case 'category':
      if (v === '0') return { node: 'root' as UssdNode, category: '', product: '' };
      return { node: 'product' as UssdNode, category: v, product: '' };
    case 'product':
      if (v === '0') return { node: 'category' as UssdNode, category: '', product: '' };
      return { node: 'qty' as UssdNode, category: state.category, product: v };
    case 'qty':
      if (!/^\d+$/.test(v)) return { node: 'qty' as UssdNode, category: state.category, product: state.product };
      return { node: 'confirm' as UssdNode, category: state.category, product: state.product };
    case 'confirm':
      if (v === '1') return { node: 'pay' as UssdNode, category: state.category, product: state.product };
      if (v === '2') return { node: 'qty' as UssdNode, category: state.category, product: state.product };
      return { node: 'ended' as UssdNode, category: '', product: '' };
    case 'pay':
      if (v === '1') return { node: 'done' as UssdNode, category: '', product: '' };
      if (v === '2') return { node: 'confirm' as UssdNode, category: state.category, product: state.product };
      return { node: 'root' as UssdNode, category: '', product: '' };
    default:
      return { node: 'root' as UssdNode, category: '', product: '' };
  }
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export function PillarsApp() {
  const [tab, setTab] = useState<TabId>('map');
  const [screen, setScreen] = useState<string>('home-map');
  const [region, setRegion] = useState<Region>(REGIONS[0]);
  const [sheet, setSheet] = useState<string | null>(null);

  // Find it for me
  const [findWhere, setFindWhere] = useState('Nairobi');
  const [findType, setFindType] = useState('Fresh');
  const [findQty, setFindQty] = useState('100 kg');
  const [findDone, setFindDone] = useState(false);

  // Vendor onboarding
  const [step, setStep] = useState(2);
  const [cats, setCats] = useState<string[]>(['farm_produce', 'dairy']);

  // Consolidation
  const [batch, setBatch] = useState(BATCHES[0]);
  const [ceilingHit, setCeilingHit] = useState(false);

  // Shop
  const [cart, setCart] = useState(CART.map((line) => ({ ...line })));
  const [slot, setSlot] = useState(SLOTS[0]);
  const [poolJoined, setPoolJoined] = useState(false);
  const [ussd, setUssd] = useState<{ node: UssdNode; entry: string; category: string; product: string }>({
    node: 'dial', entry: '*483*88#', category: '', product: ''
  });
  const [event, setEvent] = useState(EVENTS[0]);
  const [apps, setApps] = useState<{ vendor: string; offer: string; fee: string; state: string }[]>(
    APPLICATIONS.map((a) => ({ ...a }))
  );
  const [offer, setOffer] = useState('Fresh fish, dried fish, samosas');
  const [needs, setNeeds] = useState<string[]>(['power', 'space']);
  const [stallPass, setStallPass] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);

  const current: ScreenSpec = SCREENS_BY_ID[screen] ?? SCREENS[0];
  const tabScreens = useMemo(() => SCREENS.filter((s) => s.tab === tab), [tab]);

  const go = (id: string) => {
    const next = SCREENS_BY_ID[id];
    if (!next) return;
    setScreen(id);
    setTab(next.tab);
    setSheet(null);
  };

  useEffect(() => {
    document.title = 'Brief Trade — three pillars, fitted to a phone';
    QRCode.toDataURL('BRIEF-STALL-PASS-DEMO-EVT-3391', {
      width: 176, margin: 1, color: { dark: '#0A0E14', light: '#FFFFFF' }
    }).then(setQr).catch(() => setQr(''));
    return () => { document.title = 'Brief'; };
  }, []);

  const cartTotal = cart.reduce((sum, line) => sum + line.qty * line.price, 0);
  const tabRoot = (id: TabId) => SCREENS.find((s) => s.tab === id)?.id ?? 'home-map';

  // -------------------------------------------------------------------------
  // Screens
  // -------------------------------------------------------------------------

  const screenHome = (
    <>
      <div className="pp-searchrow">
        <span className="pp-searchicon" aria-hidden="true"><Search size={16} /></span>
        <input className="pp-input" placeholder="Fish, avocado, venue, supplier" aria-label="Search the trade map" />
      </div>
      <div className="pp-map" role="img" aria-label="Map of East Africa with supply clusters">
        <span className="pp-maplabel">EAST AFRICA · SUPPLY &amp; DEMAND</span>
        {REGIONS.map((r) => (
          <button
            key={r.id}
            type="button"
            className={cls('pp-pin', region.id === r.id && 'is-on')}
            style={{ left: `${r.x}%`, top: `${r.y}%` }}
            onClick={() => { setRegion(r); go('region-detail'); }}
            aria-label={`${r.name}, ${r.suppliers} suppliers`}
          >
            <span className="pp-pinemoji" aria-hidden="true">{r.emoji}</span>
            <span className="pp-pintext">
              <strong>{r.name}</strong>
              <small>{r.suppliers} suppliers</small>
            </span>
          </button>
        ))}
      </div>

      <section className="pp-card pp-spotlight" aria-labelledby="pp-spot-title">
        <div className="pp-cardhead">
          <span className="pp-kicker">Phantom · comparison layer</span>
          <span className="pp-badge">3 changes</span>
        </div>
        <h3 id="pp-spot-title">3 things changed around you</h3>
        <ul className="pp-plainlist">
          {SPOTLIGHT.map((item) => (
            <li key={item.text}><span aria-hidden="true">{item.emoji}</span> {item.text}</li>
          ))}
        </ul>
        <p className="pp-fineprint">Derived from listings, orders, pools and routes. No forecast, no score, nothing stored.</p>
      </section>

      <section className="pp-card" aria-labelledby="pp-trend-title">
        <div className="pp-cardhead"><span className="pp-kicker">Trending now</span></div>
        <div className="pp-chiprow">
          {TRENDING.map((t) => (
            <span key={t.label} className="pp-chip">
              <span aria-hidden="true">{t.emoji}</span> {t.label} <small>{t.meta}</small>
            </span>
          ))}
        </div>
      </section>

      <Btn full onClick={() => go('find-for-me')}>
        <Sparkles size={17} /> Find it for me
      </Btn>
      <p className="pp-fineprint">
        Source anywhere. Sell anywhere. The map is the index; a transaction is only one of the things it is good for.
      </p>
    </>
  );

  const screenRegion = (
    <>
      <div className="pp-regionhead">
        <span className="pp-regionemoji" aria-hidden="true">{region.emoji}</span>
        <div>
          <strong>{region.name}</strong>
          <small>{region.country} · {region.suppliers} suppliers indexed</small>
        </div>
      </div>
      <p className="pp-sectionlabel">Available in {region.name}</p>
      <ul className="pp-rows">
        {region.products.map((p) => (
          <li key={p.name} className="pp-row">
            <span className="pp-rowemoji" aria-hidden="true">{p.emoji}</span>
            <div className="pp-rowmain">
              <strong>{p.name}</strong>
              <small>{p.suppliers} suppliers · {p.price}</small>
            </div>
            <div className="pp-rowside">
              <span className="pp-status"><Dot status={p.status} /> {AVAILABILITY[p.status].label}</span>
              <small>{p.updated}</small>
            </div>
          </li>
        ))}
      </ul>
      <Btn full kind="ghost" onClick={() => setSheet('quote')}>Request current quote</Btn>
      <p className="pp-fineprint">
        Where no reliable recent price exists the row says so. A stale number is worse than an honest question.
      </p>
    </>
  );

  const screenFind = (
    <>
      {!findDone ? (
        <>
          <p className="pp-sectionlabel">Where do you need it?</p>
          <div className="pp-chiprow">
            {['Nairobi', 'Mombasa', 'Kisumu', 'Nakuru'].map((town) => (
              <button key={town} type="button" className={cls('pp-chip', 'is-tappable', findWhere === town && 'is-on')} onClick={() => setFindWhere(town)}>{town}</button>
            ))}
          </div>
          <p className="pp-sectionlabel">What type?</p>
          <div className="pp-chiprow">
            {['Fresh', 'Frozen', 'Dried', 'Wholesale'].map((t) => (
              <button key={t} type="button" className={cls('pp-chip', 'is-tappable', findType === t && 'is-on')} onClick={() => setFindType(t)}>{t}</button>
            ))}
          </div>
          <label className="pp-field">
            <span>Quantity</span>
            <input className="pp-input" value={findQty} onChange={(e) => setFindQty(e.target.value)} inputMode="numeric" />
          </label>
          <Btn full onClick={() => setFindDone(true)}>Find sources <ArrowRight size={16} /></Btn>
        </>
      ) : (
        <>
          <p className="pp-sectionlabel">Sources for {findType.toLowerCase()} fish · {findQty} → {findWhere}</p>
          <ul className="pp-stack">
            {FIND_SOURCES.map((s) => (
              <li key={s.supplier} className="pp-card">
                <div className="pp-cardhead">
                  <span className="pp-kicker"><MapPin size={12} /> {s.town} · {s.km}</span>
                  <span className="pp-badge">{s.couriers} couriers</span>
                </div>
                <strong>{s.supplier}</strong>
                <small>{s.qty}</small>
                <ul className="pp-mini">
                  {COURIERS.slice(0, 2).map((c) => (
                    <li key={c.name}>
                      <span>{c.name} · {c.licensed}</span>
                      <span>{c.eta} · {c.cost} · {c.reliability} on time</span>
                    </li>
                  ))}
                </ul>
                <Btn kind="ghost" onClick={() => setSheet('courier')}>Compare all delivery options</Btn>
              </li>
            ))}
          </ul>
          <Btn full disabled note="Referral booking is not live in this preview.">Book delivery</Btn>
        </>
      )}
    </>
  );

  const screenVendor = (
    <>
      <div className="pp-progress" aria-hidden="true">
        {ONBOARDING_STEPS.map((label, i) => (
          <span key={label} className={cls('pp-progressseg', i <= step && 'is-done')} />
        ))}
      </div>
      <p className="pp-sectionlabel">Step {step + 1} of {ONBOARDING_STEPS.length} · {ONBOARDING_STEPS[step]}</p>
      <label className="pp-field">
        <span>What do you produce?</span>
        <input className="pp-input" defaultValue="Maize flour, beans, soybeans" />
      </label>
      <label className="pp-field">
        <span>Estimated monthly capacity</span>
        <input className="pp-input" defaultValue="12 tonnes" />
      </label>
      <p className="pp-sectionlabel">Categories</p>
      <div className="pp-chiprow">
        {['farm_produce', 'grains', 'dairy', 'manufactured', 'household'].map((c) => (
          <button
            key={c} type="button"
            className={cls('pp-chip', 'is-tappable', cats.includes(c) && 'is-on')}
            onClick={() => setCats((old) => old.includes(c) ? old.filter((x) => x !== c) : [...old, c])}
          >
            {cats.includes(c) ? <Check size={13} /> : <Plus size={13} />} {c.replace('_', ' ')}
          </button>
        ))}
      </div>
      <p className="pp-sectionlabel">Verification tiers</p>
      <ul className="pp-rows">
        {VERIFICATION_TIERS.map((t) => (
          <li key={t.tier} className="pp-row">
            <span className="pp-rowemoji" aria-hidden="true"><BadgeCheck size={18} /></span>
            <div className="pp-rowmain">
              <strong>{t.tier}</strong>
              <small>{t.needs}</small>
            </div>
            <div className="pp-rowside"><small>{t.gets}</small></div>
          </li>
        ))}
      </ul>
      <div className="pp-btnrow">
        <Btn kind="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</Btn>
        <Btn onClick={() => setStep((s) => Math.min(ONBOARDING_STEPS.length - 1, s + 1))}>
          {step === ONBOARDING_STEPS.length - 1 ? 'Submit for review' : 'Save & continue'}
        </Btn>
      </div>
      <p className="pp-fineprint">
        No smartphone? A field agent completes every step on the vendor’s behalf, and the record says who did.
      </p>
    </>
  );

  const screenConsolidation = (
    <>
      <div className="pp-chiprow">
        {BATCHES.map((b) => (
          <button key={b.id} type="button" className={cls('pp-chip', 'is-tappable', batch.id === b.id && 'is-on')} onClick={() => setBatch(b)}>
            {b.id}
          </button>
        ))}
      </div>
      <section className="pp-card">
        <div className="pp-cardhead">
          <span className="pp-kicker"><Navigation size={12} /> {batch.post}</span>
          <span className="pp-badge">{batch.status}</span>
        </div>
        <strong>{batch.vendors} vendors · {batch.value}</strong>
        <small>{batch.ceiling} · {batch.cutoff}</small>
        <div className="pp-meter" aria-hidden="true"><span style={{ width: '92%' }} /></div>
        <small className="pp-fineprint">Batch value against the per-consignment ceiling. The server refuses the write above it.</small>
      </section>
      <p className="pp-sectionlabel">Consignments in this batch</p>
      <ul className="pp-rows">
        {batch.lines.map((l) => (
          <li key={l.vendor} className="pp-row">
            <span className="pp-rowemoji" aria-hidden="true"><Package size={18} /></span>
            <div className="pp-rowmain">
              <strong>{l.vendor}</strong>
              <small>{l.item}</small>
            </div>
            <div className="pp-rowside"><small>{l.value}</small></div>
          </li>
        ))}
      </ul>
      <div className="pp-btnrow">
        <Btn kind="ghost" onClick={() => setSheet('scoo')}><FileText size={16} /> SCOO</Btn>
        <Btn kind="ghost" onClick={() => setCeilingHit(true)}>Add consignment</Btn>
      </div>
      <Btn full disabled={batch.status !== 'Open'} note={batch.status === 'Open' ? 'Assigns vehicle and driver, then notifies buyers.' : 'This batch is already locked.'}>
        Lock &amp; dispatch
      </Btn>
    </>
  );

  const screenShipment = (
    <>
      <section className="pp-card pp-etacard">
        <div className="pp-cardhead"><span className="pp-kicker">SHP-2291 · Busia → Nairobi</span></div>
        <div className="pp-eta">
          <div><small>Estimated arrival</small><strong>Wed 08:00</strong></div>
          <div><small>Delay</small><strong>+2h 15m</strong></div>
        </div>
        <p className="pp-delayreason"><CircleAlert size={14} /> Queue at Busia OSBP — 6 vehicles ahead. Buyers on this batch were notified at 08:05.</p>
      </section>
      <ol className="pp-timeline">
        {SHIPMENT_LEGS.map((leg) => (
          <li key={leg.label} className={cls(leg.done && 'is-done', leg.current && 'is-current')}>
            <span className="pp-timelinedot" aria-hidden="true" />
            <div className="pp-timelinemain">
              <strong>{leg.label}</strong>
              <small>{leg.at}</small>
              {leg.note ? <p className="pp-fineprint">{leg.note}</p> : null}
            </div>
          </li>
        ))}
      </ol>
      <Btn full kind="ghost" onClick={() => setSheet('damage')}>Report damage or a delay</Btn>
    </>
  );

  const screenPayout = (
    <>
      <section className="pp-card">
        <div className="pp-cardhead"><span className="pp-kicker">Pending payout</span><span className="pp-badge">UGX</span></div>
        <strong className="pp-bignum">UGX 2,333,240</strong>
        <small>3 settled work orders · paid weekly on Friday</small>
        <div className="pp-arithmetic">
          <span>KES 48,200 × 28.4 = UGX 1,368,880</span>
          <span>KES 21,600 × 28.4 = UGX 613,440</span>
          <span>KES 12,400 × 28.3 = UGX 350,920</span>
        </div>
      </section>
      <p className="pp-sectionlabel">Rate used</p>
      <ul className="pp-rows">
        <li className="pp-row">
          <span className="pp-rowemoji" aria-hidden="true"><Wallet size={18} /></span>
          <div className="pp-rowmain">
            <strong>1 KES = 28.4 UGX</strong>
            <small>Appended 29 Sep 06:00 · buffer 1.5% · source: named provider</small>
          </div>
        </li>
      </ul>
      <p className="pp-sectionlabel">Settlement history</p>
      <ul className="pp-rows">
        {PAYOUT_ROWS.map((r) => (
          <li key={r.ref} className="pp-row">
            <span className="pp-rowemoji" aria-hidden="true"><CreditCard size={18} /></span>
            <div className="pp-rowmain">
              <strong>{r.ref}</strong>
              <small>{r.settled} at {r.rate}</small>
            </div>
            <div className="pp-rowside"><small>{r.ugx}</small></div>
          </li>
        ))}
      </ul>
      <Btn full disabled note="Automated UGX payout is a blocked workstream. Payouts stay manual and finance-confirmed.">
        Request early payout · 1.5%
      </Btn>
    </>
  );

  const screenDuka = (
    <>
      <section className="pp-card pp-reorder">
        <span className="pp-kicker">Last order · Tue 10:24</span>
        <strong>Maize flour 2kg × 20 · Beans 1kg × 12</strong>
        <small>KES 3,540 · delivered Tue 14:10</small>
        <Btn full onClick={() => go('checkout')}>Reorder last order</Btn>
      </section>
      <p className="pp-sectionlabel">Categories</p>
      <div className="pp-grid">
        {DUKA_CATEGORIES.map((c) => (
          <button key={c.label} type="button" className="pp-tile" onClick={() => go('pool-save')}>
            <span className="pp-tileemoji" aria-hidden="true">{c.emoji}</span>
            <strong>{c.label}</strong>
            <small>{c.count} listings</small>
          </button>
        ))}
      </div>
      <section className="pp-card pp-alert">
        <span className="pp-kicker">Pooled price alert</span>
        <strong>Maize flour is KES 120 in a 340kg pool — KES 112 at 500kg.</strong>
        <Btn kind="ghost" onClick={() => go('pool-save')}>Join the pool</Btn>
      </section>
      <button type="button" className="pp-ussdpair" onClick={() => go('ussd')}>
        <Smartphone size={18} />
        <span><strong>Order by USSD</strong><small>Dial *483*88# on any phone, no app needed</small></span>
        <ArrowRight size={16} />
      </button>
    </>
  );

  const screenPool = (
    <>
      <section className="pp-card">
        <div className="pp-cardhead"><span className="pp-kicker">Pool &amp; save</span><span className="pp-badge">{POOL.members} members</span></div>
        <strong>{POOL.product}</strong>
        <small>{POOL.vendor} · cutoff in {POOL.cutoff}</small>
        <div className="pp-poolbar">
          <span style={{ width: `${(POOL.filled / POOL.next) * 100}%` }} />
        </div>
        <div className="pp-poolnums">
          <div><small>Pooled now</small><strong>{money(POOL.priceNow)}</strong></div>
          <div><small>At {POOL.next} {POOL.unit}</small><strong className="pp-drop">{money(POOL.priceNext)}</strong></div>
        </div>
        <p className="pp-fineprint">
          {POOL.filled} {POOL.unit} pooled. Joining at 20 kg moves the pool to 360 {POOL.unit} and saves you KES 160 on this order.
        </p>
      </section>
      <Btn full onClick={() => setPoolJoined(true)} note={poolJoined ? 'Added to the pool. Price re-derives from the tier table.' : undefined}>
        {poolJoined ? <><Check size={17} /> In the pool</> : 'Join pool'}
      </Btn>
      <p className="pp-fineprint">
        If the pool does not reach its minimum, it is cancelled and nobody is charged. The price is derived from the tier
        table, never typed by the platform.
      </p>
    </>
  );

  const screenCheckout = (
    <>
      <p className="pp-sectionlabel">Basket</p>
      <ul className="pp-rows">
        {cart.map((line) => (
          <li key={line.name} className="pp-row">
            <span className="pp-rowemoji" aria-hidden="true"><Package size={18} /></span>
            <div className="pp-rowmain">
              <strong>{line.name}</strong>
              <small>{line.qty} × {money(line.price)}{line.pooled ? ' · pooled' : ''}</small>
            </div>
            <div className="pp-rowside">
              <strong>{money(line.qty * line.price)}</strong>
              <button type="button" className="pp-qtybtn" onClick={() => setCart((old) => old.filter((l) => l.name !== line.name))} aria-label={`Remove ${line.name}`}>
                <X size={14} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="pp-sectionlabel">Delivery window</p>
      <div className="pp-chiprow">
        {SLOTS.map((s) => (
          <button key={s} type="button" className={cls('pp-chip', 'is-tappable', slot === s && 'is-on')} onClick={() => setSlot(s)}>{s}</button>
        ))}
      </div>
      <section className="pp-card pp-totalcard">
        <div className="pp-totalrow"><span>Items</span><strong>{money(cartTotal)}</strong></div>
        <div className="pp-totalrow"><span>Delivery</span><strong>{cartTotal >= 3000 ? 'Free' : money(150)}</strong></div>
        <div className="pp-totalrow is-total"><span>To pay</span><strong>{money(cartTotal >= 3000 ? cartTotal : cartTotal + 150)}</strong></div>
        <small>Funds are held until delivery is confirmed. Nothing settles on a guess.</small>
      </section>
      <Btn full onClick={() => setSheet('stk')}>Pay with M-Pesa</Btn>
    </>
  );

  const screenUssd = (
    <div className="pp-ussdwrap">
      <div className="pp-ussd" aria-live="polite">
        {ussd.node === 'dial' ? (
          <p className="pp-ussdtext">{USSD_TEXT.dial}</p>
        ) : (
          <pre className="pp-ussdtext">{USSD_TEXT[ussd.node]}</pre>
        )}
      </div>
      {ussd.node === 'dial' || ussd.node === 'qty' ? (
        <div className="pp-ussdentry">
          <input
            className="pp-input"
            value={ussd.entry}
            onChange={(e) => setUssd((s) => ({ ...s, entry: e.target.value }))}
            aria-label="USSD entry"
            placeholder={ussd.node === 'qty' ? 'Quantity' : 'USSD code'}
          />
          <Btn onClick={() => setUssd((s) => ({ ...s, ...ussdNext(s, s.entry), entry: '' }))}>Send</Btn>
        </div>
      ) : (
        <div className="pp-keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((k) => (
            <button
              key={k} type="button" className="pp-key"
              disabled={!['0', '1', '2', '3', '4', '5'].includes(k) || ussd.node === 'done' || ussd.node === 'ended'}
              onClick={() => setUssd((s) => ({ ...s, ...ussdNext(s, k) }))}
            >
              {k}
            </button>
          ))}
        </div>
      )}
      <p className="pp-fineprint">
        Plain text, CON/END, no styling. A session that times out mid-order keeps the order as a resumable draft, and the
        session never reads an amount from the keypad.
      </p>
    </div>
  );

  const screenInstitution = (
    <>
      <section className="pp-card">
        <div className="pp-cardhead"><span className="pp-kicker"><Building2 size={12} /> Institution</span><span className="pp-badge">{INSTITUTION.type}</span></div>
        <strong>{INSTITUTION.name}</strong>
        <div className="pp-meter" aria-hidden="true">
          <span style={{ width: `${(INSTITUTION.creditUsed / INSTITUTION.creditLimit) * 100}%` }} />
        </div>
        <small>{money(INSTITUTION.creditUsed)} of {money(INSTITUTION.creditLimit)} credit used · {INSTITUTION.due}</small>
      </section>
      <p className="pp-sectionlabel">Requisitions</p>
      <ul className="pp-rows">
        {INSTITUTION.requisitions.map((r) => (
          <li key={r.ref} className="pp-row">
            <span className="pp-rowemoji" aria-hidden="true"><FileText size={18} /></span>
            <div className="pp-rowmain">
              <strong>{r.ref}</strong>
              <small>{r.items}</small>
            </div>
            <div className="pp-rowside">
              <strong>{r.total}</strong>
              <small>{r.state}</small>
            </div>
          </li>
        ))}
      </ul>
      <div className="pp-btnrow">
        <Btn kind="ghost" onClick={() => setSheet('approve')}>Approve REQ-441</Btn>
        <Btn onClick={() => setSheet('po')}>Raise purchase order</Btn>
      </div>
      <p className="pp-fineprint">
        An approval timeout escalates to the backup approver. It never auto-approves, and exceeding the credit limit
        blocks the order with the reason shown.
      </p>
    </>
  );

  const screenBasket = (
    <>
      <div className="pp-tabs" role="tablist" aria-label="Basket categories">
        {['Produce', 'Household', 'Farm', 'Dairy'].map((c) => (
          <button key={c} type="button" role="tab" className={cls('pp-tab', c === 'Produce' && 'is-on')} aria-selected={c === 'Produce'}>{c}</button>
        ))}
      </div>
      <ul className="pp-rows">
        {[
          { n: 'Sukuma wiki · 3 bunches', p: 'KES 90' },
          { n: 'Tomatoes · 2 kg', p: 'KES 180' },
          { n: 'Onions · 2 kg', p: 'KES 220' },
          { n: 'Bar soap · 6', p: 'KES 360' }
        ].map((l) => (
          <li key={l.n} className="pp-row">
            <span className="pp-rowemoji" aria-hidden="true"><ShoppingBag size={18} /></span>
            <div className="pp-rowmain"><strong>{l.n}</strong><small>Two vendors, one window</small></div>
            <div className="pp-rowside"><strong>{l.p}</strong></div>
          </li>
        ))}
      </ul>
      <button type="button" className="pp-sharelink" onClick={() => setCopied(true)}>
        <Copy size={16} />
        <span><strong>Shared basket link</strong><small>brief.app/duka/basket/BKT-7741 · revocable</small></span>
        <em>{copied ? 'Copied' : 'Copy'}</em>
      </button>
      <section className="pp-card pp-alert">
        <span className="pp-kicker">Split delivery suggested</span>
        <strong>Sukuma wiki will not keep until Thursday.</strong>
        <small>Deliver produce tomorrow and household goods Thursday, or take both tomorrow for KES 150.</small>
      </section>
      <Btn full onClick={() => go('checkout')}>Continue to checkout</Btn>
    </>
  );

  const screenEventFeed = (
    <>
      <div className="pp-chiprow">
        {['All', 'Food', 'Farmers', 'Handmade', 'Free'].map((f, i) => (
          <button key={f} type="button" className={cls('pp-chip', 'is-tappable', i === 0 && 'is-on')}>{f}</button>
        ))}
      </div>
      <section className="pp-card pp-alert">
        <span className="pp-kicker">Opportunity</span>
        <strong>Mombasa Coastal Food Market needs 12 more food vendors.</strong>
        <Btn kind="ghost" onClick={() => go('stall-application')}>Apply now</Btn>
      </section>
      <ul className="pp-stack">
        {EVENTS.map((e) => (
          <li key={e.id} className="pp-card">
            <div className="pp-cardhead">
              <span className="pp-kicker"><CalendarDays size={12} /> {e.when}</span>
              <span className="pp-badge">{e.fee}</span>
            </div>
            <strong>{e.name}</strong>
            <small>{e.type} · {e.where} · {e.stalls}</small>
            <div className="pp-chiprow">
              {e.categories.map((c) => <span key={c} className="pp-chip">{c}</span>)}
            </div>
            <Btn kind="ghost" onClick={() => { setEvent(e); go('stall-application'); }}>Apply for a stall</Btn>
          </li>
        ))}
      </ul>
      <p className="pp-fineprint">Stalls remaining is the only number an event prints. No attendee counts, no social proof.</p>
    </>
  );

  const screenStall = (
    <>
      <section className="pp-card">
        <div className="pp-cardhead"><span className="pp-kicker">{event.type}</span><span className="pp-badge">{event.fee}</span></div>
        <strong>{event.name}</strong>
        <small>{event.when} · {event.where} · {event.visitors}</small>
      </section>
      <label className="pp-field">
        <span>What will you sell?</span>
        <textarea className="pp-input pp-textarea" value={offer} onChange={(e) => setOffer(e.target.value)} rows={3} />
      </label>
      <p className="pp-sectionlabel">Requirements</p>
      <div className="pp-chiprow">
        {['power', 'water', 'space'].map((n) => (
          <button
            key={n} type="button"
            className={cls('pp-chip', 'is-tappable', needs.includes(n) && 'is-on')}
            onClick={() => setNeeds((old) => old.includes(n) ? old.filter((x) => x !== n) : [...old, n])}
          >
            {needs.includes(n) ? <Check size={13} /> : <Plus size={13} />} {n}
          </button>
        ))}
      </div>
      <button type="button" className="pp-photopick">
        <ImageIcon size={18} /> Add product photos
      </button>
      <Btn full onClick={() => setSheet('fee')}>Pay stall fee · {event.fee}</Btn>
      <p className="pp-fineprint">If the event is cancelled the fee is refunded automatically. A rejection always carries a reason.</p>
    </>
  );

  const screenDesk = (
    <>
      <section className="pp-card">
        <div className="pp-cardhead"><span className="pp-kicker">{event.name}</span><span className="pp-badge">28 of 40 taken</span></div>
        <strong>Applications</strong>
        <small>Approve, waitlist or reject with a reason.</small>
      </section>
      <ul className="pp-stack">
        {apps.map((a) => (
          <li key={a.vendor} className="pp-card">
            <div className="pp-cardhead"><span className="pp-kicker">{a.fee}</span><span className={cls('pp-badge', `is-${a.state}`)}>{a.state}</span></div>
            <strong>{a.vendor}</strong>
            <small>{a.offer}</small>
            <div className="pp-btnrow">
              <Btn kind="ghost" onClick={() => setApps((old) => old.map((x) => x.vendor === a.vendor ? { ...x, state: 'approved' } : x))}>Approve</Btn>
              <Btn kind="ghost" onClick={() => setApps((old) => old.map((x) => x.vendor === a.vendor ? { ...x, state: 'waitlisted' } : x))}>Waitlist</Btn>
              <Btn kind="quiet" onClick={() => setRejecting(a.vendor)}>Reject</Btn>
            </div>
          </li>
        ))}
      </ul>
      <p className="pp-fineprint">Approving beyond capacity is refused with the remaining count. Cancellation refunds every approved applicant in one pass.</p>
    </>
  );

  const screenBlueprint = (
    <>
      <section className="pp-card">
        <span className="pp-kicker">You asked</span>
        <strong>“{BLUEPRINT.ask}”</strong>
      </section>
      <p className="pp-sectionlabel">Recommended categories</p>
      <div className="pp-chiprow">
        {BLUEPRINT.categories.map((c) => <span key={c} className="pp-chip">{c}</span>)}
      </div>
      <p className="pp-sectionlabel">Potential vendors</p>
      <section className="pp-card">
        <div className="pp-cardhead"><span className="pp-kicker"><Store size={12} /> On the platform</span><span className="pp-badge">{BLUEPRINT.vendors}</span></div>
        <strong>{BLUEPRINT.vendors} suppliers match these categories</strong>
        <small>Live query over verified supply records — not a cached “potential” figure.</small>
        <Btn kind="ghost" onClick={() => setSheet('invite')}><Send size={15} /> Invite these vendors</Btn>
      </section>
      <p className="pp-sectionlabel">Recommended sourcing areas</p>
      <div className="pp-chiprow">
        {BLUEPRINT.sourcing.map((s) => <span key={s} className="pp-chip"><MapPin size={12} /> {s}</span>)}
      </div>
      <p className="pp-sectionlabel">Nearby logistics</p>
      <section className="pp-card">
        <div className="pp-cardhead"><span className="pp-kicker"><Truck size={12} /> Licensed operators</span></div>
        <small>{BLUEPRINT.logistics}</small>
      </section>
      <Btn full kind="ghost" onClick={() => go('organizer-desk')}>Open the organiser desk</Btn>
    </>
  );

  const screenScout = (
    <>
      <section className="pp-card pp-scouthead">
        <span className="pp-kicker"><Compass size={12} /> Your territory</span>
        <strong>{SCOUT.territory}</strong>
        <small>3 open missions · 1 demand signal</small>
      </section>
      <section className="pp-card pp-alert">
        <span className="pp-kicker">Phantom · demand</span>
        <strong><span aria-hidden="true">{SCOUT.signal.emoji}</span> {SCOUT.signal.text}</strong>
      </section>
      <p className="pp-sectionlabel">Today</p>
      <ul className="pp-stack">
        {SCOUT.missions.map((m) => (
          <li key={m.target} className="pp-card">
            <div className="pp-cardhead"><span className="pp-kicker"><ClipboardList size={12} /> {m.type}</span><span className="pp-badge">{m.fee}</span></div>
            <strong>{m.target}</strong>
            <Btn kind="ghost" onClick={() => setSheet('mission')}><Phone size={15} /> Contact supplier</Btn>
          </li>
        ))}
      </ul>
      <section className="pp-card">
        <div className="pp-cardhead"><span className="pp-kicker">Earnings · derived</span></div>
        <strong className="pp-bignum">{money(SCOUT.earnings.approved * SCOUT.earnings.each)}</strong>
        <div className="pp-arithmetic">
          <span>KES {SCOUT.earnings.each} × {SCOUT.earnings.approved} approved missions</span>
          <span>2 pending missions pay nothing yet</span>
        </div>
        <small>Flat fee per approved outcome. A rejected mission pays nothing and says why. Depth stays at one.</small>
      </section>
    </>
  );

  const BODIES: Record<string, React.ReactNode> = {
    'home-map': screenHome,
    'region-detail': screenRegion,
    'find-for-me': screenFind,
    'vendor-onboarding': screenVendor,
    'consolidation': screenConsolidation,
    'shipment': screenShipment,
    'payout': screenPayout,
    'duka-home': screenDuka,
    'pool-save': screenPool,
    'checkout': screenCheckout,
    'ussd': screenUssd,
    'institution': screenInstitution,
    'basket': screenBasket,
    'event-feed': screenEventFeed,
    'stall-application': screenStall,
    'organizer-desk': screenDesk,
    'blueprint': screenBlueprint,
    'scout-today': screenScout
  };

  const SHEETS: Record<string, { title: string; note?: string; body: React.ReactNode }> = {
    quote: {
      title: 'Request a current quote',
      note: 'The supplier confirms price and availability before it becomes a number.',
      body: <>
        <label className="pp-field"><span>Quantity</span><input className="pp-input" defaultValue="100 kg" /></label>
        <label className="pp-field"><span>Needed by</span><input className="pp-input" defaultValue="Friday 12:00" /></label>
        <Btn full disabled note="Quoting is not live in this preview.">Send request to 14 suppliers</Btn>
      </>
    },
    courier: {
      title: 'Delivery options · Mombasa → Nairobi',
      note: 'Licensed operators only. Brief orchestrates the booking; it never owns the truck.',
      body: <ul className="pp-rows">
        {COURIERS.map((c) => (
          <li key={c.name} className="pp-row">
            <span className="pp-rowemoji" aria-hidden="true"><Truck size={18} /></span>
            <div className="pp-rowmain">
              <strong>{c.name}</strong>
              <small>{c.licensed} · {c.reliability} on time</small>
            </div>
            <div className="pp-rowside"><strong>{c.cost}</strong><small>{c.eta}</small></div>
          </li>
        ))}
      </ul>
    },
    scoo: {
      title: 'Simplified Certificate of Origin',
      note: 'Drafted from the consignment rows and confirmed by the vendor before printing.',
      body: <>
        <ul className="pp-rows">
          <li className="pp-row"><span className="pp-rowemoji"><FileText size={18} /></span><div className="pp-rowmain"><strong>Batch BUSIA-118</strong><small>6 consignments · US$ 1,840 declared · STR eligible</small></div></li>
          <li className="pp-row"><span className="pp-rowemoji"><ShieldCheck size={18} /></span><div className="pp-rowmain"><strong>Busia one-stop border post</strong><small>Certificate printed at the consolidation point</small></div></li>
        </ul>
        <Btn full disabled note="Customs documents are not generated in this preview.">Generate &amp; print</Btn>
      </>
    },
    stk: {
      title: 'M-Pesa · waiting for your PIN',
      note: 'A prompt was sent to 0722•••448. This sheet never claims a payment that did not happen.',
      body: <>
        <div className="pp-waiting"><span className="pp-spinner" aria-hidden="true" /> Waiting for the PIN prompt…</div>
        <Btn full kind="ghost" onClick={() => setSheet(null)}>Cancel and keep the basket</Btn>
        <p className="pp-fineprint">An unconfigured rail returns a reason, not a fake “paid”.</p>
      </>
    },
    fee: {
      title: `Stall fee · ${event.fee}`,
      note: 'Refunded automatically if the event is cancelled or the application is rejected.',
      body: <>
        <Btn full onClick={() => { setSheet('pass'); setStallPass(true); }}>Pay with M-Pesa</Btn>
        <p className="pp-fineprint">Preview only — no payment moves.</p>
      </>
    },
    pass: {
      title: 'Stall pass',
      note: 'Works offline at the gate. Screenshot it.',
      body: <div className="pp-pass">
        {qr ? <img src={qr} alt="Demo stall pass QR code" width={176} height={176} /> : <span className="pp-passfallback">Stall pass QR unavailable in this preview</span>}
        <strong>{event.name}</strong>
        <small>Baharini Fresh Ltd · Stall 14 · {event.when}</small>
      </div>
    },
    approve: {
      title: 'Approve REQ-441',
      note: 'Approval is a named act by a named person.',
      body: <>
        <label className="pp-field"><span>Approver</span><input className="pp-input" defaultValue="Principal · Grace W." /></label>
        <Btn full disabled note="Approvals are not live in this preview.">Approve and raise the PO</Btn>
      </>
    },
    po: {
      title: 'Purchase order',
      note: 'Generated from the approved requisition, with terms printed on it.',
      body: <ul className="pp-rows">
        <li className="pp-row"><span className="pp-rowemoji"><FileText size={18} /></span><div className="pp-rowmain"><strong>PO-2026-0451</strong><small>6 lines · KES 96,400 · 30-day terms</small></div></li>
        <li className="pp-row"><span className="pp-rowemoji"><Package size={18} /></span><div className="pp-rowmain"><strong>Receiving dock</strong><small>Proof of delivery captured on arrival</small></div></li>
      </ul>
    },
    invite: {
      title: 'Invite vendors',
      note: 'Invitations are sent to suppliers already verified on the platform.',
      body: <>
        <p className="pp-sheetcopy">{BLUEPRINT.vendors} vendors in {BLUEPRINT.sourcing.join(', ')} match your categories.</p>
        <Btn full disabled note="Invitations are not sent in this preview.">Send {BLUEPRINT.vendors} invitations</Btn>
      </>
    },
    mission: {
      title: 'Verify a supplier',
      note: 'A mission pays a flat fee only when an approver accepts the evidence.',
      body: <>
        <label className="pp-field"><span>What did you confirm?</span><input className="pp-input" defaultValue="Avocado available, 4 tonnes, KES 62/kg" /></label>
        <button type="button" className="pp-photopick"><ImageIcon size={18} /> Attach photo evidence</button>
        <Btn full disabled note="Missions are not submitted in this preview.">Submit for approval</Btn>
      </>
    },
    damage: {
      title: 'Report a problem',
      note: 'Photo evidence attaches to the shipment and notifies both parties.',
      body: <>
        <label className="pp-field"><span>What happened?</span><input className="pp-input" defaultValue="Two crates wet at the border" /></label>
        <Btn full disabled note="Claims are not filed in this preview.">Attach photos and report</Btn>
      </>
    }
  };

  const activeSheet = sheet ? SHEETS[sheet] : null;

  // -------------------------------------------------------------------------
  // Shell
  // -------------------------------------------------------------------------

  return (
    <div className="pp-page" id="top">
      <div className="pp-previewbar">
        <span className="pp-previewdot" aria-hidden="true" />
        Brief Trade is an architecture concept. No order, batch, pool, stall, payout or payment in this preview is live.
      </div>

      <header className="pp-header">
        <a className="pp-logo" href="#top" aria-label="Brief Trade">
          <span className="pp-logomark" aria-hidden="true"><Compass size={19} /></span>brief<b>trade</b>
        </a>
        <nav className="pp-headnav" aria-label="Brief Trade sections">
          <a href="#pillars">Three pillars</a>
          <a href="#screens">Screens</a>
          <a href="#fit">Mobile fit</a>
          <a className="pp-backlink" href="/#home"><ArrowRight size={14} /> Back to Brief</a>
        </nav>
      </header>

      <section className="pp-intro" id="pillars">
        <div className="pp-introcopy">
          <span className="pp-kicker">Primary architecture · 2026-09-29</span>
          <h1>Three pillars, <em>one phone.</em></h1>
          <p className="pp-lead">
            Brief already runs the loop — request, match, quote, work order, repeat, trust, payment. The three pillars are
            where that loop is put to work: <strong>find it</strong>, <strong>get it</strong>, <strong>buy it</strong>,
            <strong> meet it</strong>.
          </p>
          <p className="pp-introdetail">
            Every screen below is fitted to a 360&nbsp;×&nbsp;800 phone first: one column, 44&nbsp;dp targets, bottom
            actions inside the thumb arc, bottom sheets instead of page jumps, and tables reflowed into rows. Tap through
            the device — the USSD session, the pool, the stall pass and the consolidation desk all work.
          </p>
        </div>
        <ul className="pp-pillarrow">
          {(Object.keys(PILLARS) as ('p1' | 'p2' | 'p3')[]).map((id) => (
            <li key={id}>
              <span className="pp-pillarname">{PILLARS[id].name}</span>
              <p>{PILLARS[id].line}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="pp-stage" id="screens">
        <div className="pp-devicecol">
          <div className="pp-device">
            <div className="pp-notch" aria-hidden="true" />
            <div className="pp-app">
              <div className="pp-statusbar" aria-hidden="true">
                <span>09:41</span>
                <span className="pp-statusicons"><Radio size={12} /><Zap size={13} /></span>
              </div>

              <AppBar
                title={current.title}
                sub={`${current.door} · ${current.hash}`}
                onBack={screen === tabRoot(tab) ? undefined : () => setScreen(tabRoot(tab))}
                action={
                  <span className={cls('pp-pillarbadge', `is-${current.pillar}`)}>
                    {current.pillar.toUpperCase()}
                  </span>
                }
              />

              <div className="pp-scroll" key={screen}>
                <p className="pp-whostrip">{current.who}</p>
                {BODIES[screen]}
                <div className="pp-scrollpad" />
              </div>

              <nav className="pp-tabbar" aria-label="Pillar navigation">
                {[
                  { id: 'map' as TabId, label: 'Map', Icon: Globe },
                  { id: 'supply' as TabId, label: 'Supply', Icon: Truck },
                  { id: 'shop' as TabId, label: 'Shop', Icon: ShoppingBag },
                  { id: 'gather' as TabId, label: 'Gather', Icon: Ticket },
                  { id: 'scout' as TabId, label: 'Scout', Icon: Compass }
                ].map(({ id, label, Icon }) => (
                  <button
                    key={id} type="button"
                    className={cls('pp-tabbtn', tab === id && 'is-on')}
                    aria-current={tab === id ? 'page' : undefined}
                    onClick={() => { setTab(id); setScreen(tabRoot(id)); setSheet(null); }}
                  >
                    <Icon size={20} />
                    <span>{label}</span>
                  </button>
                ))}
              </nav>

              <Sheet open={!!activeSheet} title={activeSheet?.title ?? ''} note={activeSheet?.note} onClose={() => setSheet(null)}>
                {activeSheet?.body}
              </Sheet>

              {ceilingHit ? (
                <Sheet
                  open
                  title="Above the STR ceiling"
                  note="A consignment over US$2,000 cannot travel under the Simplified Trade Regime."
                  onClose={() => setCeilingHit(false)}
                >
                  <ul className="pp-rows">
                    <li className="pp-row">
                      <span className="pp-rowemoji"><Layers size={18} /></span>
                      <div className="pp-rowmain"><strong>Split into sub-consignments</strong><small>Two STR-eligible consignments, two certificates</small></div>
                    </li>
                    <li className="pp-row">
                      <span className="pp-rowemoji"><FileText size={18} /></span>
                      <div className="pp-rowmain"><strong>Escalate to full declaration</strong><small>A partner customs agent is triggered</small></div>
                    </li>
                  </ul>
                  <Btn full kind="ghost" onClick={() => setCeilingHit(false)}>Close</Btn>
                </Sheet>
              ) : null}

              {rejecting ? (
                <Sheet
                  open
                  title="Reject with a reason"
                  note="A rejection always carries a reason, and the fee is refunded automatically."
                  onClose={() => { setRejecting(null); setReason(''); }}
                >
                  <label className="pp-field"><span>Reason</span><input className="pp-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Category already full" /></label>
                  <Btn
                    full
                    disabled={reason.trim().length < 3}
                    note={reason.trim().length < 3 ? 'Give the vendor a reason they can act on.' : undefined}
                    onClick={() => {
                      setApps((old) => old.map((x) => x.vendor === rejecting ? { ...x, state: 'rejected' } : x));
                      setRejecting(null); setReason('');
                    }}
                  >
                    Reject and refund
                  </Btn>
                </Sheet>
              ) : null}
            </div>
          </div>
          <p className="pp-devicecaption">
            Interactive concept. Figures are fixtures; buttons that would transact are disabled and say why.
          </p>
        </div>

        <aside className="pp-side">
          <div className="pp-sideblock">
            <span className="pp-kicker">Screens in {TABS.find((t) => t.id === tab)?.label}</span>
            <div className="pp-screenlist">
              {tabScreens.map((s) => (
                <button
                  key={s.id} type="button"
                  className={cls('pp-screenbtn', s.id === screen && 'is-on')}
                  onClick={() => { setScreen(s.id); setSheet(null); }}
                >
                  <span className={cls('pp-pillarbadge', `is-${s.pillar}`)}>{s.pillar.toUpperCase()}</span>
                  <span className="pp-screenbtntext">
                    <strong>{s.title}</strong>
                    <small>{s.hash}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="pp-sideblock pp-spec">
            <div className="pp-spechead">
              <span className="pp-kicker">{current.door} · {current.pillar.toUpperCase()}</span>
              <h2>{current.title}</h2>
              <p className="pp-specwho">{current.who}</p>
            </div>
            <p className="pp-specsum">{current.summary}</p>

            <h3>Mobile fit</h3>
            <ul className="pp-speclist">
              {current.fit.map((f) => <li key={f}>{f}</li>)}
            </ul>

            <h3>Data model</h3>
            <ul className="pp-speccode">
              {current.model.map((m) => <li key={m}>{m}</li>)}
            </ul>

            <h3>API</h3>
            <ul className="pp-speccode">
              {current.api.map((a) => <li key={a}>{a}</li>)}
            </ul>

            {current.ussd ? <><h3>USSD</h3><pre className="pp-specpre">{current.ussd}</pre></> : null}

            <h3>Edge cases</h3>
            <ul className="pp-speclist">
              {current.edges.map((e) => <li key={e}>{e}</li>)}
            </ul>
          </div>
        </aside>
      </section>

      <section className="pp-fitstrip" id="fit">
        <span className="pp-kicker">The mobile fit contract</span>
        <ul>
          <li><strong>360 × 800 baseline</strong> safe-area insets honoured</li>
          <li><strong>44 dp targets</strong> with 8 dp between them</li>
          <li><strong>16 px inputs</strong> so iOS never zooms a focused field</li>
          <li><strong>One column</strong> vertical scroll only — tables reflow to rows</li>
          <li><strong>Bottom actions</strong> inside the thumb arc, never top-right only</li>
          <li><strong>Sheets over jumps</strong> so context and back stay obvious</li>
          <li><strong>Recency on every claim</strong> “updated 3 hours ago”, not “available”</li>
          <li><strong>Stated failure</strong> an empty search returns alternatives, not “No results”</li>
        </ul>
      </section>

      <footer className="pp-footer">
        <p>
          Architecture record: <code>docs/THREE-PILLAR-PRIMARY-ARCHITECTURE.md</code>. Every figure on this page is a
          fixture. Nothing here is connected to a live supplier, batch, pool, event, courier, payout or payment rail.
        </p>
        <a className="pp-backlink" href="/#home"><ArrowRight size={14} /> Back to Brief</a>
      </footer>
    </div>
  );
}

export default PillarsApp;
