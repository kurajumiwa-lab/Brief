// ---------------------------------------------------------------------------
// FOLLOWING SURFACE — the viewer's Following feed + follow management.
//
// One lightweight surface, two tabs:
//   Following — recent information from followed entities, sections ranked by
//               the existing discovery system; expired content never active.
//   Manage   — the viewer's follows grouped Places / Businesses / Publishers
//              / Organizers / Communities, each with a direct unfollow.
// Everything is the caller's OWN data (self-scoped); no social mechanics.
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, MapPin, Plus, Users, X } from 'lucide-react';
import * as briefApi from '../api/briefApi';
import type { FollowingSection, FollowsGroups } from '../api/briefApi';

interface FollowingSurfaceProps {
  authed: boolean;
  /**
   * The way out. It is OPTIONAL on purpose: this surface is also embedded inside
   * Mine, where the page it sits on is the thing you leave and there is nothing
   * to close. A host that cannot close it gets no Back button, no X and no
   * click-away — a control that does nothing is how a person learns to distrust
   * every control on the screen.
   */
  onClose?: () => void;
  /** Same rule: with no object surface in the shell to open, a card is not made
   *  to look tappable. The list still shows the real row. */
  onOpenObject?: (object: any) => void;
  onOpenEntity: (entityId: string) => void;
  onRequireAuth: () => void;
  onFollowChanged?: () => void;
  /** 'sheet' (default) is the full-screen overlay the legacy App opens; 'embedded'
   *  is the same list, in the page flow, with no scrim and no close affordances. */
  variant?: 'sheet' | 'embedded';
}

const KIND_LABELS: Record<string, string> = {
  venue: 'Places',
  business: 'Businesses',
  publisher: 'Publishers',
  organizer: 'Organizers',
  community: 'Communities'
};

const KIND_SINGULAR: Record<string, string> = {
  venue: 'Place',
  business: 'Business',
  publisher: 'Publisher',
  organizer: 'Organizer',
  community: 'Community'
};

function temporalLine(o: FollowingSection['objects'][number]): string | null {
  const t = o.temporal;
  if (!t) return null;
  if ((t.status === 'upcoming' || t.status === 'happening') && typeof t.startsAt === 'string') {
    const d = new Date(t.startsAt);
    if (Number.isFinite(d.getTime())) {
      return `On ${d.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' })}`;
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

export function FollowingSurface({
  authed, onClose, onOpenObject, onOpenEntity, onRequireAuth, onFollowChanged, variant = 'sheet'
}: FollowingSurfaceProps) {
  const embedded = variant === 'embedded';
  const closable = typeof onClose === 'function' && !embedded;
  const [tab, setTab] = useState<'following' | 'manage'>('following');
  const [feed, setFeed] = useState<FollowingSection[] | null>(null);
  const [follows, setFollows] = useState<FollowsGroups | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!authed) return;
    setLoading(true);
    Promise.all([briefApi.getMyFollowingFeed(), briefApi.getMyFollows()]).then(([f, m]) => {
      if (f.ok) setFeed(f.data.sections);
      if (m.ok) setFollows(m.data);
      setLoading(false);
    });
  }, [authed]);

  useEffect(() => { load(); }, [load]);

  const kindOrder = useMemo(() => {
    if (!follows) return [];
    return Object.keys(follows.groups).filter((k) => (follows.groups[k] ?? []).length > 0);
  }, [follows]);

  const unfollow = (id: string) => {
    if (!authed) { onRequireAuth(); return; }
    briefApi.unfollowEntity(id).then((res) => {
      if (res.ok) {
        setFollows((prev) => {
          if (!prev) return prev;
          const groups = { ...prev.groups };
          for (const k of Object.keys(groups)) {
            groups[k] = (groups[k] ?? []).filter((f) => f.id !== id);
          }
          return { ...prev, groups, total: Math.max(0, prev.total - 1) };
        });
        setFeed((prev) => prev ? prev.filter((s) => s.entityId !== id) : prev);
        onFollowChanged?.();
      }
    });
  };

  return (
    <div
      className={embedded
        ? 'flex flex-col overflow-hidden rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)]'
        : 'fixed inset-0 z-50 flex flex-col justify-end overflow-hidden bg-[rgba(10, 14, 20, 0.85)] backdrop-blur-md sm:justify-center sm:p-4'}
      onClick={embedded ? undefined : onClose}
    >
      <div
        className={embedded
          ? 'flex max-h-[70vh] w-full flex-col overflow-hidden'
          : 'flex h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] shadow-2xl mb-safe sm:h-[88vh] sm:rounded-3xl'}
        onClick={embedded ? undefined : (e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-[var(--brief-line)] px-4 py-3">
          {closable ? (
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] font-bold text-[var(--brief-ink)] transition-colors hover:bg-[color:var(--color-well)]"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
          ) : (
            /* Nothing that looks like a way out unless it is one. */
            <span className="text-[13px] font-extrabold uppercase tracking-wider text-[var(--ink-70)]">Following</span>
          )}
          <div className="flex items-center gap-1 rounded-full border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-1">
            <button
              type="button"
              onClick={() => setTab('following')}
              className={`rounded-full px-3 py-1 text-[12px] font-bold transition-colors ${tab === 'following' ? 'bg-[#40916C] text-[var(--accent-ink)]' : 'text-[var(--ink-70)] hover:bg-[color:var(--color-well)]'}`}
            >
              Following
            </button>
            <button
              type="button"
              onClick={() => setTab('manage')}
              className={`rounded-full px-3 py-1 text-[12px] font-bold transition-colors ${tab === 'manage' ? 'bg-[#40916C] text-[var(--accent-ink)]' : 'text-[var(--ink-70)] hover:bg-[color:var(--color-well)]'}`}
            >
              Manage{follows && follows.total > 0 ? ` (${follows.total})` : ''}
            </button>
          </div>
          {closable && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-2 text-[var(--brief-ink)] transition-colors hover:bg-[color:var(--color-well)]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto pb-safe">
          {!authed && (
            <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
              <Users className="h-8 w-8 text-[#40916C]" />
              <p className="max-w-xs text-[14px] font-semibold text-[var(--brief-ink)]">
                Sign in to follow places, businesses, publishers, organizers and communities.
              </p>
              <button
                type="button"
                onClick={onRequireAuth}
                className="rounded-full bg-[#40916C] px-5 py-2.5 text-[14px] font-bold text-[var(--accent-ink)]"
              >
                Sign in
              </button>
            </div>
          )}

          {authed && loading && (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-[rgba(10, 14, 20,0.62)]">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0891B2] border-t-transparent" />
              <p className="text-[13px] font-semibold">Loading…</p>
            </div>
          )}

          {authed && !loading && tab === 'following' && (
            <div className="space-y-5 px-4 pb-10 pt-4 sm:px-5">
              {(!feed || feed.length === 0) && (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[var(--brief-line)] px-6 py-12 text-center">
                  <Plus className="h-6 w-6 text-[rgba(10, 14, 20,0.4)]" />
                  <p className="text-[14px] font-semibold text-[var(--brief-ink)]">Nothing followed yet</p>
                  <p className="max-w-xs text-[13px] leading-relaxed text-[rgba(10, 14, 20,0.62)]">
                    Open any place, business, publisher, organizer or community and follow it —
                    its new information will collect here.
                  </p>
                </div>
              )}
              {feed?.map((section) => (
                <section key={section.entityId} aria-label={section.name}>
                  <button
                    type="button"
                    onClick={() => onOpenEntity(section.entityId)}
                    className="group mb-2 flex w-full items-center gap-2 text-left"
                  >
                    <span className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-[var(--brief-ink)] group-hover:text-[#40916C]">
                      {section.name}
                    </span>
                    <span className="rounded-full bg-[color:var(--color-well)] px-2 py-0.5 text-[11px] font-bold text-[#40916C]">
                      {KIND_SINGULAR[section.kind] ?? section.kind}
                    </span>
                    {section.location?.area && (
                      <span className="flex items-center gap-0.5 text-[11px] font-semibold text-[rgba(10, 14, 20,0.62)]">
                        <MapPin className="h-3 w-3" /> {section.location.area}
                      </span>
                    )}
                  </button>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {section.objects.map((o) => {
                      const line = temporalLine(o);
                      const openable = typeof onOpenObject === 'function';
                      const Tag = openable ? 'button' : 'div';
                      return (
                        <Tag
                          key={o.id}
                          {...(openable ? { type: 'button', onClick: () => onOpenObject?.(o) } : {})}
                          className={`flex items-stretch gap-2.5 rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-2 text-left shadow-sm ${openable ? 'group transition-transform hover:-translate-y-0.5 hover:border-[#0891B2] cursor-pointer' : ''}`}
                        >
                          {o.imageUrl ? (
                            <img src={o.imageUrl} alt="" aria-hidden="true" loading="lazy" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                          ) : (
                            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#EFF1F4] to-[var(--brief-line)] text-[11px] font-bold uppercase text-[#5A6472]">
                              {o.type.slice(0, 4)}
                            </div>
                          )}
                          <div className="min-w-0 py-0.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#0891B2]">{o.type}</span>
                              {line && <span className="text-[11px] font-semibold text-[rgba(10, 14, 20,0.62)]">{line}</span>}
                            </div>
                            <h4 className="mt-0.5 line-clamp-2 text-[13px] font-semibold leading-snug text-[var(--brief-ink)] group-hover:text-[#40916C]">
                              {o.title}
                            </h4>
                          </div>
                        </Tag>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}

          {authed && !loading && tab === 'manage' && (
            <div className="px-4 pb-10 pt-4 sm:px-5">
              {kindOrder.length === 0 && (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[var(--brief-line)] px-6 py-12 text-center">
                  <Users className="h-6 w-6 text-[rgba(10, 14, 20,0.4)]" />
                  <p className="text-[14px] font-semibold text-[var(--brief-ink)]">You're not following anything yet</p>
                  <p className="max-w-xs text-[13px] leading-relaxed text-[rgba(10, 14, 20,0.62)]">
                    Follow a venue or business from its page and it will show up here.
                  </p>
                </div>
              )}
              {kindOrder.map((kind) => {
                const items = follows?.groups[kind] ?? [];
                if (items.length === 0) return null;
                return (
                  <section key={kind} aria-label={KIND_LABELS[kind]} className="mb-5">
                    <h3 className="mb-2 text-[12px] font-extrabold uppercase tracking-[0.14em] text-[var(--brief-ink)]">
                      {KIND_LABELS[kind]} <span className="text-[rgba(10, 14, 20,0.45)]">· {items.length}</span>
                    </h3>
                    <div className="grid gap-2">
                      {items.map((f) => (
                        <div
                          key={f.id}
                          className="flex items-center gap-3 rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-2.5 shadow-sm"
                        >
                          {f.imageUrl ? (
                            <img src={f.imageUrl} alt="" aria-hidden="true" className="h-10 w-10 rounded-xl object-cover" />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#40916C] to-[#EFF1F4] text-[var(--brief-ink)]">
                              <Users className="h-4 w-4" />
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => onOpenEntity(f.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className="truncate text-[14px] font-bold text-[var(--brief-ink)] hover:text-[#40916C]">{f.name}</p>
                            <p className="truncate text-[11px] font-semibold text-[rgba(10, 14, 20,0.62)]">
                              {f.objectCount} {f.objectCount === 1 ? 'item' : 'items'}
                              {f.location?.area ? ` · ${f.location.area}` : ''}
                              {f.sourceNames?.[0] ? ` · ${f.sourceNames[0]}` : ''}
                            </p>
                          </button>
                          <button
                            type="button"
                            onClick={() => unfollow(f.id)}
                            className="flex items-center gap-1 rounded-full border border-[var(--brief-line)] px-2.5 py-1.5 text-[11px] font-bold text-[var(--brief-ink)] transition-colors hover:border-[#DC2626] hover:bg-[color:var(--color-well)] hover:text-[#DC2626]"
                          >
                            <X className="h-3 w-3" /> Unfollow
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
              {kindOrder.length > 0 && (
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[rgba(10, 14, 20,0.5)]">
                  <Check className="h-3 w-3" /> Your follows are private to you.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
