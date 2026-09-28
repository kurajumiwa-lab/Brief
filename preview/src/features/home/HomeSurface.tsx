import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Briefcase, CalendarDays, Package, Users } from 'lucide-react';
import * as api from '../../api/briefApi';
import type { DiscoverFeedItem, DiscoverSummary } from '../../api/briefApi';
import { FeedSheet } from '../city/DiscoverFeed';
import '../../ui/compact.css';

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

/** A small doorway, not a second marketplace. All activity comes from the
 * discovery projection; no demo persona, fabricated location or counters. */
export function HomeSurface({ onOpenSpace, onExploreDiscover, onOpenSpaces, onOpenGroupBuys,
  onOpenPulse, onOpenWork, className = '' }: HomeSurfaceProps) {
  const [summary, setSummary] = useState<DiscoverSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'offers' | 'events'>('all');
  const [openItem, setOpenItem] = useState<DiscoverFeedItem | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await api.getDiscoverSummary();
      if (r.ok) setSummary(r.data);
      else setError(r.error || 'Activity could not be loaded.');
    } catch { setError('Activity could not be loaded. Check your connection.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const items = (summary?.feed ?? []).filter((i) => filter === 'all' || (filter === 'events' ? i.kind === 'event' : i.kind !== 'event'));
  const openWork = () => onOpenWork ? onOpenWork() : (window.location.hash = 'workforce');

  return (
    <div className={`compact-surface ${className}`} data-testid="compact-home">
      <header className="compact-heading">
        <div><h1>Home</h1></div>

      </header>

      <nav className="compact-shortcuts" aria-label="Quick actions">
        <button type="button" onClick={() => onExploreDiscover?.('all')}><Package size={19} /><span>Discover<small>Tools, tasks & ideas</small></span><ArrowRight size={15} /></button>
        <button type="button" onClick={() => onExploreDiscover?.('events')}><CalendarDays size={19} /><span>Wanderly<small>Parties & trips</small></span><ArrowRight size={15} /></button>
        <button type="button" onClick={openWork} data-testid="home-work"><Briefcase size={19} /><span>Work<small>Home, field & hybrid</small></span><ArrowRight size={15} /></button>
      </nav>

      <section className="compact-panel" aria-label="Latest activity">
        <div className="compact-section-heading"><h2>Latest activity</h2><button type="button" onClick={() => onExploreDiscover?.('all')}>View all <ArrowRight size={14} /></button></div>
        <div className="compact-tabs" aria-label="Activity filter">
          {(['all', 'offers', 'events'] as const).map((key) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{key === 'all' ? 'All activity' : key === 'offers' ? 'Offers' : 'Events'}</button>)}
        </div>
        {loading ? <p className="compact-empty" role="status">Reading activity…</p> : error ? <p className="compact-empty" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></p> : !items.length ? <p className="compact-empty">No recent activity.</p> : (
          <ul className="compact-list">{items.slice(0, 5).map((item) => <li key={`${item.kind}-${item.id}`}>
            <button type="button" className="compact-row" onClick={() => { if (item.kind === 'event') window.location.hash = `wanderly/experience/${encodeURIComponent(item.id)}`; else setOpenItem(item); }}>
              <span className="compact-avatar">{item.mediaUrl ? <img src={api.mediaFileUrl(item.mediaUrl)} alt="" /> : item.kind === 'event' ? <CalendarDays size={18} /> : <Package size={18} />}</span>
              <span className="compact-row-text"><strong>{item.title}</strong><small>{item.kind === 'event' ? 'Event' : 'Offer'}{item.priceLabel ? ` · ${item.priceLabel}` : ''}{item.location ? ` · ${item.location}` : ''}</small></span>
              <ArrowRight size={15} />
            </button>
          </li>)}</ul>
        )}
      </section>

      <details className="compact-disclosure">
        <summary>More <span>Groups & errands</span></summary>
        <nav className="compact-more" aria-label="More to explore">
          <button type="button" onClick={() => onExploreDiscover?.('errands', true)}>Runs</button>
          <button type="button" onClick={() => onExploreDiscover?.('circles')}><Users size={16} /> Groups</button>
          <button type="button" onClick={() => onExploreDiscover?.('errands')}>Errands</button>
          <button type="button" onClick={onOpenGroupBuys}>Group buys</button>
        </nav>
      </details>
      {openItem && <FeedSheet item={openItem} onClose={() => setOpenItem(null)} onOpenFull={(item) => { if (item.kind === 'event') window.location.assign(`/c/${encodeURIComponent(item.id)}`); else window.location.hash = `offer/${encodeURIComponent(item.id)}`; }} />}

    </div>
  );
}
