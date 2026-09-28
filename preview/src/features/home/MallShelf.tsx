import React from 'react';
import { ArrowRight } from 'lucide-react';
import { CategoryArt } from '../../ui/CategoryArt';
import { ShelfPlank } from '../../components/shelf/ShelfPlank';
import { soundEngine } from '../../utils/SoundEngine';
import '../../ui/mall.css';

// ---------------------------------------------------------------------------
// THE MALL SHELF — a header, a row of goods, and the plank under them.
//
// Why a component instead of a section per screen: the app already had shelves
// (the legacy main shelf, the city feed's flow tiles, the You surface's thirteen
// sections), and each one invented its own header, its own spacing and its own
// way of saying "there is more here". That is how a screen ends up either a
// wall of rows or an empty plate with a heading on it.
//
// One shelf type, three fits:
//   * `row`   — the horizontal snap rail. For browsing; it can hold 20 doors
//               without turning the page into a scroll you never escape.
//   * `grid`  — two columns on a phone, three above. For doors that are used
//               daily and want to be seen all at once.
//   * `list`  — full-width rows. For things with a number and a next step.
//
// THE RULES THIS COMPONENT ENFORCES
//   * A shelf shows what it has. With no rows and no `onAction`, it renders
//     nothing: an empty shelf is a gap in the building, not a design.
//   * ONE action per empty state. Not three buttons that all mean "maybe".
//   * `tag` is what a shelf puts on a door when the server answered with a
//     real number. `null` prints nothing. A zero is printed as a zero only when
//     the caller says the read succeeded and it is genuinely zero — and a count
//     that was never read never shows a dash pretending to be a number.
//   * The plank is presentation. It carries no text and no focus.
// ---------------------------------------------------------------------------

export interface MallDoor {
  id: string;
  label: string;
  hint?: string;
  /** ui/CategoryArt key — the wing's own drawing, never a stock photo. */
  art?: string;
  /** A real number from a real read, or nothing. */
  tag?: string | number | null;
  /** True when `tag` is a real zero (print it) rather than an unread read. */
  tagIsZero?: boolean;
  unit?: string;
  /** A button when the destination is a surface in this shell, a real link when
   *  the destination is a page of its own (/track, /reviews, /cloudbites) — so
   *  a long-press can open it elsewhere, which a fake button cannot. */
  href?: string;
  onSelect?: () => void;
}

export interface MallShelfProps {
  id: string;
  kicker: string;
  title: string;
  note?: string;
  doors: MallDoor[];
  fit?: 'row' | 'grid' | 'list';
  seeAllLabel?: string;
  onSeeAll?: () => void;
  /** Rendered when `doors` is empty. Exactly one action lives here. */
  empty?: React.ReactNode;
  /** A shelf can carry its own furniture instead of doors — the live reel, a
   *  table, a strip. The header, the plank and the "see all" stay the shelf's. */
  children?: React.ReactNode;
  withPlank?: boolean;
  className?: string;
}

export function MallShelf({
  id,
  kicker,
  title,
  note,
  doors,
  fit = 'row',
  seeAllLabel,
  onSeeAll,
  empty,
  children,
  withPlank = true,
  className = ''
}: MallShelfProps) {
  const titleId = `mall-shelf-${id}-title`;
  if (doors.length === 0 && !empty && !children) return null;

  return (
    <section className={`mall-shelf ${className}`.trim()} aria-labelledby={titleId} data-shelf={id}>
      <header className="mall-shelf__head">
        <div>
          <p className="mall-shelf__kicker">{kicker}</p>
          <h2 className="mall-shelf__title" id={titleId}>{title}</h2>
          {note && <p className="mall-shelf__note">{note}</p>}
        </div>
        {onSeeAll && seeAllLabel && (
          <button type="button" className="mall-shelf__see" onClick={onSeeAll}>
            {seeAllLabel} <ArrowRight size={13} aria-hidden="true" />
          </button>
        )}
      </header>

      {children ? children : doors.length === 0 ? (
        <div className="mall-shelf__stack">{empty}</div>
      ) : (
        <>
          <div
            className={
              fit === 'grid'
                ? 'mall-shelf__grid'
                : fit === 'list'
                  ? 'mall-shelf__stack'
                  : 'mall-shelf__row'
            }
          >
            {doors.map((door) => (
              <MallDoorButton key={door.id} door={door} fit={fit} />
            ))}
          </div>
          {withPlank && fit === 'row' && (
            <div className="mall-shelf__after">
              <ShelfPlank />
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function MallDoorButton({ door, fit = 'row' }: { door: MallDoor; fit?: MallShelfProps['fit'] }) {
  const hasTag =
    typeof door.tag === 'string'
      ? door.tag.trim().length > 0
      : typeof door.tag === 'number'
        ? door.tag !== 0 || door.tagIsZero === true
        : false;
  const aria = door.hint ? `${door.label}: ${door.hint}` : door.label;
  const body = (
    <>
      {door.art && (
        <span className="mall-door__art" aria-hidden="true">
          <CategoryArt kind={door.art} />
        </span>
      )}
      <span className="mall-door__body">
        <span className="mall-door__label">{door.label}</span>
        {door.hint && <span className="mall-door__hint">{door.hint}</span>}
      </span>
      {hasTag && <span className="mall-tag">{door.tag}</span>}
      {door.unit && <span className="mall-door__unit" aria-hidden="true">{door.unit}</span>}
      {fit === 'list' && (
        <span className="mall-door__go" aria-hidden="true">
          <ArrowRight size={16} />
        </span>
      )}
    </>
  );
  const className = `mall-door${fit === 'list' ? ' mall-door--list' : ''}${fit === 'grid' ? ' mall-door--wide' : ''}`;
  const activate = () => {
    soundEngine.play('tap');
    door.onSelect?.();
  };
  if (door.href) {
    return (
      <a
        href={door.href}
        aria-label={aria}
        data-door-id={door.id}
        className={className}
        onClick={(event) => {
          // A link that also plays the tap and can be handled in-app: the
          // default navigation stays unless a caller takes it over.
          soundEngine.play('tap');
          if (door.onSelect) {
            event.preventDefault();
            door.onSelect();
          }
        }}
      >
        {body}
      </a>
    );
  }
  return (
    <button type="button" onClick={activate} aria-label={aria} data-door-id={door.id} className={className}>
      {body}
    </button>
  );
}

export default MallShelf;
