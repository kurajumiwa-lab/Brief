import React from 'react';

// ---------------------------------------------------------------------------
// TRACEMARK — the brand mark, one file, one shape.
//
// It draws a stroke, not a fill: a horizontal bar with a stem that bends, and a
// node at the end of the bar — a thing that left a trace. The geometry is the
// one the brand brief specified, and it is deliberately *not* a letter in a
// box: the previous header was a `B` glyph on a dark square, which read as an
// avatar of the user rather than a product mark.
//
// The colour comes from the room (currentColor / the accent token), never a
// hard-coded hex inside a component — a literal #40916C here would be a second
// source of truth for the brand and would survive a palette change looking
// exactly like the old one.
// ---------------------------------------------------------------------------

export interface TraceMarkProps {
  /** Rendered square size in px. The viewBox scales, so any size stays crisp. */
  size?: number;
  /** Accessible name. Empty string means decorative (the wordmark carries it). */
  title?: string;
  className?: string;
}

export function TraceMark({ size = 28, title = 'Trace', className = '' }: TraceMarkProps) {
  const decorative = title === '';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      className={className}
      role={decorative ? 'presentation' : 'img'}
      aria-label={decorative ? undefined : title}
      aria-hidden={decorative || undefined}
      style={{ display: 'block' }}
    >
      <path
        d="M6 12 H34 M20 12 V30 Q20 34 16 34"
        stroke="currentColor"
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="34" cy="12" r="3" fill="currentColor" />
    </svg>
  );
}

export default TraceMark;
