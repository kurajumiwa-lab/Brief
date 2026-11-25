import { Link } from "react-router-dom";
import { ArrowUpRight, Map as MapIcon, MapPin } from "lucide-react";

/**
 * MAP DISCOVERY — the map as a door, not a canvas.
 *
 * The review asked for map discovery on Home. It did NOT ask for a second map
 * engine on the Home screen, and that distinction is the whole design:
 *
 *   · The Home map would be a *Leaflet canvas*, and a Leaflet canvas on a
 *     phone is a megabyte of tiles and JavaScript before the first pin — on
 *     the slow connection most of this product's people are actually on. Home
 *     already loads the feed. A second engine on the same screen would be the
 *     opposite of fast.
 *   · So Home offers a **door**: a card that says what is on the map near
 *     you, drawn from the very items Home has already loaded, and one action
 *     that opens the real map at /map.
 *
 * Every number in this card is a real count of loaded items. There are no
 * invented pins, no fake distances, and no "1,240 places" theatre.
 */

/** Pull the area out of a location string: "Kisumu central" → "Kisumu central". */
const areaOf = (item) =>
  String(item?.location || item?.area_name || "").trim();

export default function MapDiscovery({ items = [], place = null, to = "/map" }) {
  // Count the loaded items by the area they name. The areas are real strings
  // from real records, so the list is a list of places people actually traded
  // in — not a generated map legend.
  const areas = new Map();
  for (const item of items) {
    const area = areaOf(item);
    if (!area) continue;
    areas.set(area, (areas.get(area) || 0) + 1);
  }
  const places = [...areas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const count = items.length;

  return (
    <section aria-labelledby="map-discovery-heading" data-testid="map-discovery" className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="map-discovery-heading" className="ds-title">
          On the map
        </h2>
        <Link to={to} className="ds-action" data-testid="map-discovery-open">
          Open the map
          <ArrowUpRight size={13} aria-hidden="true" />
        </Link>
      </div>

      <Link
        to={to}
        className="ds-card ds-card-interactive ds-focus relative block overflow-hidden"
      >
        {/* A drawn map surface: a hairline grid and a soft wash. It is
            decoration with `aria-hidden`, so the card is read by its text. */}
        <div
          aria-hidden="true"
          className="relative h-28 overflow-hidden bg-brand-50 dark:bg-brand-500/10"
          style={{
            backgroundImage:
              "linear-gradient(rgb(var(--brand-500) / 0.14) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--brand-500) / 0.14) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        >
          <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-surface-1 to-transparent" />
          <span className="absolute left-4 top-4 grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white shadow-sm">
            <MapIcon size={17} aria-hidden="true" />
          </span>
        </div>

        <div className="p-3.5">
          <p className="text-sm font-bold text-ink-1">
            {count > 0
              ? `${count} listing${count === 1 ? "" : "s"} near you`
              : "Nothing on the map yet"}
          </p>
          <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">
            {place
              ? `Around ${place}. The map groups suppliers, markets and places by neighbourhood.`
              : "The map groups suppliers, markets and places by neighbourhood."}
          </p>

          {places.length > 0 && (
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {places.map(([area, n]) => (
                <li
                  key={area}
                  className="inline-flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-1 text-2xs font-semibold text-ink-2"
                >
                  <MapPin size={11} className="text-brand-600 dark:text-brand-300" aria-hidden="true" />
                  <span className="max-w-[10rem] truncate">{area}</span>
                  <span className="tabular-nums text-ink-4">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Link>
    </section>
  );
}
