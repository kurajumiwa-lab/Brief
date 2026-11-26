import { SpottedDealCard } from "@/components/spotted/SpottedDealUI";
import ListingCard from "@/components/listings/ListingCard";
import { cn } from "@/lib/utils";

/**
 * THE REGION GRID — the standard card, in a grid.
 *
 * There used to be a second card design here: a dark, full-bleed panel with
 * the price inside a coloured slab. It looked like a different product from
 * the white shopfront card, and a person moving between the two surfaces saw
 * two different apps.
 *
 * The brief asks for one compact listing card everywhere. This grid now
 * renders it — the same image, title, price-or-price-on-request, distance,
 * seller, trust indicator and save action as Home and Explore.
 *
 * Community-spotted sales keep their own card: they are a report about a
 * place, not a listing, and pretending otherwise would give a rumour the
 * authority of an offer.
 */
export default function RegionsGrid({ items = [], className, onSpottedChanged = () => {} }) {
  if (items.length === 0) return null;
  return (
    <ul className={cn("grid grid-cols-2 gap-3 lg:grid-cols-3", className)} data-testid="regions-grid">
      {items.map((item) => (
        <li key={`${item.kind}:${item.id}`} className="min-w-0">
          {item.feed_kind === "SPOTTED_DEAL" ? (
            <SpottedDealCard deal={item} onChanged={onSpottedChanged} />
          ) : (
            <ListingCard item={item} />
          )}
        </li>
      ))}
    </ul>
  );
}

/** Kept under its old name: the standard card is the region card now. */
export function RegionCard({ item }) {
  return <ListingCard item={item} />;
}
