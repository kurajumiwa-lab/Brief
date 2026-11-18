import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Heart, MapPin, TrendingDown } from "lucide-react";
import { CategoryPill } from "@/components/explore/CategoryTiles";
import { kindLabel, momentumLabel, paletteFor, priceLabel } from "@/lib/categoryArt";
import { ownerRank } from "@/lib/standing";
import { isFavorite, toggleFavorite } from "@/lib/discoverFavorites";
import { cn } from "@/lib/utils";

/**
 * A DENSE DISCOVERY CARD.
 *
 * The card answers four questions without opening: what is it, where, what it
 * costs, and who is behind it. The whole card is the target; saving is the one
 * separate action, and it says "saved on this device", not "verified".
 */
const CTA = {
  listing: "View offer",
  available: "View offer",
  service: "Book service",
  provider: "Open page",
  rental: "Check dates",
  event: "See event",
  scheduled: "See round",
  person: "Open page",
  post: "Read post",
  community: "Join community",
  collection: "Open collection",
  opportunity: "See request",
  wanted: "See request",
};

function priceWithUnit(item) {
  const base = priceLabel(item.price_kes);
  const unit = item.meta?.unit || item.meta?.starting_price_unit || item.meta?.price_unit;
  if (base === "Open" || !unit) return base;
  return `${base} / ${unit}`;
}

export default function MerchCard({ item, featured = false, onSavedChanged }) {
  const [saved, setSaved] = useState(() => isFavorite(item));
  const primaryCategory = item.meta?.primary_category || null;
  // An Available posting is an offer; it belongs to a good, service or rental.
  // The card says which one instead of presenting "Offer" as a category.
  const offerKind = { goods: "listing", service: "service", rental: "rental" }[primaryCategory];
  const cardKind = offerKind || item.kind;
  const cardLabel = primaryCategory
    ? `${primaryCategory.charAt(0).toUpperCase()}${primaryCategory.slice(1)} offer`
    : kindLabel(item.kind);
  const palette = paletteFor(offerKind ? { ...item, kind: offerKind } : item);
  const Icon = palette.Icon;
  const rank = ownerRank(item.owner);
  const place = String(item.location || item.area_name || "").split(",")[0] || "Near you";
  const trades = Number(item.owner?.movements_completed || 0) + Number(item.owner?.confirmed_trade_proofs || 0);
  const momentum = momentumLabel(item);
  const serviceCount = item.meta?.service_count || 0;
  const cta = primaryCategory === "service" ? "Enquire" : (CTA[item.kind] || "Open");

  function save(event) {
    event.preventDefault();
    event.stopPropagation();
    const next = toggleFavorite(item);
    setSaved(next);
    onSavedChanged?.(next);
  }

  return (
    <article
      data-testid={`content-card-${item.kind}`}
      data-merch-card="true"
      className={cn(
        "group relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-edge-1 bg-surface-1 shadow-xs",
        "transition-[border-color,transform,box-shadow] duration-2 hover:-translate-y-0.5 hover:border-edge-3 hover:shadow-sm",
        featured && "sm:col-span-2",
      )}
    >
      <Link
        to={item.to || "#"}
        aria-label={`Open ${item.title || kindLabel(item.kind)}`}
        className="absolute inset-0 z-10 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      />

      <div
        className={cn("relative w-full overflow-hidden bg-surface-2", featured ? "aspect-[16/10]" : "aspect-[4/3]")}
        data-testid="region-card-art"
        data-fallback={item.image ? "false" : "true"}
      >
        {item.image ? (
          <img src={item.image} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-3 group-hover:scale-[1.03]" />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ backgroundImage: `linear-gradient(135deg, ${palette.from}, ${palette.to})` }}
            aria-hidden="true"
          >
            <Icon size={featured ? 46 : 34} strokeWidth={1.4} style={{ color: palette.ink }} />
          </div>
        )}

        <CategoryPill kind={cardKind} label={cardLabel} className="absolute left-2 top-2 z-20 shadow-xs" />

        {item.distance_km != null && (
          <span
            data-testid="region-card-distance"
            className="absolute bottom-2 left-2 z-20 inline-flex items-center gap-1 rounded-full bg-white/92 px-2 py-0.5 text-[10px] font-bold text-ink-2 shadow-xs backdrop-blur"
          >
            <MapPin size={9} aria-hidden="true" />
            {Number(item.distance_km).toFixed(1)} km
          </span>
        )}

        <span
          data-testid="region-card-level"
          title={`${rank.label} · Lvl ${rank.level}`}
          className={cn(
            "absolute right-2 top-2 z-20 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-extrabold",
            rank.level >= 3 ? "bg-hot text-white" : "bg-white/95 text-ink-2 backdrop-blur",
          )}
        >
          Lvl {rank.level}{rank.level >= 3 ? "+" : ""}
        </span>

        <button
          type="button"
          onClick={save}
          aria-pressed={saved}
          aria-label={saved ? `Remove ${item.title || "card"} from saved` : `Save ${item.title || "card"}`}
          data-testid="merch-card-save"
          className={cn(
            "absolute bottom-2 right-2 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/60 shadow-sm backdrop-blur transition-colors",
            saved ? "bg-brand-700 text-white" : "bg-white/95 text-ink-2 hover:text-brand-700",
          )}
        >
          <Heart size={14} fill={saved ? "currentColor" : "none"} aria-hidden="true" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-3">
        <h3 className={cn("line-clamp-2 font-extrabold leading-snug text-ink-1", featured ? "text-base" : "text-sm")}>
          {item.title || kindLabel(item.kind)}
        </h3>

        {serviceCount > 0 && (
          <span data-testid="region-card-service-count" className="mt-1 inline-flex w-fit items-center rounded-full border border-edge-1 bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-ink-3">
            {serviceCount} service{serviceCount === 1 ? "" : "s"}
          </span>
        )}

        <p className="mt-1 flex min-w-0 items-center gap-1 text-micro text-ink-4">
          <MapPin size={10} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{place}</span>
          <span aria-hidden="true">•</span>
          <span className="shrink-0 font-extrabold text-ink-2">{priceWithUnit(item)}</span>
        </p>

        {item.is_fair_corridor_price && (
          <span
            data-testid="region-card-fair-price"
            title={`At or below the ${item.corridor_scope_label || item.location || "corridor"} median of KSh ${Number(item.corridor_median_kes || 0).toLocaleString()}`}
            className="mt-1 inline-flex w-fit items-center gap-1 rounded-md border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/15 dark:text-brand-200"
          >
            <TrendingDown size={11} aria-hidden="true" /> Fair corridor price
          </span>
        )}

        <div className="mt-auto pt-2.5">
          {momentum?.capacity > 0 ? (
            <>
              <div className="flex items-center justify-between gap-2 text-[10px] font-bold text-ink-3">
                <span data-testid="region-card-momentum">{momentum.text}</span>
                <span className="text-ink-4">{Math.max(momentum.capacity - momentum.joined, 0)} left</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(Math.max(Math.round((momentum.joined / momentum.capacity) * 100), 4), 100)}%` }} aria-hidden="true" />
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-1 text-[10px]">
              <span className="inline-flex items-center gap-1 font-extrabold text-brand-700 dark:text-brand-300">
                {cta} <ArrowRight size={10} aria-hidden="true" />
              </span>
              <span className="shrink-0 text-ink-4">{trades > 0 ? `${trades} trade${trades === 1 ? "" : "s"}` : "No trades yet"}</span>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

/** The standard two-column dense grid. */
export function MerchGrid({ items = [], onSavedChanged }) {
  if (!items.length) return null;
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3" data-testid="regions-grid">
      {items.map((item) => (
        <li key={`${item.kind}:${item.id}`} className="min-w-0">
          <MerchCard item={item} onSavedChanged={onSavedChanged} />
        </li>
      ))}
    </ul>
  );
}
