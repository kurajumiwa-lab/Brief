// ---------------------------------------------------------------------------
// MUSEUM GALLERY — events and trips, byway-home style, honest rows only.
//
// A navy hero ("Go somewhere."), then a horizontal rail of TRIPS — events
// whose end date falls on a later day than their start — then the events
// grid for everything else. Trips are not a second table: the same campaign
// row renders as a journey when its own dates span days, with the span
// computed from those dates and the host, price and place it stated.
//
// What the case keeps from before:
//   * every row is a REAL published campaign from /api/events — nothing is
//     seeded to fill a shelf;
//   * no result countergames, no ranks, no "top trips": shelves sort by date,
//     and the counts in the hero are the loaded rows, counted plainly;
//   * Decision 6 stands: no featured slot, no popularity sort, no "N going".
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useState } from "react";
import * as briefApi from "../../api/briefApi";
import type { EventListing } from "../../api/briefApi";
import { NoPhotoPlate } from "./NoPhotoPlate";
import { categoryAccent } from "./categoryPalette";
import { GlobysCard } from "../../ui/GlobysCard";
import { TripCard, isTrip } from "./TripCard";
import { HostEventSheet } from "./HostEventSheet";
import { CalendarDays } from "lucide-react";
import { soundEngine } from "../../utils/SoundEngine";

function timeOf(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function money(amount: number, currency: string): string {
  return `${currency} ${Number(amount).toLocaleString('en-KE')}`;
}

export function MuseumGallery({ className = "" }: { className?: string }) {
  const [events, setEvents] = useState<EventListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setError(null);
    // The whole case: no category, no place, no window. The order is the
    // server's one order — startsAt ascending.
    const res = await briefApi.browseEvents({ limit: 50 });
    if (!res.ok) {
      if (!quiet) {
        setEvents([]);
        setError(res.error);
      }
      return;
    }
    setEvents(res.data.events);
    setError(null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Back to the tab -> re-read the ledger. A refresh on return, not a stream.
  useEffect(() => {
    const onVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void load(true);
    };
    if (typeof window === 'undefined') return;
    window.addEventListener('focus', onVisible);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onVisible);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const open = (slug: string) => {
    if (typeof window !== "undefined") window.open(`/c/${slug}`, "_self");
  };

  const rows = events ?? [];
  const trips = rows.filter(isTrip);
  const singles = rows.filter((e) => !isTrip(e));

  return (
    <div className={className}>
      {error && <p className="text-xs" style={{ color: "var(--color-danger)" }}>{error}</p>}
      {events === null && !error && (
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Loading…</p>
      )}

      {events !== null && !error && (
        <div
          className="p-5 rounded-3xl"
          style={{ background: 'radial-gradient(140% 130% at 88% 8%, rgba(64,145,108,0.38), rgba(64,145,108,0) 55%), #0D1B2A' }}
        >
          <p className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: 'var(--sage)' }}>
            Events &amp; trips
          </p>
          <p className="text-[26px] font-black leading-tight mt-1" style={{ color: '#FFFFFF' }}>
            Go somewhere.
          </p>
          <p className="text-[13px] mt-1" style={{ color: 'var(--sage)' }}>
            {trips.length} trip{trips.length === 1 ? '' : 's'} · {singles.length} event{singles.length === 1 ? '' : 's'} on the board
          </p>
          <button
            type="button"
            onClick={() => { soundEngine.play('heavyTap'); setSheetOpen(true); }}
            className="mt-3 px-4 py-2 rounded-full text-[13px] font-black cursor-pointer"
            style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
          >
            Plan a trip
          </button>
        </div>
      )}

      {events !== null && rows.length === 0 && !error && (
        <div className="p-5 rounded-3xl border border-dashed text-center space-y-2" style={{ borderColor: 'var(--brief-line)', background: 'var(--color-paper)', boxShadow: 'var(--room-light), var(--lift-1)' }}>
          <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
            Nothing is published yet.
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
            When an event goes live around you, it appears here.
          </p>
          <button
            type="button"
            onClick={() => { soundEngine.play('heavyTap'); setSheetOpen(true); }}
            className="px-4 py-2 rounded-full text-[13px] font-black cursor-pointer"
            style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
          >
            Host the first one
          </button>
        </div>
      )}

      {trips.length > 0 && (
        <section className="space-y-2 mt-4" aria-label="Trips">
          <h3 className="text-[12px] font-black uppercase tracking-wider" style={{ color: 'var(--brief-ink)' }}>
            Trips
          </h3>
          <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1">
            {trips.map((e) => (
              <TripCard key={e.slug} event={e} onOpen={open} />
            ))}
          </div>
        </section>
      )}

      {singles.length > 0 && (
        <section className="space-y-2 mt-4" aria-label="Events">
          <h3 className="text-[12px] font-black uppercase tracking-wider" style={{ color: 'var(--brief-ink)' }}>
            Events
          </h3>
          <div className="grid grid-cols-2 gap-2.5">
            {singles.map((e) => (
              <GlobysCard
                key={e.slug}
                testId={`exhibit-${e.slug}`}
                image={e.coverImageUrl}
                imageAlt={e.title}
                plate={
                  <NoPhotoPlate
                    mark={e.categoryLabel ?? null}
                    icon={<CalendarDays className="w-4 h-4" />}
                    accent={categoryAccent(e.category)}
                  />
                }
                title={e.title}
                price={e.goalAmount != null ? 'Contribution pot' : (e.price === 0 ? 'Free' : money(e.price, e.currency))}
                seller={e.hostName ?? null}
                mono={[timeOf(e.startsAt), e.location].filter(Boolean).join(' · ')}
                actionLabel="View event →"
                onAction={() => open(e.slug)}
                onOpen={() => open(e.slug)}
              />
            ))}
          </div>
        </section>
      )}

      <HostEventSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onPublished={() => { void load(true); }}
      />
    </div>
  );
}

export default MuseumGallery;
