import React from 'react';

// ---------------------------------------------------------------------------
// WAIROMARK — the knot on the brand card.
//
// Four rounded loops, blue into chama green. Colour is the card's own pair
// (#2563EB → #10B981) because the mark is two hues by design; a single
// currentColor would flatten it into the old one-ink stamp.
//
// TraceMark stays. This file is added, not a swap of that geometry.
// ---------------------------------------------------------------------------

export interface WairoMarkProps {
  size?: number;
  title?: string;
  className?: string;
}

export function WairoMark({ size = 28, title = 'My Shop App', className = '' }: WairoMarkProps) {
  const decorative = title === '';
  const uid = React.useId().replace(/:/g, '');
  const g = `wairo-g-${uid}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      role={decorative ? 'presentation' : 'img'}
      aria-label={decorative ? undefined : title}
      aria-hidden={decorative || undefined}
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={g} x1="6" y1="42" x2="42" y2="6" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2563EB" />
          <stop offset="1" stopColor="#10B981" />
        </linearGradient>
      </defs>
      <g stroke={`url(#${g})`} strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="7" y="7" width="22" height="22" rx="7" />
        <rect x="19" y="7" width="22" height="22" rx="7" />
        <rect x="7" y="19" width="22" height="22" rx="7" />
        <rect x="19" y="19" width="22" height="22" rx="7" />
      </g>
    </svg>
  );
}

export default WairoMark;
