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
 *
 * v3.2: the slot is a little wider and the media a little shorter (16:10 rather
 * than 4:3), which is where a 390px phone stops feeling cramped — three cards
 * still peek across the rail, and each card carries about a fifth more text.
 *
 * The media slot also stops being a bordered box when the card is filled in:
 * `bare` drops the hairline and the background tint, so a real photograph (or
 * the market-green identity panel) reaches the card's edges instead of sitting
 * inside one more outline.
 */

/** The card slot: identical width for every shelf, at every breakpoint. */
export const CARD_SLOT = "w-[11.5rem] sm:w-48 lg:w-52";

/** The media ratio every card uses — one shape, no layout shift. */
export const CARD_MEDIA_RATIO = "aspect-[16/10]";

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
export function CardMedia({ src, ratio = CARD_MEDIA_RATIO, tint = "bg-surface-2", fallback, bare = false, children, className }) {
  return (
    <div className={cn("relative shrink-0 overflow-hidden", !bare && "border-b border-edge-1", ratio, src ? "bg-surface-2" : tint, className)}>
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

/**
 * THE CARD POSTER — what a card shows in its media slot when the record has no
 * photograph of its own.
 *
 * Most records in this network are not photographed: a group, a market, a
 * delivery request, a service offer. The old answer was a small icon floating in
 * an otherwise empty tinted box, which read as "missing image". This is the
 * designed answer instead — the same slot, carrying an idea at the size of the
 * slot: the module's mark above the one word that says what you are looking at.
 * Nothing is faked; the mark and the word come from the record and its module.
 *
 * Tones are literal class strings so Tailwind can see them, and every one is
 * token-based, so both themes and a re-skin keep working.
 */
const POSTER_TONES = {
  brand: "bg-brand-50 text-brand-700 dark:bg-surface-2 dark:text-brand-300",
  amber: "bg-accent-50 text-accent-700 dark:bg-surface-2 dark:text-accent-300",
  blue: "bg-blue-50 text-blue-700 dark:bg-surface-2 dark:text-blue-300",
  orchid: "bg-orchid-50 text-orchid-700 dark:bg-surface-2 dark:text-orchid-300",
  slate: "bg-surface-2 text-ink-3",
};

export function CardPoster({ icon: Icon, label, tone = "brand", corner, className }) {
  return (
    <CardMedia bare tint={POSTER_TONES[tone] || POSTER_TONES.brand} className={className}>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center">
        {Icon && <Icon size={22} aria-hidden="true" />}
        {label && (
          <span className="line-clamp-1 text-micro font-bold uppercase tracking-[0.12em]">{label}</span>
        )}
      </div>
      {corner}
    </CardMedia>
  );
}

/** The card's text block. Not interactive — the stretched link owns the tap. */
export function CardBody({ children, className }) {
  return <div className={cn("pointer-events-none flex flex-1 flex-col gap-1 p-3", className)}>{children}</div>;
}

/** A card's own action row, above the stretched link. */
export function CardActions({ children, className }) {
  return <div className={cn("relative z-10 flex items-center gap-1.5 px-3 pb-3", className)}>{children}</div>;
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
