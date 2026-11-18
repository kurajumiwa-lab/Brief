import { Link } from "react-router-dom";
import { ArrowRight, BadgePercent, MapPin } from "lucide-react";
import { priceLabel } from "@/lib/categoryArt";

/**
 * ITEMS ON SALE — a swipeable strip of the priced offers already in the feed.
 * It is a shortcut into the same records the grid below renders, not a second
 * ranking and not a discount we invented.
 */
export default function DealRail({ items = [], viewAllTo = "/discover?public_sale=true&kind=listing" }) {
  return (
    <section aria-labelledby="discover-deals-heading" className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-mk-orange">Don't miss out</p>
          <h2 id="discover-deals-heading" className="mt-1 text-2xl font-black tracking-tight text-mk-ink">
            Items on sale
          </h2>
          <p className="mt-0.5 text-[11px] text-mk-ink-soft">Priced offers and public sales around you.</p>
        </div>
        <Link
          to={viewAllTo}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-extrabold text-mk-ink hover:text-mk-orange"
        >
          View all <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-mk-line bg-mk-card px-4 py-8 text-center">
          <BadgePercent size={20} className="mx-auto text-mk-orange" aria-hidden="true" />
          <p className="mt-2 text-sm font-bold text-mk-ink">No priced items here yet</p>
          <p className="mt-0.5 text-xs text-mk-ink-soft">Publish an offer, or spot a public sale you walked past.</p>
        </div>
      ) : (
        <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {items.slice(0, 8).map((item) => (
            <Link
              key={`${item.feed_kind || item.kind}:${item.id}`}
              to={item.to || "#"}
              data-testid={`discover-deal-${item.id}`}
              className="group w-[142px] shrink-0 snap-start overflow-hidden rounded-2xl border border-mk-line bg-mk-card"
            >
              <div className="relative aspect-square overflow-hidden bg-mk-warm">
                {item.image ? (
                  <img src={item.image} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-3 group-hover:scale-[1.04]" />
                ) : (
                  <span className="grid h-full w-full place-items-center text-mk-orange">
                    <BadgePercent size={26} aria-hidden="true" />
                  </span>
                )}
                <span className="absolute left-2 top-2 rounded-md bg-mk-orange px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
                  {item.feed_kind === "SPOTTED_DEAL" ? "Spotted" : "Priced"}
                </span>
              </div>
              <div className="space-y-1 p-2.5">
                <p className="line-clamp-2 text-[12px] font-extrabold leading-snug text-mk-ink">{item.title}</p>
                <p className="text-[13px] font-black text-mk-ink">{priceLabel(item.price_kes)}</p>
                <p className="flex items-center gap-1 text-[10px] text-mk-ink-soft">
                  <MapPin size={9} aria-hidden="true" />
                  <span className="truncate">{String(item.location || "Near you").split(",")[0]}</span>
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
