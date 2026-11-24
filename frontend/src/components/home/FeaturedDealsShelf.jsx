import { Link } from "react-router-dom";
import { BadgePercent, Store } from "lucide-react";
import Media from "@/components/ui/Media";
import ShelfHeader from "@/components/home/ShelfHeader";
import { parseApiDate } from "@/lib/formatters";

/**
 * FEATURED DEALS — the brief's step 7.
 *
 * These are real Spotted deals, published by a merchant for a real business and
 * expiring on a real date. The rail therefore shows only fields the deal
 * carries: its own discount summary, its own shop, its own expiry. It never
 * computes a "was/now" pair, because the deal does not carry a was-price and a
 * discount that the product invents is a lie told in the merchant's name.
 *
 * Paid ranking is not for sale. Order is the order the server returned, which
 * is expiring-soonest first.
 */

function expiresLabel(value) {
  const date = parseApiDate(value);
  if (!date) return null;
  const days = Math.ceil((date.getTime() - Date.now()) / 86400000);
  if (days < 1) return "Ends today";
  if (days === 1) return "Ends tomorrow";
  return `${days} days left`;
}

function DealCard({ deal }) {
  const expires = expiresLabel(deal.expires_at);
  return (
    <li className="w-[200px] shrink-0 snap-start">
      <Link
        to="/discover?kind=spotted"
        className="shelf-card group block bg-surface-1 transition-transform duration-2 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-brand-500"
        data-testid="deal-card"
      >
        <div className="shelf-media-fade shelf-fade-surface-1 relative h-[104px] overflow-hidden">
          <Media
            src={deal.image_url}
            alt=""
            className="h-full w-full object-cover transition-transform duration-3 group-hover:scale-[1.03]"
            fallback={
              <span className="flex h-full w-full items-center justify-center bg-accent-50 dark:bg-accent-500/15" aria-hidden="true">
                <BadgePercent size={32} strokeWidth={1.4} className="text-accent-700 dark:text-accent-400" />
              </span>
            }
          />
          {expires && (
            <span className="absolute left-2 top-2 rounded-full bg-white/95 px-2 py-0.5 text-2xs font-extrabold text-ink-1 shadow-sm backdrop-blur">
              {expires}
            </span>
          )}
        </div>

        <div className="relative z-10 -mt-4 p-2.5 pt-4">
          <p className="line-clamp-2 text-xs font-extrabold leading-snug text-ink-1">{deal.title}</p>
          {deal.discount_summary && (
            <p className="mt-1 line-clamp-1 text-2xs font-bold text-accent-700 dark:text-accent-400">
              {deal.discount_summary}
            </p>
          )}
          {deal.merchant_name && (
            <p className="mt-0.5 flex items-center gap-1 line-clamp-1 text-2xs text-ink-4">
              <Store size={10} aria-hidden="true" />
              {deal.merchant_name}
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}

export default function FeaturedDealsShelf({ deals = [] }) {
  // Expired deals are not "featured". The endpoint filters, but a stale cache
  // must not resurrect yesterday's offer, so the guard lives here too.
  const live = deals
    .filter((deal) => {
      if (!deal?.expires_at) return true;
      const end = parseApiDate(deal.expires_at);
      return !end || end.getTime() > Date.now();
    })
    .slice(0, 6);

  if (live.length === 0) return null;

  return (
    <section aria-labelledby="deals-heading" data-testid="deals-shelf">
      <ShelfHeader
        id="deals-heading"
        eyebrow="Spotted in shops"
        title="Deals near you"
        to="/discover?kind=spotted"
        linkLabel="All deals"
      />
      <ul className="-mx-4 mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 no-scrollbar sm:-mx-1 sm:px-1">
        {live.map((deal) => (
          <DealCard key={deal.id} deal={deal} />
        ))}
      </ul>
    </section>
  );
}
