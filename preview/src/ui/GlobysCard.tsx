import React from 'react';
import { BadgeCheck } from 'lucide-react';
import { PHOTO_FILTER } from '../features/city/room';

// ---------------------------------------------------------------------------
// GLOBCARD — the ONE card shape for every list surface (Home, Discover,
// Mine, Events, Circles). The rule this file enforces: one card shape.
// One image slot (1:1), one title (two lines, ellipsis), one bold price
// line, one seller line, one mono location line, and exactly ONE full-width
// action button. No exceptions, no featured variants, no corner badges —
// the verified check is INLINE with the seller name, never on its own line,
// and it renders only when the row really is verified (Brief attaches no
// verified badge to a market stall; the check exists to render a fact, not
// to decorate).
//
// The mono line carries the row's real where/when. It never carries a
// distance this app cannot measure: the distance a Globys screenshot prints
// does not exist in this store, and inventing "0.3 km" is the one lie this
// codebase was built to refuse. The real location string is the honest
// occupant of that line.
// ---------------------------------------------------------------------------

export interface GlobysCardProps {
  /** The row's own photo. A real photo always beats the plate. */
  image?: string | null;
  imageAlt?: string;
  /** What the 1:1 slot shows when there is no photo (NoPhotoPlate etc.). */
  plate?: React.ReactNode;
  title: string;
  /** Bold 16px. The row's real price (or its real key figure); null prints
      no line — an absent number is not a zero. */
  price?: string | null;
  /** Seller/shop name. Null = the line is not rendered, not a guess. */
  seller?: string | null;
  /** Render the inline blue check next to the name. Only ever a real fact. */
  verified?: boolean;
  /** The mono where/when line. Real location or date; never an invented km. */
  mono?: string | null;
  /** The one full-width action, e.g. "Chat on WhatsApp →". */
  actionLabel: string;
  onAction?: () => void;
  /** When set, the action is a link (a real wa.me target). */
  actionHref?: string | null;
  disabled?: boolean;
  /** Card body tap — opening the row's detail. Distinct from the action. */
  onOpen?: () => void;
  /** Test hook suffix: [data-testid="globys-card-<suffix>"]. */
  testId?: string;
}

export const GlobysCard: React.FC<GlobysCardProps> = ({
  image = null,
  imageAlt = '',
  plate = null,
  title,
  price = null,
  seller = null,
  verified = false,
  mono = null,
  actionLabel,
  onAction,
  actionHref = null,
  disabled = false,
  onOpen,
  testId
}) => {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const body = (
    <>
      {/* THE 1:1 SLOT — the row's own photo, or the plate that waits for one. */}
      <div className="relative w-full aspect-square overflow-hidden" style={{ background: 'var(--color-well)' }}>
        {image ? (
          <img src={image} alt={imageAlt} loading="lazy" className="absolute inset-0 h-full w-full object-cover" style={{ filter: PHOTO_FILTER }} />
        ) : (
          plate
        )}
      </div>

      {/* THE SHAPE — every card carries the same lines, in the same order.
          A tap here is a body tap: it opens the row (bubbles to the card). */}
      <div className="p-3 space-y-1">
        <h3 className="text-[15px] font-bold leading-tight line-clamp-2" style={{ color: 'var(--color-text)' }}>
          {title}
        </h3>
        {price ? (
          <p className="text-[16px] font-bold leading-tight" style={{ color: 'var(--color-text)' }}>{price}</p>
        ) : null}
        {seller ? (
          <p className="text-[12px] font-medium flex items-center gap-1 min-w-0" style={{ color: 'var(--color-text-muted)' }}>
            <span className="truncate">{seller}</span>
            {/* INLINE with the name, never a badge of its own: the check is
                part of the sentence "Nairobi Boda ✓", not a sticker. */}
            {verified && (
              <BadgeCheck className="w-3 h-3 shrink-0" style={{ color: '#40916C' }} aria-label="verified" />
            )}
          </p>
        ) : null}
        {mono ? (
          <p className="text-[12px] font-mono truncate" style={{ color: 'var(--color-text-muted)' }}>{mono}</p>
        ) : null}

        {/* THE ONE ACTION — full width. A card with two buttons is two
            decisions; this is the one this row exists to make. */}
        {/* THE ACTION — a text link, not a button on every card. Blue is spent
            on true primaries (create, order, post, confirm); a card's action
            is a sentence with an arrow. Same testids, same behaviour. */}
        {actionHref && !disabled ? (
          <a
            href={actionHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={stop}
            data-testid={testId ? `card-action-${testId}` : 'card-action'}
            className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-bold"
            style={{ color: 'var(--color-primary)' }}
          >
            {actionLabel}
          </a>
        ) : (
          <button
            type="button"
            onClick={(e) => { stop(e); onAction?.(); }}
            disabled={disabled}
            data-testid={testId ? `card-action-${testId}` : 'card-action'}
            className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-bold cursor-pointer disabled:cursor-default"
            style={{ color: disabled ? 'var(--color-text-muted)' : 'var(--color-primary)' }}
          >
            {actionLabel}
          </button>
        )}
      </div>
    </>
  );

  return (
    <article
      data-testid={testId ? `globys-card-${testId}` : 'globys-card'}
      onClick={onOpen}
      className={`relative rounded-2xl overflow-hidden bg-[color:var(--color-paper)] ${onOpen ? 'cursor-pointer' : ''}`}
      style={{ boxShadow: 'var(--room-light), var(--lift-1), inset 0 0 0 1px var(--brief-line)' }}
      aria-label={title}
    >
      {body}
    </article>
  );
};

export default GlobysCard;
