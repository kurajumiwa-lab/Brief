import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Heart, MapPin, Share2, TrendingDown } from "lucide-react";
import { CategoryPill } from "@/components/explore/CategoryTiles";
import { kindLabel, momentumLabel, paletteFor, priceLabel } from "@/lib/categoryArt";
import { photoFor } from "@/lib/photos";
import Media from "@/components/ui/Media";
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
  // A real photograph of the actual listing always wins. Otherwise the card
  // borrows a category photograph so a feed is not a wall of coloured blocks —
  // and if the subject has no honest photograph, this is null and the designed
  // colour-and-icon poster renders instead.
  const photo = item.image || photoFor(item);

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
        // White card, 16px radius, hairline edge, photo on top. The brief's
        // marketplace card — not the dark full-bleed panel this used to be,
        // which made every listing look like a promotion.
        "group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-edge-1 bg-surface-1",
        "shadow-xs transition-shadow duration-2 hover:shadow-md",
        featured && "sm:col-span-2",
      )}
    >
      {/* ── Photograph ───────────────────────────────────────────────────── */}
      <Link
        to={item.to || "#"}
        aria-label={`Open ${item.title || kindLabel(item.kind)}`}
        className={cn("relative block w-full overflow-hidden bg-surface-3",
          featured ? "aspect-[16/9]" : "aspect-[4/3]")}
      >
        <Media
          src={photo}
          alt=""
          className="h-full w-full object-cover transition-transform duration-3 group-hover:scale-[1.03]"
          fallback={
            <span
              className="flex h-full w-full items-center justify-center"
              style={{ backgroundImage: `linear-gradient(135deg, ${palette.from}, ${palette.to})` }}
              aria-hidden="true"
            >
              <Icon size={featured ? 56 : 42} strokeWidth={1.3} style={{ color: palette.ink }} />
            </span>
          }
        />

        {/* The category label sits on the photo; the scrim is a few pixels of
            gradient, not a dark panel over the whole card. */}
        <span className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/45 to-transparent" aria-hidden="true" />
        <CategoryPill
          kind={cardKind}
          label={cardLabel}
          className="absolute left-2 top-2 z-10 border-0 bg-black/55 text-white shadow-none backdrop-blur"
        />
      </Link>

      {/* Save and share float on the photograph, where they cannot eat the text. */}
      <div className="absolute right-2 top-2 z-20 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={save}
          aria-pressed={saved}
          aria-label={saved ? `Remove ${item.title || "card"} from saved` : `Save ${item.title || "card"}`}
          data-testid="merch-card-save"
          className={cn(
            "grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white shadow-sm backdrop-blur transition-colors",
            saved && "text-amber-400",
          )}
        >
          <Heart size={14} fill={saved ? "currentColor" : "none"} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={share}
          aria-label={`Share ${item.title || "card"}`}
          data-testid="region-card-share"
          className="grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white/90 shadow-sm backdrop-blur transition-colors hover:text-white"
        >
          <Share2 size={13} aria-hidden="true" />
        </button>
      </div>

      {shared && (
        <span className="absolute left-2 top-14 z-20 rounded-md bg-black/70 px-2 py-1 text-2xs font-bold text-white backdrop-blur">
          Link copied
        </span>
      )}

      {/* ── Text ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col p-3">
        <Link to={item.to || "#"} className="min-w-0">
          <h3 className={cn("line-clamp-2 font-bold leading-snug text-ink-1", featured ? "text-card-title" : "text-sm")}>
            {item.title || kindLabel(item.kind)}
          </h3>
        </Link>

        {/* Who is behind it and what their record is. Metadata is 12px and
            second-tier colour, per the brief's type ramp. */}
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-2xs font-semibold text-ink-4">
          <span
            data-testid="region-card-level"
            title={`${rank.label} · Lvl ${rank.level}`}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-brand-50 px-1.5 py-0.5 font-bold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
          >
            Lvl {rank.level}{rank.level >= 3 ? "+" : ""}
          </span>
          <span className="truncate">{trades > 0 ? `${trades} trade${trades === 1 ? "" : "s"}` : "No trades yet"}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{place}</span>
        </div>

        {serviceCount > 0 && (
          <span data-testid="region-card-service-count" className="mt-1 inline-flex w-fit items-center rounded-full bg-surface-2 px-1.5 py-0.5 text-2xs font-bold text-ink-3">
            {serviceCount} service{serviceCount === 1 ? "" : "s"}
          </span>
        )}

        {item.is_fair_corridor_price && (
          <span
            data-testid="region-card-fair-price"
            title={`At or below the ${item.corridor_scope_label || item.location || "corridor"} median of KSh ${Number(item.corridor_median_kes || 0).toLocaleString()}`}
            className="mt-1 inline-flex w-fit items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-2xs font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
          >
            <TrendingDown size={11} aria-hidden="true" /> Fair corridor price
          </span>
        )}

        {/* Price and distance are the two facts a buyer scans for, so they get
            the bottom line of the card — not a dark inset panel. */}
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="min-w-0">
            <span className="block text-sm font-black tabular-nums text-ink-1">{priceWithUnit(item)}</span>
            <span className="block truncate text-2xs font-semibold uppercase tracking-wide text-ink-4">{unitLabel(item)}</span>
          </div>
          {item.distance_km != null && (
            <span data-testid="region-card-distance" className="inline-flex shrink-0 items-center gap-0.5 text-2xs font-semibold text-ink-4">
              <MapPin size={10} aria-hidden="true" />
              {Number(item.distance_km).toFixed(1)} km
            </span>
          )}
        </div>

        {momentum?.capacity > 0 && (
          <div className="mt-2">
            <div className="flex items-center justify-between gap-2 text-2xs font-bold text-ink-3">
              <span data-testid="region-card-momentum">{momentum.text}</span>
              <span>{Math.max(momentum.capacity - momentum.joined, 0)} left</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-brand-500"
                style={{ width: `${Math.min(Math.max(Math.round((momentum.joined / momentum.capacity) * 100), 4), 100)}%` }}
                aria-hidden="true"
              />
            </div>
          </div>
        )}

        <Link
          to={item.to || "#"}
          className="mt-2.5 flex h-9 w-full items-center justify-center gap-1 rounded-xl bg-accent-600 text-2xs font-extrabold uppercase tracking-[0.06em] text-white transition-colors hover:bg-accent-700"
        >
          {cta} <ArrowRight size={11} aria-hidden="true" />
        </Link>

        {item.owner?.handle && (
          <span className="mt-1.5 block truncate text-center text-2xs text-ink-4">/p/{item.owner.handle}</span>
        )}
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
