import { Link } from "react-router-dom";
import { ArrowRight, MapPin, Store, Package, Truck, Wrench, Users } from "lucide-react";
import { CATEGORY_TINTS } from "@/config/categoryTints";
import { cn } from "@/lib/utils";

/**
 * ONE MARKET, AS A PLACE WHERE BUSINESS HAPPENS.
 *
 * The card this replaces said "0 registered vendors" and nothing else, which is
 * the same thing a phone book says about a shop that closed. Three rules here:
 *
 *  · **Activity is the headline.** "12 traders selling now" comes first;
 *    "40 registered" is the quiet line under it. A market with a hundred
 *    sign-ups and an empty shelf must not look busier than one where a dozen
 *    people are selling today.
 *  · **An empty market is an invitation.** It says what joining would do for
 *    the reader, in the server's words, and never shows a row of zeroes.
 *  · **The categories are real.** They come from what members actually have on
 *    their shelves, so "Goods · Beverages" is a fact and not a template.
 */

const DOOR_ICONS = { goods: Package, people: Users, services: Truck, equipment: Wrench };

export default function MarketActivityCard({ market, compact = false }) {
  const trading = !market.empty;
  const distance =
    typeof market.distance_km === "number" ? `${market.distance_km} km` : market.located ? null : "not located";

  const categories = Array.isArray(market.categories)
    ? market.categories.map((c) => c.category).filter(Boolean).slice(0, 3)
    : [];

  return (
    <article
      data-testid="market-activity-card"
      data-empty={market.empty ? "true" : "false"}
      className={cn(
        "rounded-2xl border border-edge-1 bg-surface-1 shadow-xs",
        compact ? "p-3" : "p-3.5"
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
            trading ? "bg-brand-500/12 text-brand-700 dark:text-brand-300" : "bg-surface-2 text-ink-4"
          )}
        >
          <Store size={15} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5">
            <Link
              to={`/markets/${market.id}`}
              className="truncate text-xs font-bold tracking-tight text-ink-1 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 dark:hover:text-brand-300"
            >
              {market.name}
            </Link>
            {trading ? (
              <span className="rounded-full bg-brand-500/12 px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">
                Trading
              </span>
            ) : (
              <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-ink-4">
                Inviting
              </span>
            )}
          </div>

          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-micro text-ink-4">
            <span className="inline-flex items-center gap-0.5">
              <MapPin size={9} aria-hidden="true" />
              {[market.city, market.country].filter(Boolean).join(" · ") || "—"}
            </span>
            {distance && <span className="text-ink-3">· {distance}</span>}
          </p>

          {/* The activity line. One number that matters, then the quiet one. */}
          {trading ? (
            <p className="mt-1 text-2xs font-semibold text-ink-2">
              {market.active_vendors} trader{market.active_vendors === 1 ? "" : "s"} selling now
              <span className="font-normal text-ink-4">
                {" "}
                · {market.listings} listing{market.listings === 1 ? "" : "s"}
                {market.services ? ` · ${market.services} service${market.services === 1 ? "" : "s"}` : ""}
                {market.equipment ? ` · ${market.equipment} for hire` : ""}
              </span>
            </p>
          ) : (
            <p className="mt-1 line-clamp-2 text-2xs leading-relaxed text-ink-3">{market.invitation}</p>
          )}

          {categories.length > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-1">
              {categories.map((c) => (
                <span
                  key={c}
                  className="rounded bg-surface-2 px-1.5 py-0.5 text-micro font-medium text-ink-3"
                >
                  {c}
                </span>
              ))}
            </p>
          )}

          {market.registered > 0 && (
            <p className="mt-1 text-micro text-ink-4">
              {market.registered} registered
              {trading && market.recent_vendors ? ` · ${market.recent_vendors} updated this month` : ""}
            </p>
          )}
        </div>

        <Link
          to={`/markets/${market.id}`}
          aria-label={`Open ${market.name}`}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
        >
          <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </div>

      {/* The four doors, only where something is behind them. */}
      {trading && Array.isArray(market.explore) && (
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-edge-1 pt-2">
          {market.explore
            .filter((door) => door.available)
            .map((door) => {
              const Icon = DOOR_ICONS[door.key] || Package;
              // Same hues as the Explore categories: Goods green, People
              // indigo, Services blue, Equipment sand — the vocabulary holds
              // wherever a category is named.
              const tint = CATEGORY_TINTS[door.key];
              return (
                <Link
                  key={door.key}
                  to={`/markets/${market.id}?shelf=${door.key}`}
                  data-tint={door.key}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-semibold transition-colors",
                    tint ? `${tint.wash} ${tint.ink}` : "bg-surface-2 text-ink-2",
                  )}
                >
                  <Icon size={10} aria-hidden="true" />
                  {door.label}
                  <span className="opacity-70">{door.count}</span>
                </Link>
              );
            })}
        </div>
      )}
    </article>
  );
}
