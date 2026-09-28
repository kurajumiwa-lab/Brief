// ---------------------------------------------------------------------------
// THE ROOM — one set of surfaces, one light source, shared by every screen that
// shows a picture.
//
// Why this exists: a card that carries its own ad-hoc gradient, its own
// `border: 1px solid` and its own black scrim is a card in a different room
// from its neighbours. That is what made Browse feel "nude" — flat white paper,
// grey strokes, and cold blue-violet plates that looked dropped in from
// somewhere else. So the treatment lives here and is the same everywhere:
//
//   * `roomSurface()` / `PLASTER` + `plateGlow()` — a plate for a thing with NO
//     photo: the room's own plaster, lifted by light, with the accent at about
//     11% so the brand is present without the surface becoming a gradient
//     swatch. Never a stock photo, never a pattern pretending to be a picture,
//     never a dark panel, and never more than TWO background layers: a plate
//     paints its plaster floor and its light as separate elements, which is both
//     simpler to reason about and legible to a CSSOM that chokes on long
//     background lists (jsdom — which the suites run on — drops them entirely,
//     so an over-layered plate would silently render as nothing under test).
//   * `PHOTO_SCRIM` — the ink of the room (not pure black) fading up through a
//     real photograph, so type over a photo reads and the photo reads as lit by
//     this room. `.brief-scrim` in index.css is the same gradient for class use.
//   * `PHOTO_FILTER` — the house grade on real pictures: −10% saturation and
//     +5% contrast, with no hue shift. A photograph of a crate of tomatoes is
//     never re-coloured into something it is not; this is a restrained tonal
//     grade, not a disguise. Grain is deliberately absent: it needs an overlay
//     per image, and the feed does not pay for decoration.
//   * `LISTED_AGO` — the only sentence a photo-less card is allowed about time,
//     and only when the row carries a real timestamp.
//
// Nothing in here takes a colour from a hash of a title or a seller name: an
// invented hue that looks like data is the same mistake as an invented number.
// ---------------------------------------------------------------------------

/** Nothing in here is a colour from a hash — see the header. */
import type * as React from 'react';

export const ROOM_TINT = 'rgba(37, 99, 235, 0.07)';
export const ROOM_TINT_SECONDARY = 'rgba(8, 145, 178, 0.06)';
/** #18130C — --brief-ink warmed a shade for laying over a photograph. */
export const SCRIM_INK = '10, 14, 20';

/** The room's own plaster as ONE layer: the floor of a plate. A component paints
    this on the plate and adds its accent as a separate glow layer above it, so
    no surface depends on a parser that can handle several backgrounds. */
export const PLASTER = 'linear-gradient(158deg, #FBFCFE 0%, #EDF1F6 100%)';

/** The room's own surface for a card with no picture of its own. Deliberately
    TWO layers (a light, then the plaster) and never more: a real browser paints
    any number of them, and two is what the effect needs. */
export function roomSurface(tint: string | null = ROOM_TINT): string {
  return [
    `radial-gradient(130% 95% at 106% 4%, ${tint ?? ROOM_TINT_SECONDARY} 0%, transparent 62%)`,
    PLASTER
  ].join(', ');
}

/** ONE corner of accent light over the plaster: the hue at the top-right, at
    about 11%. A wash, never a fill — so two categories never look like two
    different products, and the plate still reads as the same material as the
    page. Single layer by design: a plate component paints the plaster beneath
    it as its own element (see NoPhotoPlate / GlobysCard). */
export function plateGlow(accent: string | null): string {
  return `radial-gradient(125% 95% at 106% 4%, ${accent ? accent + '1f' : ROOM_TINT_SECONDARY} 0%, transparent 62%)`;
}

/** A room plate carrying ONE hue at wash strength — for a category whose wing
    has a colour. Kept as a single string for one-shot backgrounds (a button, an
    <img> well); a card body uses PLASTER + plateGlow() as two layers instead. */
export function roomPlate(accent: string | null): string {
  return [plateGlow(accent), PLASTER].join(', ');
}

export const PHOTO_SCRIM = `linear-gradient(to top, rgba(${SCRIM_INK}, 0.95) 0%, rgba(${SCRIM_INK}, 0.62) 34%, rgba(${SCRIM_INK}, 0.16) 68%, rgba(${SCRIM_INK}, 0.04) 100%)`;

export const PHOTO_FILTER = 'saturate(0.9) contrast(1.05)';

/** Small chip that sits on the plate: quiet, warm, unmistakably not a number. */
export const PLATE_CHIP: React.CSSProperties = {
  background: 'rgba(10, 14, 20, 0.055)',
  color: 'var(--brief-muted)'
};

/** "listed 3h ago" from the row's own timestamp — or nothing at all. */
export function listedAgo(
  iso: string | null | undefined,
  now: number = typeof Date !== 'undefined' ? Date.now() : 0
): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const mins = Math.floor((now - ms) / 60000);
  if (mins < 1) return 'listed just now';
  if (mins < 60) return `listed ${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `listed ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `listed ${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `listed ${months}mo ago`;
  return `listed ${Math.floor(days / 365)}y ago`;
}

export default roomSurface;
