import MerchCard from "./MerchCard";
import { ownerLevel } from "@/lib/standing";
import { regionLabel } from "@/config/regions";

/**
 * NEVER A DEAD END.
 *
 * A strict Level 3+ filter can return nothing in a young corridor. Instead of an
 * empty page, the screen says what happened and shows what is actually active at
 * every level, clearly labelled. This is not a relaxation of the filter: the
 * notice still says the strict result is empty.
 */
export default function FallbackRail({ items = [], region = null, onShowEveryPage, onWiden, onSavedChanged }) {
  const fallback = items.slice(0, 8);
  const label = region ? regionLabel(region) : "this area";
  return (
    <section data-testid="explore-filtered-empty" className="space-y-3">
      <div className="rounded-2xl bg-mk-card p-4 text-sm text-mk-ink">
        <p className="font-extrabold">No Level 3+ traders here yet</p>
        <p className="mt-0.5 text-xs text-mk-ink-soft">
          Level 3 means at least one completed trade on record. The strict filter found none in {label}.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={onShowEveryPage} className="inline-flex h-9 items-center rounded-lg bg-mk-ink px-3 text-micro font-bold text-mk-cream">
            Show every page
          </button>
          {onWiden && (
            <button type="button" onClick={onWiden} className="inline-flex h-9 items-center rounded-lg bg-mk-warm px-3 text-micro font-bold text-mk-ink">
              Widen to 50 km
            </button>
          )}
        </div>
      </div>

      {fallback.length > 0 && (
        <div>
          <div className="mb-2 flex items-end justify-between gap-2">
            <div>
              <h2 className="text-xl font-black text-mk-ink">Popular in {label} <span className="font-semibold text-mk-ink-soft">(all levels)</span></h2>
              <p className="text-micro text-mk-ink-soft">Active now. A level is shown as it is, never rounded up.</p>
            </div>
          </div>
          <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            {fallback.map((item) => {
              const level = ownerLevel(item.owner);
              return (
                <div key={`${item.kind}:${item.id}`} className="w-[46%] min-w-[150px] shrink-0 snap-start sm:w-[220px]">
                  <div className="mb-1 inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-2xs font-bold text-ink-3">
                    {level > 0 ? `Lvl ${level}${level >= 3 ? "+" : ""}` : "New page"}
                  </div>
                  <MerchCard item={item} onSavedChanged={onSavedChanged} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}


/**
 * COLD-START BACKFILL.
 *
 * A young corridor can be empty at 15 km without being empty at 50 km. Rather
 * than a dead end, this rail shows the active pages that do exist, at Level 1–2,
 * with the distance on every card. It is a fallback, never a claim that these
 * are the best traders in the region.
 */
export function ColdStartRail({ items = [], region = null, radius = 15, onSavedChanged }) {
  const label = region ? regionLabel(region) : "this area";
  if (!items.length) return null;
  return (
    <section data-testid="discover-cold-start" className="space-y-3">
      <div className="rounded-2xl bg-mk-card p-4">
        <p className="text-sm font-extrabold text-mk-ink">Quiet within {radius} km</p>
        <p className="mt-0.5 text-xs text-mk-ink-soft">
          Showing active pages nearby, up to 50 km. Each card says how far away it is.
        </p>
      </div>
      <div>
        <h2 className="text-xl font-black text-mk-ink">
          Popular in {label} <span className="font-semibold text-mk-ink-soft">(all levels)</span>
        </h2>
        <p className="text-micro text-mk-ink-soft">Level 1–2 pages, shown as they are — never rounded up.</p>
        <div className="no-scrollbar -mx-4 mt-2 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {items.map((item) => (
            <div key={`${item.kind}:${item.id}`} className="w-[46%] min-w-[150px] shrink-0 snap-start sm:w-[220px]">
              <MerchCard item={item} onSavedChanged={onSavedChanged} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
