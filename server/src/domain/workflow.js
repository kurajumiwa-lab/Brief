// ---------------------------------------------------------------------------
// AUTOMATION ENGINE — trigger → condition → action, with a memory
//
// The rule table is `workflows`; the run log is `workflowRuns`. Both existed for
// the creator-facing trigger/condition/action feature and this engine EXTENDS
// them rather than duplicating them: two rule engines would be one lie. The
// diff is in four places, and each one was a defect or a dead end:
//
//   1. A CURSOR, NOT A WINDOW. The old sweep read `signals.slice(-500)`. More
//      than five hundred signals between two sweeps and the older ones were
//      never processed — with no record that they were skipped. The cursor is
//      an integer in `engineState`, so a backlog DRAINS instead of evaporating.
//   2. THE RUN ROW IS WRITTEN BEFORE THE ACTIONS. It used to be written after,
//      which meant a throwing action left no trace at all today and the next
//      tick re-ran the actions that had already succeeded — a second
//      notification to the same person. Now: `running`, then `ok | partial |
//      failed`, with a per-action result so a retry re-runs only what failed.
//   3. ACTIONS ARE NAMED CAPABILITIES, NOT THREE VERBS. `notify`/`tag`/`blast`
//      could tell somebody that something needed doing but could never do it, so
//      no signal could cause a state transition. See engine/actions.js.
//   4. FAILURES END SOMEWHERE. The retry ladder is declared, and its last rung
//      is a dead letter on a queue a person works. A thrown action used to
//      escape into an empty `.catch()`.
//
// THREE KINDS OF AUTOMATION, WHICH IS WHAT "ALWAYS ON" ACTUALLY NEEDS:
//
//   reactive   something happened → respond          (the signal cursor)
//   scheduled  a time arrived → act                  (the `schedules` table)
//   state      something stayed in a state too long  (kind:'state' rules)
//
// The third is the one that was missing everywhere: an age is only watchable if
// something records when the state was entered, and only acts if something
// looks at it on a clock. Both now exist.
//
// HONESTY, unchanged from before:
//   * a `blast` action fails closed when no outbound provider is configured —
//     it never claims a send that did not happen
//   * a workflow only reacts to events that genuinely occurred
//   * the run log is append-only, so an operator can see exactly what fired
// ---------------------------------------------------------------------------

import { store, newId } from '../store.js';
import * as actions from './engine/actions.js';
import * as deadLetters from './engine/deadLetters.js';
import * as review from './engine/review.js';
import * as schedules from './engine/schedules.js';

export const ACTION_TYPES = actions.ACTION_TYPES;

/** Every condition field a workflow may filter on. */
export const CONDITION_FIELDS = ['actorId', 'type', 'objectId', 'circleId', 'entityKind', 'entityId', 'metadata'];

/** The three shapes of automation. A rule says which one it is. */
export const KINDS = ['reactive', 'scheduled', 'state'];

/** How far a rule may go on its own (EVENT-ENGINE.md §8). */
export const FRONTIERS = ['auto', 'rule_threshold', 'human', 'manual'];

/** Signals processed in one tick before yielding; the cursor keeps the rest. */
const MAX_PER_TICK = 5000;
/** How long before a state rule may fire again for the same subject. */
const STATE_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function readField(signal, field) {
  if (field === 'actorId') return signal.actorId ?? null;
  if (field === 'type') return signal.type ?? null;
  if (field === 'objectId') return signal.objectId ?? null;
  if (field === 'circleId') return signal.circleId ?? null;
  if (field === 'entityKind') return signal.entityKind ?? null;
  if (field === 'entityId') return signal.entityId ?? null;
  if (field.startsWith('metadata.')) {
    const key = field.slice('metadata.'.length);
    return signal.metadata?.[key] ?? null;
  }
  return null;
}

function matchesCondition(signal, cond) {
  const actual = readField(signal, cond.field);
  const want = cond.value;
  switch (cond.op) {
    case 'eq': return String(actual ?? '') === String(want ?? '');
    case 'ne': return String(actual ?? '') !== String(want ?? '');
    case 'contains': return String(actual ?? '').toLowerCase().includes(String(want ?? '').toLowerCase());
    case 'exists': return actual !== null && actual !== undefined;
    default: return false;
  }
}

// --- the rule table ---------------------------------------------------------

export function createWorkflow({ name, trigger, conditions = [], actions: acts = [], ownerId, enabled = true, kind = 'reactive', state = null, frontier = 'auto', thresholdKey = null, system = false, slug = null }) {
  if (!name || !String(name).trim()) throw new Error('name is required');
  if (kind !== 'state' && !trigger) throw new Error('trigger is required');
  if (kind === 'state' && !state) throw new Error('a state rule needs a state { collection, status, ageField }');
  if (!ownerId && !system) throw new Error('an owner is required');
  if (!KINDS.includes(kind)) throw new Error(`unknown kind: ${kind}`);
  if (!FRONTIERS.includes(frontier)) throw new Error(`unknown frontier: ${frontier}`);
  if (!system && (!Array.isArray(acts) || acts.length === 0)) throw new Error('at least one action is required');
  for (const a of acts ?? []) {
    if (!actions.hasAction(a.type)) throw new Error(`unknown action type: ${a.type}`);
  }
  const now = new Date().toISOString();
  return store.insert('workflows', {
    id: newId('wf'),
    name: String(name).trim(),
    slug,
    system: Boolean(system),
    kind,
    trigger: trigger ?? null,
    state: state ? { ...state } : null,
    frontier,
    thresholdKey,
    conditions: conditions.map((c) => ({ field: c.field, op: c.op, value: c.value ?? null })),
    actions: (acts ?? []).map((a) => ({ ...a })),
    ownerId: ownerId ?? null,
    enabled: enabled !== false,
    // State rules remember the last time they fired for each subject. Without
    // it, "has this been stuck for two days" would escalate on every tick.
    stateFires: {},
    createdAt: now,
    updatedAt: now
  });
}

export function updateWorkflow(id, patch) {
  const wf = store.find('workflows', (w) => w.id === id);
  if (!wf) throw new Error('workflow not found');
  const allowed = ['name', 'trigger', 'conditions', 'actions', 'enabled', 'kind', 'state', 'frontier', 'thresholdKey'];
  const next = {};
  for (const k of allowed) if (k in (patch ?? {})) next[k] = patch[k];
  if (next.actions) {
    for (const a of next.actions) if (!actions.hasAction(a.type)) throw new Error(`unknown action type: ${a.type}`);
  }
  // An automation level is policy, and changing policy is an act with an author
  // (EVENT-ENGINE.md §8). The audit trail is the signal log.
  const levelChanged = next.frontier && next.frontier !== wf.frontier;
  const updated = store.update('workflows', id, { ...next, updatedAt: new Date().toISOString() });
  if (levelChanged) {
    void emitEngineEvent('automation_level_changed', {
      workflowId: id,
      from: wf.frontier,
      to: next.frontier,
      actorId: patch?.updatedBy ?? null
    });
  }
  return updated;
}

export function getWorkflow(id) {
  return store.find('workflows', (w) => w.id === id) ?? null;
}

/**
 * Rules. System rules (the engine's own defaults) are excluded unless asked
 * for, so the creator-facing list keeps showing only what the creator wrote.
 */
export function listWorkflows({ ownerId = null, includeSystem = false, kind = null } = {}) {
  let rows = store.all('workflows');
  if (!includeSystem) rows = rows.filter((w) => !w.system);
  if (ownerId) rows = rows.filter((w) => w.ownerId === ownerId);
  if (kind) rows = rows.filter((w) => (w.kind ?? 'reactive') === kind);
  return rows.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** Does this workflow's trigger + conditions match a signal? */
export function matches(wf, signal) {
  if (!wf.enabled) return false;
  if ((wf.kind ?? 'reactive') === 'state') return false; // state rules do not react
  if (wf.trigger !== '*' && wf.trigger !== signal.type) return false;
  return (wf.conditions ?? []).every((c) => matchesCondition(signal, c));
}

// --- the run log ------------------------------------------------------------

function openRun({ workflow, signal = null, subject = null, eventSeq = null, reason = null }) {
  const now = new Date().toISOString();
  return store.insert('workflowRuns', {
    id: newId('wfrun'),
    workflowId: workflow.id,
    workflowName: workflow.name,
    // `signalId` is kept for the existing dedupe and for the creator UI; a
    // state or scheduled run has no signal, so it carries a stable synthetic id
    // ('state:<subjectId>' / 'schedule:<scheduleId>') which doubles as its key.
    signalId: signal?.id ?? reason ?? null,
    signalType: signal?.type ?? reason ?? null,
    eventSeq,
    subject,
    status: 'running',
    attempt: 1,
    startedAt: now,
    endedAt: null,
    error: null,
    nextRetryAt: null,
    deadLettered: false,
    results: [],
    at: now
  });
}

function closeRun(run, { results, error = null }) {
  const failed = results.filter((r) => !r.ok);
  const status = error ? 'failed' : failed.length === 0 ? 'ok' : failed.length === results.length ? 'failed' : 'partial';
  const attempt = run.attempt ?? 1;
  const next = status === 'failed' && !deadLetters.exhausted(attempt)
    ? deadLetters.nextRetryAt(attempt)
    : null;
  return store.update('workflowRuns', run.id, {
    status,
    results,
    error,
    endedAt: new Date().toISOString(),
    nextRetryAt: next,
    // A partial run still retries its failures. `attempt` counts runs of this
    // unit of work, which is what the ladder is measured in.
    attempt,
    at: run.at ?? run.startedAt
  });
}

/**
 * Execute a workflow for one event (or one state subject).
 *
 * Actions run in order and each result is recorded alone, so a retry can re-run
 * only the ones that failed without repeating the ones that succeeded.
 */
async function runWorkflow(workflow, ctx, { onlyActions = null } = {}) {
  const run = ctx.run ?? openRun({
    workflow,
    signal: ctx.signal ?? null,
    subject: ctx.subject ?? null,
    eventSeq: ctx.signal?.seq ?? null,
    reason: ctx.reason ?? null
  });

  // The action context: which rule is acting, on what event, and on what
  // subject. Actions that record provenance (a notification, an escalation, a
  // scheduled reminder) need all three, and a rule that cannot name itself in
  // the record it produces is not auditable.
  const actionCtx = { ...ctx, workflow, run };

  const results = [];
  let thrown = null;
  for (const action of workflow.actions ?? []) {
    if (onlyActions && !onlyActions.includes(action.type)) {
      const previous = (run.results ?? []).find((r) => r.action === action.type);
      if (previous) results.push(previous);
      continue;
    }
    try {
      const outcome = await actions.run(action.type, action, actionCtx);
      results.push({
        action: action.type,
        ok: outcome?.ok !== false,
        reason: outcome?.reason ?? null,
        detail: outcome?.detail ?? null,
        money: actions.isMoneyAction(action.type)
      });
    } catch (error) {
      // A THROW is a fault, not a refusal. It is recorded as a failed action
      // here and the run is marked failed — never swallowed, which is what the
      // old empty `.catch()` in installSweep() did.
      thrown = String(error?.message ?? error);
      results.push({ action: action.type, ok: false, reason: 'threw', error: thrown, money: actions.isMoneyAction(action.type) });
    }
  }

  const closed = closeRun(run, { results, error: thrown });
  // The ladder's last rung is a row a person can work.
  if (closed.status === 'failed' && deadLetters.exhausted(closed.attempt)) {
    deadLetters.open({
      key: `run:${closed.id}`,
      workflowId: workflow.id,
      runId: closed.id,
      eventId: ctx.signal?.id ?? null,
      action: results.find((r) => !r.ok)?.action ?? null,
      payload: { runId: closed.id, results, subject: ctx.subject ?? null, signalType: ctx.signal?.type ?? null },
      attempts: closed.attempt,
      error: thrown ?? results.find((r) => !r.ok)?.reason ?? 'action failed'
    });
    store.update('workflowRuns', closed.id, { deadLettered: true });
  }
  return closed;
}

// --- reactive automation: the cursor ----------------------------------------

export function readCursor() {
  return Number(store.find('engineState', (r) => r.id === 'workflow_cursor')?.lastSeq) || 0;
}

export function setCursor(seq) {
  const row = store.find('engineState', (r) => r.id === 'workflow_cursor');
  if (row) store.update('engineState', row.id, { lastSeq: seq, at: new Date().toISOString() });
  else store.insert('engineState', { id: 'workflow_cursor', lastSeq: seq, at: new Date().toISOString() });
  return seq;
}

/**
 * Process every signal after the cursor.
 *
 * Idempotent the way the old sweep was — deduped by (workflow, signal) in
 * `workflowRuns` — so a re-run, a restart, or a replayed log cannot make a rule
 * act twice on one event.
 */
export async function sweep({ max = MAX_PER_TICK } = {}) {
  const cursor = readCursor();
  const pending = store
    .all('signals')
    .filter((s) => Number(s.seq) > cursor)
    .sort((a, b) => Number(a.seq) - Number(b.seq));

  const rules = listWorkflows({ includeSystem: true }).filter((w) => matches2Enabled(w));
  const runs = store.all('workflowRuns');
  const done = new Set(runs.filter((r) => r.signalId).map((r) => `${r.workflowId}:${r.signalId}`));

  const batch = pending.slice(0, max);
  let executed = 0;
  let lastSeq = cursor;

  for (const signal of batch) {
    for (const wf of rules) {
      const key = `${wf.id}:${signal.id}`;
      if (done.has(key)) continue;
      if (!matches(wf, signal)) continue;
      const run = await runWorkflow(wf, { signal });
      // `executed` counts ACTIONS that succeeded, which is what it has always
      // meant to callers. `runs` says how many rules fired.
      executed += (run.results ?? []).filter((r) => r.ok).length;
      done.add(key);
    }
    lastSeq = Number(signal.seq);
  }

  // The cursor advances past everything EXAMINED, including events no rule
  // wanted — otherwise every tick would re-scan every unrouted event forever.
  if (lastSeq > cursor) setCursor(lastSeq);

  return {
    executed,
    examined: batch.length,
    // A backlog is visible rather than silent: this is the number the old
    // window used to discard.
    remaining: Math.max(0, pending.length - batch.length),
    cursor: lastSeq
  };
}

const matches2Enabled = (w) => w.enabled !== false && (w.kind ?? 'reactive') !== 'state';

// --- state-based automation: age in a state ---------------------------------

/**
 * "Something has remained in a state too long."
 *
 * The rule names a collection, the statuses to watch, a timestamp field and an
 * age. This is the automation an always-on operator actually needs — it is what
 * notices that a work order has been confirmed for two days with nobody
 * starting it, without anybody remembering to look.
 */
export async function evaluateStateRules({ now = Date.now() } = {}) {
  const rules = listWorkflows({ includeSystem: true, kind: 'state' }).filter((w) => w.enabled !== false);
  let fired = 0;

  for (const wf of rules) {
    const watch = wf.state ?? {};
    const rows = store.all(watch.collection ?? '');
    for (const row of rows) {
      if (watch.status && !watch.status.includes(row.status)) continue;
      const stamp = watch.ageField ? Date.parse(row[watch.ageField] ?? '') : NaN;
      if (!Number.isFinite(stamp)) continue;
      const age = now - stamp;
      if (age < (Number(watch.olderThanMs) || 0)) continue;

      // Cooldown, per subject: without it a stuck row would escalate on every
      // tick, and the queue would become unworkable instead of informative.
      const last = Date.parse(wf.stateFires?.[row.id] ?? '') || 0;
      if (last && now - last < STATE_COOLDOWN_MS) continue;

      const subject = { kind: watch.subjectKind ?? (watch.collection ?? '').replace(/s$/, ''), id: row.id };
      const run = await runWorkflow(wf, {
        subject,
        reason: `state:${row.id}`,
        signal: null
      });
      const fires = { ...(wf.stateFires ?? {}), [row.id]: new Date().toISOString() };
      store.update('workflows', wf.id, { stateFires: fires });
      if (run.status !== 'failed') fired++;
    }
  }
  return { fired };
}

// --- scheduled automation: the clock ----------------------------------------

/**
 * Fire what is due.
 *
 * The schedule row is marked AFTER the action, deliberately: a crash mid-action
 * leaves it `pending` and it fires again. At-least-once is the correct choice
 * here because the actions are idempotent by key — better a duplicate attempt
 * than a reminder nobody ever gets.
 */
export async function fireDueSchedules({ now = Date.now() } = {}) {
  const due = schedules.due({ now });
  const fired = [];
  for (const row of due) {
    const wf = row.workflowId ? getWorkflow(row.workflowId) : null;
    const ctx = {
      signal: null,
      subject: row.subject,
      reason: `schedule:${row.id}`,
      schedule: row,
      recipient: row.params?.userId ?? null
    };
    try {
      const outcome = await actions.run(row.action, { ...row.params, scheduleId: row.id }, ctx);
      if (outcome?.ok === false) {
        // A schedule whose action refused is not retried forever: it is
        // recorded as failed and shown, because the refusal is usually about
        // the world having changed (the subject was withdrawn).
        schedules.markFailed(row.id, { error: outcome.reason ?? 'action refused' });
        deadLetters.open({
          key: `schedule:${row.id}`,
          workflowId: row.workflowId,
          action: row.action,
          payload: { scheduleId: row.id, params: row.params },
          attempts: 1,
          error: outcome.reason ?? 'action refused'
        });
      } else {
        schedules.markFired(row.id, { result: outcome?.detail ?? null });
      }
      fired.push({ id: row.id, action: row.action, wf: wf?.name ?? null });
    } catch (error) {
      schedules.markFailed(row.id, { error: error?.message ?? error });
      deadLetters.open({
        key: `schedule:${row.id}`,
        workflowId: row.workflowId,
        action: row.action,
        payload: { scheduleId: row.id, params: row.params },
        attempts: 1,
        error: String(error?.message ?? error)
      });
    }
  }
  return { fired: fired.length, schedules: fired };
}

// --- retries ----------------------------------------------------------------

/**
 * Re-run the failures that are due.
 *
 * Only the actions that failed are re-run: repeating a notification that
 * already succeeded is its own kind of harm, and the per-action results in the
 * run row are what make that possible.
 */
export async function retryDue({ now = Date.now() } = {}) {
  const candidates = store.filter(
    'workflowRuns',
    (r) => r.status === 'failed' && !r.deadLettered && r.nextRetryAt && Date.parse(r.nextRetryAt) <= now
  );
  const retried = [];
  for (const run of candidates) {
    const wf = getWorkflow(run.workflowId);
    if (!wf) continue;
    const failedActions = (run.results ?? []).filter((r) => !r.ok).map((r) => r.action);
    const signal = run.signalId ? store.find('signals', (s) => s.id === run.signalId) : null;
    const next = await runWorkflow(
      wf,
      {
        signal,
        subject: run.subject ?? null,
        reason: run.signalId,
        run: store.update('workflowRuns', run.id, {
          status: 'running',
          attempt: (run.attempt ?? 1) + 1,
          startedAt: new Date().toISOString(),
          nextRetryAt: null
        })
      },
      { onlyActions: failedActions }
    );
    retried.push({ runId: run.id, status: next.status, attempt: next.attempt });
  }
  return { retried };
}

// --- the tick ---------------------------------------------------------------

/**
 * One pass of everything an always-on engine does: react to what happened,
 * fire what is due, retry what broke, and look at what has been sitting still.
 * Called on a cadence by `installSweep` and by tests directly.
 */
export async function tick({ max = MAX_PER_TICK } = {}) {
  const swept = await sweep({ max });
  const scheduled = await fireDueSchedules();
  const retries = await retryDue();
  const states = await evaluateStateRules();
  return { swept, scheduled, retries, states };
}

/**
 * Install a periodic sweep so workflows fire without a request. Uses the same
 * unref'd setInterval discipline as the backup cadence, so it never holds the
 * process open. Off in tests.
 */
export function installSweep({ intervalMs = 60 * 1000 } = {}) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return null;
  const timer = setInterval(() => {
    tick().catch(async (e) => {
      // A failed tick is recorded, not swallowed: the old empty catch is
      // exactly how a permanently broken engine stays quiet.
      try {
        deadLetters.open({
          key: `tick:${new Date().toISOString().slice(0, 16)}`,
          action: 'tick',
          attempts: 1,
          error: String(e?.message ?? e)
        });
      } catch {
        // nothing left to do
      }
    });
  }, intervalMs);
  timer.unref?.();
  return timer;
}

// --- reporting --------------------------------------------------------------

/** Runs, newest first — the operator's view of what fired and why. */
export function listRuns({ limit = 100, status = null } = {}) {
  let rows = store.all('workflowRuns');
  if (status) rows = rows.filter((r) => r.status === status);
  return rows
    .slice()
    .sort((a, b) => String(b.at ?? b.startedAt).localeCompare(String(a.at ?? a.startedAt)))
    .slice(0, limit);
}

export function runStats() {
  const runs = store.all('workflowRuns');
  const byWorkflow = {};
  const byStatus = {};
  for (const r of runs) {
    byWorkflow[r.workflowId] = (byWorkflow[r.workflowId] ?? 0) + 1;
    const s = r.status ?? 'legacy';
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }
  return { totalRuns: runs.length, byWorkflow, byStatus };
}

/**
 * The engine's whole state in one object, for an ops desk: what is queued, what
 * broke, what a person must decide, and how much ran without one.
 */
export function engineStatus() {
  return {
    cursor: readCursor(),
    signals: store.all('signals').length,
    rules: {
      total: store.all('workflows').length,
      system: store.all('workflows').filter((w) => w.system).length,
      byKind: store.all('workflows').reduce((acc, w) => {
        const k = w.kind ?? 'reactive';
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {})
    },
    runs: runStats(),
    schedules: schedules.stats(),
    review: review.stats(),
    deadLetters: deadLetters.stats()
  };
}

// --- the engine's own defaults ----------------------------------------------

async function emitEngineEvent(type, metadata) {
  try {
    const { emitSignal } = await import('../signal.js');
    return emitSignal({ type, actorId: metadata.actorId ?? null, actorKind: metadata.actorId ? 'operator' : 'rule', source: 'internal', metadata });
  } catch {
    return null;
  }
}

/**
 * The rules the engine ships with. They are ROWS, not code branches, so an
 * operator can see them, disable one, or change its threshold without a deploy
 * — and so "what does this system do on its own?" is a query rather than an
 * archaeology expedition.
 *
 * Idempotent by `slug`: a restart re-asserts the defaults and never duplicates
 * them, and an operator's edits to a default are not silently reverted.
 */
export const DEFAULT_RULES = [
  {
    slug: 'campaign-past-end-closes',
    name: 'A campaign past its end closes itself',
    kind: 'state',
    frontier: 'auto',
    state: { collection: 'campaigns', status: ['published', 'live'], ageField: 'endsAt', olderThanMs: 0, subjectKind: 'campaign' },
    actions: [{ type: 'close_campaign' }],
    why: 'Before this, "has it ended" was a read-time opinion: the row still said published and the dashboard showed a live event that could not sell a ticket.'
  },
  {
    slug: 'work-order-reminder-24h',
    name: 'Remind the requester a day after a work order is created',
    kind: 'reactive',
    frontier: 'auto',
    trigger: 'work_order_created',
    conditions: [],
    actions: [{ type: 'schedule', action: 'remind', inMs: 24 * 60 * 60 * 1000, title: 'A work order you created is waiting', body: 'Nothing has been agreed on it yet.' }],
    why: 'The scheduled kind: a time arrives and something should happen, durably, even across a restart.'
  },
  {
    slug: 'work-order-stuck-after-confirm',
    name: 'Escalate a work order confirmed but never started',
    kind: 'state',
    frontier: 'rule_threshold',
    state: { collection: 'workOrders', status: ['confirmed'], ageField: 'updatedAt', olderThanMs: 48 * 60 * 60 * 1000, subjectKind: 'work_order' },
    actions: [{ type: 'escalate', kind: 'work_order_stuck', reason: 'Confirmed two days ago and never started' }],
    why: 'The state-based kind: age in a state is the thing a person notices too late and a rule notices on time.'
  },
  {
    slug: 'work-order-delivered-requests-release',
    name: 'A delivered work order asks for its money',
    kind: 'reactive',
    frontier: 'rule_threshold',
    trigger: 'work_order_delivered',
    conditions: [],
    actions: [{ type: 'escalate', kind: 'payout_large', reason: 'Work delivered — release is a human decision', data: { policy: 'release_requires_review' } }],
    why: 'The frontier, applied: of the operations in §8, releasing money is the one that must not be automatic. The rule does the noticing; a person does the releasing.'
  }
];

/**
 * Seed the defaults. `enabled` is left alone on an existing rule: an operator
 * who switched one off meant it.
 */
export function ensureDefaultRules() {
  const created = [];
  for (const spec of DEFAULT_RULES) {
    if (store.find('workflows', (w) => w.slug === spec.slug)) continue;
    created.push(
      createWorkflow({
        name: spec.name,
        trigger: spec.trigger,
        conditions: spec.conditions ?? [],
        actions: spec.actions,
        ownerId: null,
        system: true,
        slug: spec.slug,
        kind: spec.kind,
        state: spec.state ?? null,
        frontier: spec.frontier
      })
    );
  }
  return created;
}
