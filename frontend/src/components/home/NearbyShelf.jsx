import { Link } from "react-router-dom";
import { MapPin } from "lucide-react";
import Media from "@/components/ui/Media";
import ShelfHeader from "@/components/home/ShelfHeader";
import { paletteFor, priceLabel } from "@/lib/categoryArt";
import { photoFor } from "@/lib/photos";
import { regionPath } from "@/config/regions";

/**
 * NEARBY GOODS, SERVICES AND RENTALS — the brief's step 6.
 *
 * A shelf, not a feed. Regions owns browsing every listing with its full
 * context; Home answers "what could I buy or hire within reach, right now?" in
 * three or four cards.
 *
 * Two rules keep it honest:
 *
 *   · A seller's own photograph wins over the library. The library is
 *     atmosphere that comes from the category, never evidence of the item.
 *   · A missing price renders as "Open", because a seller who has not set one
 *     has not set one. The card never fills the gap with a guess.
 *
 * It renders nothing at all when the shelf is empty. An empty carousel above
 * the fold is furniture, and it pushes real content down the page.
 */

const CARDS = 6;

function NearbyCard({ item }) {
  const palette = paletteFor(item);
  const Icon = palette.Icon;
  const place = String(item.area_name || item.location || "").split(",")[0];
  const amount = priceLabel(item.price_kes);
  const label = item.kind === "available" ? "Offer" : null;

  return (
    <li className="w-[168px] shrink-0 snap-start">
      <Link
        to={item.to || "/regions"}
        className="shelf-card group block bg-surface-1 transition-transform duration-2 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-brand-500"
        data-testid="nearby-card"
      >
        <div className="shelf-media-fade shelf-fade-surface-1 relative h-[112px] overflow-hidden">
          <Media
            src={item.image || photoFor(item)}
            alt=""
            className="h-full w-full object-cover transition-transform duration-3 group-hover:scale-[1.03]"
            fallback={
              <span
                className="flex h-full w-full items-center justify-center"
                style={{ backgroundImage: `linear-gradient(135deg, ${palette.from}, ${palette.to})` }}
                aria-hidden="true"
              >
                <Icon size={34} strokeWidth={1.4} style={{ color: palette.ink }} />
              </span>
            }
          />
          {label && (
            <span className="absolute right-2 top-2 rounded-full bg-black/45 px-2 py-0.5 text-2xs font-bold text-white backdrop-blur">
              {label}
            </span>
          )}
        </div>

        <div className="relative z-10 -mt-4 p-2.5 pt-4">
          <p className="line-clamp-2 text-xs font-extrabold leading-snug text-ink-1">{item.title}</p>
          {place && (
            <p className="mt-0.5 line-clamp-1 text-2xs text-ink-4">{place}</p>
          )}
          <p className="mt-1.5 text-xs font-bold tabular-nums text-brand-700 dark:text-brand-400">
            {amount}
          </p>
        </div>
      </Link>
    </li>
  );
}

export default function NearbyShelf({ items = [], region = null }) {
  const trade = items.slice(0, CARDS);
  if (trade.length === 0) return null;

  return (
    <section aria-labelledby="nearby-heading" data-testid="nearby-shelf">
      <ShelfHeader
        id="nearby-heading"
        eyebrow="Within reach"
        title="Goods, services and rentals"
        to={region ? regionPath(region) : "/regions"}
        linkLabel={region ? region.name : "Browse all"}
      />
      <ul className="-mx-4 mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 no-scrollbar sm:-mx-1 sm:px-1">
        {trade.map((item) => (
          <NearbyCard key={`${item.kind}:${item.id}`} item={item} />
        ))}
      </ul>
      <p className="mt-1 flex items-center gap-1 text-2xs text-ink-4">
        <MapPin size={10} aria-hidden="true" />
        Nearest first. Nothing here is paid placement.
      </p>
    </section>
  );
}
