import { Link } from "react-router-dom";
import { ArrowRight, Compass, MapPin, PlusCircle, Store } from "lucide-react";
import { countryName, regionLine, regionPath } from "@/config/regions";
import { METRIC_LOADED, metricProvenance, metricValue } from "@/lib/regionMetrics";
import { cn } from "@/lib/utils";

/**
 * THE REGIONAL SPOTLIGHT — the region as a place, with the truth about it.
 *
 * The old spotlight was a promotional poster for "our top picks", and when the
 * feed had nothing to promote it fell back to a large, empty card that said
 * "Around you" and offered nothing. That is the card the review called
 * under-informative, and it was under-informative because it had no region in
 * it at all.
 *
 * This card answers four questions, in order:
 *
 *   1. **Which place is this?** The region's name, its hub and its country —
 *      the identity a local recognises, not a market gate.
 *   2. **What is here?** Four counts — listings, businesses, offers and kinds
 *      of thing — taken from the records the screen actually holds, each one
 *      labelled with where it came from. A count that is not known is a dash,
 *      never a zero.
 *   3. **How far does "here" reach?** The scope line says the point the feed
 *      is centred on and the radius around it.
 *   4. **What can I do about it?** One clear regional action, and one way to
 *      publish into it.
 */
const METRICS = [
  { key: "listings", label: "Listings" },
  { key: "businesses", label: "Businesses" },
  { key: "offers", label: "Offers" },
  { key: "categories", label: "Kinds" },
];

export default function RegionSpotlight({
  region,
  metrics,
  scopeNote = null,
  onPost,
  className,
}) {
  if (!region) return null;

  const known = metrics?.state === METRIC_LOADED;
  const provenance = metricProvenance(metrics, { regionLabel: region.name });

  return (
    <section
      aria-labelledby="region-spotlight-heading"
      data-testid="region-spotlight"
      className={cn(
        "soft-card overflow-hidden rounded-2xl bg-mk-card ring-1 ring-mk-line",
        className,
      )}
    >
      {/* ── identity ─────────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 sm:px-5 sm:pt-5">
        <p className="flex items-center gap-1.5 text-2xs font-extrabold uppercase tracking-[0.18em] text-mk-orange">
          <MapPin size={12} aria-hidden="true" />
          {region.country ? `${countryName(region.country)} · ${region.hub}` : region.hub}
        </p>
        <h2
          id="region-spotlight-heading"
          className="mt-1 text-3xl font-black tracking-[-0.03em] text-mk-ink sm:text-4xl"
        >
          {region.name}
        </h2>
        <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-mk-ink-soft">
          {region.summary}
        </p>

        {Array.isArray(region.knownFor) && region.knownFor.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5" data-testid="region-known-for">
            {region.knownFor.slice(0, 4).map((thing) => (
              <li
                key={thing}
                className="rounded-full bg-mk-warm px-2.5 py-1 text-2xs font-bold text-mk-ink-soft"
              >
                {thing}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── the numbers ───────────────────────────────────────────────────── */}
      <div className="mt-4 border-t border-mk-line bg-mk-cream/60 px-4 py-3.5 sm:px-5">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4" data-testid="region-metrics">
          {METRICS.map(({ key, label }) => (
            <div key={key} className="min-w-0">
              <dt className="text-2xs font-bold uppercase tracking-[0.1em] text-mk-ink-soft">
                {label}
              </dt>
              <dd
                data-testid={`region-metric-${key}`}
                className="mt-0.5 text-2xl font-black tabular-nums tracking-tight text-mk-ink"
              >
                {known ? metricValue(metrics[key]) : "—"}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2.5 text-2xs leading-snug text-mk-ink-soft" data-testid="region-metrics-note">
          {provenance}
        </p>
      </div>

      {/* ── scope + the one clear action ──────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-t border-mk-line px-4 py-3 sm:px-5">
        {scopeNote && (
          <p className="min-w-0 flex-1 text-2xs font-semibold text-mk-ink-soft" data-testid="region-scope-note">
            {scopeNote}
          </p>
        )}
        <Link
          to={regionPath(region)}
          data-testid="region-open"
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-mk-ink px-4 text-xs font-extrabold text-mk-cream transition-colors hover:bg-mk-ink/90"
        >
          <Compass size={14} aria-hidden="true" />
          Open {region.name}
          <ArrowRight size={13} aria-hidden="true" />
        </Link>
        {onPost && (
          <button
            type="button"
            onClick={onPost}
            data-testid="region-post"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-mk-line bg-mk-cream px-4 text-xs font-extrabold text-mk-ink transition-colors hover:border-mk-ink/40"
          >
            <PlusCircle size={14} aria-hidden="true" />
            Post in {region.hub}
          </button>
        )}
      </div>
    </section>
  );
}

/** The one-line summary of a region used above the card on narrow screens. */
export function RegionCaption({ region }) {
  if (!region) return null;
  return (
    <p className="flex items-center gap-1.5 text-2xs text-mk-ink-soft" data-testid="region-caption">
      <Store size={11} aria-hidden="true" />
      {regionLine(region)}
    </p>
  );
}
