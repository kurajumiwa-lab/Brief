import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Plus,
  ArrowRight,
  MessageCircle,
  Package,
  Store,
  CalendarDays,
  Users,
  Bike,
  Truck,
  Sun,
  Repeat,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  ShieldCheck,
  FileText,
  Hash,
  EyeOff,
  Bell,
  MapPin,
  X
} from 'lucide-react';
import type { Space, Circle, PublicSpace, Order } from '../../api/types';
import * as briefApi from '../../api/briefApi';
import type {
  DiscoverFeedItem,
  DiscoverGap,
  DiscoverRoute,
  DiscoverSummary,
  EventListing,
  FollowsGroups
} from '../../api/briefApi';
import { CreateFlowModal } from '../spaces/CreateFlowModal';
import { FLOW_ACCENT, FeedSheet } from '../city/DiscoverFeed';
import { NoPhotoPlate } from '../city/NoPhotoPlate';
import { categoryAccent } from '../city/categoryPalette';
import { listedAgo, PHOTO_FILTER } from '../city/room';
import { GlobysCard } from '../../ui/GlobysCard';
import { BannerButton } from '../../ui/BannerButton';
import { PromoBanners } from './PromoBanners';
import { CardSkeleton } from '../../components/ui/Skeleton';
import { soundEngine } from '../../utils/SoundEngine';
import { buildLoopSections, type LoopContext, type LoopSection } from './loopEngine';
import { WairoMark } from '../../components/WairoMark';
import { CategoryArt } from '../../ui/CategoryArt';

// ---------------------------------------------------------------------------
// HOME SURFACE — merged storefront + loop window shop.
// The storefront IS the home feed: hero cover, logo plate, contrast endplates
// sit atop the loop's own shelves (popular, merch, gaps, suppliers, events,
// groups, wholesale). No separate storefront overlay — Home is the street.
// Every number, badge and CTA is a real row.
// ---------------------------------------------------------------------------

export interface HomeSurfaceProps {
  onOpenEarn?: () => void;
  userName?: string;
  onOpenSpace: (spaceId: string) => void;
  onExploreDiscover?: (subTab?: 'bulk' | 'direct' | 'niche' | 'group' | 'events' | 'circles' | 'errands' | 'all' | 'shops', startRun?: boolean) => void;
  onGetPaid?: () => void;
  onOpenSpaces?: () => void;
  onOpenGroupBuys?: () => void;
  onOpenPulse?: () => void;
  onOpenHow?: () => void;
  className?: string;
}

const money = (n: number, currency: string) => `${currency} ${Number(n).toLocaleString('en-KE')}`;
const shortDate = (iso: string | null) => {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  try {
    const d = new Date(ms);
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
    return `${day} ${d.getUTCDate()} ${month}`;
  } catch {
    return '';
  }
};

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

export const HomeSurface: React.FC<HomeSurfaceProps> = ({
  onOpenSpace,
  onExploreDiscover,
  onOpenSpaces,
  onOpenGroupBuys,
  onOpenPulse,
  className = ''
}) => {
  const [summary, setSummary] = useState<DiscoverSummary | null>(null);
  const [feed, setFeed] = useState<DiscoverFeedItem[]>([]);
  const [events, setEvents] = useState<EventListing[]>([]);
  const [spaces, setSpaces] = useState<PublicSpace[]>([]);
  const [circles, setCircles] = useState<Circle[]>([]);
  const [loading, setLoading] = useState(true);
  const [openItem, setOpenItem] = useState<DiscoverFeedItem | null>(null);
  const [createSpaceOpen, setCreateSpaceOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [barDismissed, setBarDismissed] = useState(false);
  const [carousel, setCarousel] = useState(0);
  const offersRef = useRef<HTMLDivElement>(null);

  // Read stated place from local storage
  const [area] = useState<string>(() => {
    try {
      return localStorage.getItem('brief.world.place') ?? 'Nairobi';
    } catch {
      return 'Nairobi';
    }
  });

  // Loop persona switcher for interactive demonstration
  const [persona, setPersona] = useState<'all' | 'customer' | 'vendor' | 'trader'>('all');

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, evRes, spRes, cirRes] = await Promise.all([
        briefApi.getDiscoverSummary(),
        briefApi.browseEvents({ limit: 50 }),
        briefApi.discoverPublicSpaces(12),
        briefApi.getCircles()
      ]);
      if (sumRes.ok && sumRes.data) {
        setSummary(sumRes.data);
        setFeed(sumRes.data.feed);
      }
      if (evRes.ok && evRes.data?.events) {
        setEvents(evRes.data.events);
      }
      if (spRes.ok && spRes.data) {
        setSpaces(spRes.data);
      }
      if (cirRes.ok && cirRes.data) {
        setCircles(cirRes.data);
      }
    } catch {
      /* network fallback */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Mode tiles navigation
  const MODES: Array<{ id: string; label: string; act: () => void }> = [
    { id: 'shops', label: 'Shops', act: () => onOpenSpaces?.() },
    { id: 'events', label: 'Events', act: () => onExploreDiscover?.('events') },
    { id: 'circles', label: 'Groups', act: () => onExploreDiscover?.('circles') },
    { id: 'errands', label: 'Errands', act: () => onExploreDiscover?.('errands') },
    { id: 'runs', label: 'Runs', act: () => onExploreDiscover?.('errands', true) },
    { id: 'groupBuys', label: 'Group Buys', act: () => onOpenGroupBuys?.() }
  ];

  const plateIcon = (flow: string | null | undefined, kind: string): React.ReactNode => {
    if (kind === 'event') return <CalendarDays className="w-4 h-4" />;
    switch (flow) {
      case 'bulk': return <Package className="w-4 h-4" />;
      case 'direct': return <Bike className="w-4 h-4" />;
      case 'niche': return <Sun className="w-4 h-4" />;
      case 'group': return <Users className="w-4 h-4" />;
      default: return <Package className="w-4 h-4" />;
    }
  };

  const waHref = (item: DiscoverFeedItem): string | null => {
    const digits = (item.contact ?? '').replace(/\D/g, '');
    if (digits.length < 9) return null;
    return `https://wa.me/${digits}?text=${encodeURIComponent(`Hi — I saw "${item.title}" on Wairo and I would like to ask about it.`)}`;
  };

  const openFull = (item: DiscoverFeedItem) => {
    if (item.kind === 'event') window.open(`/c/${item.id}`, '_self');
    else window.location.hash = `offer/${encodeURIComponent(item.id)}`;
  };

  const joinCircle = async (c: Circle) => {
    const res = await briefApi.joinCircle(c.id);
    if (!res.ok) { showToast(res.error ?? 'Could not join this group.'); return; }
    showToast(`Joined ${c.name}.`);
    onExploreDiscover?.('circles');
  };

  const myCircles = circles.filter((c) => Boolean(c.viewerRole));
  const openCircles = circles.filter((c) => !c.viewerRole && c.canJoin);

  // Storefront derived counts
  const listings = useMemo(() => (summary?.feed ?? []).filter((i) => i.kind !== 'event'), [summary]);
  const newArrivals = useMemo(() => listings.filter((l) => isNew(l.listedAt)), [listings]);
  const featured = useMemo(() => {
    const pinned = listings.filter((l) => l.why === 'seller-pin');
    const rest = listings.filter((l) => l.why !== 'seller-pin');
    return [...pinned, ...rest].slice(0, 12);
  }, [listings]);
  const perView = 4;
  const maxScroll = Math.max(0, featured.length - perView);
  const go = (hash: string) => { soundEngine.play('tap'); window.location.hash = hash; };
  const goOffer = (id: string) => { soundEngine.play('tap'); window.location.hash = `offer/${encodeURIComponent(id)}`; };
  const listingsCount = summary?.counts?.listings ?? listings.length;
  const eventsCount = summary?.counts?.events ?? events.length;
  const heroImage = spaces.find((s) => s.image)?.image ?? null;

  // The Loop Section generator
  const loopSections: LoopSection[] = useMemo(() => {
    const context: LoopContext = { area, persona };
    return buildLoopSections(
      context,
      {
        feed,
        events,
        gaps: summary?.unmapped ?? [],
        spaces,
        routes: summary?.routes ?? [],
        circles
      },
      {
        onOpenGroupBuys,
        onOpenPulse,
        onExploreDiscover
      }
    );
  }, [area, persona, feed, events, summary, spaces, circles, onOpenGroupBuys, onOpenPulse, onExploreDiscover]);

  return (
    <div className={`space-y-6 max-w-5xl mx-auto pb-12 ${className}`}>
      {toastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-2xl bg-[color:var(--color-text)] text-white text-xs font-bold shadow-2xl animate-fadeIn border border-white/10">
          {toastMsg}
        </div>
      )}

      {/* ── 0. ANNOUNCEMENT BAR — real counts, dismissible ─────────────── */}
      {!barDismissed && listingsCount > 0 && (
        <div
          className="-mx-4 sm:-mx-6 flex items-center justify-center gap-2 px-4 py-2 text-center"
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

      {/* ── 1. HERO — Bolt-style cover + logo plate + contrast ─────────── */}
      <section className="relative overflow-hidden rounded-3xl" style={{ background: 'var(--navy)' }}>
        <div className="px-5 sm:px-8 py-8 sm:py-10 grid sm:grid-cols-2 gap-6 items-center">
          <div>
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider"
              style={{ background: 'rgba(255,255,255,0.12)', color: 'var(--sage)' }}
            >
              <Sparkles className="w-3.5 h-3.5" /> The digital street
            </span>
            <h1 className="text-[30px] sm:text-[38px] font-black leading-[1.02] mt-3 text-white">
              Business gets<br />done here.
            </h1>
            <p className="text-[14px] sm:text-[15px] mt-3 max-w-md" style={{ color: 'rgba(255,255,255,0.72)' }}>
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
                onClick={() => { soundEngine.play('tap'); window.location.hash = 'create'; }}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-full text-[14px] font-bold cursor-pointer"
                style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}
              >
                <Store className="w-4 h-4" /> Host a shop
              </button>
            </div>
          </div>
          <div className="relative">
            <div
              className="relative rounded-3xl overflow-hidden aspect-[4/3] shadow-2xl"
              style={{ background: 'radial-gradient(120% 120% at 80% 10%, rgba(64,145,108,0.4), rgba(13,27,42,0) 60%), #10243a', border: '3px solid rgba(255,255,255,0.12)' }}
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
              {/* Logo plate overlapping the cover edge */}
              <div className="absolute -bottom-3 -left-3 w-16 h-16 rounded-2xl bg-white grid place-items-center shadow-xl border border-black/5">
                <WairoMark size={36} title="" />
              </div>
            </div>
          </div>
        </div>
        {/* Contrast endplate bar under hero */}
        <div className="px-5 sm:px-8 py-3 flex items-center justify-between" style={{ background: 'rgba(255,255,255,0.06)', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.7)' }}>
            {listingsCount} live · {spaces.length} shops · {events.length} events
          </span>
          <button type="button" onClick={() => go('city/all')} className="text-[12px] font-bold cursor-pointer" style={{ color: 'var(--sage)' }}>Explore all →</button>
        </div>
      </section>

      {/* ── 1a. CATEGORY GRID — Browse the street (storefront shelf) ───── */}
      <section className="py-2" aria-label="Browse by category">
        <h2 className="text-[16px] font-extrabold tracking-tight" style={{ color: 'var(--brief-ink)' }}>
          Browse the street
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
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

      {/* ── 2. TOP CATEGORY SCROLL (YouTube-style Explore Pills) ────────── */}
      <section aria-label="Explore" className="space-y-2">
        <div data-testid="mode-tiles" aria-label="Ways in" className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => { soundEngine.play('tap'); m.act(); }}
              className="shrink-0 px-4 py-2 rounded-full text-[13px] font-bold cursor-pointer transition-all hover:opacity-90 active:scale-95"
              style={{ background: 'var(--color-well)', color: 'var(--brief-ink)' }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* The Loop Recommendation persona filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1 text-[11px]">
          <span className="shrink-0 font-bold uppercase tracking-wider text-[var(--muted-ink)] inline-flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-[var(--color-primary)]" /> Loop Feed:
          </span>
          {[
            ['all', `All in ${area || 'Nairobi'}`],
            ['customer', 'Customer picks'],
            ['vendor', 'Vendor & B2B'],
            ['trader', 'Wholesale & gaps']
          ].map(([p, label]) => (
            <button
              key={p}
              type="button"
              onClick={() => { soundEngine.play('tap'); setPersona(p as any); }}
              className={`shrink-0 px-2.5 py-1 rounded-full font-bold transition-all cursor-pointer ${
                persona === p
                  ? 'bg-[color:var(--color-primary)] text-white'
                  : 'bg-[color:var(--color-paper)] text-[color:var(--muted-ink)] border border-[var(--brief-line)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* ── 1b. EXPLORE BANNERS — the street's own promoted rails ──────── */}
      <PromoBanners />

      {/* ── 2b. FEATURED COUNTER inside Home (storefront shelf given space) */}
      <section className="py-2" aria-label="On the counter" ref={offersRef}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[16px] font-extrabold tracking-tight" style={{ color: 'var(--brief-ink)' }}>
              On the counter
            </h2>
            <p className="text-[11px] text-[var(--color-text-muted)]">Live offers from the street — pinned by the shop first</p>
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
          <div className="mt-3 p-5 rounded-2xl border border-dashed text-center" style={{ borderColor: 'var(--brief-line)', background: 'var(--color-paper)' }}>
            <p className="text-[13px] font-bold" style={{ color: 'var(--brief-ink)' }}>Nothing on the counter yet.</p>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1">When a shop publishes an offer, it appears here.</p>
          </div>
        ) : (
          <div className="mt-3 overflow-hidden">
            <div
              className="flex gap-3 transition-transform duration-300"
              style={{ transform: `translateX(-${carousel * 54}px)` }}
            >
              {featured.map((l) => (
                <div key={l.id} className="w-[200px] shrink-0 snap-start">
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
                        <NoPhotoPlate seller={l.seller} mark={l.flow ?? 'listing'} icon={plateIcon(l.flow, l.kind)} stamp={listedAgo(l.listedAt)} accent={(l.flow && FLOW_ACCENT[l.flow]) || null} />
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
                      <p className="text-[13px] font-bold" style={{ color: 'var(--brief-ink)' }}>{l.priceLabel ?? 'Price not listed'}</p>
                      <p className="text-[11px] text-[var(--color-text-muted)] truncate">{l.seller}{l.location ? ` · ${l.location}` : ''}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── 3. THE HERO BANNER (What's moving today) ───────────────────── */}
      <section aria-label="What's moving today">
        <BannerButton
          label="What’s moving today"
          onClick={() => { soundEngine.play('tap'); onOpenPulse?.(); }}
        />
      </section>

      {/* ── 4. YOUTUBE-STYLE HORIZONTALLY SCROLLABLE CAROUSELS ─────────── */}
      {loading && feed.length === 0 ? (
        <section className="space-y-4">
          <div className="space-y-2">
            <div className="h-4 w-40 bg-[color:var(--color-well)] rounded animate-pulse" />
            <div className="flex gap-3 overflow-hidden">
              <CardSkeleton className="w-44 shrink-0" />
              <CardSkeleton className="w-44 shrink-0" />
              <CardSkeleton className="w-44 shrink-0" />
            </div>
          </div>
        </section>
      ) : (
        loopSections.map((section) => {
          const SectionHeader = (
            <div className="flex items-center justify-between pb-1">
              <div>
                <h3 className="text-[16px] font-extrabold tracking-tight" style={{ color: 'var(--color-text)' }}>
                  {section.title}
                </h3>
                {section.subtitle && (
                  <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                    {section.subtitle}
                  </p>
                )}
              </div>
              {section.seeAllRoom && (
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.play('tap');
                    onExploreDiscover?.(section.seeAllRoom as any);
                  }}
                  className="text-[12px] font-bold inline-flex items-center gap-0.5 cursor-pointer"
                  style={{ color: 'var(--color-primary)' }}
                >
                  See all <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );

          if (section.kind === 'popular' || section.kind === 'merch') {
            if (section.items.length === 0) return null;
            return (
              <section key={section.id} aria-label={section.title} className="space-y-2.5">
                {SectionHeader}
                <div
                  data-testid={section.kind === 'popular' ? 'open-now-grid' : undefined}
                  className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-2"
                >
                  {section.items.map((item: DiscoverFeedItem) => {
                    const wa = waHref(item);
                    return (
                      <div
                        key={`${section.id}-${item.id}`}
                        data-testid={`globys-card-open-${item.id}`}
                        className="w-[180px] sm:w-[210px] shrink-0 snap-start"
                      >
                        <GlobysCard
                          testId={`open-${item.id}`}
                          image={item.mediaUrl ? briefApi.mediaFileUrl(item.mediaUrl) : null}
                          imageAlt={item.title}
                          plate={
                            <NoPhotoPlate
                              seller={item.seller}
                              mark={item.flow ?? item.kind}
                              icon={plateIcon(item.flow, item.kind)}
                              stamp={item.kind === 'listing' ? listedAgo(item.listedAt) : null}
                              accent={(item.flow && FLOW_ACCENT[item.flow]) || null}
                            />
                          }
                          title={item.title}
                          price={item.priceLabel}
                          seller={item.seller}
                          mono={
                            item.origin && item.destination
                              ? `${item.origin} → ${item.destination}`
                              : (item.location ?? null)
                          }
                          actionLabel={wa ? 'Chat on WhatsApp →' : 'View offer →'}
                          actionHref={wa}
                          onAction={() => {
                            soundEngine.play('tap');
                            if (!wa) openFull(item);
                          }}
                          onOpen={() => { soundEngine.play('tap'); setOpenItem(item); }}
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          }

          if (section.kind === 'gaps') {
            if (section.items.length === 0) return null;
            return (
              <section key={section.id} aria-label={section.title} className="space-y-2.5">
                {SectionHeader}
                <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-2">
                  {section.items.map((gap: DiscoverGap) => (
                    <div
                      key={gap.requestId}
                      onClick={() => {
                        soundEngine.play('tap');
                        window.location.hash = `requests/${encodeURIComponent(gap.requestId)}`;
                      }}
                      className="w-[230px] shrink-0 snap-start p-3.5 rounded-xl bg-[color:var(--color-paper)] space-y-2 border border-dashed border-[var(--brief-line)] cursor-pointer hover:border-[var(--color-primary)] transition-all brief-lift-1"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-900">
                          Demand gap
                        </span>
                        {gap.category && (
                          <span className="text-[11px] font-bold text-[var(--color-primary)] truncate">
                            {gap.category}
                          </span>
                        )}
                      </div>
                      <h4 className="text-[13px] font-bold leading-snug line-clamp-2 text-[var(--brief-ink)]">
                        {gap.title}
                      </h4>
                      <p className="text-[12px] font-mono text-[var(--muted-ink)] truncate">
                        {gap.quantity ? `${gap.quantity} ${gap.unit ?? 'units'}` : 'Volume needed'}
                        {gap.location ? ` · ${gap.location}` : ''}
                      </p>
                      {gap.requiredBy && (
                        <p className="text-[11px] font-mono text-[var(--color-primary)]">
                          Needed by {shortDate(gap.requiredBy)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          }

          if (section.kind === 'suppliers') {
            if (section.items.length === 0) return null;
            return (
              <section key={section.id} aria-label={section.title} className="space-y-2.5">
                {SectionHeader}
                <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-2">
                  {section.items.map((s: PublicSpace) => (
                    <div
                      key={s.id}
                      onClick={() => {
                        soundEngine.play('tap');
                        onOpenSpace(s.id);
                      }}
                      className="w-[190px] shrink-0 snap-start rounded-xl overflow-hidden bg-[color:var(--color-paper)] p-3 space-y-2 cursor-pointer brief-lift-1 border border-[var(--brief-line)] hover:border-[var(--color-primary)] transition-all"
                    >
                      <div className="h-20 w-full rounded-lg overflow-hidden bg-[var(--color-well)] relative">
                        {s.image ? (
                          <img
                            src={briefApi.mediaFileUrl(s.image)}
                            alt=""
                            className="w-full h-full object-cover"
                            style={{ filter: PHOTO_FILTER }}
                          />
                        ) : (
                          <div className="w-full h-full grid place-items-center bg-[var(--color-well)] text-[var(--color-primary)]">
                            <Store className="w-6 h-6" />
                          </div>
                        )}
                      </div>
                      <div>
                        <h4 className="text-[13px] font-bold truncate text-[var(--brief-ink)]">{s.name}</h4>
                        <p className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--color-primary)]">
                          {(s.type || 'Shop').replace('_', ' ')}
                        </p>
                        <p className="text-[11px] text-[var(--muted-ink)] truncate mt-0.5">
                          {s.where ?? 'Local shopfront'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          }

          if (section.kind === 'events') {
            if (section.items.length === 0) return null;
            return (
              <section key={section.id} aria-label={section.title} className="space-y-2.5">
                {SectionHeader}
                <div
                  data-testid="today-grid"
                  className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-2"
                >
                  {section.items.map((e: EventListing) => (
                    <div
                      key={e.slug}
                      data-testid={`globys-card-event-${e.slug}`}
                      onClick={() => {
                        soundEngine.play('tap');
                        window.open(`/c/${e.slug}`, '_self');
                      }}
                      className="w-[220px] shrink-0 snap-start rounded-xl overflow-hidden bg-[color:var(--color-paper)] p-3 space-y-2 cursor-pointer brief-lift-1 border border-[var(--brief-line)] hover:border-[var(--color-primary)] transition-all"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-[color:var(--color-primary-subtle)] text-[color:var(--color-primary)]">
                          {e.categoryLabel}
                        </span>
                        {e.recurrence && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--muted-ink)]">
                            <Repeat className="w-3 h-3 text-[var(--color-primary)]" />
                            {e.recurrence.ruleText || 'Repeats'}
                          </span>
                        )}
                      </div>

                      <h4 className="text-[13px] font-bold leading-snug line-clamp-2 text-[var(--brief-ink)]">
                        {e.title}
                      </h4>

                      <p className="text-[12px] font-extrabold text-[var(--brief-ink)]">
                        {e.goalAmount != null ? 'Contribution pot' : (e.price === 0 ? 'Free' : money(e.price, e.currency ?? 'KES'))}
                      </p>

                      <div className="text-[11px] text-[var(--muted-ink)] space-y-0.5 truncate">
                        <p className="truncate">{e.startsAt ? shortDate(e.startsAt) : 'Upcoming'}{e.location ? ` · ${e.location}` : ''}</p>
                        {e.hostName && <p className="truncate">Hosted by <strong className="text-[var(--brief-ink)]">{e.hostName}</strong></p>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          }

          if (section.kind === 'groups') {
            if (circles.length === 0) return null;
            return (
              <section key={section.id} aria-label={section.title} className="space-y-2.5">
                {SectionHeader}
                <div data-testid="groups-grid" className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                  {myCircles.slice(0, 8).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      data-testid={`globys-card-group-${c.id}`}
                      onClick={() => { soundEngine.play('tap'); onExploreDiscover?.('circles'); }}
                      className="shrink-0 w-16 flex flex-col items-center gap-1 cursor-pointer"
                    >
                      <span
                        className="w-14 h-14 rounded-full grid place-items-center text-[18px] font-black"
                        style={{ background: 'var(--navy)', color: '#FFFFFF' }}
                        aria-hidden="true"
                      >
                        {(c.name || '?').trim().charAt(0).toUpperCase()}
                      </span>
                      <span className="text-[11px] font-bold truncate w-16 text-center" style={{ color: 'var(--brief-ink)' }}>
                        {c.name}
                      </span>
                    </button>
                  ))}
                  {openCircles.slice(0, 8).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      data-testid={`globys-card-group-${c.id}`}
                      onClick={() => { soundEngine.play('tap'); void joinCircle(c); }}
                      className="shrink-0 w-16 flex flex-col items-center gap-1 cursor-pointer"
                      aria-label={`Join ${c.name}`}
                    >
                      <span
                        className="w-14 h-14 rounded-full grid place-items-center text-[18px] font-black"
                        style={{ background: 'var(--color-well)', color: 'var(--brief-ink)', border: '1px dashed var(--muted-ink)' }}
                        aria-hidden="true"
                      >
                        {(c.name || '?').trim().charAt(0).toUpperCase()}
                      </span>
                      <span className="text-[11px] font-bold truncate w-16 text-center" style={{ color: 'var(--muted-ink)' }}>
                        {c.name}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            );
          }

          if (section.kind === 'wholesale') {
            if (section.items.length === 0) return null;
            return (
              <section key={section.id} aria-label={section.title} className="space-y-2.5">
                {SectionHeader}
                <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-2">
                  {section.items.map((r: DiscoverRoute) => (
                    <div
                      key={`${r.origin}-${r.destination}`}
                      onClick={() => {
                        soundEngine.play('tap');
                        onExploreDiscover?.('bulk');
                      }}
                      className="w-[210px] shrink-0 snap-start p-3.5 rounded-xl bg-[color:var(--color-paper)] space-y-1.5 border border-[var(--brief-line)] cursor-pointer brief-lift-1"
                    >
                      <p className="text-[11px] font-black uppercase tracking-wider text-[var(--color-primary)]">
                        {r.flow ?? 'Wholesale route'}
                      </p>
                      <h4 className="text-[13px] font-bold leading-snug text-[var(--brief-ink)]">
                        {r.origin} <span aria-hidden="true">→</span> {r.destination}
                      </h4>
                      <p className="text-[11px] font-mono text-[var(--muted-ink)]">
                        {r.listings} active {r.listings === 1 ? 'offer' : 'offers'}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            );
          }

          return null;
        })
      )}

      {/* ── Storefront shelf: mid-promo + new arrivals (given space in merged feed) */}
      {newArrivals.length > 0 && (
        <section className="py-4" aria-label="New arrivals">
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-extrabold tracking-tight" style={{ color: 'var(--brief-ink)' }}>New this week</h2>
            <button type="button" onClick={() => go('city/all')} className="text-[12px] font-bold inline-flex items-center gap-0.5 cursor-pointer" style={{ color: 'var(--color-primary)' }}>
              Shop new <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
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
                    <NoPhotoPlate seller={l.seller} mark={l.flow ?? 'listing'} icon={plateIcon(l.flow, l.kind)} />
                  )}
                  <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide" style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}>New</span>
                </div>
                <div className="p-3 space-y-1">
                  <p className="text-[13px] font-bold leading-snug line-clamp-2" style={{ color: 'var(--brief-ink)' }}>{l.title}</p>
                  <p className="text-[13px] font-bold" style={{ color: 'var(--brief-ink)' }}>{l.priceLabel ?? 'Price not listed'}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="py-4" aria-label="Group buys">
        <div
          className="relative overflow-hidden rounded-3xl p-6 sm:p-8"
          style={{ background: 'radial-gradient(120% 140% at 90% 0%, rgba(64,145,108,0.35), rgba(13,27,42,0) 55%), var(--navy)' }}
        >
          <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider" style={{ background: 'var(--sage)', color: 'var(--navy)' }}>
            Pooled demand
          </span>
          <h3 className="text-[20px] sm:text-[22px] font-black text-white mt-3">Buy more together, pay less per unit</h3>
          <p className="text-[13px] mt-2 max-w-lg" style={{ color: 'rgba(255,255,255,0.72)' }}>
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

      {/* ── Counted not invented + shops on street (storefront trust endplate) */}
      <section className="py-6" aria-label="Why the street is honest">
        <h2 className="text-[16px] font-extrabold tracking-tight text-center" style={{ color: 'var(--brief-ink)' }}>
          Counted, not invented
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5">
          {[
            { icon: <ShieldCheck className="w-5 h-5" />, title: 'Escrow records', body: 'Brief records funds held — it moves no money.' },
            { icon: <FileText className="w-5 h-5" />, title: 'Receipt-backed', body: 'A price carries its receipt photo — never a lone number.' },
            { icon: <Hash className="w-5 h-5" />, title: 'Real counts', body: 'Every figure is a row somebody wrote — a dash when empty.' },
            { icon: <EyeOff className="w-5 h-5" />, title: 'No invention', body: 'No fake ratings, no fake followers, no “best sellers”.' },
          ].map((v) => (
            <div key={v.title} className="text-center">
              <span className="inline-grid place-items-center w-10 h-10 rounded-xl" style={{ background: 'var(--color-primary-subtle)', color: 'var(--color-primary)' }}>
                {v.icon}
              </span>
              <p className="text-[13px] font-bold mt-2" style={{ color: 'var(--brief-ink)' }}>{v.title}</p>
              <p className="text-[11px] text-[var(--color-text-muted)] mt-1 leading-snug">{v.body}</p>
            </div>
          ))}
        </div>
      </section>

      {spaces.length > 0 && (
        <section className="py-4" aria-label="Shops on the street">
          <h2 className="text-[16px] font-extrabold tracking-tight" style={{ color: 'var(--brief-ink)' }}>Shops on the street</h2>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-1">Real public shopfronts — counted by the people who follow them.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            {spaces.slice(0, 8).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onOpenSpace(s.id)}
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
        </section>
      )}

      {/* Detail Sheet modal when an item is tapped */}
      {openItem && (
        <FeedSheet item={openItem} onClose={() => setOpenItem(null)} onOpenFull={openFull} />
      )}

      {/* Create Flow Modal */}
      {createSpaceOpen && (
        <CreateFlowModal
          isOpen={createSpaceOpen}
          onClose={() => setCreateSpaceOpen(false)}
          onCompleted={(newSpace) => {
            showToast(`Space "${newSpace.name}" created!`);
            onOpenSpace(newSpace.id);
          }}
        />
      )}
    </div>
  );
};

export default HomeSurface;
