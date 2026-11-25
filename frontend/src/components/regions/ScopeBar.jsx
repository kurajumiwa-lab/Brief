import { useEffect, useState } from "react";
import { Crosshair, MapPin, SlidersHorizontal, X } from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { toast } from "@/components/ui/Toast";
import { geoAPI } from "@/lib/api";
import { parsePin } from "@/lib/geoPin";
import { RADII, useOutsideStore } from "@/stores/outsideStore";
import { cn } from "@/lib/utils";

/**
 * WHERE THE RESULTS ARE LOOKING FROM.
 *
 * "Around you" was one phrase that meant four different things: your device's
 * GPS, the area you typed, your business address, and a market the server
 * guessed. This bar says which one is in use, in one line, and lets the person
 * change it.
 *
 * The permission flow is the part that matters:
 *
 *   · GPS is asked for ONLY when the person presses "Use my location". A
 *     prompt nobody asked for is a prompt people refuse.
 *   · A refusal is not an error. The bar keeps the region scope and says the
 *     permission was declined — the screen keeps working.
 *   · A device that cannot share a location says so, and offers the typed
 *     area instead.
 *   · No area at all is not an error either: the feed runs without a radius,
 *     and the bar says that is what is happening.
 */
export default function ScopeBar({ scope, onCentreOnMe, className }) {
  const location = useOutsideStore((s) => s.location);
  const locationStatus = useOutsideStore((s) => s.locationStatus);
  const setLocation = useOutsideStore((s) => s.setLocation);
  const requestGps = useOutsideStore((s) => s.requestGps);

  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (location?.label) setTyped(location.label);
  }, [location?.label]);

  // The radius that is actually in force: the region's own reach when a region
  // is the scope, the person's own saved radius otherwise.
  const radius = scope?.radiusKm ?? Math.round(location?.radius_km ?? 15);
  const locked = Boolean(scope?.locked);
  const locating = locationStatus === "loading" || saving;

  // A saved area that cannot be read is worth saying out loud: otherwise the
  // scope line quietly changes what it means and nobody notices.
  const detail = locationStatus === "error"
    ? "We couldn’t read your saved area — the scope above is what is in use."
    : scope?.detail || "Showing everything the network has.";

  const useMyLocation = async () => {
    const result = await requestGps();
    if (result.ok) {
      toast.success("Showing what's around you.");
      onCentreOnMe?.();
      setOpen(false);
      return;
    }
    if (result.reason === "denied") {
      toast.error("Location permission declined — the region scope still works.");
    } else if (result.reason === "unavailable") {
      toast.error("This device can't share a location — type your area instead.");
    } else {
      toast.error("Couldn't save that location. Try typing your area.");
    }
  };

  const saveTyped = async () => {
    const text = typed.trim();
    if (!text) {
      toast.error("Type a neighbourhood, town or venue.");
      return;
    }
    setSaving(true);
    try {
      const pin = parsePin(text);
      const saved = pin
        ? await setLocation({ label: "Pasted pin", geo_lat: pin.lat, geo_lng: pin.lng, source: "manual" })
        : await (async () => {
            const { data } = await geoAPI.geocode(text);
            return setLocation({ label: text, geo_lat: data.lat, geo_lng: data.lng, source: "manual" });
          })();
      setSaving(false);
      if (saved) {
        toast.success(pin ? "Pinned that map link." : `Looking around ${text}.`);
        onCentreOnMe?.();
        setOpen(false);
      } else {
        toast.error("Couldn't save that. Try again.");
      }
    } catch {
      setSaving(false);
      toast.error("We couldn't find that place. Try “Kondele, Kisumu”.");
    }
  };

  return (
    <div
      data-testid="regions-scope-bar"
      className={cn("rounded-2xl border border-mk-line bg-mk-card", className)}
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-mk-warm text-mk-orange">
          <MapPin size={15} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-extrabold text-mk-ink" data-testid="regions-scope-label">
            {scope?.label || "No area set"}
          </p>
          <p className="truncate text-2xs text-mk-ink-soft" data-testid="regions-scope-detail">
            {detail}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="regions-scope-panel"
          data-testid="regions-scope-toggle"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-mk-line px-3 text-2xs font-extrabold text-mk-ink transition-colors hover:border-mk-ink/40"
        >
          <SlidersHorizontal size={13} aria-hidden="true" />
          {open ? "Close" : "Change"}
        </button>
      </div>

      {open && (
        <div
          id="regions-scope-panel"
          data-testid="regions-scope-panel"
          className="space-y-3 border-t border-mk-line px-3 py-3"
        >
          <div className="flex flex-wrap items-end gap-2">
            <Input
              label="Your area"
              wrapperClassName="min-w-0 flex-1"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") saveTyped(); }}
              placeholder="Kondele, Kisumu or paste a map pin"
              data-testid="regions-area-input"
            />
            <Button onClick={saveTyped} loading={saving} disabled={saving}>Save</Button>
            <Button variant="secondary" icon={Crosshair} onClick={useMyLocation} loading={locating}>
              Use my location
            </Button>
          </div>

          <div role="group" aria-label="Discovery radius" className="flex flex-wrap items-center gap-1.5">
            <span className="text-2xs font-extrabold uppercase tracking-[0.1em] text-mk-ink-soft">
              How wide
            </span>
            {RADII.map((option) => {
              const active = radius === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  disabled={locked}
                  title={locked ? "A region has its own reach. Choose “around me” to change this." : option.hint}
                  onClick={() => setLocation({ radius_km: option.value })}
                  data-testid={`regions-radius-${option.value}`}
                  className={cn(
                    "inline-flex h-9 items-center rounded-full border px-3 text-2xs font-extrabold transition-colors",
                    locked && "cursor-not-allowed opacity-50",
                    active
                      ? "border-mk-ink bg-mk-ink text-mk-cream"
                      : "border-mk-line bg-mk-cream text-mk-ink-soft hover:border-mk-ink/40",
                  )}
                >
                  {option.label}
                  <span className="ml-1 tabular-nums opacity-70">{option.value} km</span>
                </button>
              );
            })}
          </div>

          {locked && (
            <p className="text-2xs text-mk-ink-soft" data-testid="regions-radius-locked">
              A region has its own reach. Use “Use my location” to look around yourself instead.
            </p>
          )}

          {locationStatus === "denied" && (
            <p role="status" className="text-2xs font-semibold text-mk-orange">
              Location permission declined — the region scope is still working.
            </p>
          )}
          {locationStatus === "unavailable" && (
            <p role="status" className="text-2xs font-semibold text-mk-orange">
              This device can&apos;t share a location. Type your area instead.
            </p>
          )}
          {locationStatus === "error" && (
            <p role="alert" className="flex items-center gap-1.5 text-2xs font-semibold text-mk-orange">
              <X size={12} aria-hidden="true" />
              That didn&apos;t save. The previous area is still in use.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
