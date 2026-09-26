// ---------------------------------------------------------------------------
// ENTITY PAGE — the public page of a followable entity
// (venue / business / publisher / organizer / community).
//
// Everything rendered here comes from the server's public entity projection:
// real persisted objects, real temporal statuses, real trust flags. Expired
// content never appears active (the server already filters it); degraded
// sources are flagged plainly; no verification badges are invented. When an
// entity cannot be resolved, the page says so honestly instead of showing a
// generic empty profile.
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Building2, CalendarDays, Check, Clock, Globe, MapPin,
  Megaphone, Newspaper, Share2, Users, X
} from 'lucide-react';
import * as briefApi from '../api/briefApi';
import type { BriefEntity, EntityKind } from '../api/briefApi';

const T = { muted: 'rgba(10, 14, 20,0.62)', ink: '#0D1117', line: 'var(--brief-line)', surface: 'var(--color-paper)', primary: '#0891B2', deep: '#40916C', dark: '#0D1117' };

export const ENTITY_KIND_META: Record<EntityKind, { label: string; icon: React.ReactNode; plural: string }> = {
  venue: { label: 'Place', icon: <MapPin className="h-4 w-4" />, plural: 'Places' },
  business: { label: 'Business', icon: <Building2 className="h-4 w-4" />, plural: 'Businesses' },
  publisher: { label: 'Publisher', icon: <Newspaper className="h-4 w-4" />, plural: 'Publishers' },
  organizer: { label: 'Organizer', icon: <Megaphone className="h-4 w-4" />, plural: 'Organizers' },
  community: { label: 'Community', icon: <Users className="h-4 w-4" />, plural: 'Communities' }
};

interface EntityPageProps {
  entityId: string;
  authed: boolean;
  origin: string | null;
  onClose: () => void;
  onOpenObject: (object: any) => void;
  /** Open the public location discovery page (/explore/:name). */
  onOpenLocation?: (name: string) => void;
  onRequireAuth: () => void;
  /** Called after a follow/unfollow lands so callers can refresh state. */
  onFollowChanged?: () => void;
}

const STATUS_ORDER = ['happening', 'upcoming', 'active', 'latest', 'recurring'];

/** Group the entity's objects by real temporal status. */
function groupObjects(entity: BriefEntity): {
  upcoming: BriefEntity['objects'];
  active: BriefEntity['objects'];
  latest: BriefEntity['objects'];
  expired: BriefEntity['objects'];
} {
  const upcoming: BriefEntity['objects'] = [];
  const active: BriefEntity['objects'] = [];
  const latest: BriefEntity['objects'] = [];
  const expired: BriefEntity['objects'] = [];
  for (const o of entity.objects ?? []) {
    const status = o.temporal?.status;
    const type = o.type;
    if (status === 'expired' || status === 'past') {
      // Defensive: the server never sends stale rows; if one slips through it
      // must never be presented as active.
      expired.push(o);
    } else if (status === 'upcoming' || status === 'happening') {
      upcoming.push(o);
    } else if (status === 'active') {
      active.push(o);
    } else if (type === 'event' || type === 'experience') {
      upcoming.push(o);
    } else if (type === 'offer') {
      active.push(o);
    } else {
      latest.push(o);
    }
  }
  return { upcoming, active, latest, expired };
}

function temporalPreview(o: BriefEntity['objects'][number]): string | null {
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
    if (Number.isFinite(d.getTime())) {
      return `Closes ${d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}`;
    }
    return 'Active';
  }
  if (t.status === 'happening') return 'Happening now';
  if (t.status === 'recurring') return 'Recurring';
  return null;
}

function ContentCard({ o, onOpen }: { o: BriefEntity['objects'][number]; onOpen: () => void }) {
  const preview = temporalPreview(o);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-stretch gap-3 rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-2.5 text-left shadow-sm transition-transform hover:-translate-y-0.5 hover:border-[#0891B2]"
    >
      {o.imageUrl ? (
        <img
          src={o.imageUrl}
          alt=""
          aria-hidden="true"
          loading="lazy"
          className="h-20 w-20 shrink-0 rounded-xl object-cover"
        />
      ) : (
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#EFF1F4] to-[var(--brief-line)] text-[#5A6472]">
          <CalendarDays className="h-6 w-6" />
        </div>
      )}
      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#0891B2]">
            {o.type}
          </span>
          {preview && (
            <span className="text-[11px] font-semibold text-[rgba(10, 14, 20,0.62)]">
              {preview}
            </span>
          )}
        </div>
        <h4 className="mt-0.5 line-clamp-2 text-[14px] font-semibold leading-snug text-[var(--brief-ink)] group-hover:text-[#40916C]">
          {o.title}
        </h4>
        <p className="mt-0.5 truncate text-[11px] text-[rgba(10, 14, 20,0.62)]">
          {o.locationName || o.area || o.county || ''}
          {o.sourceNames?.[0] ? `${o.locationName || o.area || o.county ? ' · ' : ''}${o.sourceNames[0]}` : ''}
        </p>
      </div>
    </button>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <section aria-label={title}>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-[var(--brief-ink)]">
          {title}
        </h3>
        <span className="rounded-full bg-[color:var(--color-well)] px-2 py-0.5 text-[11px] font-bold text-[#40916C]">
          {count}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {children}
      </div>
    </section>
  );
}

export function EntityPage({ entityId, authed, origin, onClose, onOpenObject, onOpenLocation, onRequireAuth, onFollowChanged }: EntityPageProps) {
  const [entity, setEntity] = useState<BriefEntity | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    setStatus('loading');
    briefApi.getEntity(entityId).then((res) => {
      if (res.ok && res.data.entity) {
        setEntity(res.data.entity);
        setStatus('ready');
      } else if (!res.ok && res.status === 404) {
        setEntity(null);
        setStatus('notfound');
      } else {
        setEntity(null);
        setStatus('error');
      }
    });
  }, [entityId]);

  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => (entity ? groupObjects(entity) : null), [entity]);
  const kindMeta = entity ? ENTITY_KIND_META[entity.kind] : null;
  const shareUrl = useMemo(() => {
    if (!origin) return null;
    const base = `${origin.replace(/\/+$/, '')}`;
    return `${base}/e/${encodeURIComponent(entityId)}`;
  }, [origin, entityId]);

  const toggleFollow = () => {
    if (!authed) { onRequireAuth(); return; }
    if (!entity || busy) return;
    setBusy(true);
    const wasFollowed = entity.isFollowed;
    const call = wasFollowed
      ? briefApi.unfollowEntity(entity.id)
      : briefApi.followEntity(entity.id);
    call.then((res) => {
      setBusy(false);
      if (res.ok && entity) {
        setEntity({
          ...entity,
          isFollowed: !wasFollowed,
          followCount: res.data.followCount
        });
        onFollowChanged?.();
      }
    });
  };

  const share = () => {
    if (!shareUrl) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(shareUrl).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }).catch(() => {});
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end overflow-hidden bg-[rgba(10, 14, 20, 0.85)] backdrop-blur-md sm:justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] shadow-2xl mb-safe sm:h-[88vh] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-[var(--brief-line)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] font-bold text-[var(--brief-ink)] transition-colors hover:bg-[color:var(--color-well)]"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          {shareUrl && (
            <button
              type="button"
              onClick={share}
              className="flex items-center gap-1.5 rounded-full border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-2.5 py-1.5 text-[12px] font-bold text-[var(--brief-ink)] transition-colors hover:bg-[color:var(--color-well)]"
            >
              <Share2 className="h-3.5 w-3.5" />
              {copied ? 'Link copied' : 'Share'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-2 text-[var(--brief-ink)] transition-colors hover:bg-[color:var(--color-well)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pb-safe">
          {status === 'loading' && (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-[rgba(10, 14, 20,0.62)]">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0891B2] border-t-transparent" />
              <p className="text-[13px] font-semibold">Loading…</p>
            </div>
          )}

          {status === 'notfound' && (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-24 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--color-well)] text-[#40916C]">
                <Users className="h-7 w-7" />
              </div>
              <h3 className="text-[16px] font-bold text-[var(--brief-ink)]">This entity isn't on Brief</h3>
              <p className="max-w-xs text-[13px] leading-relaxed text-[rgba(10, 14, 20,0.62)]">
                There's no public profile behind this link. It may be private, or the
                information behind it may no longer be on Brief.
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
              <p className="text-[14px] font-semibold text-[var(--brief-ink)]">Couldn't load this page</p>
              <button
                type="button"
                onClick={load}
                className="rounded-full bg-[#40916C] px-4 py-2 text-[13px] font-bold text-[var(--accent-ink)]"
              >
                Try again
              </button>
            </div>
          )}

          {status === 'ready' && entity && kindMeta && groups && (
            <>
              {/* Cover */}
              {entity.imageUrl ? (
                <div className="relative h-44 sm:h-56">
                  <img src={entity.imageUrl} alt="" aria-hidden="true" className="h-full w-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[rgba(10, 14, 20, 0.90)] via-[rgba(10, 14, 20, 0.20)] to-transparent" />
                </div>
              ) : (
                <div className="relative h-32 bg-gradient-to-br from-[#EFF1F4] via-[var(--color-well)] to-[var(--brief-line)] sm:h-40">
                  <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 20% 30%, #0891B2 0, transparent 45%), radial-gradient(circle at 80% 70%, #40916C 0, transparent 40%)' }} />
                </div>
              )}

              {/* Identity row */}
              <div className="relative px-4 sm:px-6">
                <div className="-mt-8 flex flex-wrap items-end gap-3">
                  {entity.imageUrl ? (
                    <img src={entity.imageUrl} alt="" aria-hidden="true" className="h-16 w-16 rounded-2xl border-2 border-[var(--color-paper)] bg-[color:var(--color-paper)] object-cover shadow-lg" />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-[var(--color-paper)] bg-gradient-to-br from-[#40916C] to-[#EFF1F4] text-[var(--brief-ink)] shadow-lg">
                      {kindMeta.icon}
                    </div>
                  )}
                  <div className="flex-1 pb-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-[color:var(--color-well)] px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#40916C]">
                        {kindMeta.label}
                      </span>
                      {entity.category && entity.category !== entity.kind && (
                        <span className="rounded-full bg-[color:var(--color-well)] px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#40916C]">
                          {entity.category}
                        </span>
                      )}
                    </div>
                    <h2 className="mt-1 text-[30px] font-extrabold leading-tight text-[var(--brief-ink)]">
                      {entity.name}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={toggleFollow}
                    disabled={busy}
                    className={`mb-1 flex items-center gap-1.5 rounded-full px-4 py-2.5 text-[14px] font-bold transition-colors ${
                      entity.isFollowed
                        ? 'border border-[#0891B2]/40 bg-[color:var(--color-well)] text-[#40916C] hover:bg-[#EFF1F4]'
                        : 'bg-[#40916C] text-[var(--accent-ink)] hover:bg-[#EFF1F4]'
                    }`}
                  >
                    {entity.isFollowed ? (<><Check className="h-4 w-4" /> Following</>) : 'Follow'}
                  </button>
                </div>

                {/* Meta line */}
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-semibold text-[rgba(10, 14, 20,0.62)]">
                  {(entity.location?.area || entity.location?.county) && (
                    <button
                      type="button"
                      onClick={() => onOpenLocation?.(entity.location?.area ?? entity.location?.county ?? '')}
                      className="flex items-center gap-1 rounded-full bg-[color:var(--color-well)] px-2 py-0.5 text-[11px] font-bold text-[#40916C] transition-colors hover:bg-[#40916C] hover:text-[var(--accent-ink)]"
                      title={`Explore ${entity.location.area ?? entity.location.county}`}
                    >
                      <MapPin className="h-3.5 w-3.5" />
                      {[entity.location.area, entity.location.county].filter(Boolean).join(', ')}
                    </button>
                  )}
                  {entity.sourceNames.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Globe className="h-3.5 w-3.5" />
                      {entity.sourceNames.join(', ')}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {entity.followCount} {entity.followCount === 1 ? 'follower' : 'followers'}
                  </span>
                </div>

                {/* Trust line — derived facts only, never invented badges. */}
                {entity.trust.degraded && (
                  <p className="mt-2 rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2 text-[12px] font-semibold leading-relaxed text-amber-900">
                    This page's source is currently marked degraded on Brief — treat its
                    information with extra care until it's re-verified.
                  </p>
                )}
                {!entity.trust.degraded && entity.trust.corroborated && (
                  <p className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-[rgba(10, 14, 20,0.62)]">
                    <Check className="h-3.5 w-3.5 text-[#40916C]" />
                    Its content has been reported across multiple sources.
                  </p>
                )}

                {entity.summary && (
                  <p className="mt-3 text-[14px] leading-relaxed text-[var(--brief-ink)]">{entity.summary}</p>
                )}
                {entity.description && entity.description !== entity.summary && (
                  <p className="mt-2 text-[13px] leading-relaxed text-[rgba(10, 14, 20,0.62)]">
                    {entity.description.slice(0, 400)}
                    {entity.description.length > 400 ? '…' : ''}
                  </p>
                )}
              </div>

              {/* Content */}
              <div className="mt-6 space-y-6 px-4 pb-10 sm:px-6">
                <Section title="Upcoming" count={groups.upcoming.length}>
                  {groups.upcoming.map((o) => (
                    <ContentCard key={o.id} o={o} onOpen={() => onOpenObject(o)} />
                  ))}
                </Section>

                <Section title="Active offers" count={groups.active.length}>
                  {groups.active.map((o) => (
                    <ContentCard key={o.id} o={o} onOpen={() => onOpenObject(o)} />
                  ))}
                </Section>

                <Section title="Latest" count={groups.latest.length}>
                  {groups.latest.map((o) => (
                    <ContentCard key={o.id} o={o} onOpen={() => onOpenObject(o)} />
                  ))}
                </Section>

                {groups.expired.length > 0 && (
                  <section aria-label="Expired">
                    <div className="mb-2 flex items-center gap-2">
                      <h3 className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-[rgba(10, 14, 20,0.55)]">
                        Ended or expired
                      </h3>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {groups.expired.map((o) => (
                        <div key={o.id} className="rounded-2xl border border-[rgba(220, 225, 232, 0.60)] bg-[rgba(238, 241, 245, 0.50)] p-3">
                          <p className="line-through text-[13px] font-semibold text-[rgba(10, 14, 20,0.55)]">{o.title}</p>
                          <p className="mt-0.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[rgba(10, 14, 20,0.45)]">Expired</p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {groups.upcoming.length + groups.active.length + groups.latest.length === 0 && (
                  <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[var(--brief-line)] px-6 py-10 text-center">
                    <Clock className="h-6 w-6 text-[rgba(10, 14, 20,0.4)]" />
                    <p className="text-[13px] font-semibold text-[rgba(10, 14, 20,0.62)]">
                      Nothing current right now — follow this {kindMeta.label.toLowerCase()} and
                      new information will land in your Following feed.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
