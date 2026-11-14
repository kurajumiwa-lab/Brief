import { Link } from "react-router-dom";
import { ArrowUpRight, ChevronRight, MapPin } from "lucide-react";
import { COUNTRIES, REGIONS, countryName, regionPath } from "@/config/regions";
import { cn } from "@/lib/utils";

/**
 * REGIONS — the replacement for the market directory.
 *
 * A market is a place with a gate. A region is where a person actually trades,
 * and it survives them changing what they sell. The screen is a list, not a grid
 * of cards, because the job is "where is this?" and the fastest answer is a
 * name, a hub city and one line of what the place is known for.
 *
 * Verification did not get a region of its own. The old Mall was a separate tab
 * for verified businesses; here a confirmed page carries a badge in every
 * region, which is both more useful to a buyer and one fewer screen to keep.
 */
export default function RegionsView({
  country = "",
  onCountry,
  regions = REGIONS,
  counts = null,
  search = "",
  onSearch,
}) {
  const shown = country ? regions.filter((region) => region.country === country) : regions;
  const grouped = COUNTRIES.map((c) => ({
    ...c,
    regions: shown.filter((region) => region.country === c.code),
  })).filter((group) => group.regions.length > 0);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <header>
        <p className="eyebrow">Discovery</p>
        <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-ink-1 sm:text-3xl">Regions</h1>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-ink-3">
          The corridor, not the market stall. Pick where you trade and see the
          people, pages and offers around it.
        </p>
      </header>

      {onSearch && (
        <div className="mt-5">
          <label htmlFor="region-search" className="sr-only">
            Search a region, town or trade
          </label>
          <input
            id="region-search"
            type="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search a region, town or trade"
            className="h-11 w-full rounded-xl border border-edge-1 bg-surface-1 px-4 text-sm text-ink-1 placeholder:text-ink-4 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </div>
      )}

      <div className="mt-4 flex gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label="Country">
        {[{ code: "", name: "All" }, ...COUNTRIES].map((option) => {
          const active = country === option.code;
          return (
            <button
              key={option.code || "all"}
              type="button"
              onClick={() => onCountry?.(option.code)}
              aria-pressed={active}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1.5 text-2xs font-bold transition-colors",
                active
                  ? "border-brand-700 bg-brand-700 text-white"
                  : "border-edge-1 bg-surface-1 text-ink-3 hover:border-edge-2 hover:text-ink-1",
              )}
            >
              {option.name}
            </button>
          );
        })}
      </div>

      <div className="mt-6 space-y-7">
        {grouped.map((group) => (
          <section key={group.code} aria-labelledby={`country-${group.code}`}>
            <h2 id={`country-${group.code}`} className="eyebrow">
              {group.name}
            </h2>
            <ul className="mt-1.5 divide-y divide-edge-1 border-y border-edge-1">
              {group.regions.map((region) => (
                <li key={region.slug}>
                  <Link
                    to={regionPath(region)}
                    className="group flex items-center gap-3 py-4 px-1 -mx-1 rounded-xl hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                      <MapPin size={17} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate text-sm font-bold text-ink-1">{region.name}</span>
                        <span className="shrink-0 text-micro text-ink-4">{region.hub}</span>
                        {counts?.[region.slug] > 0 && (
                          <span className="ml-auto shrink-0 text-micro tabular-nums text-ink-4">
                            {counts[region.slug]} pages
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 line-clamp-1 block text-2xs text-ink-3">
                        {region.summary}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {region.knownFor.slice(0, 4).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-surface-2 px-2 py-0.5 text-micro font-medium text-ink-3"
                          >
                            {tag}
                          </span>
                        ))}
                      </span>
                    </span>
                    <ChevronRight size={15} className="shrink-0 text-ink-4 group-hover:text-ink-1" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {grouped.length === 0 && (
          <div className="rounded-2xl border border-dashed border-edge-2 bg-surface-0 px-5 py-10 text-center">
            <p className="text-sm font-bold text-ink-1">No region matches that</p>
            <p className="mt-1 text-2xs text-ink-3">
              Try a town name — Kisumu, Mbale, Arusha — or clear the country filter.
            </p>
          </div>
        )}
      </div>

      <aside className="mt-8 rounded-2xl border border-edge-1 bg-surface-1 p-4">
        <p className="text-2xs font-bold text-ink-1">A confirmed page carries its badge everywhere</p>
        <p className="mt-1 text-2xs leading-relaxed text-ink-3">
          There is no separate directory for verified businesses. A page that an
          institution or a regulator has confirmed shows that mark in every region
          it appears in, and an unconfirmed page says so rather than hiding.
        </p>
        <Link
          to="/you/rank"
          className="mt-2 inline-flex items-center gap-1 text-micro font-bold text-brand-700 hover:underline dark:text-brand-400"
        >
          How confirmation works
          <ArrowUpRight size={12} aria-hidden="true" />
        </Link>
      </aside>

      <p className="mt-6 text-center text-micro text-ink-4">
        {shown.length} regions · {COUNTRIES.map((c) => countryName(c.code)).join(", ")}
      </p>
    </div>
  );
}
