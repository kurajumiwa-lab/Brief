import { useEffect, useState } from "react";
import { Crosshair, MapPin, SlidersHorizontal, X } from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";
import { geoAPI } from "@/lib/api";
import { cn } from "@/lib/utils";
import { LAYERS, RADII, locationExplain, locationLabel, useOutsideStore } from "@/stores/outsideStore";

/**
 * THE LOCATION BAR — the one control that decides what "around you" means.
 *
 * Three things it has to get right:
 *
 *   · It always says WHERE it thinks you are and WHY. A point that came from
 *     your business address is labelled as such, so the app never quietly
 *     shows you your shop's neighbourhood and calls it your home.
 *   · Denying GPS is a normal path, not a dead end. "Choose your area" types a
 *     place name, geocodes it through the existing `/api/geo/geocode`, and
 *     carries on. Nothing about Outside requires a location permission.
 *   · The radius is a filter, not a wall. Widening it adds content; it never
 *     hides unlocated content, which is enforced on the server.
 */
export default function LocationBar({ className, showRadius = true }) {
  const location = useOutsideStore((s) => s.location);
  const loadLocation = useOutsideStore((s) => s.loadLocation);
  const setLocation = useOutsideStore((s) => s.setLocation);
  const status = useOutsideStore((s) => s.locationStatus);

  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState("");
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!location) loadLocation();
  }, [location, loadLocation]);

  useEffect(() => {
    if (location?.label) setLabel(location.label);
  }, [location?.label]);

  /**
   * Ask for GPS only when the person asks for it, and degrade to the typed
   * field when it is refused. The permission prompt is a cost, so it is never
   * spent on first paint.
   */
  const useMyLocation = async () => {
    if (!navigator?.geolocation) {
      toast.error("This browser can't share a location — type your area instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const saved = await setLocation({
          geo_lat: pos.coords.latitude,
          geo_lng: pos.coords.longitude,
          source: "gps",
          label: null,
        });
        setLocating(false);
        if (saved) {
          setEditing(false);
          toast.success("Showing what's around you.");
        } else {
          toast.error("Couldn't save that location. Try typing your area.");
        }
      },
      () => {
        setLocating(false);
        toast.error("Location permission declined — that's fine, type your area instead.");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  };

  const saveTyped = async () => {
    const text = label.trim();
    if (!text) {
      toast.error("Type a neighbourhood, town or venue.");
      return;
    }
    setLocating(true);
    try {
      const { data } = await geoAPI.geocode(text);
      const saved = await setLocation({
        label: text, geo_lat: data.lat, geo_lng: data.lng, source: "manual",
      });
      setLocating(false);
      if (saved) {
        setEditing(false);
        toast.success(`Looking around ${text}.`);
      } else {
        toast.error("Couldn't save that. Try again.");
      }
    } catch {
      setLocating(false);
      toast.error("We couldn't find that place. Try “Kondele, Kisumu”.");
    }
  };

  return (
    <section
      aria-label="Your location"
      data-testid="location-bar"
      className={cn("rounded-card border border-edge-1 bg-surface-1 p-3 shadow-xs sm:p-4", className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
          <MapPin size={16} aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink-1" data-testid="location-label">
            {locationLabel(location)}
          </p>
          <p className="truncate text-2xs text-ink-4">{locationExplain(location)}</p>
        </div>

        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          aria-expanded={editing}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-edge-2 px-3 text-xs font-semibold text-ink-2 transition-colors hover:bg-surface-2"
        >
          <SlidersHorizontal size={14} aria-hidden="true" />
          {editing ? "Close" : "Change"}
        </button>
      </div>

      {showRadius && (
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Discovery radius">
          {RADII.map((option) => {
            const active = Math.round(location?.radius_km ?? 15) === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                title={option.hint}
                onClick={() => setLocation({ radius_km: option.value })}
                data-testid={`radius-${option.value}`}
                className={cn(
                  "inline-flex h-8 items-center rounded-full border px-3 text-2xs font-semibold transition-colors",
                  active
                    ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                    : "border-edge-2 text-ink-3 hover:border-ink-4 hover:text-ink-1",
                )}
              >
                {option.label}
                <span className="ml-1 tabular-nums opacity-70">{option.value} km</span>
              </button>
            );
          })}
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-3 border-t border-edge-1 pt-3">
          <div className="flex flex-wrap items-end gap-2">
            <Input
              label="Your area"
              wrapperClassName="min-w-0 flex-1"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveTyped(); }}
              placeholder="Kondele, Kisumu"
              hint="A neighbourhood, a town or a venue. No exact address needed."
              data-testid="location-input"
            />
            <Button onClick={saveTyped} loading={locating} disabled={locating}>
              Save
            </Button>
            <Button variant="secondary" icon={Crosshair} onClick={useMyLocation} loading={locating}>
              Use my location
            </Button>
          </div>

          <Select
            label="How wide should we look?"
            options={LAYERS}
            value={location?.layer || "town"}
            onChange={(e) => setLocation({ layer: e.target.value })}
            hint="A party is nearby. A specialist contractor serves a whole town. A trip draws people from further out."
          />

          <label className="flex min-h-tap cursor-pointer items-start gap-2.5 text-xs text-ink-3">
            <input
              type="checkbox"
              checked={Boolean(location?.share_location)}
              onChange={(e) => setLocation({ share_location: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-edge-2 text-brand-600 focus:ring-brand-500"
            />
            <span>
              Show me on the nearby shelf.
              <span className="block text-2xs text-ink-4">
                Off by default. Even on, we show your area — never your exact pin.
              </span>
            </span>
          </label>

          {status === "error" && (
            <p role="alert" className="flex items-center gap-1.5 text-2xs font-medium text-danger">
              <X size={12} aria-hidden="true" />
              That didn't save. Your previous area is still in use.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
