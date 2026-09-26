// ---------------------------------------------------------------------------
// CATEGORY PALETTE — the colour identity of an exhibit, derived from its
// CATEGORY, not from a hash of its title.
//
// Why: the monogram letter ("W" for Wedding, "S for "Saturday brunch run") read
// as a placeholder — a letter that maps to nothing the user knows. A category
// tint does map to something: the same wing of the case is always the same
// colour, so the palette teaches the taxonomy instead of decorating it.
//
// THE ROOM REVISION (2026-09-17): a wing used to be a hard indigo→cyan FILL laid
// behind the text, which is why a card with no cover photo looked like a poster
// from another app pasted into a page of paper cards. A category colour is now a
// LIGHT on the room's own plaster (`categoryPlate`), not a fill. `categoryGradient`
// stays for the rare surface that genuinely wants a band of colour, but it is
// warm-shifted and used once, not as a card background.
//
// A real cover photograph always wins over a tint — the tint is only the
// fallback, never a stock image standing in for goods nobody photographed.
// ---------------------------------------------------------------------------

import { plateGlow, roomPlate } from './room';

export const CATEGORY_PALETTE: Record<string, { accent: string; label: string }> = {
  // No hue here may equal the action accent (#40916C): a wing colour that is
  // also "the primary button" makes every CTA look like a category label. The
  // palette flip found exactly that — the sweep had quietly turned popup into the
  // accent. Measured apart: violet, teal, rose, deep indigo, brown.
  popup: { accent: '#7C3AED', label: 'Popups & markets' },
  session: { accent: '#0E7C86', label: 'Sessions & classes' },
  drop: { accent: '#BE123C', label: 'Drops' },
  event: { accent: '#3730A3', label: 'Events' },
  contribution: { accent: '#8A5A2B', label: 'Causes & pots' }
};

const NEUTRAL = '#64748B';

/** The wing's colour itself — for a 1px mark, a dot, an icon. */
export function categoryAccent(category: string | null | undefined): string {
  return (category && CATEGORY_PALETTE[category]?.accent) || NEUTRAL;
}

/** The wing's colour as a surface treatment: the room's plaster, lit by one hue.
    A single string, for one-shot backgrounds. A card that owns a cover area
    paints `categoryWash()` over `PLASTER` instead, in two layers. */
export function categoryPlate(category: string | null | undefined): string {
  return roomPlate(categoryAccent(category));
}

/** Just the wash of the wing's light, for the two-layer card case. */
export function categoryWash(category: string | null | undefined): string {
  return plateGlow(categoryAccent(category));
}

/** Kept for the one band-of-colour use (the event card's rail). Warm-shifted:
    two stops, both muted, so it sits in the room instead of over it. */
export function categoryGradient(category: string | null | undefined): string {
  const accent = categoryAccent(category);
  return `linear-gradient(135deg, ${accent} 0%, ${accent}cc 100%)`;
}

export function categoryLabel(category: string | null | undefined): string | null {
  return category && CATEGORY_PALETTE[category] ? CATEGORY_PALETTE[category].label : null;
}
