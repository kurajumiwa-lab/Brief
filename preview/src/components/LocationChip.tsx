import React from 'react';
import { MapPin, Compass, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// LOCATION CHIP — the single home for location control.
//
// §10: tapping the chip opens a polished BOTTOM SHEET — "Where should Brief
// look?" — instead of a floating dropdown. The sheet offers the same honest
// options, in a mobile-first layout:
//   * Use my location  (device fix; scopes the feed by distance)
//   * a city/district  (real gazetteer places; scopes by area matching)
//   * Show everywhere  (null location; the global ranked feed)
// Nothing here is inferred or fabricated about the viewer, and there is no
// fake "recent areas" list — the places are the ones the extraction
// gazetteer actually knows.
// ---------------------------------------------------------------------------

export interface GeoPoint {
  lat: number;
  lng: number;
  label: string;
  /** A named locality (county/area) this point stands for, when it has one — */
  area?: string;
}

export interface LocationChipProps {
  label: string;
  locating: boolean;
  locError: string | null;
  hasLocation: boolean;
  onLocate: () => void;
  onSelectCity: (c: GeoPoint) => void;
  onClearLocation: () => void;
}

export const CITIES: GeoPoint[] = [
  { lat: -1.2921, lng: 36.8219, label: 'Nairobi', area: 'Nairobi' },
  { lat: -1.2636, lng: 36.8034, label: 'Westlands', area: 'Westlands' },
  { lat: -1.2921, lng: 36.7808, label: 'Kilimani', area: 'Kilimani' },
  { lat: -1.2833, lng: 36.8167, label: 'CBD', area: 'CBD' },
  { lat: -1.253, lng: 36.899, label: 'Kasarani', area: 'Kasarani' },
  { lat: -1.3959, lng: 36.7388, label: 'Rongai', area: 'Rongai' },
  { lat: -4.0435, lng: 39.6682, label: 'Mombasa', area: 'Mombasa' },
  { lat: -0.0917, lng: 34.768, label: 'Kisumu', area: 'Kisumu' },
  { lat: -0.3031, lng: 36.08, label: 'Nakuru', area: 'Nakuru' }
];

export function LocationChip({ label, locating, locError, hasLocation, onLocate, onSelectCity, onClearLocation }: LocationChipProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex items-center gap-1.5 bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-xs font-bold px-3 py-1.5 rounded-full border border-[var(--brief-line)] hover:border-[#0891B2] transition-colors cursor-pointer"
      >
        <MapPin className="w-3.5 h-3.5 text-[var(--brief-ink)]" />
        <span>{label}</span>
      </button>

      {open && (
        <div role="dialog" aria-label="Choose location" className="fixed inset-0 z-[70] flex flex-col justify-end">
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Dismiss location sheet"
            className="flex-1 min-h-0 bg-[rgba(10, 14, 20, 0.25)] backdrop-blur-[2px] cursor-pointer"
          />
          <div
            className="brief-sheet-up max-h-[70vh] overflow-y-auto bg-[#EFF1F4] border-t border-[var(--brief-line)] rounded-t-[28px] shadow-2xl px-4 pb-6 pt-5"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-[var(--ink-60)]">Location</p>
                <h3 className="mt-0.5 text-[32px] font-black tracking-tight text-[var(--brief-ink)]">Where should Brief look?</h3>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close location sheet"
                className="h-9 w-9 flex items-center justify-center rounded-full bg-[color:var(--color-paper)] border border-[var(--brief-line)] text-[var(--brief-ink)] text-[32px] font-light hover:border-[#40916C] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Use my location — the primary, most-convenient choice. */}
            <button
              type="button"
              onClick={() => { onLocate(); }}
              className="flex w-full items-center gap-3 rounded-2xl bg-[#40916C] px-4 py-3.5 text-left text-[14px] font-extrabold text-[var(--accent-ink)] cursor-pointer transition-opacity hover:opacity-90"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[rgba(10, 14, 20, 0.10)]">
                <Compass className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                {locating ? 'Locating…' : 'Use my location'}
              </span>
            </button>
            {locError && <p className="mt-2 px-1 text-[12px] font-semibold text-[#DC2626]">{locError}</p>}

            {/* Cities/districts — real gazetteer places, as tappable pills. */}
            <p className="mb-2 mt-5 px-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--ink-60)]">
              Or choose a place
            </p>
            <div className="grid grid-cols-3 gap-2">
              {CITIES.map((c) => {
                const selected = label === c.label;
                return (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => { onSelectCity(c); setOpen(false); }}
                    aria-pressed={selected}
                    className={`rounded-xl border px-2 py-2.5 text-[13px] font-semibold transition-colors cursor-pointer ${
                      selected
                        ? 'bg-[#40916C] text-[var(--accent-ink)] border-[#0891B2]'
                        : 'bg-[color:var(--color-paper)] text-[var(--ink-70)] border-[var(--brief-line)] hover:border-[#0891B2]'
                    }`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>

            {/* Show everywhere — return to the global feed. */}
            {hasLocation && (
              <button
                type="button"
                onClick={() => { onClearLocation(); setOpen(false); }}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--brief-line)] bg-transparent px-4 py-3 text-[13px] font-bold text-[var(--ink-70)] cursor-pointer hover:text-[var(--brief-ink)]"
              >
                Show everywhere
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default LocationChip;
