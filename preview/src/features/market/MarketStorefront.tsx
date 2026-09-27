import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search, Menu, User, Heart, ShoppingBag, ChevronRight, ChevronLeft, ChevronDown,
  X, Store, Users, Bike, Package,
  ShieldCheck, FileText, Hash, EyeOff, ArrowRight, MapPin, Sparkles, Bell,
} from 'lucide-react';
import * as briefApi from '../../api/briefApi';
import type {
  DiscoverSummary, DiscoverFeedItem, EventListing, FollowsGroups
} from '../../api/briefApi';
import type { PublicSpace, Order } from '../../api/types';
import { WairoMark } from '../../components/WairoMark';
import { CategoryArt } from '../../ui/CategoryArt';
import { NoPhotoPlate } from '../city/NoPhotoPlate';
import { FLOW_ACCENT } from '../city/DiscoverFeed';
import { PHOTO_FILTER, listedAgo } from '../city/room';
import { soundEngine } from '../../utils/SoundEngine';
import { Sheet } from '../../ui/Sheet';
import { FollowingSurface } from '../../components/FollowingSurface';

// ---------------------------------------------------------------------------
// MARKET STOREFRONT — the e-commerce homepage for the Wairo street.
//
// Eleven sections, in the shape of a store front: announcement bar, nav
// header (logo · search · categories · account · wishlist · cart), hero,
// category grid, featured counter, mid-page promo, new arrivals, value props,
// social proof, newsletter, footer.
//
// THE LAW THIS FILE OBEDIES: every number, badge and CTA is a real row.
//   * "On the counter" is real live offers — never "Best Sellers"/"Trending"
//     (no popularity is stored, so no ranking is invented).
//   * A "New" badge is drawn only when a real listedAt is within 7 days.
//   * There is no countdown — no real time-limited sale exists to time.
//   * The newsletter incentive is honest ("see new offers"), never a fake
//     "10% off" (no discount engine exists).
//   * Social proof is the real shop directory, not a fake Instagram feed.
//   * There are no payment-method badges — Brief moves no money; it is records.
//   * The cart and wishlist counts are real (orders / follows), and read as
//     zero or absent, never a flattering placeholder.
// ---------------------------------------------------------------------------

const money = (n: number, c: string) => `${c} ${Number(n).toLocaleString('en-KE')}`;

const REAL_ROOMS = [
  { room: 'shops' as const, label: 'Shops', art: 'shops', sub: 'Shopfronts on the street' },
  { room: 'events' as const, label: 'Events', art: 'events', sub: 'Meetups & trips' },
  { room: 'circles' as const, label: 'Groups', art: 'groups', sub: 'Chamas & pools' },
  { room: 'errands' as const, label: 'Errands', art: 'errands', sub: 'Carrying & runs' },
  { room: 'runs' as const, label: 'Runs', art: 'runs', sub: 'Deliveries' },
  { room: 'group' as const, label: 'Group Buys', art: 'groupBuys', sub: 'Pooled demand' },
];

function isNew(listedAt: string | null | undefined): boolean {
  if (!listedAt) return false;
  const ms = Date.parse(listedAt);
  if (!Number.isFinite(ms)) return false;
  return Date.now() - ms <= 7 * 86400000;
}

export const MarketStorefront: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const [summary, setSummary] = useState<DiscoverSummary | null>(null);
  const [shops, setShops] = useState<PublicSpace[]>([]);
  const [events, setEvents] = useState<EventListing[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [follows, setFollows] = useState<FollowsGroups | null>(null);

  const [barDismissed, setBarDismissed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [carousel, setCarousel] = useState(0);
  const offersRef = useRef<HTMLDivElement>(null);
  const [followSheetOpen, setFollowSheetOpen] = useState(false);
  const [authed, setAuthed] = useState(true);

  useEffect(() => {
    let live = true;
    void briefApi.getDiscoverSummary().then((r) => { if (live && r.ok) setSummary(r.data); });
    void briefApi.discoverPublicSpaces(12).then((r) => { if (live && r.ok) setShops(r.data); });
    void briefApi.browseEvents({ limit: 12 }).then((r) => { if (live && r.ok) setEvents(r.data.events); });
    void briefApi.getMyOrders().then((r) => { if (live && r.ok) setOrders(r.data); });
    void briefApi.getMyFollows().then((r) => { if (live && r.ok) setFollows(r.data); });
    void briefApi.whoAmI().then((r) => { if (live) setAuthed(r.ok); });
    return () => { live = false; };
  }, []);

  const listings = useMemo(
    () => (summary?.feed ?? []).filter((i) => i.kind !== 'event'),
    [summary],
  );
  const newArrivals = useMemo(
    () => listings.filter((l) => isNew(l.listedAt)),
    [listings],
  );
  // Featured = the shop's own real pins first, then the rest of the counter.
  const featured = useMemo(() => {
    const pinned = listings.filter((l) => l.why === 'seller-pin');
    const rest = listings.filter((l) => l.why !== 'seller-pin');
    return [...pinned, ...rest].slice(0, 12);
  }, [listings]);
  const perView = 4;
  const maxScroll = Math.max(0, featured.length - perView);
  const go = (hash: string) => { soundEngine.play('tap'); window.location.hash = hash; };
  const goOffer = (id: string) => { soundEngine.play('tap'); window.location.hash = `offer/${encodeURIComponent(id)}`; };

  const openOrders = orders.filter((o) => o.status !== 'settled' && o.status !== 'cancelled');
  const latestOrder = openOrders[0] ?? null;
  const followCount = follows?.total ?? null;
  const listingsCount = summary?.counts.listings ?? listings.length;
  const eventsCount = summary?.counts.events ?? events.length;

  // A real cover for the hero: the first public shop that carries one.
  const heroImage = shops.find((s) => s.image)?.image ?? null;

  const plateIcon = (l: DiscoverFeedItem) => {
    switch (l.flow) {
      case 'bulk': return <Package className="w-4 h-4" />;
      case 'direct': return <Bike className="w-4 h-4" />;
      case 'group': return <Users className="w-4 h-4" />;
      default: return <Package className="w-4 h-4" />;
    }
  };

  return (
    <div className="min-h-full bg-[color:var(--color-bg)] pb-24" data-testid="market-storefront">
      {/* ── 1. ANNOUNCEMENT BAR (dismissible, real counts) ─────────────── */}
      {!barDismissed && (
        <div
          className="flex items-center justify-center gap-2 px-4 py-2 text-center"
          style={{ background: 'var(--navy)', color: '#fff' }}
        >
          <span className="text-[12px] font-bold">
            The street is open — {listingsCount} live offer{listingsCount === 1 ? '' : 's'}{eventsCount ? ` · ${eventsCount} event${eventsCount === 1 ? '' : 's'} this week` : ''}
          </span>
          <button
            type="button" aria-label="Dismiss announcement"
            onClick={() => setBarDismissed(true)}
            className="p-0.5 rounded-full hover:bg-white/10 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── 2. NAVIGATION HEADER ──────────────────────────────────────── */}
      <header
        className="sticky top-0 z-40 border-b border-[var(--brief-line)]"
        style={{ background: 'var(--color-paper)' }}
      >
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center gap-3">
          {onBack && (
            <button
              type="button" aria-label="Back to the app"
              onClick={() => { soundEngine.play('tap'); onBack(); }}
              className="p-2 -ml-2 rounded-full hover:bg-[var(--color-well)] cursor-pointer"
              style={{ color: 'var(--brief-ink)' }}
            >
              <X className="w-5 h-5" />
            </button>
          )}
          {/* Logo */}
          <button type="button" onClick={() => go('home')} className="flex items-center gap-2 shrink-0 cursor-pointer">
            <WairoMark size={30} title="" />
            <span className="flex flex-col items-start leading-none">
              <span className="text-[17px] font-black tracking-tight" style={{ color: 'var(--wairo-slate)' }}>Wairo</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">Blue Avenue</span>
            </span>
          </button>

          {/* Category mega menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => { soundEngine.play('tap'); setMenuOpen((o) => !o); }}
              className="hidden sm:inline-flex items-center gap-1 px-3 py-2 rounded-xl text-[13px] font-bold cursor-pointer"
              style={{ color: 'var(--brief-ink)' }}
            >
              <Menu className="w-4 h-4" /> Categories <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {menuOpen && (
              <div
                className="absolute left-0 top-full mt-1 w-72 rounded-2xl overflow-hidden border border-[var(--brief-line)] shadow-lg"
                style={{ background: 'var(--color-paper)' }}
              >
                {REAL_ROOMS.map((r) => (
                  <button
                    key={r.room}
                    type="button"
                    onClick={() => { setMenuOpen(false); go(`city/${r.room}`); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--color-well)] text-left cursor-pointer"
                  >
                    <CategoryArt kind={r.art} className="!w-9 !h-8 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-bold" style={{ color: 'var(--brief-ink)' }}>{r.label}</span>
                      <span className="block text-[11px] text-[var(--color-text-muted)] truncate">{r.sub}</span>
                    </span>
                    <ChevronRight className="w-4 h-4 ml-auto text-[var(--color-text-muted)]" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Search — expandable on mobile, inline on desktop */}
          <div className="flex-1 flex items-center justify-end gap-2">
            <form
              className={`flex items-center gap-2 px-3 rounded-xl border border-[var(--brief-line)] ${searchOpen ? 'w-full' : 'w-full sm:w-56'}`}
              style={{ background: 'var(--color-well)' }}
              onSubmit={(e) => { e.preventDefault(); if (term.trim()) { go(`search/${encodeURIComponent(term.trim())}`); setSearchOpen(false); setTerm(''); } }}
            >
              <Search className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
              <input
                type="search"
                aria-label="Search the street"
                placeholder="Search shops, offers, events"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onFocus={() => setSearchOpen(true)}
                className="w-full bg-transparent py-2 text-[13px] outline-none"
                style={{ color: 'var(--brief-ink)' }}
              />
            </form>
          </div>

          {/* Account */}
          <button
            type="button" aria-label="Account"
            onClick={() => go('you')}
            className="p-2 rounded-full hover:bg-[var(--color-well)] cursor-pointer"
            style={{ color: 'var(--brief-ink)' }}
          >
            <User className="w-5 h-5" />
          </button>
          {/* Wishlist — the ONLY following entry. Opens as primary sheet, not a navigation. */}
          <button
            type="button" aria-label={`Following ${followCount ?? ''}`}
            onClick={() => { soundEngine.play('tap'); setFollowSheetOpen(true); }}
            className="relative p-2 rounded-full hover:bg-[var(--color-well)] cursor-pointer"
            style={{ color: 'var(--brief-ink)' }}
            data-testid="storefront-heart"
          >
            <Heart className="w-5 h-5" />
            {followCount != null && followCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full grid place-items-center text-[10px] font-black"
                style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
              >
                {followCount}
              </span>
            )}
          </button>
          {/* Cart (real open orders count + mini preview) */}
          <div className="relative">
            <button
              type="button" aria-label={`Orders ${openOrders.length}`}
              onClick={() => go('mine')}
              className="relative p-2 rounded-full hover:bg-[var(--color-well)] cursor-pointer"
              style={{ color: 'var(--brief-ink)' }}
            >
              <ShoppingBag className="w-5 h-5" />
              {openOrders.length > 0 && (
                <span
                  className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full grid place-items-center text-[10px] font-black"
                  style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
                >
                  {openOrders.length}
                </span>
              )}
            </button>
            {latestOrder && (
              <span className="sr-only">Latest order: {latestOrder.listingTitle}</span>
            )}
          </div>
        </div>
      </header>

      {/* ── 3. HERO (single, real cover, honest CTA) ──────────────────── */}
      <section className="relative overflow-hidden" style={{ background: 'var(--navy)' }}>
        <div className="max-w-5xl mx-auto px-4 py-12 sm:py-16 grid sm:grid-cols-2 gap-8 items-center">
          <div>
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider"
              style={{ background: 'rgba(255,255,255,0.12)', color: 'var(--sage)' }}
            >
              <Sparkles className="w-3.5 h-3.5" /> The digital street
            </span>
            <h1 className="text-[34px] sm:text-[44px] font-black leading-[1.02] mt-3 text-white">
              Business gets done here.
            </h1>
            <p className="text-[15px] sm:text-[17px] mt-3 max-w-md" style={{ color: 'rgba(255,255,255,0.72)' }}>
              Shops, offers, events and group buys — the street for Kenya&apos;s informal economy, counted from real rows.
            </p>
            <div className="flex flex-wrap gap-3 mt-6">
              <button
                type="button"
                onClick={() => { soundEngine.play('tap'); offersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-full text-[14px] font-black cursor-pointer"
                style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
              >
                Browse the counter <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => go('create')}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-full text-[14px] font-bold cursor-pointer"
                style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}
              >
                <Store className="w-4 h-4" /> Host a shop
              </button>
            </div>
          </div>
          <div className="relative">
            <div
              className="relative rounded-3xl overflow-hidden aspect-[4/3]"
              style={{ background: 'radial-gradient(120% 120% at 80% 10%, rgba(64,145,108,0.4), rgba(13,27,42,0) 60%), #10243a' }}
            >
              {heroImage ? (
                <img
                  src={briefApi.mediaFileUrl(heroImage)}
                  alt="A shop on the street"
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{ filter: PHOTO_FILTER }}
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center">
                  <WairoMark size={96} title="" />
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-4">
        {/* ── 4. CATEGORY GRID (real rooms) ───────────────────────────── */}
        <section className="py-8" aria-label="Browse by category">
          <h2 className="text-[18px] font-extrabold tracking-tight" style={{ color: 'var(--brief-ink)' }}>
            Browse the street
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
            {REAL_ROOMS.map((r) => (
              <button
                key={r.room}
                type="button"
                onClick={() => go(`city/${r.room}`)}
                className="group flex items-center gap-3 p-3 rounded-2xl text-left cursor-pointer transition-all hover:-translate-y-0.5 border border-[var(--brief-line)]"
                style={{ background: 'var(--color-paper)' }}
              >
                <CategoryArt kind={r.art} className="!w-12 !h-11 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-[14px] font-bold" style={{ color: 'var(--brief-ink)' }}>{r.label}</span>
                  <span className="block text-[11px] text-[var(--color-text-muted)] truncate">{r.sub}</span>
                </span>
                <ChevronRight className="w-4 h-4 ml-auto text-[var(--color-text-muted)] group-hover:translate-x-0.5 transition-transform" />
              </button>
            ))}
          </div>
        </section>

        {/* ── 5. FEATURED COUNTER (real offers, carousel) ─────────────── */}
        <section className="py-4" aria-label="On the counter" ref={offersRef}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[18px] font-extrabold tracking-tight" style={{ color: 'var(--brief-ink)' }}>
                On the counter
              </h2>
              <p className="text-[12px] text-[var(--color-text-muted)]">Live offers from the street — pinned by the shop first</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button" aria-label="Previous"
                onClick={() => { soundEngine.play('tap'); setCarousel((c) => Math.max(0, c - 1)); }}
                className="p-2 rounded-full border border-[var(--brief-line)] cursor-pointer disabled:opacity-40"
                style={{ background: 'var(--color-paper)', color: 'var(--brief-ink)' }}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button" aria-label="Next"
                onClick={() => { soundEngine.play('tap'); setCarousel((c) => Math.min(maxScroll, c + 1)); }}
                className="p-2 rounded-full border border-[var(--brief-line)] cursor-pointer disabled:opacity-40"
                style={{ background: 'var(--color-paper)', color: 'var(--brief-ink)' }}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => go('city/all')} className="text-[12px] font-bold inline-flex items-center gap-0.5 cursor-pointer" style={{ color: 'var(--color-primary)' }}>
                View All <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {featured.length === 0 ? (
            <div className="mt-4 p-6 rounded-2xl border border-dashed text-center" style={{ borderColor: 'var(--brief-line)', background: 'var(--color-paper)' }}>
              <p className="text-[14px] font-bold" style={{ color: 'var(--brief-ink)' }}>Nothing on the counter yet.</p>
              <p className="text-[12px] text-[var(--color-text-muted)] mt-1">When a shop publishes an offer, it appears here.</p>
            </div>
          ) : (
            <div className="mt-4 overflow-hidden">
              <div
                className="flex gap-3 transition-transform duration-300"
                style={{ transform: `translateX(-${carousel * (240 / perView + (240 / perView - 24) / perView)}px)` }}
              >
                {featured.map((l) => (
                  <div key={l.id} className="w-[210px] shrink-0 snap-start">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => goOffer(l.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') goOffer(l.id); }}
                      className="rounded-2xl overflow-hidden bg-[color:var(--color-paper)] border border-[var(--brief-line)] cursor-pointer hover:-translate-y-0.5 transition-all"
                    >
                      <div className="relative aspect-[4/3] overflow-hidden" style={{ background: 'var(--color-well)' }}>
                        {l.mediaUrl ? (
                          <img src={briefApi.mediaFileUrl(l.mediaUrl)} alt={l.title} loading="lazy" className="absolute inset-0 w-full h-full object-cover" style={{ filter: PHOTO_FILTER }} />
                        ) : (
                          <NoPhotoPlate seller={l.seller} mark={l.flow ?? 'listing'} icon={plateIcon(l)} stamp={listedAgo(l.listedAt)} accent={(l.flow && FLOW_ACCENT[l.flow]) || null} />
                        )}
                        {l.why === 'seller-pin' && (
                          <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide" style={{ background: 'rgba(255,255,255,0.92)', color: 'var(--color-primary)' }}>
                            Pinned
                          </span>
                        )}
                        {isNew(l.listedAt) && (
                          <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide" style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}>
                            New
                          </span>
                        )}
                      </div>
                      <div className="p-3 space-y-1">
                        <p className="text-[13px] font-bold leading-snug line-clamp-2" style={{ color: 'var(--brief-ink)' }}>{l.title}</p>
                        <p className="text-[14px] font-bold" style={{ color: 'var(--brief-ink)' }}>{l.priceLabel ?? 'Price not listed'}</p>
                        <p className="text-[11px] text-[var(--color-text-muted)] truncate">{l.seller}{l.location ? ` · ${l.location}` : ''}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ── 6. MID-PAGE PROMO (real group buys, no fake countdown) ──── */}
        <section className="py-6" aria-label="Group buys">
          <div
            className="relative overflow-hidden rounded-3xl p-6 sm:p-8"
            style={{ background: 'radial-gradient(120% 140% at 90% 0%, rgba(64,145,108,0.35), rgba(13,27,42,0) 55%), var(--navy)' }}
          >
            <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider" style={{ background: 'var(--sage)', color: 'var(--navy)' }}>
              Pooled demand
            </span>
            <h3 className="text-[22px] sm:text-[26px] font-black text-white mt-3">Buy more together, pay less per unit</h3>
            <p className="text-[14px] mt-2 max-w-lg" style={{ color: 'rgba(255,255,255,0.72)' }}>
              Group buys pool demand with other buyers on the street. The price each buyer pays is stated on the buy — nothing is invented.
            </p>
            <button
              type="button"
              onClick={() => go('groupbuys')}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-full text-[14px] font-black cursor-pointer mt-5"
              style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
            >
              Browse group buys <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </section>

        {/* ── 7. NEW ARRIVALS (real recent listings, real New badges) ─── */}
        {newArrivals.length > 0 && (
          <section className="py-6" aria-label="New arrivals">
            <div className="flex items-center justify-between">
              <h2 className="text-[18px] font-extrabold tracking-tight" style={{ color: 'var(--brief-ink)' }}>New this week</h2>
              <button type="button" onClick={() => go('city/all')} className="text-[12px] font-bold inline-flex items-center gap-0.5 cursor-pointer" style={{ color: 'var(--color-primary)' }}>
                Shop new <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
              {newArrivals.slice(0, 6).map((l) => (
                <div
                  key={l.id}
                  role="button" tabIndex={0}
                  onClick={() => goOffer(l.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') goOffer(l.id); }}
                  className="rounded-2xl overflow-hidden bg-[color:var(--color-paper)] border border-[var(--brief-line)] cursor-pointer hover:-translate-y-0.5 transition-all"
                >
                  <div className="relative aspect-[4/3] overflow-hidden" style={{ background: 'var(--color-well)' }}>
                    {l.mediaUrl ? (
                      <img src={briefApi.mediaFileUrl(l.mediaUrl)} alt={l.title} loading="lazy" className="absolute inset-0 w-full h-full object-cover" style={{ filter: PHOTO_FILTER }} />
                    ) : (
                      <NoPhotoPlate seller={l.seller} mark={l.flow ?? 'listing'} icon={plateIcon(l)} />
                    )}
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide" style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}>New</span>
                  </div>
                  <div className="p-3 space-y-1">
                    <p className="text-[13px] font-bold leading-snug line-clamp-2" style={{ color: 'var(--brief-ink)' }}>{l.title}</p>
                    <p className="text-[14px] font-bold" style={{ color: 'var(--brief-ink)' }}>{l.priceLabel ?? 'Price not listed'}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── 8. VALUE PROPS (real Wairo values) ──────────────────────── */}
        <section className="py-8" aria-label="Why the street is honest">
          <h2 className="text-[18px] font-extrabold tracking-tight text-center" style={{ color: 'var(--brief-ink)' }}>
            Counted, not invented
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
            {[
              { icon: <ShieldCheck className="w-6 h-6" />, title: 'Escrow records', body: 'Brief records funds held between two sides. It moves no money itself.' },
              { icon: <FileText className="w-6 h-6" />, title: 'Receipt-backed prices', body: 'A claimed price on the map carries its receipt photo — never a bare number.' },
              { icon: <Hash className="w-6 h-6" />, title: 'Real counts only', body: 'Every figure is a row somebody wrote. An unmeasured figure is a dash, not a zero.' },
              { icon: <EyeOff className="w-6 h-6" />, title: 'No invented numbers', body: 'No fake ratings, no fake followers, no fake “best sellers” — none of it.' },
            ].map((v) => (
              <div key={v.title} className="text-center">
                <span className="inline-grid place-items-center w-12 h-12 rounded-2xl" style={{ background: 'var(--color-primary-subtle)', color: 'var(--color-primary)' }}>
                  {v.icon}
                </span>
                <p className="text-[14px] font-bold mt-2" style={{ color: 'var(--brief-ink)' }}>{v.title}</p>
                <p className="text-[12px] text-[var(--color-text-muted)] mt-1 leading-snug">{v.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── 9. SOCIAL PROOF (real shop directory, not fake Instagram) ── */}
        <section className="py-6" aria-label="Shops on the street">
          <h2 className="text-[18px] font-extrabold tracking-tight" style={{ color: 'var(--brief-ink)' }}>Shops on the street</h2>
          <p className="text-[12px] text-[var(--color-text-muted)] mt-1">The real public shopfronts — counted by the people who follow them.</p>
          {shops.length === 0 ? (
            <div className="mt-4 p-6 rounded-2xl border border-dashed text-center" style={{ borderColor: 'var(--brief-line)', background: 'var(--color-paper)' }}>
              <p className="text-[14px] font-bold" style={{ color: 'var(--brief-ink)' }}>No public shops yet.</p>
              <p className="text-[12px] text-[var(--color-text-muted)] mt-1">When a shop goes public, it appears here.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              {shops.slice(0, 8).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => go(`space/${encodeURIComponent(s.slug ?? s.id)}`)}
                  className="rounded-2xl overflow-hidden bg-[color:var(--color-paper)] border border-[var(--brief-line)] text-left cursor-pointer hover:-translate-y-0.5 transition-all"
                >
                  <div className="relative aspect-[4/3] overflow-hidden" style={{ background: 'var(--color-well)' }}>
                    {s.image ? (
                      <img src={briefApi.mediaFileUrl(s.image)} alt={s.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover" style={{ filter: PHOTO_FILTER }} />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center" style={{ color: 'var(--color-primary)' }}><Store className="w-6 h-6" /></div>
                    )}
                  </div>
                  <div className="p-2.5 space-y-0.5">
                    <p className="text-[13px] font-bold truncate" style={{ color: 'var(--brief-ink)' }}>{s.name}</p>
                    <p className="text-[11px] text-[var(--color-text-muted)]">{s.activeOfferCount} live · {s.followers ?? 0} follow</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── 10. NEWSLETTER (honest incentive, no fake discount) ─────── */}
        <section className="py-8" aria-label="Follow the street">
          <div
            className="rounded-3xl p-6 sm:p-8 text-center"
            style={{ background: 'var(--color-paper)', border: '1px solid var(--brief-line)' }}
          >
            <span className="inline-grid place-items-center w-11 h-11 rounded-full" style={{ background: 'var(--color-primary-subtle)', color: 'var(--color-primary)' }}>
              <Bell className="w-5 h-5" />
            </span>
            <h2 className="text-[20px] font-extrabold mt-3" style={{ color: 'var(--brief-ink)' }}>Follow the street</h2>
            <p className="text-[13px] text-[var(--color-text-muted)] mt-1 max-w-md mx-auto">
              See new offers and events in your notifications when the shops you follow post. No invented discount — the value is the street itself.
            </p>
            <button
              type="button"
              onClick={() => { soundEngine.play('tap'); setFollowSheetOpen(true); }}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-full text-[14px] font-black cursor-pointer mt-5"
              style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
            >
              {followCount ? `You follow ${followCount} — manage them` : 'Start following shops'} <ArrowRight className="w-4 h-4" />
            </button>
            <p className="text-[11px] text-[var(--color-text-faint)] mt-3">Your details stay on your account. You can unfollow anytime.</p>
          </div>
        </section>

        {/* ── Following — the heart's primary sheet, not a detour to Mine ─── */}
        <Sheet open={followSheetOpen} title="Following" onClose={() => setFollowSheetOpen(false)}>
          <FollowingSurface authed={authed} variant="embedded" onOpenEntity={(id) => { setFollowSheetOpen(false); window.location.hash = `entity/${encodeURIComponent(id)}`; }} onRequireAuth={() => { setFollowSheetOpen(false); window.location.hash = 'you'; }} />
        </Sheet>

        {/* ── 11. FOOTER ──────────────────────────────────────────────── */}
        <footer className="pt-6 pb-4 border-t border-[var(--brief-line)]" style={{ color: 'var(--color-text-muted)' }}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            <div>
              <div className="flex items-center gap-2">
                <WairoMark size={24} title="" />
                <span className="text-[15px] font-black" style={{ color: 'var(--wairo-slate)' }}>Wairo</span>
              </div>
              <p className="text-[12px] mt-2 leading-snug">The digital street where business gets done.</p>
            </div>
            <div>
              <p className="text-[12px] font-black uppercase tracking-wider" style={{ color: 'var(--brief-ink)' }}>Browse</p>
              <ul className="mt-2 space-y-1.5 text-[12px]">
                {REAL_ROOMS.slice(0, 4).map((r) => (
                  <li key={r.room}><button type="button" onClick={() => go(`city/${r.room}`)} className="cursor-pointer hover:underline">{r.label}</button></li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[12px] font-black uppercase tracking-wider" style={{ color: 'var(--brief-ink)' }}>How it works</p>
              <ul className="mt-2 space-y-1.5 text-[12px]">
                <li><button type="button" onClick={() => go('you/how')} className="cursor-pointer hover:underline">How Wairo works</button></li>
                <li><button type="button" onClick={() => go('you/privacy')} className="cursor-pointer hover:underline">Privacy</button></li>
                <li><button type="button" onClick={() => go('you/profile')} className="cursor-pointer hover:underline">Your account</button></li>
              </ul>
            </div>
            <div>
              <p className="text-[12px] font-black uppercase tracking-wider" style={{ color: 'var(--brief-ink)' }}>The street</p>
              <p className="text-[12px] mt-2 leading-snug">
                Brief moves no money — it records it. No payment rails are badged here because none are ours to claim.
              </p>
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-[var(--brief-line)] flex items-center justify-between text-[11px]">
            <span>© 2026 Wairo Blue Avenue</span>
            <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> Kenya&apos;s informal economy</span>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default MarketStorefront;
