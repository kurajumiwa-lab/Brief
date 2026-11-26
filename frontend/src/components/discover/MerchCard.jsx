import ListingCard, { ListingGrid } from "@/components/listings/ListingCard";

/**
 * THE SHOPFRONT CARD — now ONE card.
 *
 * There used to be two listing cards: this one (white, with a category pill,
 * a price line and a call to action) and `RegionCard` (dark, full bleed).
 * They said different things about the same listing, which is exactly how a
 * marketplace starts to feel like several products.
 *
 * The brief asks for one compact listing card with a fixed set of facts, used
 * everywhere. `ListingCard` is that card. This file keeps the old names so
 * every existing import — and every existing test id — keeps working, and
 * there is now exactly one implementation to change.
 */
export default function MerchCard(props) {
  return <ListingCard {...props} />;
}

/** The standard two-column dense grid. */
export function MerchGrid({ items = [], onSavedChanged, className }) {
  return <ListingGrid items={items} onSavedChanged={onSavedChanged} className={className} />;
}
