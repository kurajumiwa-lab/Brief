import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * CARD SHELL — the frame every home-feed card shares.
 *
 * Two rules this file exists to enforce, once:
 *
 *  1. **Tap anywhere, swipe anywhere.** The whole card is one stretched link
 *     (`absolute inset-0`), so a merchant can hit it with a thumb. Anything
 *     interactive inside the card sits at `z-10` and stays its own target, and
 *     the carousel's swipe guard (see `components/ui/Shelf`) suppresses the
 *     link when a gesture was a swipe, not a tap.
 *  2. **One size for every card.** Media is always the same ratio and cards
 *     always the same width, so a carousel never jumps as it loads and the
 *     shelves line up down the feed.
 */

/** The card slot: identical width for every shelf, at every breakpoint. */
export const CARD_SLOT = "w-[10rem] sm:w-44 lg:w-48";

/** The media ratio every card uses — one shape, no layout shift. */
export const CARD_MEDIA_RATIO = "aspect-[4/3]";

export default function CardShell({ to, label, children, className, footer }) {
  return (
    <article
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-2xl border border-edge-1 bg-surface-0 shadow-xs glass-hover",
        className
      )}
    >
      <Link
        to={to}
        aria-label={label}
        className="absolute inset-0 z-0 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-1"
      >
        <span className="sr-only">{label}</span>
      </Link>
      {children}
      {footer}
    </article>
  );
}

/** Media slot: real image when the record has one, a keyed illustration when it does not. */
export function CardMedia({ src, ratio = CARD_MEDIA_RATIO, tint = "bg-surface-2", fallback, children }) {
  return (
    <div className={cn("relative shrink-0 overflow-hidden border-b border-edge-1", ratio, src ? "bg-surface-2" : tint)}>
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center" aria-hidden="true">
          {fallback}
        </div>
      )}
      {children}
    </div>
  );
}

/** The card's text block. Not interactive — the stretched link owns the tap. */
export function CardBody({ children, className }) {
  return <div className={cn("pointer-events-none flex flex-1 flex-col gap-1 p-2.5", className)}>{children}</div>;
}

/** A card's own action row, above the stretched link. */
export function CardActions({ children, className }) {
  return <div className={cn("relative z-10 flex items-center gap-1.5 px-2.5 pb-2.5", className)}>{children}</div>;
}

/** Title line — two lines maximum, in every card, so shelves stay level. */
export function CardTitle({ children, className }) {
  return <h3 className={cn("text-2xs font-semibold leading-snug text-ink-1 line-clamp-2", className)}>{children}</h3>;
}

/** The one number a merchant acts on, e.g. a price or a pay rate. */
export function CardPrice({ children, className }) {
  return <p className={cn("text-xs font-bold tabular-nums text-ink-1", className)}>{children}</p>;
}

/** Supporting line, one line, always truncating. */
export function CardMeta({ children, className }) {
  return <p className={cn("truncate text-micro text-ink-4", className)}>{children}</p>;
}

/** Compact identity line: who this record belongs to. */
export function CardVendor({ name }) {
  if (!name) return null;
  return (
    <p className="mt-auto flex items-center gap-1 truncate pt-1 text-micro font-medium text-ink-3">
      <span
        className="grid h-4 w-4 shrink-0 place-items-center rounded-md bg-surface-2 text-[8px] font-bold uppercase text-ink-3"
        aria-hidden="true"
      >
        {String(name).replace(/^@/, "").slice(0, 2)}
      </span>
      <span className="truncate">{name}</span>
    </p>
  );
}
