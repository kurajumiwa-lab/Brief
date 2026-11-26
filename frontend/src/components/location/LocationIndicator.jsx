import { useEffect, useState } from "react";
import { ChevronDown, MapPin, RefreshCw } from "lucide-react";
import LocationBar from "@/components/outside/LocationBar";
import { locationLabel, useOutsideStore } from "@/stores/outsideStore";
import { cn } from "@/lib/utils";

/**
 * THE LOCATION INDICATOR — one small, honest control.
 *
 * The brief asked for a compact dynamic location indicator in place of an
 * assumed, hardcoded place, and this is it. It is a PILL first and a panel
 * second: the pill says where the app thinks you are looking, and one press
 * opens the full controls — GPS, a typed area, the radius, the layer and
 * whether you appear on the nearby shelf.
 *
 * The rules it exists to keep:
 *
 *   · NEVER A GUESS. If the device will not share a location and no area has
 *     been chosen, the pill says "Location unavailable". It never names a
 *     town or a county it was not told, because a wrong town is worse than
 *     no town: it silently moves every result on the screen.
 *   · PERMISSION IS ASKED FOR, NOT ASSUMED. The device is asked only when
 *     the person presses "Use my location" — or the refresh control. A
 *     refusal is a route, not a dead end: the typed area is right there.
 *   · THE RADIUS IS THE PERSON'S. Three named widths, one line, no jargon.
 *   · REFRESH. One control asks the device again and asks the feed again.
 *
 * The panel is the existing `LocationBar`, unchanged in behaviour, so the
 * street screen and this one can never disagree about where the person is.
 */
export default function LocationIndicator({ className, children = null }) {
  const location = useOutsideStore((s) => s.location);
  const locationStatus = useOutsideStore((s) => s.locationStatus);
  const loadLocation = useOutsideStore((s) => s.loadLocation);
  const refreshNearby = useOutsideStore((s) => s.refreshNearby);
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!location) loadLocation();
  }, [location, loadLocation]);

  const label = locationLabel(location);
  const unavailable = !location || location.source === "unset";
  const locating = locationStatus === "loading" || refreshing;

  const refresh = async () => {
    setRefreshing(true);
    await refreshNearby();
    setRefreshing(false);
  };

  return (
    <div data-testid="location-indicator" className={cn("min-w-0", className)}>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="location-indicator-panel"
          data-testid="location-indicator-toggle"
          className={cn(
            "inline-flex h-9 min-w-0 max-w-full items-center gap-1.5 rounded-full border px-3 text-2xs font-semibold transition-colors",
            unavailable
              ? "border-dashed border-edge-2 text-ink-3 hover:border-ink-4 hover:text-ink-1"
              : "border-edge-2 bg-surface-1 text-ink-1 hover:border-brand-500",
          )}
        >
          <MapPin
            size={13}
            aria-hidden="true"
            className={cn("shrink-0", unavailable ? "text-ink-4" : "text-brand-600 dark:text-brand-300")}
          />
          <span className="truncate" data-testid="location-indicator-label">
            {label}
          </span>
          <ChevronDown
            size={13}
            aria-hidden="true"
            className={cn("shrink-0 text-ink-4 transition-transform", open && "rotate-180")}
          />
        </button>

        <button
          type="button"
          onClick={refresh}
          disabled={locating}
          aria-label="Refresh my location and results"
          data-testid="location-indicator-refresh"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-edge-2 text-ink-3 transition-colors hover:border-brand-500 hover:text-brand-700 disabled:opacity-60"
        >
          <RefreshCw size={13} className={cn(refreshing && "animate-spin")} aria-hidden="true" />
        </button>
      </div>

      {open && (
        <div
          id="location-indicator-panel"
          data-testid="location-indicator-panel"
          className="mt-2 space-y-2"
        >
          {unavailable && (
            <p
              role="status"
              data-testid="location-indicator-unavailable"
              className="rounded-xl border border-dashed border-edge-2 bg-surface-1 px-3 py-2 text-2xs text-ink-3"
            >
              We don&apos;t know where you are yet. Turn on your location, or type the area
              you want to look around.
            </p>
          )}

          <LocationBar showRadius className="border-edge-1" />

          {children}
        </div>
      )}
    </div>
  );
}
