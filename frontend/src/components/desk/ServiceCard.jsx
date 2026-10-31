import { ArrowRight, Clock } from "lucide-react";
import { num } from "@/lib/formatters";
import { tintForDesk } from "@/config/categoryTints";
import { cn } from "@/lib/utils";

/**
 * ONE SERVICE, ON THE SECOND SCREEN.
 *
 * What a buyer needs to decide whether to look closer: what it is, roughly what
 * it costs, how long it takes, and what happens if they pick it. Nothing else —
 * the deliverables and exclusions live on the service's own screen, where they
 * are the point rather than a wall between rows.
 *
 * The readiness wording comes from the server (`cta`), never from this file, so
 * a card cannot offer to sell a pilot.
 */
export function money(min, max, unit) {
  if (min == null) return "Scoped quotation";
  const range = min === max ? `KSh ${num(min)}` : `KSh ${num(min)}–${num(max)}`;
  if (unit === "monthly") return `${range}/mo`;
  if (unit === "setup_once") return `${range} once`;
  return range;
}

export default function ServiceCard({ offer, deskKey, onSelect, className }) {
  const tint = tintForDesk(deskKey || offer.desk);
  return (
    <button
      type="button"
      onClick={() => onSelect(offer.key)}
      data-testid={`service-${offer.key}`}
      data-desk={offer.desk}
      className={cn(
        "group flex w-full flex-col gap-1.5 rounded-xl border border-edge-1 bg-surface-1 p-3 text-left",
        "transition-colors hover:border-edge-3 hover:bg-surface-2/60",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50",
        className,
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold leading-tight text-ink-1">{offer.name}</span>
        <ArrowRight
          size={14}
          className="mt-0.5 shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </span>

      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-base font-extrabold tabular-nums text-ink-1">
          {money(offer.price_min_kes, offer.price_max_kes, offer.price_unit)}
        </span>
        <span className="text-micro text-ink-4">test price</span>
      </span>

      <span className="flex items-center gap-1 text-micro text-ink-4">
        <Clock size={11} aria-hidden="true" />
        <span className="truncate">{offer.turnaround}</span>
      </span>

      <span
        className={cn(
          "mt-0.5 inline-flex w-fit items-center rounded-full px-2 py-0.5 text-micro font-semibold",
          tint.wash,
          tint.ink,
        )}
      >
        {offer.cta?.label || "Enquire"}
      </span>
    </button>
  );
}
