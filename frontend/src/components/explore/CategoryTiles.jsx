import { CATEGORY_TINTS, EXPLORE_CATEGORIES, KIND_TO_CATEGORY, tintForKind } from "@/config/categoryTints";
import { cn } from "@/lib/utils";

/**
 * THE CATEGORY SELECTOR — colour as a wayfinding tool, not decoration.
 *
 * Seven tiles, no carousel, no horizontal strip: every category is visible at
 * once and wraps into as many rows as the screen needs. Hiding "Communities"
 * behind a swipe would make it a secret, and a discovery screen cannot afford
 * secret destinations.
 *
 * The hue is stable and shared (`config/categoryTints`), so Services is the
 * same pale blue here as it is on a result card and on a market's door list.
 * Selection is announced with `aria-pressed` as well as colour — the tint is an
 * aid, never the only signal.
 */
export function CategoryTiles({ value, onSelect, className }) {
  return (
    <div
      role="group"
      aria-label="Browse by category"
      data-testid="explore-categories"
      className={cn("grid grid-cols-4 gap-1.5 sm:grid-cols-7", className)}
    >
      {EXPLORE_CATEGORIES.map(({ key, kind }) => {
        const tint = CATEGORY_TINTS[key];
        const Icon = tint.icon;
        const active = value === kind;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(active ? "" : kind)}
            data-testid={`explore-kind-${kind}`}
            data-category={key}
            className={cn(
              "group flex flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 transition-colors",
              "min-h-[56px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50",
              tint.wash,
              tint.ink,
              active
                ? "border-transparent ring-2 ring-inset ring-current"
                : "border-transparent hover:brightness-[0.98] dark:hover:brightness-110",
            )}
          >
            <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
            <span className="text-micro font-semibold leading-none">{tint.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The same colours, in the smallest size they are still useful at: a badge on a
 * result card. This is what makes the selector worth learning — the colour you
 * pressed is the colour that comes back.
 */
export function CategoryPill({ kind, label, className }) {
  // The colour comes from the category the kind belongs to; the words stay the
  // kind's own, so a listing reads "Listing" in Goods green rather than being
  // renamed "Goods" by a colour token.
  const tint = tintForKind(kind);
  return (
    <span
      data-tint={KIND_TO_CATEGORY[kind] || "post"}
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

export default CategoryTiles;
