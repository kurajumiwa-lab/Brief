import React from 'react';

// ---------------------------------------------------------------------------
// SHELF ICON — the drawer's app-icon marks.
//
// Samsung-high-end grammar, not lined icons: a filled gradient squircle with
// a solid white glyph. Each shelf owns a theme, so the eye can tell which
// room a row belongs to before reading a word:
//
//   pulse   violet   the check-in
//   explore amber    board rooms (used sparingly; rooms keep CategoryArt)
//   work    blue     Your work — requests, supply, partners
//   money   green    You, your standing, your money
//   system  graphite settings and meta rows
//   danger  red      the one destructive row (sign out)
// ---------------------------------------------------------------------------

export type ShelfTheme = 'pulse' | 'explore' | 'work' | 'money' | 'system' | 'danger';

export type ShelfGlyph =
  | 'bolt'
  | 'ticket'
  | 'users'
  | 'shield'
  | 'coins'
  | 'pot'
  | 'globe'
  | 'bell'
  | 'lock'
  | 'search'
  | 'cross';

const THEME_BG: Record<ShelfTheme, string> = {
  pulse: 'linear-gradient(145deg, #8B5CF6 0%, #C026D3 100%)',
  explore: 'linear-gradient(145deg, #F59E0B 0%, #EA580C 100%)',
  work: 'linear-gradient(145deg, #40916C 0%, #0891B2 100%)',
  money: 'linear-gradient(145deg, #059669 0%, #65A30D 100%)',
  system: 'linear-gradient(145deg, var(--brief-muted) 0%, var(--brief-ink) 100%)',
  danger: 'linear-gradient(145deg, #E11D48 0%, #9F1239 100%)'
};

const GLYPHS: Record<ShelfGlyph, React.ReactNode> = {
  bolt: <path d="M13 2 4 14h6l-1 8 9-12h-6z" />,
  ticket: (
    <path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2a2.5 2.5 0 0 0 0 5v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2a2.5 2.5 0 0 0 0-5z" />
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6v1h-13z" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16.2 14.3c2.8.5 5.3 2.6 5.3 5.7v1h-4v-1c0-2.4-0.5-4.3-1.3-5.7z" />
    </>
  ),
  shield: <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z" />,
  coins: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 8.5V16c0 1.7 3.1 3 7 3s7-1.3 7-3V8.5c-1.7 1.2-4.2 2-7 2s-5.3-.8-7-2z" />
    </>
  ),
  pot: (
    <>
      <rect x="9" y="3" width="6" height="2.5" rx="1" />
      <path d="M3 11h18a9 9 0 0 1-18 0z" />
      <rect x="10.8" y="19.5" width="2.4" height="2.5" rx="1" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M3.5 12h17" stroke="currentColor" strokeWidth="2" />
    </>
  ),
  bell: (
    <>
      <path d="M12 2a6 6 0 0 0-6 6v4l-2 3.5h16L18 12V8a6 6 0 0 0-6-6z" />
      <path d="M10 19a2 2 0 0 0 4 0z" />
    </>
  ),
  lock: (
    <>
      <path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" strokeWidth="2.6" />
      <rect x="5" y="10" width="14" height="10" rx="2.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M15.5 15.5 20.5 20.5" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
    </>
  ),
  cross: (
    <>
      <path d="M6 6l12 12" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M18 6 6 18" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
    </>
  )
};

export const ShelfIcon: React.FC<{
  glyph: ShelfGlyph;
  theme: ShelfTheme;
  size?: number;
  label?: string;
}> = ({ glyph, theme, size = 32, label }) => (
  <span
    role={label ? 'img' : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
    style={{
      width: size,
      height: size,
      borderRadius: Math.round(size * 0.31),
      background: THEME_BG[theme],
      display: 'inline-grid',
      placeItems: 'center',
      color: '#FFFFFF',
      flexShrink: 0,
      boxShadow: '0 2px 6px rgba(10,14,20,0.28), inset 0 1px 0 rgba(255,255,255,0.35)'
    }}
  >
    <svg
      width={Math.round(size * 0.56)}
      height={Math.round(size * 0.56)}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      {GLYPHS[glyph]}
    </svg>
  </span>
);

export default ShelfIcon;
