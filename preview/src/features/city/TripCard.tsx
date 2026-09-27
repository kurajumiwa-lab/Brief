import React from 'react';
import { CalendarDays, Repeat } from 'lucide-react';
import type { EventListing } from '../../api/briefApi';
import { NoPhotoPlate } from './NoPhotoPlate';
import { categoryAccent } from './categoryPalette';
import { PHOTO_FILTER } from './room';

// ---------------------------------------------------------------------------
// TRIP CARD — a journey, not a point in time. An event whose end date falls
// on a later calendar day than its start renders here: cover, route strip
// with the real span in days, price, host, place. Single-day and undated
// events stay on the events shelf. The span is date arithmetic on stated
// dates — never a duration anyone typed as marketing.
// ---------------------------------------------------------------------------

const dayNum = (iso: string): number | null => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
};

export function tripDays(e: { startsAt: string | null; endsAt: string | null }): number | null {
  if (!e.startsAt || !e.endsAt) return null;
  const s = dayNum(e.startsAt);
  const t = dayNum(e.endsAt);
  if (s === null || t === null || t <= s) return null;
  return Math.round((t - s) / 86400000) + 1;
}

export function isTrip(e: { startsAt: string | null; endsAt: string | null }): boolean {
  return tripDays(e) !== null;
}

const fmtDay = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });

const money = (n: number, c: string) => (n === 0 ? 'Free' : `${c} ${n.toLocaleString('en-KE')}`);

export function TripCard({ event: e, onOpen }: { event: EventListing; onOpen: (slug: string) => void }) {
  const days = tripDays(e);
  return (
    <button
      type="button"
      onClick={() => onOpen(e.slug)}
      className="w-[260px] shrink-0 text-left rounded-2xl overflow-hidden bg-[color:var(--color-paper)] brief-lift-2 cursor-pointer"
    >
      <div className="relative h-28 w-full">
        {e.coverImageUrl ? (
          <img
            src={e.coverImageUrl}
            alt={e.title}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
            style={{ filter: PHOTO_FILTER }}
          />
        ) : (
          <NoPhotoPlate
            mark={e.categoryLabel ?? null}
            icon={<CalendarDays className="w-4 h-4" />}
            accent={categoryAccent(e.category)}
          />
        )}
        {e.recurrence && (
          <span
            className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide inline-flex items-center gap-1"
            style={{ background: 'rgba(255,255,255,0.92)', color: 'var(--color-primary)' }}
          >
            <Repeat className="w-3 h-3" /> {e.recurrence.ruleText || 'Repeats'}
          </span>
        )}
      </div>
      <div className="p-3 space-y-1">
        {e.startsAt && e.endsAt && (
          <p className="text-[11px] font-mono" style={{ color: 'var(--color-primary)' }}>
            {fmtDay(e.startsAt)} → {fmtDay(e.endsAt)}{days ? ` · ${days} days` : ''}
          </p>
        )}
        <p className="text-sm font-extrabold leading-snug line-clamp-2" style={{ color: 'var(--color-text)' }}>
          {e.title}
        </p>
        {e.description && (
          <p className="text-[12px] leading-snug line-clamp-2" style={{ color: 'var(--brief-muted)' }}>
            {e.description}
          </p>
        )}
        <p className="text-[13px] font-bold" style={{ color: 'var(--brief-ink)' }}>
          {e.goalAmount != null ? 'Contribution pot' : money(e.price, e.currency)}
        </p>
        {e.hostName && (
          <p className="text-[12px]" style={{ color: 'var(--brief-muted)' }}>
            Hosted by <strong style={{ color: 'var(--brief-ink)' }}>{e.hostName}</strong>
          </p>
        )}
        {e.location && (
          <p className="text-[12px] truncate" style={{ color: 'var(--brief-muted)' }}>
            {e.location}
          </p>
        )}
      </div>
    </button>
  );
}

export default TripCard;
