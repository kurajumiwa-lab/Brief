import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Heart, MapPin, Share2, TrendingDown } from "lucide-react";
import { CategoryPill } from "@/components/explore/CategoryTiles";
import { kindLabel, momentumLabel, paletteFor, priceLabel } from "@/lib/categoryArt";
import { ownerRank } from "@/lib/standing";
import { isFavorite, toggleFavorite } from "@/lib/discoverFavorites";
import { cn } from "@/lib/utils";

/**
 * A PRODUCT CARD, SHOPFRONT STYLE.
 *
 * The card answers four questions without opening: what is it, where, what it
 * costs, and who is behind it. The whole card is the target; saving and sharing
 * are the two separate actions, and the save says "saved on this device", not
 * "verified". Prices and distances are the seller's own facts — the orange bar
 * never invents a discount or a minimum order.
 */
const CTA = {
  listing: "View details",
  available: "View details",
  service: "View details",
  provider: "Open page",
  rental: "View details",
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
  return `${base}`;
}

function unitLabel(item) {
  const unit = item.meta?.unit || item.meta?.starting_price_unit || item.meta?.price_unit;
  if (!unit) return "Per offer";
  return `Per ${String(unit).replace(/^per_/, "").replace(/_/g, " ")}`;
}

export default function MerchCard({ item, featured = false, onSavedChanged }) {
  const [saved, setSaved] = useState(() => isFavorite(item));
  const [shared, setShared] = useState(false);
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
  const cta = CTA[item.kind] || "Open";

  function save(event) {
    event.preventDefault();
    event.stopPropagation();
    const next = toggleFavorite(item);
    setSaved(next);
    onSavedChanged?.(next);
  }

  async function share(event) {
    event.preventDefault();
    event.stopPropagation();
    const href = item.to ? `${window.location.origin}${item.to}` : window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: item.title || "Brief", url: href });
      else if (navigator.clipboard) await navigator.clipboard.writeText(href);
      setShared(true);
      window.setTimeout(() => setShared(false), 1600);
    } catch {
      /* the person cancelled the share sheet */
    }
  }

  return (
    <article
      data-testid={`content-card-${item.kind}`}
      data-merch-card="true"
      className={cn(
        "group relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-mk-line bg-mk-card",
        "transition-[border-color,transform,box-shadow] duration-2 hover:-translate-y-0.5 hover:border-mk-ink/25 hover:shadow-sm",
        featured && "sm:col-span-2",
      )}
    >
      <div
        className={cn("relative w-full overflow-hidden bg-mk-warm", featured ? "aspect-[16/10]" : "aspect-square")}
        data-testid="region-card-art"
        data-fallback={item.image ? "false" : "true"}
      >
        <Link to={item.to || "#"} aria-label={`Open ${item.title || kindLabel(item.kind)}`} className="absolute inset-0 z-0">
          {item.image ? (
            <img src={item.image} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-3 group-hover:scale-[1.03]" />
          ) : (
            <span
              className="flex h-full w-full items-center justify-center"
              style={{ backgroundImage: `linear-gradient(135deg, ${palette.from}, ${palette.to})` }}
              aria-hidden="true"
            >
              <Icon size={featured ? 48 : 34} strokeWidth={1.3} style={{ color: palette.ink }} />
            </span>
          )}
        </Link>

        <div className="absolute right-2 top-2 z-20 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={save}
            aria-pressed={saved}
            aria-label={saved ? `Remove ${item.title || "card"} from saved` : `Save ${item.title || "card"}`}
            data-testid="merch-card-save"
            className={cn(
              "grid h-9 w-9 place-items-center rounded-full border border-mk-line bg-mk-card/95 shadow-sm backdrop-blur transition-colors",
              saved ? "text-mk-orange" : "text-mk-ink-soft hover:text-mk-ink",
            )}
          >
            <Heart size={15} fill={saved ? "currentColor" : "none"} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={share}
            aria-label={`Share ${item.title || "card"}`}
            data-testid="region-card-share"
            className="grid h-9 w-9 place-items-center rounded-full border border-mk-line bg-mk-card/95 text-mk-ink-soft shadow-sm backdrop-blur transition-colors hover:text-mk-ink"
          >
            <Share2 size={14} aria-hidden="true" />
          </button>
        </div>

        <CategoryPill
          kind={cardKind}
          label={cardLabel}
          className="absolute left-2 top-2 z-20 border border-mk-line bg-mk-card/95 text-mk-ink shadow-xs backdrop-blur"
        />

        {shared && (
          <span className="absolute bottom-2 left-2 z-20 rounded-md bg-mk-ink px-2 py-1 text-[10px] font-bold text-mk-cream">
            Link copied
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-3">
        <Link to={item.to || "#"} className="min-w-0">
          <h3 className={cn("line-clamp-2 font-extrabold leading-snug text-mk-ink", featured ? "text-base" : "text-sm")}>
            {item.title || kindLabel(item.kind)}
          </h3>
        </Link>

        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] font-bold text-mk-ink-soft">
          <span className="inline-flex items-center gap-0.5 rounded-full bg-mk-warm px-1.5 py-0.5 text-mk-ink">
            Lvl {rank.level}{rank.level >= 3 ? "+" : ""}
          </span>
          <span className="truncate">{trades > 0 ? `${trades} trade${trades === 1 ? "" : "s"}` : "No trades yet"}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{place}</span>
        </div>

        {serviceCount > 0 && (
          <span data-testid="region-card-service-count" className="mt-1 inline-flex w-fit items-center rounded-full border border-mk-line bg-mk-warm px-1.5 py-0.5 text-[10px] font-bold text-mk-ink-soft">
            {serviceCount} service{serviceCount === 1 ? "" : "s"}
          </span>
        )}

        {item.is_fair_corridor_price && (
          <span
            data-testid="region-card-fair-price"
            title={`At or below the ${item.corridor_scope_label || item.location || "corridor"} median of KSh ${Number(item.corridor_median_kes || 0).toLocaleString()}`}
            className="mt-1 inline-flex w-fit items-center gap-1 rounded-md border border-mk-orange/25 bg-mk-orange-soft px-1.5 py-0.5 text-[10px] font-bold text-mk-orange"
          >
            <TrendingDown size={11} aria-hidden="true" /> Fair corridor price
          </span>
        )}

        <div className="mt-2 rounded-xl border border-mk-line bg-mk-cream p-2">
          <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.06em] text-mk-ink-soft">
            <span className="truncate">{unitLabel(item)}</span>
            {item.distance_km != null && (
              <span data-testid="region-card-distance" className="inline-flex shrink-0 items-center gap-0.5 normal-case tracking-normal">
                <MapPin size={9} aria-hidden="true" />
                {Number(item.distance_km).toFixed(1)} km
              </span>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-mk-orange px-2 py-1.5 text-white">
            <span className="truncate text-sm font-black tabular-nums">{priceWithUnit(item)}</span>
            <span
              data-testid="region-card-level"
              title={`${rank.label} · Lvl ${rank.level}`}
              className="shrink-0 rounded-md bg-white/20 px-1.5 py-0.5 text-[10px] font-extrabold"
            >
              Lvl {rank.level}{rank.level >= 3 ? "+" : ""}
            </span>
          </div>
        </div>

        <div className="mt-auto pt-2.5">
          {momentum?.capacity > 0 ? (
            <>
              <div className="flex items-center justify-between gap-2 text-[10px] font-bold text-mk-ink-soft">
                <span data-testid="region-card-momentum">{momentum.text}</span>
                <span>{Math.max(momentum.capacity - momentum.joined, 0)} left</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-mk-warm">
                <div
                  className="h-full rounded-full bg-mk-orange"
                  style={{ width: `${Math.min(Math.max(Math.round((momentum.joined / momentum.capacity) * 100), 4), 100)}%` }}
                  aria-hidden="true"
                />
              </div>
            </>
          ) : null}

          <Link
            to={item.to || "#"}
            className="mt-2 flex h-10 w-full items-center justify-center gap-1 rounded-lg border border-mk-ink/25 bg-mk-card text-[11px] font-extrabold uppercase tracking-[0.06em] text-mk-ink transition-colors hover:border-mk-ink hover:bg-mk-cream"
          >
            {cta} <ArrowRight size={11} aria-hidden="true" />
          </Link>

          {!momentum?.capacity && item.owner?.handle && (
            <span className="mt-1.5 block truncate text-center text-[10px] text-mk-ink-soft">/p/{item.owner.handle}</span>
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
