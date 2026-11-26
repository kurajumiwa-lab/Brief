import { useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Heart, MapPin, Share2, TrendingDown } from "lucide-react";
import { CategoryPill } from "@/components/explore/CategoryTiles";
import { kindLabel, listingPrice, momentumLabel, paletteFor } from "@/lib/categoryArt";
import { photoFor } from "@/lib/photos";
import { ownerRank } from "@/lib/standing";
import { isFavorite, toggleFavorite } from "@/lib/discoverFavorites";
import { cn } from "@/lib/utils";

/**
 * THE LISTING CARD — one card, everywhere.
 *
 * The brief asks for compact, visually consistent listing cards that carry a
 * fixed set of facts: an image, a title, a price (or "Price on request"), a
 * distance when there is one, who is behind it, whether they can be trusted,
 * and a save action.
 *
 * There used to be two of these — a white shopfront card and a dark
 * full-bleed one — and they said different things about the same listing.
 * This is the one card now, on Home, on Explore and in the region grid, and
 * it says the same seven things every time.
 *
 * What it will NOT do:
 *
 *   · invent a price. No price means "Price on request", not a guess;
 *   · invent a distance. A record with no position shows no distance;
 *   · claim trust it has not got. The level chip is the person's real
 *     standing, and a Level 1 trader is never painted like a Level 5 one;
 *   · take the space a save button needs. Save and share sit on the photo,
 *     where they cannot eat the title or the price.
 */
export default function ListingCard({ item, featured = false, onSavedChanged }) {
  const [saved, setSaved] = useState(() => isFavorite(item));
  const [shared, setShared] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

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
  const seller = item.owner?.name || item.owner?.business_name || (item.owner?.handle ? `@${item.owner.handle}` : "");
  const trades = Number(item.owner?.movements_completed || 0) + Number(item.owner?.confirmed_trade_proofs || 0);
  const momentum = momentumLabel(item);
  const serviceCount = item.meta?.service_count || 0;
  const price = listingPrice(item.price_kes);
  const onRequest = price === "Price on request";
  // A real photograph of the actual listing always wins. Otherwise the card
  // borrows a category photograph so a feed is not a wall of coloured blocks.
  const photo = item.image || photoFor(item);
  const hasImage = Boolean(photo) && !imageFailed;
  // "Is there a photograph OF THIS LISTING?" is a different question from
  // "is there an image on the card?". A category photograph is atmosphere, not
  // evidence, so the card says so: `data-fallback` is true unless the seller
  // published their own picture.
  const ownPhoto = Boolean(item.image) && !imageFailed;
  const claimStatus =
    item.claim_status ||
    item.owner?.claim_status ||
    (item.probationary || item.owner?.probationary ? "probationary" : null);

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
      if (navigator.share) await navigator.share({ title: item.title || "Wasta", url: href });
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
      data-listing-card="true"
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-2xl border border-edge-1 bg-surface-1",
        "transition-shadow duration-2 hover:shadow-md focus-within:ring-2 focus-within:ring-brand-500/40",
      )}
    >
      {/* ── Photograph ───────────────────────────────────────────────────── */}
      <Link
        to={item.to || "#"}
        aria-label={`Open ${item.title || kindLabel(item.kind)}`}
        className={cn("relative block w-full overflow-hidden bg-surface-3",
          featured ? "aspect-[16/9]" : "aspect-[4/3]")}
      >
        <span
          className="absolute inset-0 overflow-hidden"
          data-testid="region-card-art"
          data-fallback={ownPhoto ? "false" : "true"}
        >
          {hasImage ? (
            <img
              src={photo}
              alt=""
              loading="lazy"
              onError={() => setImageFailed(true)}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-3 group-hover:scale-[1.03]"
            />
          ) : (
            <span
              className="absolute inset-0 flex items-center justify-center"
              style={{ backgroundImage: `linear-gradient(135deg, ${palette.from}, ${palette.to})` }}
              aria-hidden="true"
            >
              <Icon size={42} strokeWidth={1.3} style={{ color: palette.ink }} />
            </span>
          )}
          <span
            className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/45 to-transparent"
            aria-hidden="true"
          />
        </span>

        {/* The category colour is not decoration: it is the colour the person
            pressed in the selector, carried onto the card that came back. */}
        <CategoryPill
          kind={cardKind}
          label={cardLabel}
          className="absolute left-2 top-2 z-10 border-0 shadow-sm"
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

        {/* Price and distance are the two facts a buyer scans for, so they get
            the bottom line of the card. An unpriced listing says so. */}
        <div className="mt-1.5 flex items-end justify-between gap-2">
          <span
            data-testid="listing-card-price"
            className={cn(
              "block truncate text-sm font-black tabular-nums",
              onRequest ? "text-ink-3" : "text-ink-1",
            )}
          >
            {price}
          </span>
          {item.distance_km != null ? (
            <span
              data-testid="region-card-distance"
              className="inline-flex shrink-0 items-center gap-0.5 text-2xs font-semibold text-ink-4"
            >
              <MapPin size={10} aria-hidden="true" />
              {Number(item.distance_km).toFixed(1)} km
            </span>
          ) : (
            <span
              data-testid="listing-card-place"
              className="inline-flex shrink-0 items-center gap-0.5 truncate text-2xs font-semibold text-ink-4"
            >
              <MapPin size={10} aria-hidden="true" />
              {place}
            </span>
          )}
        </div>

        {/* Who is behind it. A seller with no published name is not given
            one — the handle is shown instead, or nothing at all. */}
        {seller && (
          <p className="mt-1 truncate text-2xs font-semibold text-ink-3" data-testid="listing-card-seller">
            {seller}
          </p>
        )}

        {/* The trust indicator is the person's real standing, never a badge
            they have not earned. */}
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-2xs font-semibold text-ink-4">
          <span
            data-testid="region-card-level"
            title={`${rank.label} · Lvl ${rank.level}`}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-brand-50 px-1.5 py-0.5 font-bold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
          >
            {rank.level >= 5 && <BadgeCheck size={10} aria-hidden="true" />}
            Lvl {rank.level}{rank.level >= 3 ? "+" : ""}
          </span>
          <span className="truncate">
            {trades > 0 ? `${trades} trade${trades === 1 ? "" : "s"}` : "No trades yet"}
          </span>
          {claimStatus === "verified" && (
            <span
              data-testid="region-card-claim-status"
              className="inline-flex shrink-0 items-center rounded-full bg-brand-600 px-1.5 py-0.5 font-bold text-white"
            >
              Verified shop
            </span>
          )}
          {claimStatus === "probationary" && (
            <span
              data-testid="region-card-claim-status"
              className="inline-flex shrink-0 items-center rounded-full bg-surface-2 px-1.5 py-0.5 font-bold text-ink-3"
            >
              Probationary
            </span>
          )}
        </div>

        {serviceCount > 0 && (
          <span
            data-testid="region-card-service-count"
            className="mt-1 inline-flex w-fit items-center rounded-full bg-surface-2 px-1.5 py-0.5 text-2xs font-bold text-ink-3"
          >
            {serviceCount} service{serviceCount === 1 ? "" : "s"}
          </span>
        )}

        {(item.meta?.recurring_label || item.recurring_label) && (
          <span
            data-testid="region-card-recurring"
            className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-surface-2 px-1.5 py-0.5 text-2xs font-bold text-ink-3"
          >
            {item.meta?.recurring_label || item.recurring_label}
          </span>
        )}

        {item.is_fair_corridor_price && (
          <span
            data-testid="region-card-fair-price"
            title={`At or below the ${item.corridor_scope_label || item.location || "corridor"} median of KSh ${Number(item.corridor_median_kes || 0).toLocaleString()}`}
            className="mt-1 inline-flex w-fit items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-2xs font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
          >
            <TrendingDown size={11} aria-hidden="true" /> Fair Corridor Price
          </span>
        )}

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

        {item.owner?.handle && (
          <span className="mt-2 block truncate text-2xs text-ink-4">/p/{item.owner.handle}</span>
        )}
      </div>
    </article>
  );
}

/** The standard two-column dense grid. */
export function ListingGrid({ items = [], onSavedChanged, className }) {
  if (!items.length) return null;
  return (
    <ul className={cn("grid grid-cols-2 gap-3 lg:grid-cols-3", className)} data-testid="regions-grid">
      {items.map((item) => (
        <li key={`${item.kind}:${item.id}`} className="min-w-0">
          <ListingCard item={item} onSavedChanged={onSavedChanged} />
        </li>
      ))}
    </ul>
  );
}
