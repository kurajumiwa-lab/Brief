import { MapPin } from "lucide-react";
import ListingCard from "@/components/listings/ListingCard";
import ShelfHeader from "@/components/home/ShelfHeader";
import { regionPath } from "@/config/regions";

/**
 * NEARBY GOODS, SERVICES AND RENTALS.
 *
 * A shelf, not a feed. Explore owns browsing every listing with its full
 * context; Home answers "what could I buy or hire within reach, right now?"
 * in three or four cards.
 *
 * The cards are the STANDARD listing card — the same one Explore and the
 * region grid use — so a listing looks the same wherever it is met. That
 * means the card carries the seven facts the brief names and nothing else:
 * an image, a title, a price (or "Price on request"), a distance when there
 * is one, who is behind it, how trusted they are, and a save button.
 *
 * It renders nothing at all when the shelf is empty. An empty carousel above
 * the fold is furniture, and it pushes real content down the page.
 */
const CARDS = 6;

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
      <ul className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3" data-testid="nearby-list">
        {trade.map((item) => (
          <li key={`${item.kind}:${item.id}`} className="min-w-0" data-testid="nearby-card">
            <ListingCard item={item} />
          </li>
        ))}
      </ul>
      <p className="mt-2 flex items-center gap-1 text-2xs text-ink-4">
        <MapPin size={10} aria-hidden="true" />
        Nearest first. Nothing here is paid placement.
      </p>
    </section>
  );
}
