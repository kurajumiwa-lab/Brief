import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, CalendarDays, Compass, MapPin, Plus, Search } from 'lucide-react';
import * as api from '../../api/briefApi';
import type { EventListing } from '../../api/briefApi';
import type { Campaign } from '../../api/types';
import { SessionSignIn } from '../../components/SessionSignIn';
import { MyTickets } from '../../components/MyTickets';
import { HostEventSheet } from '../city/HostEventSheet';
import { ExperiencePage } from './ExperiencePage';
import { experienceHref, isTrip, wanderlyRoute, type WanderlyRoute } from './routes';
import './wanderly.css';

const money = (n: number, c: string) => n === 0 ? 'Free' : `${c} ${n.toLocaleString('en-KE')}`;
const date = (iso: string | null) => iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date to be announced';
const openExperience = (slug: string) => { window.location.hash = experienceHref(slug); };

/** Public by default. Account-only pages use the same session and APIs as Brief. */
export function WanderlyPage({ initialSlug }: { initialSlug?: string }) {
  const readRoute = (): WanderlyRoute => wanderlyRoute(window.location.hash) ?? (initialSlug ? { page: 'experience', slug: initialSlug } : { page: 'explore' });
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const change = () => { setRoute(readRoute()); window.scrollTo?.(0, 0); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, [initialSlug]);
  const page = route.page;
  return <div className="wanderly" data-testid="wanderly">
    <header className="wl-header"><div className="wl-bar">
      <a href="#wanderly" className="wl-brand"><Compass aria-hidden="true" /><span>Wanderly<small>Parties & trips</small></span></a>
      <nav className="wl-nav" aria-label="Wanderly">
        <a href="#wanderly" aria-current={page === 'explore' || page === 'trips' || page === 'experience' ? 'page' : undefined}>Explore</a>
        <a href="#wanderly/tickets" aria-current={page === 'tickets' ? 'page' : undefined}>My tickets</a>
        <a href="#wanderly/hosting" aria-current={page === 'hosting' || page === 'host' ? 'page' : undefined}>Hosting</a>
      </nav>
      <a href="/#home" className="wl-note flex items-center gap-1"><ArrowLeft size={14} /> Brief</a>
    </div></header>
    <main className="wl-main">
      {(page === 'explore' || page === 'trips') && <Explore key={page} initialKind={page === 'trips' ? 'trips' : 'all'} />}
      {page === 'experience' && <ExperiencePage key={route.slug} slug={route.slug} onBack={() => { window.location.hash = 'wanderly'; }} />}
      {page === 'tickets' && <AccountOnly key="tickets"><MyTickets onBrowseEvents={() => { window.location.hash = 'wanderly'; }} onOpenEvent={openExperience} /></AccountOnly>}
      {page === 'host' && <AccountOnly key="host"><div className="max-w-2xl mx-auto"><HostEventSheet open embedded onClose={() => { window.location.hash = 'wanderly/hosting'; }} onPublished={(_title, slug) => { if (slug) openExperience(slug); }} /></div></AccountOnly>}
      {page === 'hosting' && <AccountOnly key="hosting"><Hosting /></AccountOnly>}
    </main>
    <footer className="wl-footer"><span>Wanderly · Made for getting together.</span><a href="/#you/how">Help</a></footer>
  </div>;
}

function AccountOnly({ children }: { children: React.ReactNode }) {
  const [access, setAccess] = useState<'loading' | 'yes' | 'no' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true, generation = 0;
    const check = () => { const current = ++generation; setAccess('loading'); void api.whoAmI().then(r => { if (live && current === generation) setAccess(r.ok ? 'yes' : r.status === 401 ? 'no' : 'error'); }).catch(() => { if (live && current === generation) setAccess('error'); }); };
    check();
    const storage = (e: StorageEvent) => { if (!e.key || e.key === 'brief_session') check(); };
    window.addEventListener('brief:session-changed', check); window.addEventListener('storage', storage);
    return () => { live = false; window.removeEventListener('brief:session-changed', check); window.removeEventListener('storage', storage); };
  }, [attempt]);
  if (access === 'loading') return <p role="status" className="wl-empty">Checking your account…</p>;
  if (access === 'error') return <p role="alert" className="wl-empty">Could not check your account. <button onClick={() => setAttempt(n => n + 1)}>Retry</button></p>;
  if (access === 'no') return <div className="max-w-md mx-auto"><SessionSignIn title="Sign in to Wanderly" onSignedIn={() => setAttempt(n => n + 1)} /></div>;
  return <>{children}</>;
}

export function Explore({ initialKind = 'all' }: { initialKind?: 'all' | 'parties' | 'trips' }) {
  const [kind, setKind] = useState(initialKind);
  const [filtersOpen, setFiltersOpen] = useState(() => typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 701px)').matches : true);
  const [filters, setFilters] = useState({ location: '', category: '', from: '', to: '' });
  const [applied, setApplied] = useState(filters);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<EventListing[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { let live = true; void api.getEventCategories().then(r => { if (live && r.ok) setCategories(r.data.labels); }); return () => { live = false; }; }, []);
  useEffect(() => {
    let live = true; setState('loading'); setError('');
    void api.browseEvents({ ...applied, limit: 100 }).then(r => {
      if (!live) return;
      if (r.ok) { setEvents(r.data.events); setTotal(r.data.total); setState('ready'); }
      else { setError(r.error || 'Experiences could not be loaded.'); setState('error'); }
    }).catch(() => { if (live) { setError('Check your connection and try again.'); setState('error'); } });
    return () => { live = false; };
  }, [applied, attempt]);
  const rows = events.filter(e => kind === 'all' || (kind === 'trips' ? isTrip(e) : !isTrip(e)));
  const clear = () => { const f = { location: '', category: '', from: '', to: '' }; setFilters(f); setApplied(f); setKind('all'); };
  return <>
    <section className="wl-hero" aria-label="Explore East Africa">
      <img src="https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?auto=format&fit=crop&w=1600&q=80" alt="" />
      <div><span className="wl-eyebrow">East Africa, together</span><h1>Good nights.<br />Great escapes.</h1><p>Find your next gathering or a few days away.</p></div>
    </section>
    <div className="wl-layout">
      <aside className="wl-filters"><details open={filtersOpen} onToggle={e => setFiltersOpen(e.currentTarget.open)}><summary>Find your next plan{applied.location ? ` · ${applied.location}` : ''}</summary><form onSubmit={e => { e.preventDefault(); setApplied({ ...filters }); }}>
        <label>Where<input aria-label="Location" placeholder="Nairobi, Diani, Kampala…" value={filters.location} onChange={e => setFilters({ ...filters, location: e.target.value })} /></label>
        <label>Category<select aria-label="Category" value={filters.category} onChange={e => setFilters({ ...filters, category: e.target.value })}><option value="">All categories</option>{Object.entries(categories).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
        <label>From<input type="date" aria-label="From date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} /></label>
        <label>To<input type="date" aria-label="To date" min={filters.from || undefined} value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} /></label>
        <button type="submit" className="wl-button w-full"><Search size={14} /> Find experiences</button>
        <button type="button" className="wl-note mt-3 w-full" onClick={clear}>Clear filters</button>
      </form></details></aside>
      <section aria-label="Published experiences">
        <div className="wl-filter-tabs" aria-label="Experience type">{(['all', 'parties', 'trips'] as const).map(k => <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{k === 'all' ? 'All plans' : k === 'parties' ? 'Parties & day plans' : 'Multi-day trips'}</button>)}<span className="wl-note ml-auto">Soonest first</span></div>
        {state === 'loading' ? <p role="status" className="wl-empty">Finding experiences…</p> : state === 'error' ? <div role="alert" className="wl-empty">{error}<button className="wl-button quiet mt-4" onClick={() => setAttempt(n => n + 1)}>Retry</button></div> : rows.length === 0 ? <div className="wl-empty"><h2 className="text-2xl mb-2">No plans here yet.</h2><p className="wl-note">Try another place or date, or host something of your own.</p><div className="flex gap-2 mt-4"><button onClick={clear} className="wl-button quiet">Clear filters</button><a href="#wanderly/host" className="wl-button">Host a plan <Plus size={14} /></a></div></div> : <div className="wl-grid">{rows.map(event => <ExperienceCard key={event.slug} event={event} />)}</div>}
        {state === 'ready' && total > events.length && <p role="status" className="wl-note mt-4">Showing the first {events.length} of {total} listings. Narrow the location or dates to find more.</p>}
        {kind === 'trips' && <p className="wl-note mt-3">Trips are published experiences lasting at least 24 hours. Check the host’s plan and inclusions before reserving.</p>}
      </section>
    </div>
    <details className="wl-places"><summary>Where to next? · East African inspiration</summary><p className="wl-note mt-2">Ideas for your search, not bookable packages.</p><div className="wl-grid">{[
      { place: 'Nairobi', label: 'City nights', text: 'Start close to home. Look for a gathering in the city.' },
      { place: 'Naivasha', label: 'A little further out', text: 'Make room for a few days away with your people.' },
      { place: 'Diani', label: 'Coastal days', text: 'Take your next plan towards the coast.' },
      { place: 'Kampala', label: 'Meet in Uganda', text: 'Find what local hosts have planned.' },
      { place: 'Arusha', label: 'Northern Tanzania', text: 'Explore host-led gatherings and multi-day plans.' },
      { place: 'Kigali', label: 'Discover Rwanda', text: 'A new city, a new plan. Browse published experiences.' },
    ].map(p => <div key={p.place} className="wl-place"><span className="wl-eyebrow">{p.label}</span><h3>{p.place}</h3><p className="wl-note">{p.text}</p><button className="wl-note mt-3 underline" onClick={() => { const f = { ...filters, location: p.place }; setFilters(f); setApplied(f); document.querySelector('[aria-label="Published experiences"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Explore {p.place} →</button></div>)}</div></details>
  </>;
}
function ExperienceCard({ event: e }: { event: EventListing }) {
  const trip = isTrip(e);
  return <article className="wl-card">
    <a href={experienceHref(e.slug)} className="wl-card-image" aria-label={`View ${e.title}`}>{e.coverImageUrl ? <img src={api.mediaFileUrl(e.coverImageUrl)} alt="" loading="lazy" /> : trip ? <Compass size={32} /> : <CalendarDays size={32} />}</a>
    <div className="wl-card-body"><span className="wl-eyebrow">{trip ? 'Multi-day trip' : e.categoryLabel}</span><h2><a href={experienceHref(e.slug)}>{e.title}</a></h2>
      <p className="wl-meta"><CalendarDays size={13} />{date(e.startsAt)}{trip ? ` – ${date(e.endsAt)}` : ''}</p>
      {e.location && <p className="wl-meta"><MapPin size={13} />{e.location}</p>}
      {e.hostName && <p className="wl-note mt-2">Hosted by {e.hostName}</p>}
      <div className="wl-card-footer"><strong>{money(e.price, e.currency)}</strong><a href={experienceHref(e.slug)} className="inline-flex gap-1 items-center">View plan <ArrowUpRight size={15} /></a></div>
    </div>
  </article>;
}
function Hosting() {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { let live = true; setState('loading'); void api.getCampaigns().then(r => { if (!live) return; if (r.ok) { setRows(r.data); setState('ready'); } else { setError(r.error); setState('error'); } }); return () => { live = false; }; }, [attempt]);
  const publish = async (row: Campaign) => { setBusy(row.id); setError(''); const r = await api.campaignAction(row.id, 'publish'); setBusy(null); if (r.ok) setRows(old => old.map(c => c.id === row.id ? r.data : c)); else setError(r.error); };
  return <section aria-label="Your hosted experiences"><div className="wl-section-head"><h1>Your plans</h1><a className="wl-button" href="#wanderly/host"><Plus size={15} /> Host a plan</a></div>
    {error && <p role="alert" className="wl-empty">{error} <button onClick={() => setAttempt(n => n + 1)}>Retry</button></p>}
    {state === 'loading' ? <p role="status">Loading your plans…</p> : state === 'ready' && rows.length === 0 ? <p className="wl-empty">Nothing hosted yet. Start with a party, gathering or trip.</p> : <ul className="space-y-3">{rows.map(c => <li className="wl-card p-4 flex justify-between gap-4 items-center" key={c.id}><div><strong>{c.title}</strong><p className="wl-note">{c.status} · {date(c.startsAt)}</p></div>{c.status === 'draft' ? <button className="wl-button" disabled={busy !== null} onClick={() => void publish(c)}>{busy === c.id ? 'Publishing…' : 'Publish draft'}</button> : ['published', 'live'].includes(c.status) ? <a className="wl-button quiet" href={experienceHref(c.publicSlug)}>View plan</a> : <span className="wl-note">Not publicly available</span>}</li>)}</ul>}
  </section>;
}
export default WanderlyPage;
