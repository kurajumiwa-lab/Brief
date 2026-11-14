import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, MapPin, Search } from "lucide-react";
import { COUNTRIES, REGIONS, regionLabel, regionPath } from "@/config/regions";
import { cn } from "@/lib/utils";

/**
 * THE REGION KNOB.
 *
 * Discovery used to open on a market — "Gikomba" — because the app thought a
 * physical gate was the unit of geography. A market is one address; the people
 * who trade there do not stop at the gate. This control picks a region instead:
 * a corridor with a hub city, which is what the results are actually around.
 *
 * It is a knob, not a settings screen: one press opens the list, one press
 * closes it, and the currently chosen region is always the label.
 */
export default function RegionPicker({ region, onSelect, className }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const needle = search.trim().toLowerCase();
  const groups = COUNTRIES.map((country) => ({
    ...country,
    regions: REGIONS.filter((item) => {
      if (item.country !== country.code) return false;
      if (!needle) return true;
      return [item.name, item.hub, ...item.aliases, ...item.knownFor]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    }),
  })).filter((group) => group.regions.length > 0);

  function choose(item) {
    onSelect?.(item);
    setOpen(false);
    setSearch("");
  }

  return (
    <div className={cn("min-w-0", className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="region-picker"
        className="inline-flex h-8 min-w-0 max-w-full items-center gap-1 rounded-full border border-edge-1 bg-surface-1 px-2.5 text-2xs font-semibold text-ink-2 transition-colors hover:border-ink-4 hover:text-ink-1"
      >
        <MapPin size={12} className="shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
        <span className="truncate" data-testid="region-picker-label">
          {regionLabel(region)}
        </span>
        <ChevronDown
          size={12}
          aria-hidden="true"
          className={cn("shrink-0 text-ink-4 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose a region"
          data-testid="region-picker-panel"
          className="absolute right-0 z-30 mt-2 max-h-[70vh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-edge-1 bg-surface-0 p-3 shadow-lg"
        >
          <label htmlFor="region-picker-search" className="sr-only">
            Find a region or town
          </label>
          <div className="relative">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"
            />
            <input
              id="region-picker-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Region, town or trade"
              className="h-9 w-full rounded-lg border border-edge-1 bg-surface-1 pl-8 pr-3 text-xs text-ink-1 placeholder:text-ink-4 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>

          {groups.length === 0 ? (
            <p className="px-1 py-4 text-xs text-ink-4">
              No region matches “{search.trim()}”. Try a town, or browse all regions.
            </p>
          ) : (
            groups.map((country) => (
              <div key={country.code} className="mt-3">
                <p className="px-1 text-micro font-bold uppercase tracking-[0.12em] text-ink-4">
                  {country.name}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {country.regions.map((item) => {
                    const active = item.slug === region?.slug;
                    return (
                      <li key={item.slug}>
                        <button
                          type="button"
                          onClick={() => choose(item)}
                          aria-pressed={active}
                          data-testid={`region-option-${item.slug}`}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors",
                            active ? "bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-200" : "hover:bg-surface-2",
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-bold text-ink-1">{item.name}</span>
                            <span className="block truncate text-micro text-ink-4">
                              {item.hub} · {item.knownFor.slice(0, 2).join(" · ")}
                            </span>
                          </span>
                          {active && <Check size={14} className="shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-edge-1 pt-2.5">
            <Link
              to="/regions/all"
              onClick={() => setOpen(false)}
              className="text-micro font-bold text-brand-700 hover:underline dark:text-brand-300"
            >
              All regions
            </Link>
            {region && (
              <Link
                to={regionPath(region)}
                onClick={() => setOpen(false)}
                className="inline-flex items-center gap-1 text-micro font-semibold text-ink-3 hover:text-ink-1"
              >
                Open {region.name} <ChevronDown size={11} className="-rotate-90" aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
