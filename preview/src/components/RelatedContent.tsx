// ---------------------------------------------------------------------------
// RELATED CONTENT — the object graph rendered on detail pages.
//
// Every section is a REAL relationship (structured venue/organizer/business
// fields, provenance, or persisted relationship rows) — nothing is matched by
// keywords and nothing weak is ever shown as certain. The location edge links
// into the public /explore/:name surface, keeping the wander inside Brief.
// ---------------------------------------------------------------------------

import React from 'react';
import { ArrowUpRight, CalendarDays, Clock, Flame, MapPin, ShoppingBag, Newspaper } from 'lucide-react';
import type { GraphEdge, GraphObject } from '../api/briefApi';

const EDGE_ICON: Record<string, React.ReactNode> = {
  happening_at: <CalendarDays className="h-3 w-3" />,
  organized_by: <CalendarDays className="h-3 w-3" />,
  hosted_by: <CalendarDays className="h-3 w-3" />,
  published_by: <Newspaper className="h-3 w-3" />,
  offered_by: <ShoppingBag className="h-3 w-3" />,
  located_at: <MapPin className="h-3 w-3" />,
  related_to: <Flame className="h-3 w-3" />
};

function line(o: GraphObject): string | null {
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

export function RelatedContent({ edges, onOpenObject, onOpenLocation }: {
  edges: GraphEdge[];
  onOpenObject: (o: any) => void;
  onOpenLocation?: (name: string) => void;
}) {
  if (!edges || edges.length === 0) return null;
  return (
    <div className="space-y-5">
      {edges.map((edge) => (
        <section key={`${edge.verb}_${edge.label}`} aria-label={edge.label} className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--brief-ink)]">
              {EDGE_ICON[edge.verb]}
              {edge.label}
              <span className="text-[var(--ink-60)]">· {edge.objects.length}</span>
            </h4>
            {edge.location && onOpenLocation && (
              <button
                type="button"
                onClick={() => onOpenLocation(edge.location?.name ?? '')}
                className="flex items-center gap-1 rounded-full bg-[#40916C] px-2.5 py-1 text-[11px] font-extrabold text-[var(--accent-ink)] transition-colors hover:bg-[#C2410C]"
              >
                View area <ArrowUpRight className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {edge.objects.slice(0, 6).map((o) => {
              const image = o.imageUrl ?? o.media?.url ?? o.gallery?.[0]?.url ?? null;
              const l = line(o);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => onOpenObject(o)}
                  className="group flex items-center gap-2.5 rounded-xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-2 text-left shadow-sm transition-transform hover:-translate-y-0.5 hover:border-[#0891B2]"
                >
                  {image ? (
                    <img src={image} alt="" aria-hidden="true" loading="lazy" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#EFF1F4] to-[var(--brief-line)] text-[11px] font-bold uppercase text-[#5A6472]">
                      {o.type.slice(0, 4)}
                    </div>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold text-[var(--brief-ink)] group-hover:text-[#40916C]">{o.title}</span>
                    <span className="flex flex-wrap items-center gap-1 text-[11px] font-semibold text-[var(--ink-55)]">
                      {l && <span className="flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" />{l}</span>}
                      {(o.area || o.county) && <span>{[o.area, o.county].filter(Boolean).join(', ')}</span>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export default RelatedContent;
