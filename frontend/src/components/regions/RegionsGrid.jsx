import { SpottedDealCard } from "@/components/spotted/SpottedDealUI";
import { useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, MapPin, TrendingDown } from "lucide-react";
import { kindLabel, momentumLabel, paletteFor, priceLabel } from "@/lib/categoryArt";
import { ownerRank } from "@/lib/standing";
import { cn } from "@/lib/utils";

/**
 * REGIONS: THE VISUAL DISCOVERY GRID.
 *
 * Two columns on a phone, the same category art as the Home shelf, and the one
 * thing a buyer needs before opening a card: what it is, who is behind it, what
 * it costs, and whether enough people have joined. Nothing here repeats Home's
 * job; this is the browsing surface.
 */
export default function RegionsGrid({ items = [], className, onSpottedChanged = () => {} }) {
  if (items.length === 0) return null;
  return (
    <ul className={cn("grid grid-cols-2 gap-3 lg:grid-cols-3", className)} data-testid="regions-grid">
      {items.map((item) => (
        <li key={`${item.kind}:${item.id}`} className="min-w-0">
          {item.feed_kind === "SPOTTED_DEAL" ? <SpottedDealCard deal={item} onChanged={onSpottedChanged} /> : <RegionCard item={item} />}
        </li>
      ))}
    </ul>
  );
}

export function RegionCard({ item }) {
  const [imageFailed, setImageFailed] = useState(false);
  const palette = paletteFor(item);
  const Icon = palette.Icon;
  const rank = ownerRank(item.owner);
  const place = String(item.location || item.area_name || "").split(",")[0] || "Near you";
  const price = priceLabel(item.price_kes);
  const momentum = momentumLabel(item);
  const trades = Number(item.owner?.movements_completed || 0) + Number(item.owner?.confirmed_trade_proofs || 0);
  const hasImage = Boolean(item.image) && !imageFailed;
  const claimStatus =
    item.claim_status ||
    item.owner?.claim_status ||
    (item.probationary || item.owner?.probationary ? "probationary" : null);

  return (
    <Link
      to={item.to || "#"}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-mk-line bg-mk-card transition-[border-color,transform,box-shadow] duration-2 hover:-translate-y-0.5 hover:border-mk-ink/25 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-brand-500"
      data-testid={`content-card-${item.kind}`}
      data-region-card="true"
    >
      <div
        className="relative aspect-square w-full overflow-hidden bg-mk-warm"
        data-testid="region-card-art"
        data-fallback={hasImage ? "false" : "true"}
      >
        {hasImage ? (
          <img
            src={item.image}
            alt=""
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-3 group-hover:scale-[1.03]"
          />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ backgroundImage: `linear-gradient(135deg, ${palette.from}, ${palette.to})` }}
            aria-hidden="true"
          >
            <Icon size={36} strokeWidth={1.4} style={{ color: palette.ink }} />
          </div>
        )}

        <span className="absolute left-2 top-2 rounded-full border border-mk-line bg-mk-card/95 px-2 py-1 text-[10px] font-extrabold text-mk-ink backdrop-blur">
          {kindLabel(item.kind)}
        </span>
        {(claimStatus === "probationary" || claimStatus === "verified") && (
          <span
            data-testid="region-card-claim-status"
            className={cn(
              "absolute bottom-2 left-2 rounded-full px-2 py-0.5 text-[10px] font-bold backdrop-blur",
              claimStatus === "verified"
                ? "bg-brand-700/90 text-white"
                : "bg-amber-100/95 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100",
            )}
          >
            {claimStatus === "verified" ? "Verified shop" : "Probationary"}
          </span>
        )}
        <span
          className={cn(
            "absolute right-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-extrabold",
            rank.level >= 3
              ? "bg-mk-orange text-white"
              : "bg-mk-card/95 text-mk-ink backdrop-blur",
          )}
          title={`${rank.label} · Lvl ${rank.level}`}
          data-testid="region-card-level"
        >
          {rank.level >= 5 && <BadgeCheck size={11} aria-hidden="true" />}
          Lvl {rank.level}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-3">
        <h3 className="line-clamp-2 text-sm font-extrabold leading-snug text-mk-ink">
          {item.title || kindLabel(item.kind)}
        </h3>

        {(item.meta?.recurring_label || item.recurring_label) && (
          <span
            data-testid="region-card-recurring"
            className="mt-1 inline-flex w-fit items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200"
          >
            {item.meta?.recurring_label || item.recurring_label}
          </span>
        )}

        {item.kind === "provider" && item.meta?.service_count > 0 && (
          <span
            data-testid="region-card-service-count"
            className="mt-1 inline-flex w-fit items-center gap-1 rounded-full border border-edge-1 bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-ink-3"
          >
            {item.meta.service_count} service{item.meta.service_count === 1 ? "" : "s"}
          </span>
        )}

        <div className="mt-2 rounded-xl border border-mk-line bg-mk-cream p-2">
          <p className="flex min-w-0 items-center gap-1 text-[10px] font-bold uppercase tracking-[0.06em] text-mk-ink-soft">
            <MapPin size={9} className="shrink-0" aria-hidden="true" />
            <span className="truncate normal-case tracking-normal">{place}</span>
          </p>
          <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-mk-orange px-2 py-1.5 text-white">
            <span className="truncate text-sm font-black tabular-nums">{price}</span>
            <span className="shrink-0 rounded-md bg-white/20 px-1.5 py-0.5 text-[10px] font-extrabold">Lvl {rank.level}</span>
          </div>
        </div>

        {item.is_fair_corridor_price && (
          <span
            data-testid="region-card-fair-price"
            title={`At or below the ${
              item.corridor_scope_label || item.location || "corridor"
            } median of KSh ${Number(item.corridor_median_kes || 0).toLocaleString()}`}
            className="mt-1 inline-flex w-fit items-center gap-1 rounded-md border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/15 dark:text-brand-200"
          >
            <TrendingDown size={11} aria-hidden="true" />
            Fair Corridor Price
          </span>
        )}

        <div className="mt-auto pt-3">
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
          ) : (
            <div className="flex items-center justify-between gap-1 text-[10px] text-mk-ink-soft">
              <span className="truncate">
                {item.owner?.handle ? `/p/${item.owner.handle}` : "Page not published"}
              </span>
              <span className="shrink-0">
                {trades > 0 ? `${trades} trade${trades === 1 ? "" : "s"}` : "No trades yet"}
              </span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
