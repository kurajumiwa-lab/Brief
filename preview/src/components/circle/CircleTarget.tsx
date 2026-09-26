import React from 'react';
import type { Circle } from '../../api/types';

/**
 * CIRCLE TARGET.
 *
 * Renders the target and its progress. It performs NO arithmetic of its own:
 * `currentValue`, `progressPct`, `settledCount` and `contributorCount` are all
 * derived server-side from transactions that actually reached 'settled'.
 *
 * Two rules this component exists to hold:
 *
 *   1. `progressPct === null` means there is no target to measure. It renders
 *      as "No target set" -- never as 0%, which would look like a measured
 *      result rather than an absent one.
 *   2. The bar cannot move without settled rows behind it, and the caption
 *      always states how many there were, so a filling bar is always
 *      accountable to something real.
 */

export interface CircleTargetProps {
  circle: Circle;
  /** Compact form for list rows; full form adds the contributor line. */
  compact?: boolean;
}

export function CircleTarget({ circle, compact = false }: CircleTargetProps) {
  const hasTarget = circle.targetValue !== null && circle.progressPct !== null;

  if (!hasTarget) {
    return <p className="text-[11px] text-[var(--ink-60)]">No target set.</p>;
  }

  const pct = circle.progressPct as number;
  const target = circle.targetValue as number;
  const reached = pct >= 100;

  return (
    <div>
      <div className="h-1.5 bg-[var(--color-well)] rounded-full overflow-hidden">
        <div
          className={`h-full ${reached ? 'bg-[#40916C]' : 'bg-[#40916C]'}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>

      <p className="text-[11px] text-[var(--brief-ink)] mt-1">
        {circle.currentValue.toLocaleString()} of {target.toLocaleString()}{' '}
        &middot; {Math.round(pct)}% &middot; from {circle.settledCount} settled{' '}
        {circle.settledCount === 1 ? 'contribution' : 'contributions'}
      </p>

      {!compact && (
        <p className="text-[11px] text-[var(--ink-60)] mt-0.5">
          {circle.contributorCount === 0
            ? 'No contributors yet.'
            : `${circle.contributorCount} ${
                circle.contributorCount === 1 ? 'contributor' : 'contributors'
              }.`}{' '}
          Progress is derived from settled transactions only.
        </p>
      )}

      {circle.deadline && (
        <p className="text-[11px] text-[var(--ink-60)] mt-0.5">
          Deadline {circle.deadline.slice(0, 10)}
        </p>
      )}
    </div>
  );
}
