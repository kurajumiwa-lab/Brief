import React from 'react';
import type { EngineRun, EngineStage } from '../engine/syncEngine';

// ---------------------------------------------------------------------------
// SYNC PIPELINE — the Linear Pipeline Orchestrator.
//
// Renders the engine's LAST REAL RUN: Ping Gateway -> Hash Comparison ->
// Delta Isolation -> UI Render. Every node state, timing and count comes from
// telemetry the server (and, for render, this client) actually measured.
//
// HONESTY RULES:
//   * No run yet -> every node reads "waiting", never a fake progress state.
//   * A blocked beat (tier guardrail) shows exactly which stages were held.
//   * The connector pulses only while a beat is genuinely in flight.
// ---------------------------------------------------------------------------

const NODES: { id: string; label: string; caption: string }[] = [
  { id: 'ping', label: 'Ping Gateway', caption: 'liveness + context' },
  { id: 'hash', label: 'Hash Comparison', caption: 'manifest digests' },
  { id: 'delta', label: 'Delta Isolation', caption: 'only what changed' },
  { id: 'render', label: 'UI Render', caption: 'silent merge' }
];

export interface SyncPipelineProps {
  run: EngineRun | null;
  pending: boolean;
}

function stageFor(run: EngineRun | null, id: string): EngineStage | null {
  return run?.stages?.find((s) => s.id === id) ?? null;
}

export function SyncPipeline({ run, pending }: SyncPipelineProps) {
  const doneCount = NODES.filter((n) => {
    const s = stageFor(run, n.id);
    return s && (s.status === 'done' || s.status === 'client');
  }).length;

  return (
    <div className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[12px] font-extrabold uppercase tracking-[0.16em] text-[var(--brief-ink)]">
          Pipeline
        </h3>
        <span className="text-[11px] font-mono text-[var(--ink-60)]">
          {run
            ? run.inSync
              ? `in sync · ${run.version?.slice(0, 8) ?? ''}`
              : `${run.deltaRows} row${run.deltaRows === 1 ? '' : 's'} merged`
            : 'awaiting first beat'}
        </span>
      </div>

      <div className="flex items-stretch gap-0">
        {NODES.map((node, i) => {
          const stage = stageFor(run, node.id);
          const state: 'idle' | 'active' | 'done' | 'blocked' | 'client' =
            pending && (!stage || stage.status === 'done' || stage.status === 'client')
              ? i === doneCount ? 'active' : stage ? 'done' : 'idle'
              : stage
              ? (stage.status as any)
              : 'idle';
          const isLast = i === NODES.length - 1;
          return (
            <React.Fragment key={node.id}>
              <div className="flex-1 min-w-0 flex flex-col items-center text-center">
                {/* the node dot */}
                <div
                  className={`h-9 w-9 rounded-full flex items-center justify-center border text-[12px] font-extrabold transition-all ${
                    state === 'active' ? 'animate-pulse' : ''
                  }`}
                  style={{
                    background:
                      state === 'done' ? 'var(--brief-ink)' :
                      state === 'active' ? 'var(--color-well)' :
                      state === 'blocked' ? 'var(--color-well)' :
                      'var(--brief-ink)',
                    color:
                      state === 'done' ? 'var(--brief-ink)' :
                      state === 'active' ? 'var(--brief-ink)' :
                      state === 'blocked' ? 'var(--brief-ink)/60' :
                      'var(--brief-ink)/40',
                    borderColor:
                      state === 'done' ? 'var(--brief-ink)' :
                      state === 'active' ? '#40916C' : 'var(--brief-line)'
                  }}
                >
                  {state === 'done' ? '✓' : state === 'blocked' ? '⏸' : i + 1}
                </div>
                <p className="mt-2 text-[11px] font-extrabold text-[var(--brief-ink)] leading-tight">
                  {node.label}
                </p>
                <p className="text-[11px] text-[var(--ink-60)] leading-tight">{node.caption}</p>
                {/* real timing, or the honest absence of one */}
                <p className="mt-1 text-[11px] font-mono" style={{ color: stage?.ms != null ? 'var(--brief-ink)' : 'rgba(17,17,17,0.4)' }}>
                  {stage?.ms != null ? `${stage.ms}ms` : state === 'blocked' ? 'held' : '—'}
                </p>
                {stage?.detail && (
                  <p className="mt-0.5 text-[11px] text-[var(--ink-60)] leading-tight line-clamp-2 px-0.5">
                    {stage.detail}
                  </p>
                )}
              </div>
              {!isLast && (
                <div className="flex items-center pt-[18px] px-0.5" aria-hidden="true">
                  <div
                    className={`h-[2px] w-4 sm:w-8 rounded-full transition-colors ${
                      pending ? 'animate-pulse' : ''
                    }`}
                    style={{
                      background:
                        stageFor(run, NODES[i + 1].id) && !pending
                          ? '#40916C' : 'var(--brief-line)'
                    }}
                  />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {!run && (
        <p className="mt-3 text-center text-[11px] text-[var(--ink-60)]">
          The pipeline runs the moment the engine beats — nothing here is animated for show.
        </p>
      )}
    </div>
  );
}

export default SyncPipeline;
