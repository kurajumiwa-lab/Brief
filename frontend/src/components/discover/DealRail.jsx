import { Link } from "react-router-dom";
import { ArrowRight, BadgePercent, MapPin, PlusCircle, Store } from "lucide-react";
import { priceLabel } from "@/lib/categoryArt";

/**
 * ITEMS ON SALE — a swipeable strip of the priced offers already in the feed.
 * It is a shortcut into the same records the grid below renders, not a second
 * ranking and not a discount we invented.
 *
 * When there is nothing priced here, the empty state is COMPACT and it has two
 * doors: sell something, or report a public sale you walked past. An empty
 * shelf that only says "nothing here" is a dead end; a shelf that says "nothing
 * here yet, and here is how to change that" is an invitation.
 */
export default function DealRail({
  items = [],
  viewAllTo = "/discover?public_sale=true&kind=listing",
  onPublish,
  onSpotSale,
}) {
  return (
    <section aria-labelledby="discover-deals-heading" className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-2xs font-extrabold uppercase tracking-[0.18em] text-mk-orange">Don&apos;t miss out</p>
          <h2 id="discover-deals-heading" className="mt-1 text-2xl font-black tracking-tight text-mk-ink">
            Items on sale
          </h2>
          <p className="mt-0.5 text-2xs text-mk-ink-soft">Priced offers and public sales around you.</p>
        </div>
        {items.length > 0 && (
          <Link
            to={viewAllTo}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-extrabold text-mk-ink hover:text-mk-orange"
          >
            View all <ArrowRight size={13} aria-hidden="true" />
          </Link>
        )}
        {onSpotSale && (
          <button
            type="button"
            onClick={onSpotSale}
            data-testid="discover-deals-spot-header"
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-mk-line bg-mk-card px-3 text-2xs font-extrabold text-mk-ink transition-colors hover:border-mk-orange hover:text-mk-orange"
          >
            <BadgePercent size={12} aria-hidden="true" /> Spot a sale
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div
          data-testid="discover-deals-empty"
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-mk-line bg-mk-card px-4 py-3"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-mk-warm text-mk-orange">
            <BadgePercent size={17} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-extrabold text-mk-ink">No priced items here yet</p>
            <p className="text-2xs text-mk-ink-soft">Sell something, or report a public sale you walked past.</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {onPublish && (
              <button
                type="button"
                onClick={onPublish}
                data-testid="discover-deals-publish"
                className="inline-flex h-9 items-center gap-1 rounded-lg bg-mk-ink px-3 text-2xs font-extrabold text-mk-cream transition-colors hover:bg-mk-ink/90"
              >
                <PlusCircle size={13} aria-hidden="true" /> Sell an item
              </button>
            )}
            {onSpotSale && (
              <button
                type="button"
                onClick={onSpotSale}
                data-testid="discover-deals-spot"
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-mk-line bg-mk-cream px-3 text-2xs font-extrabold text-mk-ink transition-colors hover:border-mk-ink/40"
              >
                <Store size={13} aria-hidden="true" /> Spot a sale
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {items.slice(0, 8).map((item) => (
            <Link
              key={`${item.feed_kind || item.kind}:${item.id}`}
              to={item.to || "#"}
              data-testid={`discover-deal-${item.id}`}
              className="group relative block w-[142px] shrink-0 snap-start overflow-hidden rounded-2xl bg-ink-1 shadow-[0_16px_32px_-26px_rgba(15,10,24,0.55)]"
            >
              <div className="relative aspect-[3/4] overflow-hidden">
                {item.image ? (
                  <img src={item.image} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-3 group-hover:scale-[1.04]" />
                ) : (
                  <span className="absolute inset-0 grid place-items-center bg-gradient-to-br from-accent-700 to-mk-orange text-white/80">
                    <BadgePercent size={28} aria-hidden="true" />
                  </span>
                )}
                <span className="absolute inset-0 bg-gradient-to-t from-ink-1 via-ink-1/55 to-transparent" aria-hidden="true" />
                <span className="absolute left-2 top-2 rounded-md bg-mk-orange px-1.5 py-0.5 text-2xs font-extrabold uppercase tracking-wide text-white">
                  {item.feed_kind === "SPOTTED_DEAL" ? "Spotted" : "Priced"}
                </span>
                <div className="absolute inset-x-0 bottom-0 p-2.5 text-white">
                  <p className="line-clamp-2 text-[12px] font-extrabold leading-snug">{item.title}</p>
                  <p className="mt-1 text-[13px] font-black text-[#FFD7A8]">{priceLabel(item.price_kes)}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-2xs text-white/70">
                    <MapPin size={9} aria-hidden="true" />
                    <span className="truncate">{String(item.location || "Near you").split(",")[0]}</span>
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
