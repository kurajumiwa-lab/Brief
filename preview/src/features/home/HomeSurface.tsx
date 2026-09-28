import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, Bike, Briefcase, CalendarDays, Package, Store, Users, Layers, ShoppingBag, Truck } from 'lucide-react';
import * as api from '../../api/briefApi';
import type { DiscoverFeedItem, DiscoverSummary } from '../../api/briefApi';
import { FeedSheet } from '../city/DiscoverFeed';
import '../../ui/compact.css';
import '../../ui/home.css';

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
  onOpenWork?: () => void;
  className?: string;
}

const PAGE_SIZE = 8;
type Filter = 'all' | 'offers' | 'events';

/** The summary groups offers before events. Weave the two groups so an event is
 * visible while scrolling the home feed, not buried after hundreds of offers.
 * Keep the board's order within each group; never invent a ranking or rows. */
export function homeActivity(items: DiscoverFeedItem[], filter: Filter): DiscoverFeedItem[] {
  const offers = items.filter((item) => item.kind !== 'event');
  const events = items.filter((item) => item.kind === 'event');
  if (filter === 'offers') return offers;
  if (filter === 'events') return events;
  const result: DiscoverFeedItem[] = [];
  let o = 0, e = 0;
  while (o < offers.length || e < events.length) {
    for (let n = 0; n < 2 && o < offers.length; n++) result.push(offers[o++]);
    if (e < events.length) result.push(events[e++]);
  }
  return result;
}

/** Home is a doorway into the whole network, not just a product shelf. The
 * summary is a single real projection; every category is visible even at zero. */
export function HomeSurface({ onExploreDiscover, onOpenGroupBuys, onOpenWork, className = '' }: HomeSurfaceProps) {
  const [summary, setSummary] = useState<DiscoverSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(PAGE_SIZE);
  const [openItem, setOpenItem] = useState<DiscoverFeedItem | null>(null);
  const activityRef = useRef<HTMLElement>(null);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await api.getDiscoverSummary();
      if (r.ok) setSummary(r.data);
      else { setSummary(null); setError(r.error || 'Activity could not be loaded.'); }
    } catch { setSummary(null); setError('Activity could not be loaded. Check your connection.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const items = useMemo(() => homeActivity(summary?.feed ?? [], filter), [summary, filter]);
  const categories = [
    { label: 'Offers', detail: 'Browse what’s for sale', icon: ShoppingBag, key: 'marketplace', action: () => onExploreDiscover?.('all') },
    { label: 'Events', detail: 'Gatherings & experiences', icon: CalendarDays, key: 'events', action: () => onExploreDiscover?.('events') },
    { label: 'Shops', detail: 'Meet local storefronts', icon: Store, key: 'shops', action: () => onExploreDiscover?.('shops') },
    { label: 'Groups', detail: 'Find your people', icon: Users, key: 'circles', action: () => onExploreDiscover?.('circles') },
    { label: 'Errands', detail: 'Open runs & deliveries', icon: Bike, key: 'errands', action: () => onExploreDiscover?.('errands') },
    { label: 'Work', detail: 'Find your next opportunity', icon: Briefcase, key: '', action: () => onOpenWork ? onOpenWork() : (window.location.hash = 'workforce') },
    { label: 'Runs', detail: 'Start a delivery run', icon: Truck, key: '', action: () => onExploreDiscover?.('errands', true) },
    { label: 'Supply routes', detail: 'Browse bulk supply', icon: Package, key: '', action: () => onExploreDiscover?.('bulk') },
    { label: 'Group buys', detail: 'Buy better together', icon: Layers, key: '', action: () => onOpenGroupBuys?.() }
  ] as const;
  const countFor = (key: string) => summary?.tiles?.find((tile) => tile.key === key)?.count;
  const openActivity = (item: DiscoverFeedItem) => {
    if (item.kind === 'event') window.location.hash = `wanderly/experience/${encodeURIComponent(item.id)}`;
    else setOpenItem(item);
  };

  return (
    <div className={`compact-surface home-surface ${className}`} data-testid="compact-home">
      <header className="home-hero">
        <div className="home-hero-content">
          <p className="home-eyebrow">BRIEF ON WAIRO <span aria-hidden="true">✳</span> YOUR WORLD, IN MOTION</p>
          <h1>See what’s<br /><em>happening.</em></h1>
          <p className="home-hero-copy">People, places and opportunities worth discovering. Start with what matters to you.</p>
          <div className="home-hero-actions">
            <button type="button" className="home-hero-primary" onClick={() => onExploreDiscover?.('all')}>Explore the board <ArrowRight size={17} /></button>
            <button type="button" className="home-hero-secondary" onClick={() => activityRef.current?.scrollIntoView?.({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })}>See latest activity <ArrowDown size={16} /></button>
          </div>
        </div>
        <div className="home-hero-art" aria-hidden="true"><span className="home-orbit home-orbit-one" /><span className="home-orbit home-orbit-two" /><span className="home-orbit home-orbit-three" /><span className="home-orbit-center">B<span>.</span></span></div>
      </header>

      <section className="home-explore" aria-labelledby="home-explore-title">
        <div className="home-section-intro"><div><p className="home-kicker">THE WHOLE PICTURE</p><h2 id="home-explore-title">Explore your way</h2><p>More than a marketplace. Pick a place to begin.</p></div></div>
        <nav className="home-categories" aria-label="Explore categories">
          {categories.map(({ label, detail, icon: Icon, key, action }) => (
            <button type="button" key={label} className="home-category" onClick={action} data-testid={label === 'Work' ? 'home-work' : undefined}>
              <span className="home-category-icon" aria-hidden="true"><Icon size={22} strokeWidth={1.9} /></span>
              <span className="home-category-copy"><strong>{label}</strong><small>{detail}</small></span>
              <span className="home-category-end">{countFor(key) !== undefined && <span className="home-category-count" aria-label={`${countFor(key)} ${label.toLowerCase()}`}>{countFor(key)}</span>}<ArrowRight size={17} aria-hidden="true" /></span>
            </button>
          ))}
        </nav>
      </section>

      <aside className="home-lunch-callout" aria-label="Workday lunch concept">
        <span className="home-lunch-icon" aria-hidden="true">🍲</span>
        <span><strong>Lunch break, sorted?</strong><small>Explore CloudBites, a delivery-only kitchen concept for workdays and riders. Preview only; no orders yet.</small></span>
        <a href="/cloudbites">Explore CloudBites <ArrowRight size={16} /></a>
      </aside>

      <section className="home-activity" aria-label="Latest activity" ref={activityRef} id="home-activity">
        <div className="home-section-intro home-activity-heading">
          <div><p className="home-kicker">FROM THE BOARD</p><h2>Latest activity</h2><p>New offers and upcoming events from the board. Explore the categories above for more.</p></div>
          <button type="button" className="home-view-all" onClick={() => onExploreDiscover?.('all')}>Explore all <ArrowRight size={16} /></button>
        </div>
        <div className="home-filters" role="group" aria-label="Activity filter">
          {(['all', 'offers', 'events'] as const).map((key) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setShown(PAGE_SIZE); }}>{key === 'all' ? 'Offers & events' : key === 'offers' ? 'Offers' : 'Events'}</button>)}
        </div>
        {loading ? <p className="home-activity-state" role="status">Reading the board…</p> : error ? <p className="home-activity-state" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></p> : !items.length ? <p className="home-activity-state">{filter === 'events' ? 'No events on the board yet.' : filter === 'offers' ? 'No offers on the board yet.' : 'No recent activity on the board yet.'} <button type="button" onClick={() => onExploreDiscover?.('all')}>Explore the board</button></p> : (
          <>
            <div className="home-feed" data-testid="home-feed">
              {items.slice(0, shown).map((item) => (
                <button type="button" className="home-feed-card" key={`${item.kind}:${item.id}`} onClick={() => openActivity(item)} data-testid="home-feed-card" aria-label={`Open ${item.kind === 'event' ? 'event' : 'offer'}: ${item.title}`}>
                  <span className={`home-feed-media home-feed-media--${item.kind}`}>
                    {item.mediaUrl ? <img src={api.mediaFileUrl(item.mediaUrl)} alt="" loading="lazy" /> : <span className="home-feed-placeholder" aria-hidden="true">{item.kind === 'event' ? <CalendarDays size={32} /> : <Package size={32} />}</span>}
                    <span className="home-feed-badge">{item.kind === 'event' ? 'EVENT' : 'OFFER'}</span>
                  </span>
                  <span className="home-feed-content">
                    <span className="home-feed-title">{item.title}</span>
                    <span className="home-feed-meta">{[item.seller, item.location, item.dateLabel].filter(Boolean).join(' · ') || (item.kind === 'event' ? 'Event' : 'Offer')}</span>
                    <span className="home-feed-bottom"><span>{item.priceLabel ?? (item.kind === 'event' ? 'Event details' : 'Price not stated')}</span><ArrowRight size={17} aria-hidden="true" /></span>
                  </span>
                </button>
              ))}
            </div>
            {shown < items.length && <button type="button" className="home-load-more" onClick={() => setShown((n) => n + PAGE_SIZE)}>Show more activity <ArrowDown size={16} /><span className="home-load-count">{Math.min(shown, items.length)} of {items.length}</span></button>}
          </>
        )}
      </section>
      {openItem && <FeedSheet item={openItem} onClose={() => setOpenItem(null)} onOpenFull={(item) => { if (item.kind === 'event') window.location.assign(`/c/${encodeURIComponent(item.id)}`); else window.location.hash = `offer/${encodeURIComponent(item.id)}`; }} />}
    </div>
  );
}
