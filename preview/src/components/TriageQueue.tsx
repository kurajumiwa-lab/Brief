import React from 'react';
import * as briefApi from '../api/briefApi';
import type { TriageItem, TriageQueue as TriageQueueData } from '../api/types';

/**
 * THE WAITING-ON-YOU QUEUE.
 *
 * Every screen used to hold its own badge, so "is anything waiting for me?"
 * was a question no single place could answer. This is the one list: the
 * circle tasks you hold, the orders on your shelf, the doors you have to open
 * tonight, and the messages nobody has reviewed.
 *
 * Rules the UI keeps, because they are the point of the surface:
 *
 *   * NOTHING IS INVENTED. The list is whatever the server derived from real
 *     rows. If the server says nothing is waiting, this shows an empty state
 *     rather than suggestions, tips or sample work.
 *   * ACTIONS DO ONE THING AND THEN DISAPPEAR. Completing a task re-reads the
 *     queue, so the row leaves because the work is done -- not because a local
 *     filter hid it. A queue you dismiss by hand is a queue that lies.
 *   * A REFUSAL IS SHOWN, NOT SWALLOWED. If the server refuses an action the
 *     row stays put and the reason is displayed. The alternative -- optimistically
 *     removing the row -- would look like success where there was none.
 *   * TIME-BOXED WORK IS AT THE TOP, because a door opening tonight cannot wait
 *     behind a task with no deadline. That ordering comes from the server.
 */

export interface TriageQueueProps {
  /** Where to go when an item needs a fuller screen than a button. */
  onOpenSection: (section: string) => void;
  /** Shown in the toast area; the parent owns how notices look. */
  onNotice: (message: string) => void;
}

const KIND_LABEL: Record<TriageItem['kind'], string> = {
  task: 'Task',
  order: 'Order',
  checkin: 'Event',
  draft: 'Message'
};

/** How long something has waited, in words. 0 days is "today", not "0 days". */
function waited(days: number): string {
  if (days < 1) return 'today';
  if (days < 2) return '1 day';
  if (days < 30) return `${Math.floor(days)} days`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month' : `${months} months`;
}

/** The button label says what will actually happen. */
function actionLabel(item: TriageItem): { label: string; action: string } | null {
  switch (item.kind) {
    case 'task':
      if (item.actions.includes('complete')) return { label: 'Mark done', action: 'complete' };
      if (item.actions.includes('assign')) return { label: 'Take it', action: 'assign' };
      return null;
    case 'order':
      // The server names the next real stage ("accepted", "ready"), so the
      // button promises that stage and nothing vaguer.
      return item.nextStatus
        ? { label: `Mark ${item.nextStatus}`, action: 'advance' }
        : null;
    case 'checkin':
      return { label: 'Open the gate', action: 'gate' };
    case 'draft':
      return { label: 'Review', action: 'review' };
    default:
      return null;
  }
}

export function TriageQueue({ onOpenSection, onNotice }: TriageQueueProps) {
  const [queue, setQueue] = React.useState<TriageQueueData | null>(null);
  // 'signed-out' is kept distinct from 'unavailable' on purpose. The queue is a
  // per-person answer, so somebody who has not signed in has no queue -- that
  // is a different fact from "the server could not be reached", and lumping
  // them together would make a sign-in prompt look like an outage.
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'unavailable' | 'signed-out'>('loading');
  const [unavailableReason, setUnavailableReason] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [refusal, setRefusal] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const res = await briefApi.getTriageQueue();
    if (!res.ok) {
      // An unreachable queue is reported as unreachable. It is NOT rendered as
      // an empty one: "nothing is waiting" and "I could not look" are different
      // facts, and only one of them is reassuring.
      setStatus(res.status === 401 ? 'signed-out' : 'unavailable');
      setUnavailableReason(res.error ?? 'the queue could not be read');
      return;
    }
    setQueue(res.data);
    setStatus('ready');
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const act = async (item: TriageItem, action: string) => {
    setRefusal(null);
    setBusyId(item.id);
    let res: { ok: boolean; error?: string } = { ok: false };

    if (item.kind === 'task' && (action === 'complete' || action === 'assign' || action === 'release')) {
      res = action === 'complete'
        ? await briefApi.completeTask(item.circleId, item.id)
        : action === 'assign'
          ? await briefApi.assignTask(item.circleId, item.id)
          : await briefApi.releaseTask(item.circleId, item.id);
    } else if (item.kind === 'order' && action === 'advance') {
      res = item.nextStatus
        ? await briefApi.stageOrder(item.id, item.nextStatus)
        : { ok: false, error: 'this order has no next step' };
    }

    setBusyId(null);

    if (!res.ok) {
      setRefusal(res.error ?? 'that did not go through');
      return;
    }

    onNotice(
      item.kind === 'task' && action === 'complete' ? 'Task marked done'
        : item.kind === 'task' && action === 'assign' ? 'Task is yours now'
          : item.kind === 'task' ? 'Task released back to the circle'
            : 'Order moved on'
    );
    // Re-read rather than splicing the row out locally: the queue is the
    // server's answer, and only the server knows what changed underneath.
    await load();
  };

  const open = (item: TriageItem) => {
    if (item.kind === 'task') onOpenSection('command');
    else if (item.kind === 'order') onOpenSection('vendors');
    else if (item.kind === 'checkin') onOpenSection('gate');
    else onOpenSection('inbox');
  };

  if (status === 'loading') {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <p className="text-[12px] text-[var(--ink-60)]">Reading what is waiting on you…</p>
      </div>
    );
  }

  if (status === 'signed-out') {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="border border-dashed border-[var(--brief-line)] rounded-2xl p-8 text-center">
          <p className="text-xs font-extrabold text-[var(--brief-ink)]">Sign in to see what is waiting</p>
        </div>
      </div>
    );
  }

  if (status === 'unavailable') {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="border border-dashed border-[var(--brief-line)] rounded-2xl p-8 text-center">
          <p className="text-xs font-extrabold text-[var(--brief-ink)]">The queue could not be read</p>
          <p className="text-[11px] text-[var(--ink-70)] mt-1">{unavailableReason}</p>
          <button
            onClick={() => { setStatus('loading'); void load(); }}
            className="mt-3 px-3 py-2 rounded-xl bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-[12px] cursor-pointer"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const items = queue?.items ?? [];

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 space-y-3">
      <div className="flex items-center justify-end">
        <button
          onClick={() => { setStatus('loading'); void load(); }}
          className="shrink-0 px-3 py-2 rounded-xl bg-[color:var(--color-paper)] border border-[var(--brief-line)] text-[var(--brief-ink)] font-extrabold text-[12px] cursor-pointer"
        >
          Refresh
        </button>
      </div>

      {refusal && (
        <div className="rounded-xl border border-[var(--brief-line)] bg-[var(--color-well)] px-3 py-2">
          <p className="text-[12px] text-[var(--brief-ink)]">
            Not done: {refusal}. The item is still in the queue.
          </p>
        </div>
      )}

      {items.length === 0 && (
        <div className="border border-dashed border-[var(--brief-line)] rounded-2xl p-8 text-center">
          <p className="text-xs font-extrabold text-[var(--brief-ink)]">Nothing is waiting on you</p>
        </div>
      )}

      {items.map((item) => {
        const button = actionLabel(item);
        const busy = busyId === item.id;
        return (
          <div
            key={`${item.kind}:${item.id}`}
            className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-3.5 flex items-start justify-between gap-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--ink-60)]">
                  {KIND_LABEL[item.kind]}
                </span>
                {item.kind === 'task' && (
                  <span className="text-[11px] font-bold text-[var(--ink-60)]">{item.circleName}</span>
                )}
                {item.kind === 'checkin' && item.status === 'open' && (
                  <span className="text-[11px] font-extrabold text-[var(--brief-ink)] bg-[var(--surface-3)] px-1.5 py-0.5 rounded-full">
                    Open now
                  </span>
                )}
                <span className="text-[11px] font-bold text-[var(--ink-60)]">
                  waiting {waited(item.daysWaiting)}
                </span>
              </div>

              <button
                onClick={() => open(item)}
                className="mt-1 block text-[14px] font-extrabold text-[var(--brief-ink)] text-left hover:underline cursor-pointer"
              >
                {item.title}
              </button>

              {item.detail && (
                <p className="text-[12px] text-[var(--ink-55)] mt-0.5 line-clamp-2">{item.detail}</p>
              )}

              {item.kind === 'checkin' && (
                <p className="text-[12px] text-[var(--ink-70)] mt-1">
                  {item.pending} still to check in · {item.checkedIn} checked in
                </p>
              )}
            </div>

            <div className="shrink-0 flex flex-col items-end gap-1.5">
              {button && (
                <button
                  onClick={() => {
                    if (button.action === 'gate' || button.action === 'review') open(item);
                    else void act(item, button.action);
                  }}
                  disabled={busy}
                  className="px-2.5 py-1.5 rounded-lg bg-[#40916C] text-[var(--accent-ink)] text-[11px] font-extrabold cursor-pointer disabled:opacity-50"
                >
                  {busy ? '…' : button.label}
                </button>
              )}
              {item.kind === 'task' && item.actions.includes('release') && (
                <button
                  onClick={() => void act(item, 'release')}
                  disabled={busy}
                  className="px-2.5 py-1 rounded-lg border border-[var(--brief-line)] text-[11px] font-bold text-[var(--ink-60)] cursor-pointer disabled:opacity-50"
                >
                  Hand back
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
