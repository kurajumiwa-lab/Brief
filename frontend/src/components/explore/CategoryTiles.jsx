import { CategoryRow } from "@/components/search/MarketplaceSearch";
import { CATEGORY_TINTS, KIND_TO_CATEGORY, tintForKind } from "@/config/categoryTints";
import { cn } from "@/lib/utils";

/**
 * THE CATEGORY BADGE.
 *
 * The same colours, in the smallest size they are still useful at: a badge on
 * a result card. This is what makes the selector worth learning — the colour
 * you pressed is the colour that comes back.
 */
export function CategoryPill({ kind, label, className }) {
  // The colour comes from the category the kind belongs to; the words stay the
  // kind's own, so a listing reads "Offer" in Goods terracotta rather than
  // being renamed "Goods" by a colour token.
  const tint = tintForKind(kind);
  return (
    <span
      data-tint={KIND_TO_CATEGORY[kind] || "all"}
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-micro font-semibold",
        tint.wash,
        tint.ink,
        className,
      )}
    >
      {label || tint.label}
    </span>
  );
}

/** The category vocabulary, re-exported for anything that still asks here. */
export { CATEGORY_TINTS };

/**
 * The old tile grid. It is now the search's own category row — one list, in
 * one place, used by Home and Explore alike.
 */
export default function CategoryTiles({ value = "all", onSelect, className }) {
  return <CategoryRow value={value} onSelect={onSelect} className={className} />;
}
