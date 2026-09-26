// ---------------------------------------------------------------------------
// LOCATION PAGE — the public discovery page for a place (/explore/kilimani).
//
// Everything here is derived from REAL persisted objects: the "What's
// happening here" counts are the actual live lists (never fabricated), every
// section renders only when it has content, expired content is never shown as
// active (the server gates it), and nearby appears only when genuine
// coordinates exist. Unknown locations get an honest not-found state — never
// a generic empty page.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import {
  ArrowLeft, Building2, CalendarDays, Check, Clock, Flame, Globe2,
  MapPin, Megaphone, Newspaper, Plus, ShoppingBag, Users, X
} from 'lucide-react';
import * as briefApi from '../api/briefApi';
import type { GraphObject, LocationPage as LocationPageData } from '../api/briefApi';
import { explorePath } from '../nav/routes';

const KIND_LABEL: Record<string, string> = { area: 'Area', county: 'County', landmark: 'Landmark' };

function temporalLine(o: GraphObject): string | null {
  const t = o.temporal;
  if (!t) return null;
  if ((t.status === 'upcoming' || t.status === 'happening') && typeof t.startsAt === 'string') {
    const d = new Date(t.startsAt);
    if (Number.isFinite(d.getTime())) {
      return `On ${d.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit' })}`;
    }
    return 'Upcoming';
  }
  if (t.status === 'active' && typeof t.deadlineAt === 'string') {
    const d = new Date(t.deadlineAt);
    if (Number.isFinite(d.getTime())) return `Closes ${d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}`;
    return 'Active';
  }
  if (t.status === 'happening') return 'Happening now';
  return null;
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  event: <CalendarDays className="h-3.5 w-3.5" />,
  offer: <ShoppingBag className="h-3.5 w-3.5" />,
  business: <Building2 className="h-3.5 w-3.5" />,
  place: <MapPin className="h-3.5 w-3.5" />,
  news: <Newspaper className="h-3.5 w-3.5" />,
  announcement: <Megaphone className="h-3.5 w-3.5" />
};

function GraphCard({ object, onOpenObject }: { object: GraphObject; onOpenObject: (o: GraphObject) => void }) {
  const image = object.imageUrl ?? object.media?.url ?? object.gallery?.[0]?.url ?? null;
  const line = temporalLine(object);
  return (
    <button
      type="button"
      onClick={() => onOpenObject(object)}
      className="group flex w-full items-stretch gap-2.5 rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-2 text-left shadow-sm transition-transform hover:-translate-y-0.5 hover:border-[#0891B2]"
    >
      {image ? (
        <img src={image} alt="" aria-hidden="true" loading="lazy" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
      ) : (
        <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-xl bg-gradient-to-br from-[#EFF1F4] to-[var(--brief-line)] text-[#5A6472]">
          {TYPE_ICON[object.type] ?? <Flame className="h-3.5 w-3.5" />}
          <span className="text-[11px] font-bold uppercase tracking-wider">{object.type.slice(0, 8)}</span>
        </div>
      )}
      <div className="min-w-0 py-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#0891B2]">{object.type}</span>
          {line && <span className="text-[11px] font-semibold text-[var(--ink-60)]">{line}</span>}
          {typeof object.distanceKm === 'number' && (
            <span className="rounded-full bg-[color:var(--color-well)] px-1.5 py-0.5 text-[11px] font-bold text-[#40916C]">
              {object.distanceKm < 1 ? '<1 km' : `${object.distanceKm} km`}
            </span>
          )}
        </div>
        <h4 className="mt-0.5 line-clamp-2 text-[13px] font-semibold leading-snug text-[var(--brief-ink)] group-hover:text-[#40916C]">
          {object.title}
        </h4>
        {(object.area || object.county || object.locationName) && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] font-semibold text-[var(--ink-55)]">
            <MapPin className="h-2.5 w-2.5" /> {object.locationName ?? [object.area, object.county].filter(Boolean).join(', ')}
          </p>
        )}
      </div>
    </button>
  );
}

function Section({ title, icon, objects, onOpenObject }: {
  title: string; icon?: React.ReactNode; objects: GraphObject[]; onOpenObject: (o: GraphObject) => void;
}) {
  if (!objects || objects.length === 0) return null;
  return (
    <section aria-label={title} className="mb-5">
      <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-extrabold uppercase tracking-[0.14em] text-[var(--brief-ink)]">
        {icon}{title}
        <span className="text-[var(--ink-60)]">· {objects.length}</span>
      </h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {objects.slice(0, 8).map((o) => (
          <GraphCard key={o.id} object={o} onOpenObject={onOpenObject} />
        ))}
      </div>
    </section>
  );
}

export function LocationPage({ name, authed, followedLocations, onClose, onOpenObject, onOpenLocation, onRequireAuth, onFollowLocation }: {
  name: string;
  authed: boolean;
  followedLocations: string[];
  onClose: () => void;
  onOpenObject: (o: any) => void;
  onOpenLocation: (name: string) => void;
  onRequireAuth: () => void;
  onFollowLocation: (name: string) => void;
}) {
  const [page, setPage] = useState<LocationPageData | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    setPage(null);
    setMissing(false);
    briefApi.getLocationPage(name).then((res) => {
      if (!live) return;
      if (res.ok) setPage(res.data);
      else setMissing(true);
    });
    return () => { live = false; };
  }, [name]);

  const followed = followedLocations.some((l) => l.toLowerCase() === name.toLowerCase());

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end overflow-hidden bg-[rgba(10, 14, 20, 0.85)] backdrop-blur-md sm:justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] shadow-2xl mb-safe sm:h-[88vh] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--brief-line)] px-4 py-3">
          <button type="button" onClick={onClose} className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] font-bold text-[var(--brief-ink)] transition-colors hover:bg-[color:var(--color-well)]">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <span className="truncate text-[12px] font-extrabold uppercase tracking-[0.18em] text-[var(--ink-70)]">
            Explore
          </span>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-[var(--brief-ink)] transition-colors hover:bg-[color:var(--color-well)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pb-safe">
          {missing && (
            <div className="flex flex-col items-center gap-3 px-6 py-24 text-center">
              <Globe2 className="h-8 w-8 text-[#40916C]" />
              <p className="max-w-xs text-[14px] font-semibold text-[var(--brief-ink)]">
                We don't have that location on Brief.
              </p>
              <p className="max-w-xs text-[13px] leading-relaxed text-[var(--ink-60)]">
                Locations appear here only when real information names them — nothing is invented.
              </p>
            </div>
          )}

          {!missing && !page && (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-[var(--ink-60)]">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0891B2] border-t-transparent" />
              <p className="text-[13px] font-semibold">Loading {name}…</p>
            </div>
          )}

          {page && (
            <div className="px-4 pb-10 pt-5 sm:px-5">
              {/* Header: name, kind, hierarchy, follow. */}
              <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#40916C]">
                <span className="rounded-full bg-[color:var(--color-well)] px-2 py-0.5">{KIND_LABEL[page.location.kind] ?? page.location.kind}</span>
                {page.location.county && page.location.kind !== 'county' && (
                  <button
                    type="button"
                    onClick={() => onOpenLocation(page.location.county ?? '')}
                    className="rounded-full bg-[color:var(--color-well)] px-2 py-0.5 hover:bg-[#EFF1F4]"
                    title={`Explore ${page.location.county}`}
                  >
                    {page.location.county}
                  </button>
                )}
                {page.location.kind === 'county' && Array.isArray(page.location.areas) && page.location.areas.length > 0 && (
                  <span className="rounded-full bg-[color:var(--color-well)] px-2 py-0.5 text-[var(--ink-70)]">
                    {page.location.areas.length} areas
                  </span>
                )}
              </div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-[30px] font-extrabold leading-tight text-[var(--brief-ink)]">{page.location.name}</h2>
                {authed ? (
                  <button
                    type="button"
                    onClick={() => onFollowLocation(page.location.name)}
                    className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-extrabold transition-colors ${followed ? 'bg-[#40916C] text-[var(--accent-ink)]' : 'bg-[#40916C] text-[var(--accent-ink)] hover:bg-[#C2410C]'}`}
                  >
                    {followed ? <><Check className="h-3.5 w-3.5" /> Following area</> : <><Plus className="h-3.5 w-3.5" /> Follow this area</>}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onRequireAuth}
                    className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#40916C] px-4 py-2 text-[13px] font-extrabold text-[var(--accent-ink)] transition-colors hover:bg-[#C2410C]"
                  >
                    <Plus className="h-3.5 w-3.5" /> Follow this area
                  </button>
                )}
              </div>

              {/* What's happening here — REAL counts from the live lists. */}
              <div className="mb-5 grid grid-cols-4 gap-2">
                {([
                  ['Happening now', page.activity.counts.happeningNow, <Flame key="i" className="h-3.5 w-3.5" />],
                  ['Today', page.activity.counts.today, <Clock key="i" className="h-3.5 w-3.5" />],
                  ['Coming up', page.activity.counts.comingUp, <CalendarDays key="i" className="h-3.5 w-3.5" />],
                  ['Latest', page.activity.counts.latest, <Newspaper key="i" className="h-3.5 w-3.5" />]
                ] as const).map(([label, count, icon]) => (
                  <div key={label} className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-2 py-2.5 text-center shadow-sm">
                    <div className="flex items-center justify-center gap-1 text-[11px] font-extrabold uppercase tracking-[0.1em] text-[var(--ink-70)]">
                      {icon}{label}
                    </div>
                    <p className="mt-1 text-[30px] font-extrabold leading-none text-[var(--brief-ink)]">{count}</p>
                  </div>
                ))}
              </div>

              <Section title="Happening now" icon={<Flame className="h-3 w-3" />} objects={page.activity.happeningNow} onOpenObject={onOpenObject} />
              <Section title="Today" icon={<Clock className="h-3 w-3" />} objects={page.activity.today} onOpenObject={onOpenObject} />
              <Section title="Coming up" icon={<CalendarDays className="h-3 w-3" />} objects={page.activity.comingUp} onOpenObject={onOpenObject} />
              <Section title="Offers" icon={<ShoppingBag className="h-3 w-3" />} objects={page.sections.offers ?? []} onOpenObject={onOpenObject} />
              <Section title="Businesses" icon={<Building2 className="h-3 w-3" />} objects={page.sections.businesses ?? []} onOpenObject={onOpenObject} />
              <Section title="Places" icon={<MapPin className="h-3 w-3" />} objects={page.sections.places ?? []} onOpenObject={onOpenObject} />
              <Section title="Local news" icon={<Newspaper className="h-3 w-3" />} objects={page.sections.news ?? []} onOpenObject={onOpenObject} />
              <Section title="Announcements" icon={<Megaphone className="h-3 w-3" />} objects={page.sections.announcements ?? []} onOpenObject={onOpenObject} />
              <Section title="Nearby" icon={<MapPin className="h-3 w-3" />} objects={page.nearby.items} onOpenObject={onOpenObject} />

              {page.nearby.available === false && (
                <p className="mb-5 flex items-center gap-1.5 rounded-xl bg-[color:var(--color-well)] px-3 py-2 text-[11px] font-semibold text-[var(--ink-60)]">
                  <Globe2 className="h-3 w-3" />
                  {page.nearby.reason === 'no_coordinates'
                    ? `${page.location.name} is a text-based location — no map coordinates exist for it, so nearby distance is not shown.`
                    : 'Nearby discovery needs genuine coordinates; none exist for this area yet.'}
                </p>
              )}

              <p className="mt-6 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--ink-60)]">
                <Users className="h-3 w-3" /> Live from Brief objects — shared via {explorePath(page.location.name)}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default LocationPage;
