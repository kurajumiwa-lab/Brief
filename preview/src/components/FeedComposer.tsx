import React from 'react';
import {
  Heart, CalendarDays, Megaphone, Tag, Store, MapPin, Newspaper,
  Briefcase, Sparkles, Wrench, Package, BookOpen, Info
} from 'lucide-react';
import * as briefApi from '../api/briefApi';
import { WireSection } from './WireSection';
import { StandaloneBanner } from './StandaloneBanner';
import { PHOTO_SCRIM, PLASTER } from "../features/city/room";

// ---------------------------------------------------------------------------
// HOME FEED
//
// The home surface is intentionally quiet: real photography does the work,
// and every item is represented by its title. No teaser copy, counts or
// invented metadata compete with the things people came to find.
// ---------------------------------------------------------------------------

type FeedObject = any;

interface FeedComposerProps {
  onOpen: (obj: FeedObject) => void;
  onOpenTea: (slug: string) => void;
  onOpenTag?: (tag: string) => void;
  typeFilter?: string;
  onFeedStatus?: (status: 'loading' | 'ready' | 'unavailable') => void;
  /** A named locality the feed is scoped to (never invented). */
  area?: string | null;
  /** A geo point the feed is scoped to. */
  geo?: { lat: number; lng: number; radiusKm?: number } | null;
  /** A content-type category the feed is scoped to (server-side browse). */
  type?: string | null;
  /** Preloaded feed data — when present the component does not fetch. */
  feed?: FeedData | null;
  /** Explore mode: one uniform grid of everything, no hero or sections. */
  browse?: boolean;
}

interface FeedData {
  hero: FeedObject[];
  discovery: FeedObject[];
  opportunities: FeedObject[];
  more: FeedObject[];
  tea: any | null;
  moreTea: any[];
  counts: { objects: number; tea: number; deduped: number };
  _meta?: { generatedAt?: string; apiVersion?: string } | null;
  _mediaProvider?: { configured?: boolean } | null;
}

const T = {
  bg: 'var(--color-well)',
  surface: 'var(--color-paper)',
  line: 'var(--brief-line)',
  ink: '#0D1117',
  muted: 'rgba(10, 14, 20,0.62)',
  green: '#40916C'  /* legacy name: the accent, used for the selected-collection border */
};

// ---------------------------------------------------------------------------
// CARD INTELLIGENCE — the WHAT / WHERE / WHEN / WHY / SOURCE on every card,
// derived only from the safe public fields the feed endpoint exposes.
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<string, string> = {
  event: 'Event',
  experience: 'Event',
  business: 'Business',
  offer: 'Offer',
  alert: 'Alert',
  announcement: 'Notice',
  news: 'News',
  place: 'Place',
  opportunity: 'Opportunity',
  service: 'Service',
  product: 'Product',
  knowledge: 'Guide'
};

function typeLabel(item: FeedObject): string | null {
  return TYPE_LABELS[String(item?.type ?? '')] ?? null;
}

// §8/§9 — the trust state, rendered as one honest word on the card, with a
// DISTINCT tone per tier (§9). The server's lifecycle is unverified →
// source_confirmed → cross_source_confirmed → community_confirmed. Only the
// corroborated tiers read as "verified"; a single source is muted, never
// dressed up. Nothing here is invented — the string comes straight off the
// projected row.
function trustBadge(item: FeedObject): { label: string; tone: 'muted' | 'cyan' | 'green' } | null {
  const status = String(item?.verificationStatus ?? '');
  if (status === 'community_confirmed') return { label: 'Community confirmed', tone: 'green' };
  if (status === 'cross_source_confirmed' || status === 'verified') return { label: 'Verified', tone: 'cyan' };
  if (status === 'source_confirmed') return { label: 'Source confirmed', tone: 'muted' };
  return null;
}

function shortDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, tomorrow)) return 'Tomorrow';
  return date.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' });
}

function timeOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit' });
}

/** A short WHEN line from the safe temporal projection (never invented). */
function whenLabel(item: FeedObject): string | null {
  const t = item?.temporal;
  if (!t || typeof t !== 'object') return null;
  const day = (v: unknown) => shortDate(v);
  const time = (v: unknown) => timeOf(v);

  if (t.status === 'happening') return 'Happening now';
  if (t.status === 'upcoming') {
    const start = day(t.startsAt);
    const parsed = typeof t.startsAt === 'string' ? new Date(t.startsAt) : null;
    const hasClock = parsed && Number.isFinite(parsed.getTime()) && !(parsed.getHours() === 0 && parsed.getMinutes() === 0);
    if (start && hasClock) return `${start} ${time(t.startsAt)}`;
    if (start) return start;
    return 'Upcoming';
  }
  if (t.status === 'past') {
    const start = day(t.startsAt);
    return start ? `Ended ${start}` : 'Ended';
  }
  if (t.status === 'recurring') return 'Recurring';
  if (t.status === 'undated') {
    if (typeof t.dayOfWeek === 'string') {
      return t.dayOfWeek.charAt(0).toUpperCase() + t.dayOfWeek.slice(1);
    }
    return null;
  }
  if (t.status === 'active') {
    const dl = day(t.deadlineAt);
    return dl ? `Ends ${dl}` : 'Ongoing';
  }
  if (t.status === 'no_deadline') return 'Ongoing';
  if (t.status === 'expired') {
    const dl = day(t.deadlineAt);
    return dl ? `Ended ${dl}` : 'Expired';
  }
  if (t.status === 'current') {
    // Fresh news/announcements get a gentle age readout from their timestamp.
    const created = item?.createdAt;
    if (typeof created === 'string' && typeLabel(item) === 'News') {
      const ageMs = Date.now() - Date.parse(created);
      if (Number.isFinite(ageMs) && ageMs > 0 && ageMs < 86400000) {
        const hours = Math.max(1, Math.round(ageMs / 3600000));
        return hours < 1 ? 'Just now' : `${hours}h ago`;
      }
    }
    return null;
  }
  return null;
}

/** A one-line WHY it matters, when the safe fields justify one. */
function whyLabel(item: FeedObject): string | null {
  if (item?.type === 'alert') return 'Alert';
  const t = item?.temporal;
  if (t?.status === 'happening') return 'Live now';
  if (t?.status === 'active' && typeof t.deadlineAt === 'string') {
    const ms = Date.parse(t.deadlineAt) - Date.now();
    if (Number.isFinite(ms) && ms > 0 && ms < 3 * 86400000) return 'Ending soon';
  }
  if (t?.status === 'upcoming' && typeof t.startsAt === 'string') {
    const ms = Date.parse(t.startsAt) - Date.now();
    if (Number.isFinite(ms) && ms > 0 && ms < 86400000) return 'Tomorrow';
  }
  if (item?.verificationStatus === 'community_confirmed' || item?.verificationStatus === 'cross_source_confirmed') {
    return 'Confirmed';
  }
  return null;
}

function whereLabel(item: FeedObject): string | null {
  const name = String(item?.locationName ?? '').trim();
  if (name) return name;
  const area = String(item?.metadata?.area ?? '').trim();
  const county = String(item?.metadata?.county ?? '').trim();
  if (area && county) return `${area}, ${county}`;
  return area || county || null;
}

/** Distance readout when the feed is geo-scoped. Real data only — the field
 *  is absent unless the server actually computed a distance. */
function distanceLabel(item: FeedObject): string | null {
  const raw = item?.metadata?.distanceKm ?? item?.distanceKm;
  if (raw === undefined || raw === null || raw === '') return null;
  const d = Number(raw);
  if (!Number.isFinite(d)) return null;
  if (d < 0.1) return 'Right here';
  if (d < 1) return `${Math.round(d * 1000)} m away`;
  return `${d} km away`;
}

/** §8 — the type-specific fact line. Events show attendance (or capacity),
 *  opportunities show the value and who is offering it. Only REAL projected
 *  fields; renders nothing when the data does not carry them. */
function factLine(item: FeedObject): string | null {
  const m = item?.metadata ?? {};
  const type = String(item?.type ?? '');
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  if (type === 'experience' || type === 'event') {
    const going = num(m.attendeesCount);
    const spots = num(m.capacity);
    const bits = [going !== null ? `${going} going` : null, spots !== null ? `${spots} spots` : null].filter(Boolean);
    return bits.length ? bits.join(' · ') : null;
  }
  if (type === 'opportunity') {
    const price = num(m.price);
    const value = price !== null ? `${m.currency || 'KES'} ${price.toLocaleString()}` : null;
    const by = typeof m.organizer === 'string' && m.organizer.trim() ? `by ${m.organizer.trim()}` : null;
    const bits = [value, by].filter(Boolean);
    return bits.length ? bits.join(' · ') : null;
  }
  return null;
}

function sourceLabel(item: FeedObject): string | null {
  const names = Array.isArray(item?.sourceNames) ? item.sourceNames.filter((s: unknown) => typeof s === 'string') : [];
  const count = typeof item?.sourceCount === 'number' ? item.sourceCount : names.length;
  if (!names.length && !count) return null;
  if (names.length >= 1) {
    const extra = count > names.length ? ` +${count - names.length}` : '';
    return `${names[0]}${extra}`;
  }
  return `${count} ${count === 1 ? 'source' : 'sources'}`;
}

function feedUpdatedAt(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit' });
}

function testExpiryLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
}

function imageOf(item: FeedObject): string | null {
  return item?.media?.url ?? item?.imageUrl ?? item?.heroImage ?? null;
}

function titleOf(item: FeedObject): string {
  return String(item?.title ?? '').trim();
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 px-1 text-[12px] font-bold uppercase tracking-[0.22em]" style={{ color: T.muted }}>
      {children}
    </h2>
  );
}

function PhotoTitleCard({
  item,
  onOpen,
  className = ''
}: {
  item: FeedObject;
  onOpen: (obj: FeedObject) => void;
  className?: string;
}) {
  const [imgFailed, setImgFailed] = React.useState(false);
  const image = imgFailed ? null : imageOf(item);
  const title = titleOf(item);
  const type = typeLabel(item);
  const when = whenLabel(item);
  const where = whereLabel(item);
  const dist = distanceLabel(item);
  const why = whyLabel(item);
  const source = sourceLabel(item);
  const isAlert = item?.type === 'alert';
  const meta = [when, where, dist].filter(Boolean).join(' · ');

  // A strong, type-specific glyph when a real photo does not exist — the
  // type IS the visual. Never a grey box, never a fabricated image.
  const TypeGlyph = item?.type === 'alert' ? Megaphone
    : item?.type === 'experience' || item?.type === 'event' ? CalendarDays
      : item?.type === 'offer' ? Tag
        : item?.type === 'place' ? MapPin
          : item?.type === 'news' ? Newspaper
            : item?.type === 'business' || item?.type === 'service' ? Store
              : item?.type === 'opportunity' ? Briefcase
                : item?.type === 'announcement' ? Megaphone
                  : item?.type === 'product' ? Package
                    : item?.type === 'knowledge' ? BookOpen
                      : Sparkles;
  const glyphTint = isAlert ? '#DC2626' : '#0891B2';

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={`${title}${when ? `, ${when}` : ''}${where ? `, ${where}` : ''}`}
      className={`group relative block min-h-[190px] overflow-hidden rounded-2xl border text-left transition-transform duration-200 hover:-translate-y-0.5 hover:border-[#0891B2] active:scale-[0.99] ${className}`}
      style={{ borderColor: T.line, background: T.surface }}
    >
      {image ? (
        <img
          src={image}
          alt=""
          aria-hidden="true"
          loading="lazy"
          onError={() => setImgFailed(true)}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
      ) : (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: isAlert
            ? 'linear-gradient(135deg, #F0F2F5 0%, #F0F2F5 100%)'
            : `linear-gradient(135deg, ${T.surface} 0%, ${T.bg} 100%)` }}
        >
          <TypeGlyph
            className="h-10 w-10 opacity-40"
            style={{ color: glyphTint }}
            aria-hidden="true"
            strokeWidth={1.6}
          />
        </div>
      )}
      {image && (
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, rgba(9,11,16,0.04) 22%, rgba(9,11,16,0.82) 100%)' }}
        />
      )}
      {/* WHAT + WHY: type chip and urgency chip, top corners. */}
      {type && (
        <span
          className="absolute left-3 top-3 rounded-full px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.12em]"
          style={image
            ? { background: 'rgba(9,11,16,0.66)', color: 'var(--color-paper)' }
            : { background: 'rgba(10, 14, 20,0.08)', color: T.ink }}
        >
          {type}
        </span>
      )}
      {/* §8/§9 — the trust badge, with a distinct tone per tier. Only the
          corroborated tiers show; a single source is muted, community is
          green, cross-source is cyan. */}
      {trustBadge(item) && (() => {
        const b = trustBadge(item)!;
        const glyph = b.tone === 'green' ? '✓' : b.tone === 'cyan' ? '●' : '◉';
        const bg = b.tone === 'green' ? '#059669' : b.tone === 'cyan' ? '#0891B2' : 'rgba(10, 14, 20,0.14)';
        const fg = b.tone === 'muted' ? '#0D1117' : 'var(--color-paper)';
        return (
          <span
            className="absolute left-3 top-9 rounded-full px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.12em]"
            style={{ background: bg, color: fg }}
          >
            {glyph} {b.label}
          </span>
        );
      })()}
      {why && (
        <span
          className="absolute right-3 top-3 rounded-full px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.12em]"
          style={isAlert
            ? { background: image ? 'rgba(255, 93, 108,0.92)' : 'rgba(255, 93, 108,0.12)', color: image ? 'var(--color-paper)' : '#DC2626' }
            : { background: image ? 'rgba(9,11,16,0.66)' : 'rgba(10, 14, 20,0.08)', color: image ? 'var(--color-paper)' : T.ink }}
        >
          {why}
        </span>
      )}
      {/* WHEN · WHERE above the title, SOURCE below it. */}
      <div className="absolute inset-x-4 bottom-4">
        {meta && (
          <p
            className="mb-1 line-clamp-1 text-[11px] font-semibold tracking-wide"
            style={{ color: image ? 'rgba(255,255,255,0.85)' : T.muted }}
          >
            {meta}
          </p>
        )}
        <h3 className="line-clamp-3 text-[15px] font-semibold leading-snug" style={{ color: image ? 'var(--color-paper)' : T.ink }}>
          {title}
        </h3>
        {factLine(item) && (
          <p
            className="mt-1 line-clamp-1 text-[11px] font-semibold"
            style={{ color: image ? 'rgba(255,255,255,0.85)' : T.muted }}
          >
            {factLine(item)}
          </p>
        )}
        {source && (
          <p
            className="mt-1 line-clamp-1 text-[11px] font-semibold uppercase tracking-[0.1em]"
            style={{ color: image ? 'rgba(255,255,255,0.6)' : T.muted }}
          >
            {source}
          </p>
        )}
      </div>
    </button>
  );
}

function TitleRow({
  item,
  onOpen,
  image = true
}: {
  item: FeedObject;
  onOpen: (obj: FeedObject) => void;
  image?: boolean;
}) {
  const thumb = imageOf(item);
  const title = titleOf(item);
  const type = typeLabel(item);
  const when = whenLabel(item);
  const where = whereLabel(item);
  const dist = distanceLabel(item);
  const source = sourceLabel(item);
  const meta = [type, when, where, dist].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={`${title}${when ? `, ${when}` : ''}${where ? `, ${where}` : ''}`}
      className="group flex min-h-16 w-full items-center gap-3 rounded-2xl border p-2 text-left transition-colors hover:border-[#0891B2]"
      style={{ borderColor: T.line, background: T.surface }}
    >
      {image && thumb && (
        <img src={thumb} alt="" aria-hidden="true" loading="lazy" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
      )}
      <span className="min-w-0 flex-1 px-1">
        <h3 className="truncate text-[15px] font-semibold" style={{ color: T.ink }}>
          {title}
        </h3>
        {meta && (
          <p className="mt-0.5 truncate text-[11px] font-semibold" style={{ color: T.muted }}>
            {meta}
          </p>
        )}
        {source && (
          <p className="mt-0.5 truncate text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: T.muted }}>
            {source}
          </p>
        )}
      </span>
    </button>
  );
}

export function FeedComposer({ onOpen, onOpenTea, onOpenTag, typeFilter = 'all', onFeedStatus, area, geo, type, feed: preloadedFeed, browse = false }: FeedComposerProps) {
  const [state, setState] = React.useState<{
    status: 'loading' | 'ready';
    feed: FeedData | null;
  }>({ status: 'loading', feed: null });
  const [collections, setCollections] = React.useState<any[]>([]);
  const [banners, setBanners] = React.useState<any[]>([]);
  const [openCollection, setOpenCollection] = React.useState<{
    key: string;
    title: string;
    status: 'loading' | 'ready' | 'error';
    objects: FeedObject[];
    error: string | null;
  } | null>(null);

  const openCollectionByKey = async (collection: { key?: string; id?: string; title?: string }) => {
    const key = String(collection.key || collection.id || '');
    if (!key) return;
    setOpenCollection({ key, title: collection.title || key, status: 'loading', objects: [], error: null });
    const res = await briefApi.getCollection(key);
    if (!res.ok) {
      setOpenCollection({
        key,
        title: collection.title || key,
        status: 'error',
        objects: [],
        error: res.error || 'Collection unavailable.'
      });
      return;
    }
    setOpenCollection({
      key,
      title: res.data?.title || collection.title || key,
      status: 'ready',
      objects: Array.isArray(res.data?.objects) ? res.data.objects : [],
      error: null
    });
  };

  React.useEffect(() => {
    // A preloaded feed (parent already fetched for this exact scope) is
    // authoritative — the component renders it without a second request.
    if (preloadedFeed) {
      setState({ status: 'ready', feed: preloadedFeed });
      onFeedStatus?.('ready');
      return;
    }
    let live = true;
    onFeedStatus?.('loading');
    (async () => {
      const [feedRes, collectionRes, bannerRes] = await Promise.all([
        briefApi.getFeed({
          ...(geo ? { lat: geo.lat, lng: geo.lng, radiusKm: geo.radiusKm } : {}),
          ...(area ? { area } : {}),
          ...(type ? { type } : {})
        }),
        briefApi.getCollections(),
        briefApi.getCampaignBanners()
      ]);
      if (!live) return;
      setState({ status: 'ready', feed: feedRes.ok ? feedRes.data as FeedData : null });
      onFeedStatus?.(feedRes.ok ? 'ready' : 'unavailable');
      if (collectionRes.ok) setCollections(collectionRes.data as any[]);
      if (bannerRes.ok) setBanners(bannerRes.data as any[]);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onFeedStatus, area, geo?.lat, geo?.lng, geo?.radiusKm, type, preloadedFeed]);

  if (state.status === 'loading') {
    return (
      <div className="space-y-3 animate-pulse" aria-label="Loading">
        <div className="h-64 rounded-2xl" style={{ background: T.surface }} />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-40 rounded-2xl" style={{ background: T.surface }} />
          <div className="h-40 rounded-2xl" style={{ background: T.surface }} />
        </div>
      </div>
    );
  }

  const feed = state.feed;
  if (!feed) {
    return (
      <div
        className="mx-1 rounded-2xl p-6 text-center shadow-sm"
        style={{ background: T.surface }}
      >
        <p className="text-xs" style={{ color: T.muted }}>
          No updates for this shelf.
        </p>
      </div>
    );
  }

  const all = [...(feed.hero ?? []), ...(feed.discovery ?? []), ...(feed.opportunities ?? []), ...(feed.more ?? [])];
  const unique = Array.from(new Map(all.filter((item) => item?.id).map((item) => [item.id, item])).values());
  // When the parent scoped the feed server-side (a category tab), the rows are
  // already that category — the legacy client-side filter only applies to the
  // unsorted Home mix.
  const scoped = type ? unique : (typeFilter === 'all' ? unique : unique.filter((item) => item.type === typeFilter));
  const hero = scoped[0] ?? null;
  const withoutHero = scoped.filter((item) => item.id !== hero?.id);
  const discovery = withoutHero.filter((item) => item.type !== 'experience' && item.type !== 'opportunity');
  const opportunities = withoutHero.filter((item) => item.type === 'opportunity');
  const events = withoutHero.filter((item) => item.type === 'experience');
  const tags = [...new Set([
    ...unique.map((item) => item.category).filter(Boolean),
    ...(feed.tea?.tags ?? [])
  ])].slice(0, 8);

  const hasContent = Boolean(hero || feed.tea || discovery.length || opportunities.length || events.length || collections.length || banners.length || tags.length);
  const temporary = [...unique, feed.tea].find((item) => item?.testContent);
  const temporaryExpiry = testExpiryLabel(temporary?.testContent?.expiresAt);
  if (!hasContent) {
    // Honest emptiness, scoped to what the person actually asked for: the
    // filter, the place, the category. Never invent rows to fill the space
    // (the no-fake-live-data rule).
    const EmptyIcon = type === 'offer' || type === 'opportunity' ? Tag
      : type === 'place' ? MapPin
        : type === 'experience' || type === 'event' ? CalendarDays
          : type === 'alert' ? Megaphone
            : Info;
    const EmptyTitle = type
      ? `No ${TYPE_LABELS[type]?.toLowerCase() ?? 'items'} in ${area ?? 'this area'} yet`
      : area
        ? `Nothing new in ${area} yet`
        : 'Nothing here yet';
    const EmptyBody = area
      ? 'When people around here publish events, offers, gigs, and community runs, they will appear in this feed. Nothing is hidden — there is simply no real data for this place yet.'
      : type
        ? `This category only shows real published content. When the first ${TYPE_LABELS[type]?.toLowerCase() ?? 'item'} arrives in ${area ?? 'this area'}, it will appear here.`
        : 'This feed fills with what people publish around you: events, offers, gigs, places and alerts. It is empty because nothing has been published yet — not because something failed.';
    return (
      <section
        aria-label={`No ${type ?? 'content'} in ${area ?? 'this area'}`}
        className="mx-1 rounded-2xl p-6 text-center shadow-sm"
        style={{ background: T.surface }}
      >
        <EmptyIcon className="mx-auto h-7 w-7" style={{ color: T.muted }} aria-hidden="true" />
        <h2 className="mt-3 text-base font-bold" style={{ color: T.ink }}>{EmptyTitle}</h2>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed" style={{ color: T.muted }}>
          {EmptyBody}
        </p>
        {(area || geo) && (
          <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: T.muted }}>
            Try another location
          </p>
        )}
      </section>
    );
  }

  const updatedAt = feedUpdatedAt(feed._meta?.generatedAt);

  return (
    <div className="space-y-8" style={{ fontFamily: 'var(--m3-font-body)', color: T.ink }}>
      {temporary && (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-dashed border-[var(--brief-line)] bg-[color:var(--color-paper)] px-3 py-2.5">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--brief-ink)]">{temporary.testContent.label}</p>
            <p className="mt-1 text-[11px] leading-snug text-[var(--ink-55)]">Temporary welcome content for release testing. It will leave the public feed at the expiry above and will not be silently reseeded.</p>
          </div>
          <span className="shrink-0 text-right text-[11px] font-bold text-[var(--ink-60)]">{temporaryExpiry ? `until ${temporaryExpiry}` : 'temporary'}</span>
        </div>
      )}
      {updatedAt && (
        <p className="px-1 text-[11px] text-[var(--ink-60)]">
          Live Brief feed · refreshed {updatedAt}
        </p>
      )}
      {/* Explore: the whole catalog in one uniform grid. No hero, no section
          splits — browse is browse. */}
      {browse && scoped.length > 0 && (
        <section>
          <SectionTitle>Explore</SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {scoped.slice(0, 24).map((item) => (
              <PhotoTitleCard key={item.id} item={item} onOpen={onOpen} className="min-h-[170px] sm:min-h-[210px]" />
            ))}
          </div>
        </section>
      )}

      {/* A single visual lead. */}
      {!browse && hero && (
        <PhotoTitleCard
          item={hero}
          onOpen={onOpen}
          className="min-h-[290px] sm:min-h-[380px]"
        />
      )}

      {!browse && banners.length > 0 && (
        <section>
          <SectionTitle>Featured</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {banners.slice(0, 4).map((banner) => (
              <StandaloneBanner key={banner.id} banner={banner} />
            ))}
          </div>
        </section>
      )}

      {!browse && feed.tea && (
        <section>
          <SectionTitle>Stories</SectionTitle>
          <button
            type="button"
            onClick={() => onOpenTea(feed.tea.slug)}
            aria-label={titleOf(feed.tea)}
            className="group relative block min-h-[190px] w-full overflow-hidden rounded-2xl border text-left transition-transform duration-200 hover:-translate-y-0.5 hover:border-[#0891B2]"
            style={{ borderColor: T.line, background: T.surface }}
          >
            {imageOf(feed.tea) ? (
              <img
                src={imageOf(feed.tea) as string}
                alt=""
                aria-hidden="true"
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              />
            ) : (
              <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${T.surface}, ${T.bg})` }} />
            )}
            {imageOf(feed.tea) && (
              <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(9,11,16,0.04) 20%, rgba(9,11,16,0.86) 100%)' }} />
            )}
            <h3 className="absolute inset-x-4 bottom-4 line-clamp-3 text-[32px] font-semibold leading-snug" style={{ color: imageOf(feed.tea) ? 'var(--color-paper)' : T.ink }}>
              {titleOf(feed.tea)}
            </h3>
            {/* The public rating, on the front page: the real derived count. */}
            {typeof (feed.tea as any).likeCount === 'number' && (feed.tea as any).likeCount > 0 && (
              <span
                className="absolute right-3 top-3 flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold"
                style={{ background: 'rgba(9,11,16,0.75)', color: 'var(--color-paper)' }}
              >
                <Heart className="h-3 w-3" style={{ fill: 'var(--color-paper)', stroke: 'var(--color-paper)' }} />
                {(feed.tea as any).likeCount}
              </span>
            )}
          </button>
        </section>
      )}

      {!browse && type && withoutHero.length > 0 && (
        <section>
          <SectionTitle>{TYPE_LABELS[type] ?? 'Latest'}</SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {withoutHero.slice(0, 12).map((item) => (
              <PhotoTitleCard key={item.id} item={item} onOpen={onOpen} className="min-h-[190px] sm:min-h-[220px]" />
            ))}
          </div>
        </section>
      )}

      {!type && discovery.length > 0 && (
        <section>
          <SectionTitle>Nearby</SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {discovery.slice(0, 6).map((item) => (
              <PhotoTitleCard key={item.id} item={item} onOpen={onOpen} className="min-h-[190px] sm:min-h-[220px]" />
            ))}
          </div>
        </section>
      )}

      {!type && opportunities.length > 0 && (
        <section>
          <SectionTitle>Offers</SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {opportunities.slice(0, 6).map((item) => (
              <PhotoTitleCard key={item.id} item={item} onOpen={onOpen} className="min-h-[180px] sm:min-h-[220px]" />
            ))}
          </div>
        </section>
      )}

      {!type && events.length > 0 && (
        <section>
          <SectionTitle>Upcoming</SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {events.slice(0, 6).map((item) => (
              <PhotoTitleCard key={item.id} item={item} onOpen={onOpen} className="min-h-[180px] sm:min-h-[220px]" />
            ))}
          </div>
        </section>
      )}

      {collections.length > 0 && (
        <section>
          <SectionTitle>Collections</SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {collections.map((collection) => {
              const image = imageOf(collection);
              const title = titleOf(collection);
              return (
                <button
                  key={collection.id || collection.key}
                  type="button"
                  onClick={() => void openCollectionByKey(collection)}
                  aria-label={title}
                  className="group relative min-h-28 overflow-hidden rounded-2xl border-0 p-3 text-left transition-colors shadow-sm"
                  style={{ background: T.surface }}
                >
                  {image && <img src={image} alt="" aria-hidden="true" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-60 transition-transform duration-500 group-hover:scale-[1.03]" />}
                  <div className="absolute inset-0" style={{ background: image ? PHOTO_SCRIM : PLASTER }} />
                  <span className="relative block line-clamp-3 text-[15px] font-semibold" style={{ color: image ? 'var(--color-paper)' : T.ink }}>{title}</span>
                </button>
              );
            })}
          </div>
          {openCollection && (
            <div className="mt-3 space-y-2">
              {openCollection.status === 'loading' && <div className="h-14 animate-pulse rounded-2xl" style={{ background: T.surface }} />}
              {openCollection.status === 'error' && <TitleRow item={{ id: 'collection-error', title: openCollection.error }} onOpen={() => undefined} image={false} />}
              {openCollection.status === 'ready' && openCollection.objects.map((item) => (
                <TitleRow key={item.id} item={item} onOpen={onOpen} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default FeedComposer;
