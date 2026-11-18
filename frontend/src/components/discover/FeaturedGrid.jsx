import { Link } from "react-router-dom";
import { Flame } from "lucide-react";
import MerchCard from "./MerchCard";

/**
 * FEATURED & TRENDING — one lead card, two compact cards.
 *
 * Order is the feed's own relevance order (proximity, timing, recency, real
 * engagement), not a paid slot and not a view count we do not have. The heading
 * says what it is, and the note says how it was chosen.
 */
export default function FeaturedGrid({ items = [], viewAllTo = null, onSavedChanged }) {
  if (items.length < 3) return null;
  const [lead, ...tail] = items.slice(0, 3);
  return (
    <section aria-labelledby="discover-featured-heading" data-testid="discover-featured" className="space-y-2">
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-[0.18em] text-mk-orange">
            <Flame size={11} aria-hidden="true" /> Trending now
          </p>
          <h2 id="discover-featured-heading" className="mt-1 text-2xl font-black tracking-tight text-mk-ink">
            Featured &amp; Trending
          </h2>
          <p className="mt-0.5 text-[11px] text-mk-ink-soft">Closest, soonest and most active — never paid placement.</p>
        </div>
        {viewAllTo && (
          <Link to={viewAllTo} className="shrink-0 text-[11px] font-extrabold text-mk-ink hover:text-mk-orange">
            View all
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="col-span-2 sm:col-span-2">
          <MerchCard item={lead} featured onSavedChanged={onSavedChanged} />
        </div>
        <div className="col-span-2 grid grid-cols-2 gap-3 sm:col-span-1 sm:grid-cols-1">
          {tail.map((item) => (
            <MerchCard key={`${item.kind}:${item.id}`} item={item} onSavedChanged={onSavedChanged} />
          ))}
        </div>
      </div>
    </section>
  );
}
