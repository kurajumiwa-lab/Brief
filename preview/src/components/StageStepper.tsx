import React from 'react';

// ---------------------------------------------------------------------------
// STAGE STEPPER — the generic pipeline visualizer.
//
// Sequential progress dots for ANY tracked flow: a group buy's funding
// pipeline, a match's lifecycle, anything with ordered stages. States come
// from real data (index of the current stage); the connector fills up to the
// truth, never beyond it.
// ---------------------------------------------------------------------------

export interface StepperStage {
  id: string;
  label: string;
  blurb?: string;
}

export interface StageStepperProps {
  stages: StepperStage[];
  currentIndex: number;
  /** Compact = horizontal scroll rail for dense surfaces. */
  compact?: boolean;
}

export function StageStepper({ stages, currentIndex, compact = false }: StageStepperProps) {
  return (
    <div className={compact ? 'flex items-start gap-0 overflow-x-auto no-scrollbar pb-1' : 'flex items-start gap-0'}>
      {stages.map((stage, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        const isLast = i === stages.length - 1;
        return (
          <React.Fragment key={stage.id}>
            <div className="flex min-w-[72px] flex-1 flex-col items-center text-center">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full border text-[12px] font-extrabold transition-all"
                style={{
                  background: done || active ? '#40916C' : 'var(--color-paper)',
                  color: done || active ? 'var(--brief-ink)' : 'rgba(17,17,17,0.4)',
                  borderColor: done || active ? '#40916C' : 'var(--brief-line)',
                  opacity: active ? 1 : done ? 0.9 : 1
                }}
              >
                {done ? '✓' : i + 1}
              </div>
              <p
                className="mt-1.5 text-[11px] font-extrabold leading-tight"
                style={{ color: active ? 'var(--brief-ink)' : done ? 'rgba(17,17,17,0.7)' : 'rgba(17,17,17,0.4)' }}
              >
                {stage.label}
              </p>
              {!compact && stage.blurb && (
                <p className="mt-0.5 hidden text-[11px] leading-tight text-[var(--ink-60)] sm:block">{stage.blurb}</p>
              )}
            </div>
            {!isLast && (
              <div className="flex items-center pt-[15px] px-0.5" aria-hidden="true">
                <div
                  className="h-[2px] w-3 rounded-full sm:w-6"
                  style={{ background: i < currentIndex ? '#40916C' : 'var(--brief-line)' }}
                />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default StageStepper;
