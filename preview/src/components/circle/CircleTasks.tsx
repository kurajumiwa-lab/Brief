import React from 'react';
import type { Block, MemberRole } from '../../api/types';

/**
 * CIRCLE TASKS.
 *
 * Tasks are Blocks of type 'task'; their state is hydrated server-side onto
 * `block.task`. This component groups them by status and offers the actions
 * the caller's role permits.
 *
 * Hiding a button is presentation, NOT security. Every action here is also
 * enforced by the server, which rejects the request outright -- an observer
 * who forges a call still gets a 403. The role checks below exist so the UI
 * doesn't offer something that will fail, not to protect the data.
 *
 * Empty states are honest: a circle with no tasks says so rather than
 * displaying invented placeholder work.
 */

const OPERATIONAL: MemberRole[] = ['coordinator', 'contributor', 'scout', 'logistics'];

export interface CircleTasksProps {
  blocks: Block[];
  /** The viewing user. Used to tell "my work" from everyone else's. */
  /** null until the session answers; never a placeholder id. */
  currentUserId?: string | null;
  /** The viewer's role in THIS circle, or null when not a member. */
  myRole: MemberRole | null;
  busyId: string | null;
  /** Resolve a userId to something a human reads. A task row that prints
   *  `usr_o3k…` is a database dumped into the room: nobody can tell who holds
   *  the work, and the assignee is the one person the line is about. */
  nameOf?: (userId: string | null | undefined) => string | null;
  onAssign: (blockId: string) => void;
  onRelease: (blockId: string) => void;
  onComplete: (blockId: string) => void;
  /** The three acts that could make a group forget something. Each is refused by
   *  the server without a reason, so the button stays disabled until one is
   *  typed — an honest affordance, not a gate. */
  onCancel?: (blockId: string, reason: string) => void;
  onReopen?: (blockId: string, reason: string) => void;
  /** "I did it" is the assignee's claim; this is the coordinator's. Separate. */
  onVerify?: (blockId: string) => void;
  onDue?: (blockId: string, dueAt: string, reason: string) => void;
}

export function CircleTasks({
  blocks,
  currentUserId,
  myRole,
  busyId,
  nameOf,
  onAssign,
  onRelease,
  onComplete,
  onCancel,
  onReopen,
  onVerify,
  onDue
}: CircleTasksProps) {
  // One open "why?" field at a time, next to the act it explains.
  const [asking, setAsking] = React.useState<{ id: string; kind: 'cancel' | 'reopen' | 'due' } | null>(null);
  const [why, setWhy] = React.useState('');
  const [dueDraft, setDueDraft] = React.useState('');
  const tasks = blocks.filter((b) => b.type === 'task');

  const open = tasks.filter((t) => (t.task?.status ?? 'open') === 'open');
  const assigned = tasks.filter((t) => t.task?.status === 'assigned');
  const completed = tasks.filter((t) => t.task?.status === 'completed');
  const cancelled = tasks.filter((t) => t.task?.status === 'cancelled');

  const canOperate = myRole !== null && OPERATIONAL.includes(myRole);
  const isCoordinator = myRole === 'coordinator';

  if (tasks.length === 0) {
    return (
      <div>
        <Heading>Tasks</Heading>
        <p className="text-xs text-[var(--ink-60)]">No tasks in this circle.</p>
      </div>
    );
  }

  const row = (task: Block) => {
    const state = task.task;
    // null-safe on both sides: no session, no claim of ownership — and an
    // unassigned task is nobody's, not the viewer's.
    const mine = Boolean(currentUserId) && state?.assigneeId === currentUserId;
    const busy = busyId === task.id;

    return (
      <div
        key={task.id}
        className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-3 space-y-2"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-[var(--brief-ink)] min-w-0">{task.content}</p>
          <span
            className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full ${
              state?.status === 'completed'
                ? 'bg-[color:var(--color-paper)] text-[var(--brief-ink)]'
                : state?.status === 'assigned'
                ? 'bg-[color:var(--color-paper)] text-[var(--brief-ink)]'
                : 'bg-[var(--brief-line)] text-[var(--ink-60)]'
            }`}
          >
            {state?.status ?? 'open'}
          </span>
        </div>

        {/* Who holds it, and who finished it — by name. Never inferred, never a
            key. When no name resolves, the line says it cannot, rather than
            falling back to the id. */}
        {state?.status === 'assigned' && (
          <p className="text-[11px] text-[var(--ink-60)]">
            {mine ? 'Assigned to you' : `Assigned to ${nameOf?.(state.assigneeId) || 'a member'}`}
          </p>
        )}
        {state?.status === 'completed' && (
          <p className="text-[11px] text-[var(--ink-60)]">
            Completed by {nameOf?.(state.completedBy) || (state.completedBy ? 'a member' : 'unknown')}
            {state.completedAt ? ` on ${state.completedAt.slice(0, 10)}` : ''}
            {/* Complete and verified are two facts, printed as two: the first is
                the assignee's claim, the second a coordinator's. */}
            {state.verifiedAt ? ' · verified' : ' · not yet verified'}
          </p>
        )}
        {state?.status === 'cancelled' && (
          <p className="text-[11px] text-[var(--ink-60)]">
            Cancelled{state.cancelReason ? ` — ${state.cancelReason}` : ''}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {isCoordinator && state?.status !== 'cancelled' && (
            <button
              onClick={() => { setAsking(asking?.id === task.id && asking.kind === 'cancel' ? null : { id: task.id, kind: 'cancel' }); setWhy(''); }}
              className="px-3 py-1.5 rounded-xl border border-[var(--brief-line)] text-[var(--ink-60)] font-extrabold text-[11px] cursor-pointer"
            >
              Cancel
            </button>
          )}
          {isCoordinator && (state?.status === 'completed' || state?.status === 'cancelled') && (
            <button
              onClick={() => { setAsking(asking?.id === task.id && asking.kind === 'reopen' ? null : { id: task.id, kind: 'reopen' }); setWhy(''); }}
              className="px-3 py-1.5 rounded-xl border border-[var(--brief-line)] text-[var(--ink-60)] font-extrabold text-[11px] cursor-pointer"
            >
              Reopen
            </button>
          )}
          {isCoordinator && state?.status === 'completed' && !state.verifiedAt && onVerify && (
            <button
              onClick={() => onVerify(task.id)}
              disabled={busy}
              className="px-3 py-1.5 rounded-xl bg-[var(--color-success)] text-[var(--accent-ink)] font-extrabold text-[11px] cursor-pointer disabled:opacity-50"
            >
              Verify it landed
            </button>
          )}
          {(canOperate && state?.status !== 'cancelled') && (
            <button
              onClick={() => { setAsking(asking?.id === task.id && asking.kind === 'due' ? null : { id: task.id, kind: 'due' }); setDueDraft((task.task?.dueAt ?? '').slice(0, 10)); }}
              className="px-3 py-1.5 rounded-xl border border-[var(--brief-line)] text-[var(--ink-60)] font-extrabold text-[11px] cursor-pointer"
            >
              {task.task?.dueAt ? `Due ${String(task.task.dueAt).slice(0, 10)}` : 'Set a deadline'}
            </button>
          )}
          {asking?.id === task.id && asking.kind !== 'due' && (
            <div className="w-full flex items-center gap-2">
              <input
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                aria-label={`reason for ${asking.kind === 'cancel' ? 'cancelling' : 'reopening'} this task`}
                placeholder={asking.kind === 'cancel' ? 'why is it being cancelled? the circle sees this' : 'why is it being reopened? the circle sees this'}
                maxLength={500}
                className="min-w-0 flex-1 px-2.5 py-1.5 rounded-xl border border-[var(--brief-line)] text-[11px] text-[var(--brief-ink)]"
              />
              <button
                disabled={!why.trim()}
                onClick={() => {
                  const reason = why.trim();
                  if (!reason) return;
                  if (asking.kind === 'cancel') onCancel?.(task.id, reason);
                  else onReopen?.(task.id, reason);
                  setAsking(null); setWhy('');
                }}
                className="shrink-0 px-3 py-1.5 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-[11px] cursor-pointer disabled:opacity-40"
              >
                {asking.kind === 'cancel' ? 'Cancel task' : 'Reopen task'}
              </button>
            </div>
          )}
          {asking?.id === task.id && asking.kind === 'due' && (
            <div className="w-full flex items-center gap-2">
              <input type="date" value={dueDraft} onChange={(e) => setDueDraft(e.target.value)} aria-label="new deadline"
                className="shrink-0 px-2.5 py-1.5 rounded-xl border border-[var(--brief-line)] text-[11px] text-[var(--brief-ink)]" />
              <input value={why} onChange={(e) => setWhy(e.target.value)} aria-label="reason for moving the deadline"
                placeholder="why is the date moving? (required)" maxLength={500}
                className="min-w-0 flex-1 px-2.5 py-1.5 rounded-xl border border-[var(--brief-line)] text-[11px] text-[var(--brief-ink)]" />
              <button
                disabled={!dueDraft || !why.trim()}
                onClick={() => { onDue?.(task.id, dueDraft, why.trim()); setAsking(null); setWhy(''); }}
                className="shrink-0 px-3 py-1.5 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-[11px] cursor-pointer disabled:opacity-40"
              >
                Move it
              </button>
            </div>
          )}
          {state?.status === 'open' && canOperate && (
            <button
              onClick={() => onAssign(task.id)}
              disabled={busy}
              className="px-3 py-1.5 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-[11px] cursor-pointer disabled:opacity-50"
            >
              {busy ? 'Working...' : 'Take this on'}
            </button>
          )}

          {state?.status === 'assigned' && (mine || isCoordinator) && (
            <>
              <button
                onClick={() => onComplete(task.id)}
                disabled={busy}
                className="px-3 py-1.5 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-[11px] cursor-pointer disabled:opacity-50"
              >
                {busy ? 'Working...' : 'Mark complete'}
              </button>
              <button
                onClick={() => onRelease(task.id)}
                disabled={busy}
                className="px-3 py-1.5 rounded-xl bg-[color:var(--color-paper)] border border-[var(--brief-line)] text-[var(--brief-ink)] font-extrabold text-[11px] cursor-pointer disabled:opacity-50"
              >
                Release
              </button>
            </>
          )}
        </div>

        {/* An observer is told why, rather than shown a button that 403s. */}
        {state?.status === 'open' && myRole === 'observer' && (
          <p className="text-[11px] text-[var(--ink-60)]">
            Observers cannot take on tasks.
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <Heading>Tasks</Heading>

      {open.length > 0 && (
        <div className="space-y-2">
          <SubHeading>Open &middot; {open.length}</SubHeading>
          {open.map(row)}
        </div>
      )}

      {assigned.length > 0 && (
        <div className="space-y-2">
          <SubHeading>In progress &middot; {assigned.length}</SubHeading>
          {assigned.map(row)}
        </div>
      )}

      {completed.length > 0 && (
        <div className="space-y-2">
          <SubHeading>Completed &middot; {completed.length}</SubHeading>
          {completed.map(row)}
        </div>
      )}

      {/* Cancelled work is not deleted work. It sits in its own group, with the
          reason under it, so the room can still answer "what did we drop?". */}
      {cancelled.length > 0 && (
        <div className="space-y-2">
          <SubHeading>Cancelled &middot; {cancelled.length}</SubHeading>
          {cancelled.map(row)}
        </div>
      )}
    </div>
  );
}

const Heading = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-[12px] font-extrabold text-[var(--ink-60)]">
    {children}
  </h3>
);

const SubHeading = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[11px] text-[var(--ink-60)]">{children}</p>
);
