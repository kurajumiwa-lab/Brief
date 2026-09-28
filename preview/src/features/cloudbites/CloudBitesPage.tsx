import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Briefcase, Building2,
  CalendarDays, Check, ChefHat, ChevronLeft, ChevronRight, CircleHelp, Clock3,
  MapPin, Menu, Minus, PackageCheck, Plus, ShieldCheck,
  ShoppingBag, Sparkles, UtensilsCrossed, Users, X
} from 'lucide-react';
import { categories, dishes, findConceptArea, photo, zones } from './cloudBitesData';
import { useDialogFocus } from '../../ui/useDialogFocus';
import './cloudbites.css';

type Dish = typeof dishes[number];
const money = (amount: number) => `KES ${amount.toLocaleString('en-KE')}`;

const useCases = [
  { icon: Briefcase, title: 'Going to work?', copy: 'Preorder lunch from a nearby hotel or restaurant, then collect it when your break starts.' },
  { icon: Clock3, title: 'Finishing a shift?', copy: 'Arrange dinner for pickup on the way home. Local delivery stays optional, not the default.' },
  { icon: CalendarDays, title: 'Meeting someone?', copy: 'Find a place to eat, request a table or plan meeting catering before you arrive.' },
  { icon: MapPin, title: 'Visiting town?', copy: 'Discover local food, daily offers and participating hotels before you get there.' }
];

const sampleOffers = [
  { time: 'WEEKDAYS · 12:00–14:00', title: 'Business lunch', copy: 'A meal ready for pickup around the workday lunch break.', icon: Briefcase },
  { time: 'WEEKDAYS · 17:00–19:00', title: 'After-work dinner', copy: 'Schedule a pickup on the route home instead of waiting for a delivery.', icon: Clock3 },
  { time: 'FRIDAY · 17:00–21:00', title: 'Dinner & a table', copy: 'Pair a time-based food offer with a table request.', icon: CalendarDays },
  { time: 'WEEKENDS', title: 'Buffet & family dining', copy: 'Help visitors and local families plan where to eat before they arrive.', icon: Users }
];

const networkPrinciples = [
  { icon: Users, title: 'Free to join and discover', copy: 'The intended starting point: free for people to browse and free for local businesses to join and list.' },
  { icon: ShieldCheck, title: 'No exclusivity', copy: 'A hotel can keep its own site, Google presence, Uber, Bolt and any other partner channels.' },
  { icon: ChefHat, title: 'The merchant stays in control', copy: 'Businesses set their own menu, prices, pickup windows and offers.' },
  { icon: Sparkles, title: 'Value-based options', copy: 'Possible revenue: fees on completed business, promoted offers or paid tools—not an upfront listing fee.' }
];

export function CloudBitesPage() {
  const [destination, setDestination] = useState('');
  const [selectedZone, setSelectedZone] = useState<ReturnType<typeof findConceptArea>>(null);
  const [destinationChecked, setDestinationChecked] = useState(false);
  const [category, setCategory] = useState<string>('all');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [qr, setQr] = useState('');
  const carousel = useRef<HTMLDivElement>(null);
  const destinationInput = useRef<HTMLInputElement>(null);
  const cartPanel = useRef<HTMLElement>(null);
  const closeCart = () => setCartOpen(false);
  useDialogFocus(cartOpen, cartPanel, closeCart);

  useEffect(() => {
    const previous = document.title;
    document.title = 'CloudBites on Brief — local food, pickup and preorders';
    // The QR opens this web concept, not a nonexistent app-store listing.
    QRCode.toDataURL(`${window.location.origin}/cloudbites`, {
      width: 156,
      margin: 1,
      color: { dark: '#182a25', light: '#ffffff' }
    }).then(setQr).catch(() => setQr(''));
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

  const previewDestination = (event?: React.FormEvent) => {
    event?.preventDefault();
    setSelectedZone(findConceptArea(destination));
    setDestinationChecked(true);
  };
  const pickZone = (zone: typeof zones[number]) => {
    setDestination(zone.name);
    setSelectedZone(zone);
    setDestinationChecked(true);
    destinationInput.current?.focus();
  };
  const pickCategory = (id: string) => {
    setCategory(id);
    document.getElementById('popular')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  const add = (dish: Dish) => setCart(old => ({ ...old, [dish.id]: (old[dish.id] ?? 0) + 1 }));
  const update = (dish: Dish, delta: number) => setCart(old => ({ ...old, [dish.id]: Math.max(0, (old[dish.id] ?? 0) + delta) }));
  const scrollCards = (direction: number) => carousel.current?.scrollBy({ left: direction * 310, behavior: 'smooth' });

  return <div className="cb-page" id="top">
    <a className="cb-skip" href="#menu">Skip to sample menu</a>
    <div className="cb-preview-bar"><span className="cb-preview-dot" /> CloudBites is a local food-commerce concept on Brief. No merchant orders, reservations or workplace plans are live.</div>

    <header className="cb-header">
      <a className="cb-logo" href="#top" aria-label="CloudBites on Brief"><span className="cb-logo-mark"><UtensilsCrossed size={20} strokeWidth={2.5} /></span>cloud<span>bites</span><i>.</i></a>
      <nav className={menuOpen ? 'cb-nav is-open' : 'cb-nav'} aria-label="CloudBites navigation">
        <a onClick={() => setMenuOpen(false)} href="#how">How it works</a>
        <a onClick={() => setMenuOpen(false)} href="#uses">Everyday uses</a>
        <a onClick={() => setMenuOpen(false)} href="#offers">Timed offers</a>
        <a onClick={() => setMenuOpen(false)} href="#menu">Sample menu</a>
        <a onClick={() => setMenuOpen(false)} href="#for-business">For businesses</a>
      </nav>
      <div className="cb-head-actions">
        <a className="cb-brief-link" href="/#home"><ArrowLeft size={15} /> Back to Brief</a>
        <button className="cb-cart-trigger" type="button" onClick={() => setCartOpen(true)} aria-label={`Open lunch list, ${totalItems} ${totalItems === 1 ? 'item' : 'items'}`}><ShoppingBag size={18} /><span className="cb-cart-label">Lunch list</span><b>{totalItems}</b></button>
        <button className="cb-mobile-menu" type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen}>{menuOpen ? <X size={22}/> : <Menu size={22}/>}</button>
      </div>
    </header>

    <main>
      <section className="cb-hero" aria-labelledby="cb-title">
        <div className="cb-hero-copy">
          <div className="cb-kicker"><span className="cb-kicker-line" /> A FOOD CONCEPT ON BRIEF</div>
          <h1 id="cb-title">Food from <em>where you’re going.</em></h1>
          <p className="cb-lead">Preorder lunch. Pick up dinner. Reserve a table. Discover local offers.</p>
          <p className="cb-hero-detail">Find hotels, restaurants and food businesses around work or a destination—and arrange your meal before you arrive. Pickup first; no citywide delivery fleet required.</p>
          <div className="cb-hero-actions">
            <a className="cb-button cb-button-orange" href="#menu">Browse local food <ArrowRight size={17}/></a>
            <a className="cb-hero-business-link" href="#for-business">For hotels &amp; restaurants <ArrowDown size={15}/></a>
          </div>
          <form className="cb-address-form" onSubmit={previewDestination}>
            <label htmlFor="cb-address"><MapPin size={19} /> Preview a Nairobi destination</label>
            <div className="cb-input-row"><input id="cb-address" ref={destinationInput} value={destination} onChange={e => { setDestination(e.target.value); setDestinationChecked(false); }} placeholder="Westlands, Kilimani or Nairobi CBD" autoComplete="off" required maxLength={100} /><button className="cb-button cb-button-orange" type="submit">Preview area <ArrowRight size={17} /></button></div>
          </form>
          <div className="cb-address-result" role="status" aria-live="polite">
            {destinationChecked && selectedZone ? <><Check size={16}/><span><strong>{selectedZone.name} selected.</strong> In a live Brief network, this area would show local menus, offers and pickup options. This preview has no live listings yet.</span></> : destinationChecked ? <><CircleHelp size={17}/><span>We can’t match that to one of the illustrative Nairobi areas. This is a sample lookup, not a live directory or availability check.</span></> : <><MapPin size={16}/><span>Try a sample area. Destination selection stays in this browser; no merchant availability is connected.</span></>}
          </div>
          <div className="cb-hero-bottom"><div className="cb-avatar-stack" aria-hidden="true"><span>🍲</span><span>🏨</span><span>📍</span></div><p>For people <strong>working, visiting or passing through.</strong><br/>Plan around the place and time already in your day.</p><a href="#how" className="cb-text-link">See the flow <ArrowDown size={15}/></a></div>
        </div>
        <div className="cb-hero-visual"><img src={photo('hero')} alt="Illustrative workday meal with a burger, rice bowl, greens and sauces" width="1400" height="895" /><div className="cb-hero-circle"><span>LOCAL FOOD<br/>ON YOUR ROUTE</span><MapPin size={23}/></div><div className="cb-hero-float"><span className="cb-float-icon"><Building2 size={22}/></span><span><strong>Food near your destination</strong><small>Pickup first · plan ahead</small></span><ArrowUpRight size={18}/></div><span className="cb-image-credit">Illustrative food photography · concept preview</span></div>
      </section>

      <section className="cb-proof-strip" aria-label="CloudBites concept principles"><div><MapPin size={21}/><span>Local pickup first</span></div><div><Clock3 size={21}/><span>Preorder for a time</span></div><div><Briefcase size={21}/><span>Workplace meal windows</span></div><div><ChefHat size={21}/><span>Hotels &amp; restaurants</span></div></section>

      <section className="cb-section cb-how" id="how" aria-labelledby="cb-how-title">
        <div className="cb-section-top"><div><p className="cb-overline">LOCAL COMMERCE AROUND YOUR DAY</p><h2 id="cb-how-title">Discover. Schedule. <em>Collect.</em></h2></div><p>Not “bring food to my house.”<br/>“Help me plan food where I’m already going.”</p></div>
        <div className="cb-steps">
          {[
            { num:'01', icon:MapPin, title:'Find food at your destination', copy:'A live Brief area would show participating hotels, restaurants, cafés and their real offers. This preview uses illustrative listings.' },
            { num:'02', icon:CalendarDays, title:'Choose a time or a table', copy:'Preorder for a pickup window, coordinate a team meal or request a reservation when a merchant offers it.' },
            { num:'03', icon:PackageCheck, title:'Collect locally', copy:'Pickup is the default. A future workplace flow could offer local fulfillment as an option; no citywide home-delivery fleet is promised.' }
          ].map(step => <div className="cb-step" key={step.num}><div className="cb-step-icon"><step.icon size={27} strokeWidth={1.8}/></div><span className="cb-step-num">STEP {step.num}</span><h3>{step.title}</h3><p>{step.copy}</p></div>)}
        </div>
        <p className="cb-small-note">The discovery, scheduling and reservation flows are product concepts; no live orders, pickup slots or reservations are connected.</p>
      </section>

      <section className="cb-why" id="uses" aria-labelledby="cb-why-title"><div className="cb-why-inner"><div className="cb-why-heading"><p className="cb-overline">FOOD THAT FITS THE JOURNEY</p><h2 id="cb-why-title">Meals for the places you’re <em>already going.</em></h2><p>One local network can serve workdays, errands and visits—not just one delivery use case.</p><a href="#offers" className="cb-button cb-button-dark">See timed examples <ArrowRight size={17}/></a></div><div className="cb-benefits">
        {useCases.map(use => <div className="cb-benefit" key={use.title}><span><use.icon size={24} strokeWidth={1.7}/></span><div><h3>{use.title}</h3><p>{use.copy}</p></div></div>)}
      </div></div></section>

      <section className="cb-section cb-offers" id="offers" aria-labelledby="cb-offers-title"><div className="cb-section-top"><div><p className="cb-overline">QUIET-HOUR INVENTORY</p><h2 id="cb-offers-title">Offers with a <em>time and a place.</em></h2></div><p>Examples of what a hotel or restaurant could publish.<br/>These are not live promotions.</p></div><div className="cb-offer-grid">{sampleOffers.map(offer => <article className="cb-offer-card" key={offer.title}><div className="cb-offer-card-top"><span className="cb-offer-icon"><offer.icon size={20}/></span><span className="cb-example-label">Example only</span></div><p className="cb-offer-time">{offer.time}</p><h3>{offer.title}</h3><p className="cb-offer-copy">{offer.copy}</p><span className="cb-offer-foot">Possible pickup or reservation flow <ArrowRight size={14}/></span></article>)}</div><p className="cb-small-note">A real merchant would control availability, menu, price and schedule. No offers, tables or meal slots are available through this preview.</p></section>

      <section className="cb-section cb-categories" id="menu" aria-labelledby="cb-menu-title"><div className="cb-section-top cb-inline-top"><div><p className="cb-overline">CLOUDBITES · SAMPLE STOREFRONT</p><h2 id="cb-menu-title">Browse a <em>sample food menu.</em></h2><p>Illustrative dishes show one way local food could appear on Brief.</p></div><button type="button" className="cb-inline-cta" onClick={() => pickCategory('all')}>View sample dishes <ArrowUpRight size={18}/></button></div><div className="cb-category-grid">{categories.map(cat => <button type="button" key={cat.id} className="cb-category" onClick={() => pickCategory(cat.id)}><img src={photo(cat.image)} loading="lazy" width="560" height="560" alt={`${cat.name} concept food photography`}/><span className="cb-category-shade"/><span className="cb-category-copy"><small>{cat.note}</small><strong>{cat.name}</strong></span><span className="cb-category-arrow" aria-label={`Explore ${cat.name}`}><ArrowUpRight size={19}/></span><span className="cb-category-hover">Browse samples <ArrowRight size={15}/></span></button>)}</div><p className="cb-small-note">Food photography and prices are illustrative. No participating hotel, restaurant, live menu or inventory is connected.</p></section>

      <section className="cb-section cb-popular" id="popular" aria-labelledby="cb-popular-title"><div className="cb-section-top cb-inline-top"><div><p className="cb-overline">SAMPLE CATALOG</p><h2 id="cb-popular-title">A local food <em>storefront.</em></h2><p>Sample dishes and indicative prices only—not a live menu.</p></div><div className="cb-carousel-controls"><button type="button" onClick={() => scrollCards(-1)} aria-label="Scroll sample dishes left"><ChevronLeft size={22}/></button><button type="button" onClick={() => scrollCards(1)} aria-label="Scroll sample dishes right"><ChevronRight size={22}/></button></div></div>
        <div className="cb-filter-tabs" role="group" aria-label="Filter sample menu"><button type="button" className={category === 'all' ? 'is-active' : ''} aria-pressed={category === 'all'} onClick={() => setCategory('all')}>All dishes</button>{categories.map(cat => <button type="button" key={cat.id} className={category === cat.id ? 'is-active' : ''} aria-pressed={category === cat.id} onClick={() => setCategory(cat.id)}>{cat.name}</button>)}</div>
        <div className="cb-dish-track" ref={carousel}>{visible.map(dish => <article className="cb-dish" key={dish.id}><div className="cb-dish-image"><img src={photo(dish.image)} alt={dish.name} width="600" height="600" loading="lazy"/>{dish.badge && <span className="cb-badge">{dish.badge}</span>}</div><div className="cb-dish-info"><h3>{dish.name}</h3><p>{dish.note}</p><div className="cb-dish-rating"><Sparkles size={13}/> Sample catalog item · not a live merchant listing</div><div className="cb-dish-action"><strong>{money(dish.price)} <small>illustrative</small></strong><button type="button" onClick={() => add(dish)} aria-label={`Add ${dish.name} to lunch list`}><Plus size={17}/> Add to list</button></div></div></article>)}</div>
        <div className="cb-popular-bottom"><p>Adding a dish builds a temporary list in this browser. It does not create an order or reserve a pickup.</p><button className="cb-inline-cta" type="button" onClick={() => setCartOpen(true)}>Open lunch list <ShoppingBag size={17}/></button></div>
      </section>

      <section className="cb-zones" id="zones" aria-labelledby="cb-zones-title"><div className="cb-zones-inner"><div className="cb-zones-copy"><p className="cb-overline">DISCOVER BEFORE YOU ARRIVE</p><h2 id="cb-zones-title">Start with <em>where you’re going.</em></h2><p>This illustrative map shows how local menus and offers could be browsed by destination. It is not a service radius and has no live merchant inventory.</p><div className="cb-zone-feedback" role="status" aria-live="polite">{selectedZone ? <><span className="cb-check-mark"><Check size={15}/></span><span><strong>{selectedZone.name}</strong> selected. No live businesses or availability are connected in this preview.</span></> : <><MapPin size={18}/><span>Select one of the sample Nairobi areas to preview destination-led discovery.</span></>}</div><p className="cb-zone-key"><span/> Illustrative area <i/> No live merchant data</p></div><div className="cb-map" role="group" aria-label="Illustrative Nairobi areas, not a live business directory"><div className="cb-map-top"><span><MapPin size={15}/> NAIROBI · SAMPLE AREAS</span><span>NOT LIVE INVENTORY</span></div><svg className="cb-map-art" aria-hidden="true" viewBox="0 0 660 480" preserveAspectRatio="xMidYMid slice"><path d="M-20 101C103 80 134 226 304 170S509 131 680 44M-24 387C134 389 170 265 308 307S513 358 690 297M87-20C72 147 249 211 161 497M470-22C420 152 550 182 510 500" fill="none" stroke="#d8e5d2" strokeWidth="20"/><path d="M-20 101C103 80 134 226 304 170S509 131 680 44M-24 387C134 389 170 265 308 307S513 358 690 297M87-20C72 147 249 211 161 497M470-22C420 152 550 182 510 500" fill="none" stroke="#fff" strokeWidth="11"/><path d="M-10 252h680M300-10l10 500M13 40l642 411" stroke="#e1e9d8" strokeWidth="3" strokeDasharray="10 12"/></svg><div className="cb-map-ring cb-map-ring-outer"/><div className="cb-map-ring cb-map-ring-inner"/><span className="cb-map-center"><ChefHat size={16}/> Local food on Brief</span>{zones.map(zone => <button type="button" key={zone.id} className={selectedZone?.id === zone.id ? 'cb-map-pin is-selected' : 'cb-map-pin'} style={{left:`${zone.x}%`,top:`${zone.y}%`}} onClick={() => pickZone(zone)} aria-label={`Preview local food near ${zone.name}`}><span className="cb-map-pin-dot"><MapPin size={17}/></span><span>{zone.name}</span></button>)}<div className="cb-map-caption"><span className="cb-map-caption-icon"><MapPin size={21}/></span><span><strong>Pickup first</strong><small>Delivery is optional</small></span></div></div></div></section>

      <section className="cb-work" id="workplace" aria-labelledby="cb-work-title"><div><span className="cb-work-symbol"><Briefcase size={27}/></span><div><p className="cb-overline">WORKFORCE + LOCAL COMMERCE</p><h2 id="cb-work-title">One lunch window.<br/><em>A whole team served.</em></h2><p>Imagine a 30-person office ordering from a few nearby businesses for a shared 12:30 pickup. Brief could coordinate scheduled demand first; one local run might be optional later. This is an example flow, not a live workplace plan.</p></div></div><div className="cb-work-actions"><a href="/#workforce">Explore work on Brief <ArrowUpRight size={17}/></a><a href="/#city/errands">Explore optional local runs <ArrowUpRight size={17}/></a></div></section>

      <section className="cb-app" id="for-business" aria-labelledby="cb-business-title"><div className="cb-app-inner"><div className="cb-app-copy"><p className="cb-overline">FOR HOTELS, RESTAURANTS &amp; CAFÉS</p><h2 id="cb-business-title">Get discovered. Get preorders. <em>Fill quiet hours.</em></h2><p>A future Brief storefront could bring additional direct demand to a hotel’s quiet hours by helping people working, visiting and living nearby discover what its kitchen already offers. Merchants could publish menus, timed offers, pickup windows, table requests or workplace catering—without replacing their existing channels.</p><ul className="cb-principles"><li><Check size={16}/> Intended launch principle: free to join and list, with no upfront subscription or listing fee—not a promise that all services stay free.</li><li><Check size={16}/> No exclusivity. Keep your own site, Google presence, Uber, Bolt and any other channels.</li><li><Check size={16}/> You control your menus, prices, offers and pickup terms.</li><li><Check size={16}/> Pickup is the default; workplace fulfillment can be optional.</li></ul><p className="cb-merchant-economics"><strong>Strategic possibilities:</strong> transaction fees on completed business, promoted offers or paid workplace tools. These are not live services or verified fees; exact terms would be clear before launch.</p><div className="cb-business-actions"><a className="cb-button cb-button-orange" href="/#home">Explore Brief <ArrowRight size={17}/></a><a className="cb-pitch-link" href="#offers">See offer examples <ArrowDown size={15}/></a></div><div className="cb-qr-area">{qr && <img src={qr} width="86" height="86" alt="QR code linking to the CloudBites concept preview on Brief"/>}<span><strong>CloudBites on Brief</strong><small>Scan to share this web preview · no separate app required</small></span></div></div><div className="cb-phone-wrap"><div className="cb-phone"><div className="cb-phone-top"><span>BRIEF</span><span>●●● ▰</span></div><div className="cb-phone-content"><div className="cb-phone-logo">cloud<span>bites.</span></div><small>NAIROBI CBD · SAMPLE VIEW</small><strong>Food from where<br/>you’re going.</strong><div className="cb-phone-search"><MapPin size={13}/> Pickup, offers &amp; reservations</div><div className="cb-phone-card"><img src={photo('korean-chicken')} alt=""/><span>SAMPLE PICKUP WINDOW <strong>Tuesday lunch · 12:30</strong><small>Illustrative concept · not live</small></span></div><span className="cb-phone-small">One food concept inside Brief.</span></div></div><div className="cb-phone-deco cb-phone-deco-one"/><div className="cb-phone-deco cb-phone-deco-two"/></div></div></section>

      <section className="cb-trust" aria-labelledby="cb-trust-title"><p className="cb-overline">OPEN NETWORK, CLEAR TERMS</p><h2 id="cb-trust-title">Free to join. <em>Explore value-based revenue.</em></h2><p className="cb-trust-intro">The intended principles keep discovery and joining easy. Strategic revenue possibilities focus on completed activity and optional business tools—not access to a list of merchants.</p><div className="cb-trust-grid">{networkPrinciples.map(principle => <div key={principle.title}><principle.icon size={23}/><h3>{principle.title}</h3><p>{principle.copy}</p></div>)}</div><p className="cb-trust-note">These are product principles, not an active merchant pricing plan. No orders, reservations or fees are live in this preview.</p></section>
    </main>

    <footer className="cb-footer"><div className="cb-footer-main"><div className="cb-footer-brand"><a href="#top" className="cb-logo"><span className="cb-logo-mark"><UtensilsCrossed size={20}/></span>cloud<span>bites</span><i>.</i></a><p>One local food-commerce concept inside Brief—the local work and commerce network.</p><span className="cb-footer-tag">FOOD FROM WHERE YOU’RE GOING.</span></div><div className="cb-footer-links"><div><h3>Explore</h3><a href="#menu">Sample menu</a><a href="#offers">Timed offer examples</a><a href="#zones">Browse by area</a><a href="#how">How it works</a></div><div><h3>On Brief</h3><a href="/#workforce">Workforce</a><a href="#workplace">Workplace meals</a><a href="#for-business">For local businesses</a><a href="/#home">Back to Brief</a></div><div><h3>The details</h3><a href="#allergens" onClick={() => { (document.getElementById('allergens') as HTMLDetailsElement).open = true; }}>Sample ingredients</a><a href="#policies" onClick={() => { (document.getElementById('policies') as HTMLDetailsElement).open = true; }}>Terms &amp; privacy</a><span>Merchant onboarding: not live yet</span><span>Orders and reservations: unavailable</span></div></div></div><div className="cb-footer-disclosures"><details id="allergens"><summary>Sample menu and ingredients</summary><p>Dishes, images, prices and ingredient notes are illustrative. They are not a live hotel menu or verified allergen information; do not rely on this preview to make an allergy-related food decision.</p></details><details id="policies"><summary>Terms and privacy</summary><p>This concept preview keeps destination selection and the temporary lunch list in your browser. It does not send an address, order, payment, table request or workplace request to a server. Live merchant and customer terms must be published before launch.</p></details></div><div className="cb-footer-bottom"><span>© {new Date().getFullYear()} CloudBites concept · on Brief</span><span>No merchant listings, orders or reservations are live.</span><a href="#top">Back to top ↑</a></div></footer>

    {cartOpen && <div className="cb-cart-layer"><button type="button" className="cb-cart-scrim" onClick={closeCart} aria-label="Close lunch list"/><aside className="cb-cart-panel" ref={cartPanel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Your sample lunch list"><div className="cb-cart-head"><div><p className="cb-overline">SAMPLE STOREFRONT</p><h2>Your lunch list <span>({totalItems})</span></h2></div><button type="button" onClick={closeCart} aria-label="Close lunch list"><X size={22}/></button></div>{chosen.length ? <div className="cb-cart-items">{chosen.map(dish => <div className="cb-cart-item" key={dish.id}><img src={photo(dish.image)} alt="" width="70" height="70"/><div><h3>{dish.name}</h3><small>{money(dish.price)} · illustrative</small><div className="cb-quantity"><button type="button" onClick={() => update(dish, -1)} aria-label={`Remove one ${dish.name}`}><Minus size={14}/></button><span>{cart[dish.id]}</span><button type="button" onClick={() => update(dish, 1)} aria-label={`Add one ${dish.name}`}><Plus size={14}/></button></div></div></div>)}</div> : <div className="cb-cart-empty"><ShoppingBag size={35}/><h3>Your list is empty</h3><p>Browse the sample menu to see how a local storefront could work.</p><button type="button" className="cb-button cb-button-orange" onClick={() => {closeCart(); document.getElementById('popular')?.scrollIntoView({ behavior: 'smooth' });}}>Browse sample dishes <ArrowRight size={16}/></button></div>}<div className="cb-cart-foot"><div><span>Illustrative subtotal</span><strong>{money(total)}</strong></div><p>This stays on your device. No order, payment, pickup slot or reservation is created.</p><button type="button" disabled className="cb-button cb-button-orange">Checkout is not live</button></div></aside></div>}
    {totalItems > 0 && !cartOpen && <button type="button" className="cb-mobile-cart" onClick={() => setCartOpen(true)}><ShoppingBag size={18}/> View lunch list <span>{totalItems} items · {money(total)}</span></button>}
  </div>;
}

export default CloudBitesPage;
