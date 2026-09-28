import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Bike, Check, ChefHat, ChevronLeft, ChevronRight, CircleHelp, Clock3, Leaf, MapPin, Menu, Minus, PackageCheck, Plus, Search, ShieldCheck, ShoppingBag, Smartphone, Sparkles, UtensilsCrossed, X } from 'lucide-react';
import { categories, checkPlanningZone, dishes, photo, zones } from './cloudBitesData';
import { useDialogFocus } from '../../ui/useDialogFocus';
import './cloudbites.css';

type Dish = typeof dishes[number];
const money = (amount: number) => `KES ${amount.toLocaleString('en-KE')}`;

export function CloudBitesPage() {
  const [address, setAddress] = useState('');
  const [selectedZone, setSelectedZone] = useState<ReturnType<typeof checkPlanningZone>>(null);
  const [zoneChecked, setZoneChecked] = useState(false);
  const [category, setCategory] = useState<string>('all');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [qr, setQr] = useState('');
  const carousel = useRef<HTMLDivElement>(null);
  const zoneInput = useRef<HTMLInputElement>(null);
  const cartPanel = useRef<HTMLElement>(null);
  const closeCart = () => setCartOpen(false);
  useDialogFocus(cartOpen, cartPanel, closeCart);

  useEffect(() => {
    const previous = document.title;
    document.title = 'CloudBites — workday lunch concept on Brief';
    // The QR goes to this page, NOT to a nonexistent App Store listing.
    QRCode.toDataURL(`${window.location.origin}/cloudbites`, { width: 156, margin: 1,
      color: { dark: '#182a25', light: '#ffffff' } }).then(setQr).catch(() => setQr(''));
    return () => { document.title = previous; };
  }, []);
  useEffect(() => {
    if (!cartOpen) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => { document.documentElement.style.overflow = previous; };
  }, [cartOpen]);

  const totalItems = Object.values(cart).reduce((a, b) => a + b, 0);
  const total = dishes.reduce((sum, dish) => sum + (cart[dish.id] ?? 0) * dish.price, 0);
  const chosen = dishes.filter(dish => (cart[dish.id] ?? 0) > 0);
  const visible = category === 'all' ? dishes : dishes.filter(dish => dish.category === category);
  const checkAddress = (event?: React.FormEvent) => {
    event?.preventDefault();
    setSelectedZone(checkPlanningZone(address));
    setZoneChecked(true);
  };
  const pickZone = (zone: typeof zones[number]) => {
    setAddress(zone.name);
    setSelectedZone(zone);
    setZoneChecked(true);
    zoneInput.current?.focus();
  };
  const pickCategory = (id: string) => {
    setCategory(id);
    document.getElementById('popular')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  const add = (dish: Dish) => setCart(old => ({ ...old, [dish.id]: (old[dish.id] ?? 0) + 1 }));
  const update = (dish: Dish, delta: number) => setCart(old => ({ ...old, [dish.id]: Math.max(0, (old[dish.id] ?? 0) + delta) }));
  const scrollCards = (direction: number) => carousel.current?.scrollBy({ left: direction * 310, behavior: 'smooth' });

  return <div className="cb-page" id="top">
    <a className="cb-skip" href="#menu">Skip to menu</a>
    <div className="cb-preview-bar"><span className="cb-preview-dot" /> CloudBites is a kitchen concept preview on Brief. No orders or courier deliveries are live yet.</div>
    <header className="cb-header">
      <a className="cb-logo" href="#top" aria-label="CloudBites home"><span className="cb-logo-mark"><UtensilsCrossed size={20} strokeWidth={2.5} /></span>cloud<span>bites</span><i>.</i></a>
      <nav className={menuOpen ? 'cb-nav is-open' : 'cb-nav'} aria-label="CloudBites navigation">
        <a onClick={() => setMenuOpen(false)} href="#menu">Menu</a>
        <a onClick={() => setMenuOpen(false)} href="#how">How it works</a>
        <a onClick={() => setMenuOpen(false)} href="#zones">Delivery areas</a>
        <a onClick={() => setMenuOpen(false)} href="#about">About us</a>
      </nav>
      <div className="cb-head-actions">
        <a className="cb-brief-link" href="/#home"><ArrowLeft size={15} /> Back to Brief</a>
        <button className="cb-cart-trigger" type="button" onClick={() => setCartOpen(true)} aria-label={`Open lunch list, ${totalItems} items`}><ShoppingBag size={18} /><span className="cb-cart-label">Lunch list</span><b>{totalItems}</b></button>
        <button className="cb-mobile-menu" type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen}>{menuOpen ? <X size={22}/> : <Menu size={22}/>}</button>
      </div>
    </header>

    <main>
      <section className="cb-hero" aria-labelledby="cb-title">
        <div className="cb-hero-copy">
          <div className="cb-kicker"><span className="cb-kicker-line" /> GOOD FOOD. ZERO WAITING AROUND.</div>
          <h1 id="cb-title">Restaurant-Quality Food, <em>Delivered Fast</em><span className="cb-period">.</span></h1>
          <p className="cb-lead">Fresh, chef-crafted meals at your door in 30 minutes or less.</p>
          <p className="cb-hero-detail">A delivery-only kitchen idea for the workday: lunch between meetings, after a long shift, or whenever hunger hits.</p>
          <form className="cb-address-form" onSubmit={checkAddress}>
            <label htmlFor="cb-address"><MapPin size={19} /> Your delivery address or area</label>
            <div className="cb-input-row"><input id="cb-address" ref={zoneInput} value={address} onChange={e => { setAddress(e.target.value); setZoneChecked(false); }} placeholder="Try Westlands, Kilimani or your address" autoComplete="street-address" required maxLength={160} /><button className="cb-button cb-button-orange" type="submit">See Menu <ArrowRight size={17} /></button></div>
          </form>
          <div className="cb-address-result" role="status" aria-live="polite">
            {zoneChecked && selectedZone ? <><Clock3 size={16}/><span><strong>{selectedZone.name}:</strong> planning estimate {selectedZone.minutes}. Coverage and timing are not confirmed. <a href="#menu">Preview menu <ArrowRight size={13}/></a></span></> : zoneChecked ? <><CircleHelp size={17}/><span>We can’t verify this address yet. Choose a named area on the map below; ZIP codes alone cannot confirm delivery. <a href="#zones">Check areas <ArrowRight size={13}/></a></span></> : <><Clock3 size={16}/><span>Planning example: <strong>20–40 min</strong> by area. Live availability is not active yet.</span></>}
          </div>
          <div className="cb-hero-bottom"><div className="cb-avatar-stack" aria-hidden="true"><span>🍔</span><span>🍜</span><span>🥗</span></div><p>Made for <strong>busy lunch breaks</strong><br/>and the people who move the city.</p><a href="#how" className="cb-text-link">See how it works <ArrowDown size={15}/></a></div>
        </div>
        <div className="cb-hero-visual"><img src={photo('hero')} alt="Delivery-style lunch spread with a burger, spiced chicken rice bowl, greens and sauces" width="1400" height="895" fetchPriority="high" /><div className="cb-hero-circle"><span>ONLY THE<br/>GOOD STUFF</span><Sparkles size={25}/></div><div className="cb-hero-float"><span className="cb-float-icon"><Bike size={22}/></span><span><strong>From kitchen to doorstep</strong><small>Delivery-only concept</small></span><ArrowUpRight size={18}/></div><span className="cb-image-credit">Concept food photography · illustrative</span></div>
      </section>

      <section className="cb-proof-strip" aria-label="CloudBites concept highlights"><div><ChefHat size={21}/><span>Made fresh to order</span></div><div><Bike size={21}/><span>Built for delivery</span></div><div><Leaf size={21}/><span>Packaging-first thinking</span></div><div><Clock3 size={21}/><span>Workday-friendly</span></div></section>

      <section className="cb-section cb-how" id="how" aria-labelledby="cb-how-title"><div className="cb-section-top"><div><p className="cb-overline">SIMPLE FROM START TO FINISH</p><h2 id="cb-how-title">Lunch is handled.<br/><em>In three little steps.</em></h2></div><p>Less time figuring out food.<br/>More time getting on with your day.</p></div><div className="cb-steps">
        {[{ num:'01', icon:MapPin, title:'Tell us where you are', copy:'Enter your address or choose a neighborhood to explore a planning estimate.' }, { num:'02', icon:Search, title:'Find your favorite bite', copy:'Browse the sample menu and build a lunch list around your cravings.' }, { num:'03', icon:PackageCheck, title:'Enjoy it fresh', copy:'When the kitchen launches, ordering and delivery will be confirmed here.' }].map(step => <div className="cb-step" key={step.num}><div className="cb-step-icon"><step.icon size={27} strokeWidth={1.8}/></div><span className="cb-step-num">STEP {step.num}</span><h3>{step.title}</h3><p>{step.copy}</p></div>)}
      </div></section>

      <section className="cb-section cb-categories" id="menu" aria-labelledby="cb-menu-title"><div className="cb-section-top cb-inline-top"><div><p className="cb-overline">SOMETHING FOR EVERY CRAVING</p><h2 id="cb-menu-title">What are you <em>in the mood for?</em></h2></div><button type="button" className="cb-inline-cta" onClick={() => pickCategory('all')}>View full sample menu <ArrowUpRight size={18}/></button></div><div className="cb-category-grid">{categories.map(cat => <button type="button" key={cat.id} className="cb-category" onClick={() => pickCategory(cat.id)}><img src={photo(cat.image)} loading="lazy" width="560" height="560" alt={`${cat.name} concept food photography`}/><span className="cb-category-shade"/><span className="cb-category-copy"><small>{cat.note}</small><strong>{cat.name}</strong></span><span className="cb-category-arrow" aria-label={`Explore ${cat.name}`}><ArrowUpRight size={19}/></span><span className="cb-category-hover">Order now <ArrowRight size={15}/></span></button>)}</div><p className="cb-small-note">Photography and menu selections are illustrative; no live menu, pricing, or ordering is connected yet.</p></section>

      <section className="cb-why" id="about" aria-labelledby="cb-why-title"><div className="cb-why-inner"><div className="cb-why-heading"><p className="cb-overline">WHY CLOUDBITES?</p><h2 id="cb-why-title">A better kind of<br/><em>lunch break.</em></h2><p>Good food made to travel well, with an experience designed around your day.</p><a href="#popular" className="cb-button cb-button-dark">Explore the dishes <ArrowRight size={17}/></a></div><div className="cb-benefits">
        {[{ icon:Clock3, title:'30-minute delivery goal', copy:'Designed around a fast handoff. No delivery guarantee is active until operations and terms are verified.' },{ icon:ChefHat, title:'Restaurant-quality thinking', copy:'Chef-inspired dishes, made for a great meal even when the table is your desk.' },{ icon:Leaf, title:'Eco-minded packaging', copy:'A reusable and lower-waste packaging goal, not a claim about current materials.' },{ icon:MapPin, title:'Order tracking, when live', copy:'Follow your food from prep to arrival once a real dispatch and tracking integration exists.' }].map(b => <div className="cb-benefit" key={b.title}><span><b.icon size={24} strokeWidth={1.7}/></span><div><h3>{b.title}</h3><p>{b.copy}</p></div></div>)}
      </div></div></section>

      <section className="cb-section cb-popular" id="popular" aria-labelledby="cb-popular-title"><div className="cb-section-top cb-inline-top"><div><p className="cb-overline">THE GOOD STUFF</p><h2 id="cb-popular-title">The lunch <em>lineup.</em></h2><p>Eight ideas worth taking a break for. Prices are illustrative in KES.</p></div><div className="cb-carousel-controls"><button type="button" onClick={() => scrollCards(-1)} aria-label="Scroll dishes left"><ChevronLeft size={22}/></button><button type="button" onClick={() => scrollCards(1)} aria-label="Scroll dishes right"><ChevronRight size={22}/></button></div></div>
        <div className="cb-filter-tabs" role="group" aria-label="Filter dishes"><button type="button" className={category === 'all' ? 'is-active' : ''} aria-pressed={category === 'all'} onClick={() => setCategory('all')}>All dishes</button>{categories.map(cat => <button type="button" key={cat.id} className={category === cat.id ? 'is-active' : ''} aria-pressed={category === cat.id} onClick={() => setCategory(cat.id)}>{cat.name}</button>)}</div>
        <div className="cb-dish-track" ref={carousel}>{visible.map(dish => <article className="cb-dish" key={dish.id}><div className="cb-dish-image"><img src={photo(dish.image)} alt={dish.name} width="600" height="600" loading="lazy"/>{dish.badge && <span className="cb-badge">{dish.badge}</span>}</div><div className="cb-dish-info"><h3>{dish.name}</h3><p>{dish.note}</p><div className="cb-dish-rating"><Sparkles size={13}/> Sample dish · ratings pending real orders</div><div className="cb-dish-action"><strong>{money(dish.price)} <small>indicative</small></strong><button type="button" onClick={() => add(dish)} aria-label={`Add ${dish.name} to cart`}><Plus size={17}/> Add to Cart</button></div></div></article>)}</div>
        <div className="cb-popular-bottom"><p>No checkout is live. Adding an item builds a temporary lunch list on this device only.</p><button className="cb-inline-cta" type="button" onClick={() => setCartOpen(true)}>See lunch list <ShoppingBag size={17}/></button></div>
      </section>

      <section className="cb-zones" id="zones" aria-labelledby="cb-zones-title"><div className="cb-zones-inner"><div className="cb-zones-copy"><p className="cb-overline">YOUR FOOD, YOUR NEIGHBORHOOD</p><h2 id="cb-zones-title">Where could we <em>deliver?</em></h2><p>Explore a sample Nairobi delivery radius. Select a neighborhood on the map to see a planning estimate; actual coverage needs a connected kitchen and riders.</p><form className="cb-zone-form" onSubmit={checkAddress}><label htmlFor="cb-zone-input">Check an area or address</label><div><input id="cb-zone-input" value={address} onChange={e=>{setAddress(e.target.value);setZoneChecked(false);}} placeholder="e.g. Nairobi CBD" maxLength={160} required/><button type="submit" aria-label="Check area"><ArrowRight size={19}/></button></div></form><div className="cb-zone-feedback" role="status">{zoneChecked && selectedZone ? <><span className="cb-check-mark"><Check size={15}/></span><span><strong>{selectedZone.name}</strong> · planning estimate {selectedZone.minutes}. <small>Availability not confirmed.</small></span></> : zoneChecked ? <><CircleHelp size={19}/><span>Area not in this illustrative map. We can’t confirm delivery from a ZIP or unrecognized address.</span></> : <><MapPin size={18}/><span>Tap any area on the map to explore an estimate.</span></>}</div><p className="cb-zone-key"><span/> Core planning area <i/> Extended planning area</p></div><div className="cb-map" aria-label="Illustrative Nairobi delivery area map"><div className="cb-map-top"><span><MapPin size={15}/> NAIROBI · PLANNING MAP</span><span>NOT LIVE COVERAGE</span></div><svg className="cb-map-art" aria-hidden="true" viewBox="0 0 660 480" preserveAspectRatio="xMidYMid slice"><path d="M-20 101C103 80 134 226 304 170S509 131 680 44M-24 387C134 389 170 265 308 307S513 358 690 297M87-20C72 147 249 211 161 497M470-22C420 152 550 182 510 500" fill="none" stroke="#d8e5d2" strokeWidth="20"/><path d="M-20 101C103 80 134 226 304 170S509 131 680 44M-24 387C134 389 170 265 308 307S513 358 690 297M87-20C72 147 249 211 161 497M470-22C420 152 550 182 510 500" fill="none" stroke="#fff" strokeWidth="11"/><path d="M-10 252h680M300-10l10 500M13 40l642 411" stroke="#e1e9d8" strokeWidth="3" strokeDasharray="10 12"/></svg><div className="cb-map-ring cb-map-ring-outer"/><div className="cb-map-ring cb-map-ring-inner"/><span className="cb-map-center"><ChefHat size={16}/> Kitchen concept</span>{zones.map(zone => <button type="button" key={zone.id} className={selectedZone?.id === zone.id ? 'cb-map-pin is-selected' : 'cb-map-pin'} style={{left:`${zone.x}%`,top:`${zone.y}%`}} onClick={() => pickZone(zone)} aria-label={`Select ${zone.name}, planning estimate ${zone.minutes}`}><span className="cb-map-pin-dot"><MapPin size={17}/></span><span>{zone.name}</span></button>)}<div className="cb-map-caption"><span className="cb-map-caption-icon"><Bike size={21}/></span><span><strong>20–40 min</strong><small>Illustrative timing range</small></span></div></div></div></section>

      <section className="cb-work" aria-labelledby="cb-work-title"><div><span className="cb-work-symbol"><Bike size={27}/></span><div><p className="cb-overline">BUILT AROUND THE WORKDAY</p><h2 id="cb-work-title">Lunch for the team.<br/><em>Routes for the riders.</em></h2><p>CloudBites is a concept. Brief already has places to discover work and delivery runs; browse them separately, without implying a CloudBites dispatch is live.</p></div></div><div className="cb-work-actions"><a href="/#workforce">Explore work on Brief <ArrowUpRight size={17}/></a><a href="/#city/errands">Browse rider runs <ArrowUpRight size={17}/></a></div></section>

      <section className="cb-app" id="app" aria-labelledby="cb-app-title"><div className="cb-app-inner"><div className="cb-app-copy"><p className="cb-overline">GOOD FOOD, IN YOUR POCKET</p><h2 id="cb-app-title">Get $10 Off Your <em>First Order.</em></h2><p>This is a proposed launch offer, not a redeemable promotion today. Save this web page for when CloudBites opens.</p><div className="cb-store-row"><button disabled title="App Store download not available yet"><Smartphone size={22}/><span>App Store <small>Coming soon</small></span></button><button disabled title="Google Play download not available yet"><Smartphone size={22}/><span>Google Play <small>Coming soon</small></span></button></div><div className="cb-qr-area">{qr && <img src={qr} width="86" height="86" alt="QR code for this CloudBites concept page"/>}<span><strong>Scan to open this page</strong><small>Web preview · not an app download</small></span></div></div><div className="cb-phone-wrap"><div className="cb-phone"><div className="cb-phone-top"><span>9:41</span><span>●●● ▰</span></div><div className="cb-phone-content"><div className="cb-phone-logo">cloud<span>bites.</span></div><small>GOOD AFTERNOON 👋</small><strong>What sounds good<br/>for lunch?</strong><div className="cb-phone-search"><Search size={13}/> Find your next favorite</div><div className="cb-phone-card"><img src={photo('korean-chicken')} alt=""/><span>THE LUNCH PICK <strong>Seoul Good Chicken</strong><small>Sample menu · KES 890</small></span></div><span className="cb-phone-small">Made for the midday moment.</span></div></div><div className="cb-phone-deco cb-phone-deco-one"/><div className="cb-phone-deco cb-phone-deco-two"/></div></div></section>

      <section className="cb-trust" aria-labelledby="cb-trust-title"><p className="cb-overline">TRUST IS EARNED</p><h2 id="cb-trust-title">Good food. <em>Honest details.</em></h2><div className="cb-trust-grid"><div><Sparkles size={23}/><h3>Real reviews only</h3><p>No 4.8/5 score or 10,000+ order claim until verified customer reviews and order data exist.</p></div><div><ShieldCheck size={23}/><h3>Safety first</h3><p>Food safety certifications will be displayed only after documentation is verified.</p></div><div><Bike size={23}/><h3>Partners, when confirmed</h3><p>No DoorDash, Uber Eats, or courier logo is shown without an actual partnership.</p></div></div></section>
    </main>
    <footer className="cb-footer"><div className="cb-footer-main"><div className="cb-footer-brand"><a href="#top" className="cb-logo"><span className="cb-logo-mark"><UtensilsCrossed size={20}/></span>cloud<span>bites</span><i>.</i></a><p>Good food for busy days. A delivery-only kitchen concept on Brief.</p><span className="cb-footer-tag">MADE FOR THE MIDDAY MOMENT.</span></div><div className="cb-footer-links"><div><h3>Explore</h3><a href="#menu">Menu</a><a href="#about">About</a><a href="#zones">Delivery areas</a><a href="#how">How it works</a></div><div><h3>Get involved</h3><a href="/#workforce">Careers on Brief</a><a href="/#partners">Partner with us on Brief</a><a href="/#city/errands">For bike couriers</a><a href="/#home">Back to Brief</a></div><div><h3>The details</h3><a href="#allergens" onClick={() => { (document.getElementById('allergens') as HTMLDetailsElement).open = true; }}>Allergen info</a><a href="#policies" onClick={() => { (document.getElementById('policies') as HTMLDetailsElement).open = true; }}>Terms</a><a href="#policies" onClick={() => { (document.getElementById('policies') as HTMLDetailsElement).open = true; }}>Privacy</a><span>Contact & hours: pending launch</span><span>Social channels: coming soon</span></div></div></div><div className="cb-footer-disclosures"><details id="allergens"><summary>Allergen information</summary><p>Sample food images and ingredients are illustrative. No verified allergen information is available. Do not rely on this preview to make an allergy-related food decision.</p></details><details id="policies"><summary>Terms and privacy</summary><p>No purchases, accounts or address submissions are sent from this page. The location checker and lunch list run in your browser only. A live service will need published ordering terms and a privacy notice before launch.</p></details></div><div className="cb-footer-bottom"><span>© {new Date().getFullYear()} CloudBites concept · on Brief</span><span>No orders or deliveries are accepted on this preview.</span><a href="#top">Back to top ↑</a></div></footer>

    {cartOpen && <div className="cb-cart-layer"><button type="button" className="cb-cart-scrim" onClick={closeCart} aria-label="Close lunch list"/><aside className="cb-cart-panel" ref={cartPanel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Your lunch list"><div className="cb-cart-head"><div><p className="cb-overline">YOUR PICKS</p><h2>Your lunch list <span>({totalItems})</span></h2></div><button type="button" onClick={closeCart} aria-label="Close lunch list"><X size={22}/></button></div>{chosen.length ? <div className="cb-cart-items">{chosen.map(dish => <div className="cb-cart-item" key={dish.id}><img src={photo(dish.image)} alt="" width="70" height="70"/><div><h3>{dish.name}</h3><small>{money(dish.price)} · indicative</small><div className="cb-quantity"><button type="button" onClick={() => update(dish, -1)} aria-label={`Remove one ${dish.name}`}><Minus size={14}/></button><span>{cart[dish.id]}</span><button type="button" onClick={() => update(dish, 1)} aria-label={`Add one ${dish.name}`}><Plus size={14}/></button></div></div></div>)}</div> : <div className="cb-cart-empty"><ShoppingBag size={35}/><h3>Nothing in your list yet</h3><p>Explore the sample menu and find something delicious.</p><button type="button" className="cb-button cb-button-orange" onClick={() => {closeCart(); document.getElementById('popular')?.scrollIntoView({ behavior: 'smooth' });}}>Browse dishes <ArrowRight size={16}/></button></div>}<div className="cb-cart-foot"><div><span>Illustrative subtotal</span><strong>{money(total)}</strong></div><p>Preview only. No checkout, charge, kitchen prep, or delivery is available.</p><button type="button" disabled className="cb-button cb-button-orange">Checkout not available yet</button></div></aside></div>}
    {totalItems > 0 && !cartOpen && <button type="button" className="cb-mobile-cart" onClick={() => setCartOpen(true)}><ShoppingBag size={18}/> View lunch list <span>{totalItems} items · {money(total)}</span></button>}
  </div>;
}
export default CloudBitesPage;
