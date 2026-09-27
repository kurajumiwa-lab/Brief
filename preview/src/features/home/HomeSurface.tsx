import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  ChevronRight
} from 'lucide-react';
import type { Space, Circle, PublicSpace } from '../../api/types';
import * as briefApi from '../../api/briefApi';
import type {
  DiscoverFeedItem,
  DiscoverGap,
  DiscoverRoute,
  DiscoverSummary,
  EventListing
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

// ---------------------------------------------------------------------------
// HOME SURFACE — The YouTube-style discovery "Window Shop" for Blue Avenue.
//
// 1. TOP BAR / EXPLORE — The top category scroll: Shops, Events, Groups,
//    Errands, Runs, Group Buys.
// 2. THE LOOP ENGINE — Algorithm-driven recommendation feed. Vertically
//    scrolling collection of horizontally snapping carousels.
// 3. SECTIONS:
//    * Popular in your area (Marketplace listings & verified merchandise)
//    * Special Promoted / Traffic Banners (Trip packages, group buy pools)
//    * Economic Gaps near you (Unmet demand & courier availability gaps)
//    * Supplier & Shop Connect (B2B links, wholesale, workshops)
//    * Events & Trips this week (Photo-free clean cards with recurrence badges)
//    * Groups & Chamas (Shorts-style circular rail)
//    * Wholesale corridors & freight routes
// 4. NO TASK CLUTTER: Task-oriented onboarding prompts and ledger tasks
//    belong on the user's dashboard (Mine/You), leaving Home as a true
//    discovery window into the economic street.
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
    <div className={`space-y-6 max-w-2xl mx-auto pb-12 ${className}`}>
      {toastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-2xl bg-[color:var(--color-text)] text-white text-xs font-bold shadow-2xl animate-fadeIn border border-white/10">
          {toastMsg}
        </div>
      )}

      {/* ── 1. TOP CATEGORY SCROLL (YouTube-style Explore Pills) ────────── */}
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

      {/* ── 2. THE HERO BANNER (What's moving today) ───────────────────── */}
      <section aria-label="What's moving today">
        <BannerButton
          label="What’s moving today"
          onClick={() => { soundEngine.play('tap'); onOpenPulse?.(); }}
        />
      </section>

      {/* ── 3. YOUTUBE-STYLE HORIZONTALLY SCROLLABLE CAROUSELS ─────────── */}
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
          // Section header with title and "See all"
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

          // 1 & 2. POPULAR / MERCH LISTINGS
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

          // 3. ECONOMIC GAPS
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

          // 4. SUPPLIER & SHOP CONNECT
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

          // 5. EVENTS & TRIPS (Photo-free clean cards + recurrence badge)
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

          // 6. GROUPS & CHAMAS
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

          // 7. WHOLESALE & FREIGHT ROUTES
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
