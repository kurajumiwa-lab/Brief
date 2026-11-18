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
          <h2 id="discover-featured-heading" className="flex items-center gap-1.5 text-title-section font-extrabold text-ink-1">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-hot-soft text-hot">
              <Flame size={13} aria-hidden="true" />
            </span>
            Featured &amp; Trending
          </h2>
          <p className="mt-0.5 text-micro text-ink-4">Closest, soonest and most active — never paid placement.</p>
        </div>
        {viewAllTo && (
          <Link to={viewAllTo} className="shrink-0 text-micro font-bold text-brand-700 hover:underline dark:text-brand-300">
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
