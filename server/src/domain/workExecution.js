// ---------------------------------------------------------------------------
// WORK EXECUTION — Intent → Task → Proof → Outcome → Money.
//
//   INTENT   a WORK PROGRAM: "onboard 50 retailers in Nairobi West at KES 300
//            per approved merchant, within 7 days", run on a template.
//   TASK     the program decomposes into UNITS (one merchant, one quotation,
//            one interview). Each unit moves through the template's steps; each
//            step is a TASK one worker accepts. A hybrid unit can be called
//            from home by one worker and visited in the field by another.
//   PROOF    a submission: the answers, the photos, the location, the consent.
//            Automatic checks run on submit: hard failures are refused at the
//            door; soft findings (outside territory, possible duplicate, late)
//            are flagged for the reviewer, never silently decided.
//   OUTCOME  a human reviewer (owner or supervisor, never the submitter)
//            approves, returns for correction, or rejects. The unit's outcome
//            is approved only when its last step is approved; a gate answer
//            ("owner not interested") closes it honestly as not converted.
//   MONEY    a worker's earnings are DERIVED: the frozen step fee for every
//            approved task whose unit reached an approved outcome. Nothing is
//            stored as a balance. Money moves only through a weekly settlement
//            finance confirms, which writes a real ledger transaction
//            (type `work_task_fee`) — the fieldAgent/partner pattern exactly.
//
// PAY FOLLOWS DECISION 5's PRINCIPLE (docs/DECISIONS.md): a flat fee per
// approved act. The step fee is fixed when the program is created and frozen
// in its rate card. No bonus, no volume tier, no speed incentive, no quality
// multiplier — so this module accepts none of them. Decision 5's own number
// (KES 150 per approved shop visit) governs Brief's own field-agent program
// in fieldAgent.js and is not touched here: a Work Program's price is set by
// the organisation paying for the outcome.
//
// MATCHING IS EXPLAINED, NEVER SCORED. Eligibility is a list of plain
// reasons ("In Nairobi West", "18 merchant onboarding tasks approved") and
// plain blockers ("Read the merchant onboarding briefing first"). There is no
// percentage and no hidden rank.
// ---------------------------------------------------------------------------

import { store, newId } from '../store.js';
import { createTransaction, transitionTransaction } from './ledger.js';
import { isoWeekOf } from './fieldAgent.js';
import { getTemplate, templateMode, templateView, TEMPLATE_KEYS } from './workTemplates.js';
import * as wf from './workforce.js';
import { getRequest } from './requests.js';

const { fail } = wf;

export const PROGRAM_STATUS = ['draft', 'open', 'paused', 'closed'];
export const PROGRAM_AUDIENCE = ['workforce', 'network'];
export const UNIT_STATUS = ['in_progress', 'approved', 'rejected', 'not_converted', 'abandoned'];
export const TASK_STATUS = ['open', 'assigned', 'submitted', 'approved', 'rejected', 'released'];
export const REVIEW_DECISIONS = ['approve', 'return', 'reject'];
export const SETTLEMENT_STATUS = ['pending', 'confirmed', 'refused'];

// PROVISIONAL — pending an operator decision (recorded in docs/WORKFORCE.md).
// Brief's fee as basis points of the per-unit price. It is frozen into each
// program's rate card at creation, so changing it never rewrites a live
// program's terms.
export const BRIEF_WORK_FEE_BPS = 2000;

export const MAX_HELD_TASKS = 10;     // assigned-but-unsubmitted tasks per worker
export const MAX_CLAIM_BATCH = 10;
export const LOW_ACCURACY_M = 150;
export const REASON_MIN = 4;

const nowIso = () => new Date().toISOString();
const clean = (v, max = 300) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const live = (u) => u.status === 'in_progress' || u.status === 'approved';

// ---------------------------------------------------------------------------
// RATE CARD — integer KES, exact. The worker pool is split by step share with
// the remainder on the last step, so step fees always sum to the pool and the
// pool plus Brief's fee always equals the unit price. Nothing is rounded away.
// ---------------------------------------------------------------------------
export function rateCard(template, unitPriceKes, feeBps = BRIEF_WORK_FEE_BPS) {
  const briefFeeKes = Math.floor((unitPriceKes * feeBps) / 10000);
  const workerPoolKes = unitPriceKes - briefFeeKes;
  let allocated = 0;
  const steps = template.steps.map((s, i) => {
    const last = i === template.steps.length - 1;
    const feeKes = last ? workerPoolKes - allocated : Math.floor((workerPoolKes * s.share) / 100);
    allocated += feeKes;
    return { key: s.key, label: s.label, mode: s.mode, share: s.share, feeKes };
  });
  return { currency: 'KES', unitPriceKes, feeBps, briefFeeKes, workerPoolKes, steps };
}

// ---------------------------------------------------------------------------
// PROGRAMS
// ---------------------------------------------------------------------------

export function getProgram(id) {
  return store.find('workPrograms', (p) => p.id === id) ?? null;
}

export function getTask(id) {
  return store.find('workTasks', (t) => t.id === id) ?? null;
}

function pushHistory(row, entry) {
  return [...(row.history ?? []), { at: nowIso(), ...entry }].slice(-200);
}

export function createProgram(workforceId, actorId, input = {}) {
  const workforce = wf.requireOwner(workforceId, actorId);
  const template = getTemplate(input.templateKey);
  if (!template) fail(`templateKey must be one of ${TEMPLATE_KEYS.join(', ')}`);
  const title = clean(input.title, 100);
  if (!title || title.length < 4) fail('give the program a title of at least 4 characters');
  const objective = clean(input.objective, 600) ?? '';
  const target = Number(input.target);
  if (!Number.isInteger(target) || target < 1 || target > 10000) fail('target must be a whole number from 1 to 10,000');
  const unitPriceKes = Number(input.unitPriceKes);
  if (!Number.isInteger(unitPriceKes) || unitPriceKes < 20 || unitPriceKes > 1000000) {
    fail('the price per approved unit must be a whole number of shillings from 20 to 1,000,000');
  }
  const audience = input.audience ?? 'workforce';
  if (!PROGRAM_AUDIENCE.includes(audience)) fail(`audience must be one of ${PROGRAM_AUDIENCE.join(', ')}`);
  const deadline = String(input.deadline ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || Number.isNaN(Date.parse(deadline))) fail('a deadline is required, as YYYY-MM-DD');
  if (deadline < nowIso().slice(0, 10)) fail('the deadline cannot be in the past');

  const territoryIds = [...new Set(Array.isArray(input.territoryIds) ? input.territoryIds : [])];
  for (const id of territoryIds) {
    const t = wf.getTerritory(id);
    if (!t || t.workforceId !== workforceId || t.status !== 'active') fail('territory not found in this workforce', 404, 'not_found');
  }
  const hasField = template.steps.some((s) => s.mode === 'field');
  if (hasField && !territoryIds.length) fail('field work needs at least one territory — where should workers go?');

  let territoryTargets = null;
  if (input.territoryTargets && typeof input.territoryTargets === 'object') {
    territoryTargets = {};
    let sum = 0;
    for (const [id, n] of Object.entries(input.territoryTargets)) {
      if (!territoryIds.includes(id)) fail('a territory quota names a territory the program does not cover');
      const v = Number(n);
      if (!Number.isInteger(v) || v < 1) fail('each territory quota must be a whole number of at least 1');
      territoryTargets[id] = v;
      sum += v;
    }
    if (sum > target) fail(`territory quotas add up to ${sum}, more than the target of ${target}`);
    if (!Object.keys(territoryTargets).length) territoryTargets = null;
  }

  // Provenance only: workforce execution must not complete a procurement
  // request or fabricate its quote/work-order/payment chain.
  const sourceRequestId = clean(input.sourceRequestId, 100);
  if (sourceRequestId) getRequest(actorId, sourceRequestId); // owner-scoped, including private requests
  const now = nowIso();
  return store.insert('workPrograms', {
    id: newId('wpg'),
    workforceId: workforce.id,
    sourceRequestId,
    ownerId: workforce.ownerId,
    title,
    objective,
    templateKey: template.key,
    mode: templateMode(template),
    audience,
    territoryIds,
    territoryTargets,
    target,
    unitPriceKes,
    // FROZEN TERMS: what every approved unit is worth, and to whom. A stated
    // contract term, not a running total — totals are always derived.
    rateCard: rateCard(template, unitPriceKes),
    deadline,
    status: 'draft',
    revision: 1,
    history: [{ at: now, actorId, action: 'created' }],
    createdBy: actorId,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    closedAt: null
  });
}

const PROGRAM_TRANSITIONS = {
  publish: { from: ['draft'], to: 'open' },
  pause: { from: ['open'], to: 'paused' },
  resume: { from: ['paused'], to: 'open' },
  close: { from: ['draft', 'open', 'paused'], to: 'closed' }
};

export function changeProgramStatus(programId, actorId, { action, revision } = {}) {
  const p = getProgram(programId);
  if (!p) fail('program not found', 404, 'not_found');
  wf.requireOwner(p.workforceId, actorId);
  const t = PROGRAM_TRANSITIONS[action];
  if (!t) fail(`action must be one of ${Object.keys(PROGRAM_TRANSITIONS).join(', ')}`);
  if (revision !== undefined && Number(revision) !== p.revision) fail('this program changed since you opened it — reload', 409, 'stale_revision');
  if (!t.from.includes(p.status)) fail(`a ${p.status} program cannot ${action}`, 409, 'invalid_state');
  const now = nowIso();
  return store.transaction(() => {
    // Closing withdraws unclaimed next steps; work already held continues, so
    // nobody loses a task they are in the middle of.
    if (action === 'close') {
      for (const task of store.filter('workTasks', (x) => x.programId === p.id && x.status === 'open')) {
        store.update('workTasks', task.id, { status: 'released', history: pushHistory(task, { action: 'withdrawn', note: 'program closed' }) });
        const unit = store.find('workUnits', (u) => u.id === task.unitId);
        if (unit?.status === 'in_progress') store.update('workUnits', unit.id, { status: 'abandoned', closedReason: 'Program closed before this step was taken', decidedAt: now });
      }
    }
    return store.update('workPrograms', p.id, {
      status: t.to,
      revision: p.revision + 1,
      publishedAt: action === 'publish' ? now : p.publishedAt,
      closedAt: action === 'close' ? now : p.closedAt,
      history: pushHistory(p, { actorId, action }),
      updatedAt: now
    });
  });
}

// ---------------------------------------------------------------------------
// ELIGIBILITY — explainable matching. Returns reasons and blockers in words.
// ---------------------------------------------------------------------------

function matchesArea(profile, territory) {
  if (!profile?.areas?.length || !territory) return false;
  const names = [territory.name, ...(territory.areas ?? [])].map((x) => x.toLowerCase());
  return profile.areas.some((a) => names.includes(a.toLowerCase()));
}

/** Territories (of the given candidates) this worker may do field work in. */
function workerTerritories(program, userId, profile, candidateIds) {
  const membership = wf.membershipOf(program.workforceId, userId);
  return candidateIds.filter((id) => {
    const t = wf.getTerritory(id);
    if (!t || t.status !== 'active') return false;
    if (membership?.status === 'active' && membership.territoryIds.includes(id)) return true;
    return program.audience === 'network' && matchesArea(profile, t);
  });
}

export function eligibility(userId, program, stepIndex = 0, unitTerritoryId = null) {
  const template = getTemplate(program.templateKey);
  const step = template.steps[stepIndex];
  const profile = wf.getProfile(userId);
  const reasons = [];
  const blockers = [];
  let territoryIds = [];

  if (program.ownerId === userId) blockers.push('You own this program — work on it is done by others');
  const membership = wf.membershipOf(program.workforceId, userId);
  if (program.audience === 'workforce') {
    if (!membership) blockers.push('Only members of this workforce can take this work');
    else if (membership.status === 'applied') blockers.push('Finish onboarding and wait for activation');
    else if (membership.status === 'suspended') blockers.push('Your membership is suspended');
    else reasons.push(`Member of ${wf.getWorkforce(program.workforceId)?.name ?? 'this workforce'}`);
  } else if (membership?.status === 'suspended') {
    blockers.push('Your membership in this workforce is suspended');
  } else {
    reasons.push('Open to the Brief worker network');
  }

  if (!profile) blockers.push('Set up your worker profile');
  else {
    if (!wf.termsCurrent(profile)) blockers.push('Accept the current independent-work terms');
    if (!wf.isBriefed(profile, template.key)) blockers.push(`Read the ${template.label.toLowerCase()} briefing first`);
    else reasons.push(`Briefed on ${template.label.toLowerCase()}`);
    if (!profile.modes.includes(step.mode)) {
      blockers.push(step.mode === 'field' ? 'Your profile says you do not do field work' : 'Your profile says you do not do home work');
    }
    if (step.mode === 'field' && step.gps && !profile.device?.gps) blockers.push('This step needs a phone with location (GPS)');
  }

  if (step.mode === 'field') {
    const candidates = unitTerritoryId ? [unitTerritoryId] : program.territoryIds;
    territoryIds = workerTerritories(program, userId, profile, candidates);
    if (!territoryIds.length) {
      const names = candidates.map((id) => wf.getTerritory(id)?.name).filter(Boolean).join(', ');
      blockers.push(`Not placed in ${names || 'this territory'}`);
    } else {
      reasons.push(`In ${territoryIds.map((id) => wf.getTerritory(id)?.name).join(', ')}`);
    }
  } else {
    territoryIds = unitTerritoryId ? [unitTerritoryId] : program.territoryIds.slice();
    reasons.push('Remote — no travel needed');
  }

  // Experience is a REASON, never a gate and never a score: counts with the
  // sample size, for the same template.
  const record = trackRecord(userId).byTemplate.find((r) => r.templateKey === template.key);
  if (record && record.approved) reasons.push(`${record.approved} ${template.label.toLowerCase()} task${record.approved === 1 ? '' : 's'} approved (of ${record.decided} decided)`);

  if (profile?.availableDays?.length && !profile.availableDays.includes(new Date().getUTCDay())) {
    reasons.push('Note: you are not marked available today');
  }

  return { eligible: blockers.length === 0, reasons, blockers, territoryIds };
}

// ---------------------------------------------------------------------------
// CAPACITY
// ---------------------------------------------------------------------------

function unitsOf(programId) {
  return store.filter('workUnits', (u) => u.programId === programId);
}

export function remainingCapacity(program, territoryId = null) {
  const units = unitsOf(program.id);
  const overall = program.target - units.filter(live).length;
  if (!territoryId || !program.territoryTargets?.[territoryId]) return Math.max(0, overall);
  const inTerritory = units.filter((u) => live(u) && u.territoryId === territoryId).length;
  return Math.max(0, Math.min(overall, program.territoryTargets[territoryId] - inTerritory));
}

function heldBy(userId) {
  return store.filter('workTasks', (t) => t.workerId === userId && t.status === 'assigned').length;
}

// ---------------------------------------------------------------------------
// EXPIRY — an assignment held past its window returns to the pool. Lazy: run
// on the reads and writes that would otherwise see a stale hold.
// ---------------------------------------------------------------------------

function releaseRow(task, { action, note, actorId = null }) {
  const now = nowIso();
  if (task.stepIndex === 0) {
    // A first step never started becomes nothing: the unit was only a slot.
    store.update('workTasks', task.id, { status: 'released', history: pushHistory(task, { actorId, action, note }) });
    store.update('workUnits', task.unitId, { status: 'abandoned', closedReason: note, decidedAt: now });
  } else {
    store.update('workTasks', task.id, {
      status: 'open', workerId: null, assignedAt: null, dueAt: null, execution: null,
      history: pushHistory(task, { actorId, action, note })
    });
  }
}

export function sweepExpired(at = Date.now()) {
  const expired = store.filter('workTasks', (t) => t.status === 'assigned' && t.dueAt && Date.parse(t.dueAt) < at);
  if (!expired.length) return 0;
  store.transaction(() => {
    for (const t of expired) releaseRow(t, { action: 'expired', note: 'Held past its time window without a submission' });
  });
  return expired.length;
}

// ---------------------------------------------------------------------------
// CLAIM (first step) and ACCEPT (a later step of a hybrid unit)
// ---------------------------------------------------------------------------

export function claim(userId, programId, { count = 1, territoryId = null, idempotencyKey = null } = {}) {
  sweepExpired();
  const program = getProgram(programId);
  if (!program || program.status === 'draft') fail('program not found', 404, 'not_found');
  if (program.status !== 'open') fail(`this program is ${program.status}`, 409, 'invalid_state');

  const key = idempotencyKey ? `${userId}:${String(idempotencyKey).slice(0, 80)}` : null;
  if (key) {
    const prior = store.filter('workUnits', (u) => u.programId === programId && u.claimKey === key);
    if (prior.length) {
      return store.filter('workTasks', (t) => prior.some((u) => u.id === t.unitId) && t.stepIndex === 0);
    }
  }

  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > MAX_CLAIM_BATCH) fail(`take between 1 and ${MAX_CLAIM_BATCH} at a time`);
  const elig = eligibility(userId, program, 0);
  if (!elig.eligible) fail(elig.blockers[0], 403, 'not_eligible', { blockers: elig.blockers });

  let tid = null;
  if (program.territoryIds.length) {
    tid = territoryId ?? elig.territoryIds[0] ?? null;
    if (!elig.territoryIds.includes(tid)) fail('you cannot take work in that territory', 403, 'not_eligible');
  }
  const remaining = remainingCapacity(program, tid);
  if (remaining < 1) fail(tid && program.territoryTargets?.[tid] ? 'this territory\'s quota is full' : 'this program has no work left to take', 409, 'full');
  if (n > remaining) fail(`only ${remaining} left to take`, 409, 'full', { remaining });
  const held = heldBy(userId);
  if (held + n > MAX_HELD_TASKS) fail(`you can hold ${MAX_HELD_TASKS} tasks at once — you hold ${held}. Submit or release some first.`, 409, 'too_many_held');

  const template = getTemplate(program.templateKey);
  const step = template.steps[0];
  const now = nowIso();
  const due = new Date(Date.now() + step.hours * 3600000).toISOString();
  return store.transaction(() => {
    const tasks = [];
    for (let i = 0; i < n; i++) {
      const unit = store.insert('workUnits', {
        id: newId('wun'),
        programId: program.id,
        workforceId: program.workforceId,
        territoryId: tid,
        status: 'in_progress',
        currentStep: 0,
        subject: {},
        subjectLabel: null,
        claimKey: key,
        startedBy: userId,
        closedReason: null,
        decidedAt: null,
        createdAt: now
      });
      tasks.push(store.insert('workTasks', {
        id: newId('wtk'),
        programId: program.id,
        workforceId: program.workforceId,
        unitId: unit.id,
        stepIndex: 0,
        stepKey: step.key,
        mode: step.mode,
        status: 'assigned',
        workerId: userId,
        assignedAt: now,
        dueAt: due,
        submittedAt: null,
        decidedAt: null,
        decidedBy: null,
        returns: 0,
        proofIds: [],
        history: [{ at: now, actorId: userId, action: 'claimed' }],
        createdAt: now
      }));
    }
    return tasks;
  });
}

export function acceptOpenTask(userId, taskId) {
  sweepExpired();
  const task = store.find('workTasks', (t) => t.id === taskId);
  if (!task) fail('task not found', 404, 'not_found');
  if (task.status !== 'open') fail('someone else has already taken this task', 409, 'invalid_state');
  const program = getProgram(task.programId);
  if (program.status === 'paused') fail('the organisation has paused this program', 409, 'invalid_state');
  const unit = store.find('workUnits', (u) => u.id === task.unitId);
  const elig = eligibility(userId, program, task.stepIndex, unit.territoryId);
  if (!elig.eligible) fail(elig.blockers[0], 403, 'not_eligible', { blockers: elig.blockers });
  if (heldBy(userId) + 1 > MAX_HELD_TASKS) fail(`you can hold ${MAX_HELD_TASKS} tasks at once. Submit or release some first.`, 409, 'too_many_held');
  const step = getTemplate(program.templateKey).steps[task.stepIndex];
  const now = nowIso();
  return store.update('workTasks', task.id, {
    status: 'assigned',
    workerId: userId,
    assignedAt: now,
    dueAt: new Date(Date.now() + step.hours * 3600000).toISOString(),
    history: pushHistory(task, { actorId: userId, action: 'accepted' })
  });
}

export function releaseTask(userId, taskId, { reason = '' } = {}) {
  const task = store.find('workTasks', (t) => t.id === taskId);
  if (!task || task.workerId !== userId) fail('task not found', 404, 'not_found');
  if (task.status !== 'assigned') fail(`this task is ${task.status}`, 409, 'invalid_state');
  store.transaction(() => releaseRow(task, { actorId: userId, action: 'released', note: clean(reason, 200) ?? 'Released by the worker' }));
  return store.find('workTasks', (t) => t.id === taskId);
}

/** Return every task a member holds in one workforce (on suspend/offboard). */
export function releaseHeldFor(member, why) {
  const held = store.filter('workTasks', (t) => t.workforceId === member.workforceId && t.workerId === member.userId && t.status === 'assigned');
  for (const t of held) releaseRow(t, { action: 'released', note: `Member ${why === 'offboard' ? 'offboarded' : 'suspended'}` });
  return held.length;
}

// ---------------------------------------------------------------------------
// PROOF — submit with hard validation, then automatic soft checks.
// ---------------------------------------------------------------------------

function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function validateFields(step, raw = {}) {
  const out = {};
  for (const f of step.fields) {
    const v = raw?.[f.key];
    const empty = v === undefined || v === null || String(v).trim() === '';
    if (empty) {
      if (f.required) fail(`${f.label} is required`, 400, 'missing_field', { field: f.key });
      continue;
    }
    if (f.kind === 'phone') {
      const p = wf.normalizePhone(v);
      if (!p) fail(`${f.label} must be a Kenyan mobile number`, 400, 'invalid_field', { field: f.key });
      out[f.key] = p;
    } else if (f.kind === 'number') {
      const num = Number(v);
      if (!Number.isFinite(num) || num < 0) fail(`${f.label} must be a number`, 400, 'invalid_field', { field: f.key });
      out[f.key] = num;
    } else if (f.kind === 'yesno') {
      const s = norm(v);
      if (s !== 'yes' && s !== 'no') fail(`${f.label}: answer yes or no`, 400, 'invalid_field', { field: f.key });
      out[f.key] = s;
    } else {
      out[f.key] = String(v).trim().slice(0, 600);
    }
  }
  return out;
}

// A device-reported start is an audit fact, not proof of physical presence.
// Optional for legacy API clients; the task runner records it before execution.
function readLocation(input) {
  if (input == null) return null;
  const validNumber = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!validNumber(input.lat) || !validNumber(input.lng) || Math.abs(input.lat) > 90 || Math.abs(input.lng) > 180) {
    fail('the location is not valid', 400, 'invalid_location');
  }
  if (input.accuracyM != null && (!validNumber(input.accuracyM) || input.accuracyM < 0)) {
    fail('location accuracy must be a non-negative number', 400, 'invalid_location');
  }
  return { lat: input.lat, lng: input.lng, accuracyM: input.accuracyM == null ? null : Math.round(input.accuracyM) };
}

export function startTask(userId, taskId, { location = null } = {}) {
  const task = getTask(taskId);
  if (!task || task.workerId !== userId) fail('task not found', 404, 'not_found');
  if (task.status !== 'assigned') fail('only an assigned task can be started', 409, 'invalid_state');
  if (task.dueAt && Date.parse(task.dueAt) < Date.now()) {
    sweepExpired();
    fail('the time window has passed; this task returned to the pool', 409, 'expired');
  }
  // Retry does not change the original timestamp or device location.
  if (task.execution) return task;
  const program = getProgram(task.programId);
  const step = getTemplate(program.templateKey).steps[task.stepIndex];
  const point = readLocation(location);
  if (step.gps && !point) fail('check in with your location when you arrive', 400, 'location_required');
  const execution = { startedAt: nowIso(), location: step.gps ? point : null };
  return store.update('workTasks', task.id, {
    execution,
    history: pushHistory(task, { actorId: userId, action: step.gps ? 'checked_in' : 'started', note: 'Device-reported start; subject to proof review' })
  });
}

export function submitProof(userId, taskId, input = {}) {
  const task = store.find('workTasks', (t) => t.id === taskId);
  if (!task || task.workerId !== userId) fail('task not found', 404, 'not_found');
  if (task.status !== 'assigned') fail(`this task is ${task.status} — it cannot be submitted`, 409, 'invalid_state');
  if (task.dueAt && Date.parse(task.dueAt) < Date.now()) {
    sweepExpired();
    fail('the time window for this task has passed and it returned to the pool', 409, 'expired');
  }
  const program = getProgram(task.programId);
  const template = getTemplate(program.templateKey);
  const step = template.steps[task.stepIndex];
  const unit = store.find('workUnits', (u) => u.id === task.unitId);

  // ---- HARD: refused at the door, nothing is written --------------------
  const fields = validateFields(step, input.fields);

  const photos = [...new Set(Array.isArray(input.photos) ? input.photos : [])].slice(0, 8);
  if (photos.length < step.photosMin) fail(`this step needs at least ${step.photosMin} photo${step.photosMin === 1 ? '' : 's'}`, 400, 'photos_required');
  for (const id of photos) {
    const up = store.find('uploads', (u) => u.id === id);
    if (!up || up.ownerId !== userId) fail('a photo was not found among your uploads', 400, 'invalid_photo');
    if ((up.purpose ?? 'public') !== 'private_work') fail('work photos must be uploaded as private work evidence', 400, 'invalid_photo');
    // One photo proves one thing. Reusing it on another unit is refused.
    const reused = store.find('workProofs', (p) => p.taskId !== task.id && p.photos.includes(id));
    if (reused) fail('this photo was already submitted for different work', 409, 'photo_reused');
  }

  const location = readLocation(input.location);
  if (step.gps && !location) fail('this step needs your location, captured while you are there', 400, 'location_required');

  let consent = null;
  if (step.consent) {
    const name = clean(input.consent?.name, 80);
    if (!input.consent?.given || !name) fail('record who gave consent — this step needs it', 400, 'consent_required');
    consent = { given: true, name, words: clean(input.consent?.words, 300) };
  }

  // ---- SOFT: automatic checks, shown to the reviewer ------------------
  const checks = [];
  checks.push({ key: 'required', label: 'Required answers present', status: 'pass', detail: `${Object.keys(fields).length} answer${Object.keys(fields).length === 1 ? '' : 's'} recorded` });
  if (step.photosMin) checks.push({ key: 'photos', label: 'Photos attached', status: 'pass', detail: `${photos.length} photo${photos.length === 1 ? '' : 's'}, none reused` });
  if (step.consent) checks.push({ key: 'consent', label: 'Consent recorded', status: 'pass', detail: `Given by ${consent.name}` });

  if (step.gps) {
    const territory = unit.territoryId ? wf.getTerritory(unit.territoryId) : null;
    if (territory?.center && territory.radiusKm) {
      const d = haversineKm(location, territory.center);
      const inside = d <= territory.radiusKm;
      checks.push({
        key: 'territory', label: `Location inside ${territory.name}`, status: inside ? 'pass' : 'flag',
        detail: inside ? `${d.toFixed(1)} km from the centre (limit ${territory.radiusKm} km)` : `${d.toFixed(1)} km from the centre — outside the ${territory.radiusKm} km area`
      });
    } else {
      checks.push({ key: 'territory', label: 'Location inside territory', status: 'not_checked', detail: territory ? `${territory.name} has no map area — location recorded, not checked` : 'No territory on this unit' });
    }
    if (location.accuracyM !== null && location.accuracyM > LOW_ACCURACY_M) {
      checks.push({ key: 'accuracy', label: 'Location accuracy', status: 'flag', detail: `±${location.accuracyM} m — weaker than ${LOW_ACCURACY_M} m` });
    }
  }

  const dedupeFields = step.fields.filter((f) => f.dedupe && fields[f.key] !== undefined);
  const labelField = step.fields.find((f) => f.subjectKey);
  const others = unitsOf(program.id).filter((u) => u.id !== unit.id && live(u));
  for (const f of dedupeFields) {
    const hit = others.find((u) => u.subject?.[f.key] === fields[f.key]) ??
      store.find('workProofs', (p) => p.programId === program.id && p.unitId !== unit.id && p.fields?.[f.key] === fields[f.key] &&
        others.some((u) => u.id === p.unitId));
    checks.push(hit
      ? { key: 'duplicate', label: `Unique ${f.label.toLowerCase()}`, status: 'flag', detail: `Same ${f.label.toLowerCase()} already recorded on another ${template.unitNoun} in this program` }
      : { key: 'duplicate', label: `Unique ${f.label.toLowerCase()}`, status: 'pass', detail: 'Not seen elsewhere in this program' });
  }
  if (labelField && fields[labelField.key] && unit.territoryId) {
    const same = others.find((u) => u.territoryId === unit.territoryId && norm(u.subjectLabel) === norm(fields[labelField.key]));
    if (same) checks.push({ key: 'duplicate_name', label: 'Unique name in territory', status: 'flag', detail: `Another ${template.unitNoun} with this name exists in the same territory` });
  }
  const lateNow = nowIso().slice(0, 10) > program.deadline;
  checks.push({ key: 'deadline', label: 'Before the program deadline', status: lateNow ? 'flag' : 'pass', detail: lateNow ? `Submitted after ${program.deadline}` : `Deadline ${program.deadline}` });

  const now = nowIso();
  return store.transaction(() => {
    const proof = store.insert('workProofs', {
      id: newId('wpf'),
      taskId: task.id,
      unitId: unit.id,
      programId: program.id,
      workforceId: program.workforceId,
      workerId: userId,
      stepKey: step.key,
      attempt: task.proofIds.length + 1,
      fields,
      photos,
      location,
      consent,
      note: clean(input.note, 600),
      checks,
      flags: checks.filter((c) => c.status === 'flag').length,
      startedAt: task.execution?.startedAt ?? null,
      checkIn: task.execution?.location ?? null,
      submittedAt: now,
      review: null
    });
    store.update('workTasks', task.id, {
      status: 'submitted',
      submittedAt: now,
      proofIds: [...task.proofIds, proof.id],
      history: pushHistory(task, { actorId: userId, action: 'submitted', note: proof.flags ? `${proof.flags} flag${proof.flags === 1 ? '' : 's'}` : 'clean' })
    });
    return proof;
  });
}

// ---------------------------------------------------------------------------
// REVIEW — the human decision. Owner or supervisor, never the submitter.
// ---------------------------------------------------------------------------

export function reviewTask(reviewerId, taskId, { decision, reason = '' } = {}) {
  const task = store.find('workTasks', (t) => t.id === taskId);
  if (!task) fail('task not found', 404, 'not_found');
  wf.requireManager(task.workforceId, reviewerId);
  if (!REVIEW_DECISIONS.includes(decision)) fail(`decision must be one of ${REVIEW_DECISIONS.join(', ')}`);
  if (task.status !== 'submitted') fail(`this task is ${task.status}, not awaiting review`, 409, 'invalid_state');
  if (task.workerId === reviewerId) fail('you cannot review your own submission', 403, 'self_review');
  const why = clean(reason, 300);
  if (decision !== 'approve' && (!why || why.length < REASON_MIN)) fail(`say why — at least ${REASON_MIN} characters; the worker reads this`);

  const program = getProgram(task.programId);
  const template = getTemplate(program.templateKey);
  const step = template.steps[task.stepIndex];
  const unit = store.find('workUnits', (u) => u.id === task.unitId);
  const proof = store.find('workProofs', (p) => p.id === task.proofIds[task.proofIds.length - 1]);
  const now = nowIso();
  const review = { decision, reason: why, by: reviewerId, at: now };

  return store.transaction(() => {
    store.update('workProofs', proof.id, { review });
    if (decision === 'return') {
      store.update('workTasks', task.id, {
        status: 'assigned',
        returns: task.returns + 1,
        dueAt: new Date(Date.now() + step.hours * 3600000).toISOString(),
        history: pushHistory(task, { actorId: reviewerId, action: 'returned', note: why })
      });
      return { task: store.find('workTasks', (t) => t.id === task.id), unit };
    }
    if (decision === 'reject') {
      store.update('workTasks', task.id, { status: 'rejected', decidedAt: now, decidedBy: reviewerId, history: pushHistory(task, { actorId: reviewerId, action: 'rejected', note: why }) });
      store.update('workUnits', unit.id, { status: 'rejected', closedReason: why, decidedAt: now });
      return { task: store.find('workTasks', (t) => t.id === task.id), unit: store.find('workUnits', (u) => u.id === unit.id) };
    }

    // APPROVE — the step happened as evidenced.
    store.update('workTasks', task.id, { status: 'approved', decidedAt: now, decidedBy: reviewerId, history: pushHistory(task, { actorId: reviewerId, action: 'approved', note: why }) });
    const labelField = step.fields.find((f) => f.subjectKey);
    const subject = { ...unit.subject, ...proof.fields };
    const patch = { subject, subjectLabel: unit.subjectLabel ?? (labelField ? proof.fields[labelField.key] ?? null : null) };
    const last = task.stepIndex === template.steps.length - 1;
    if (step.gate && proof.fields[step.gate.field] !== step.gate.equals) {
      Object.assign(patch, { status: 'not_converted', closedReason: step.gate.closedAs, decidedAt: now });
    } else if (last) {
      Object.assign(patch, { status: 'approved', decidedAt: now });
    } else {
      const next = template.steps[task.stepIndex + 1];
      patch.currentStep = task.stepIndex + 1;
      store.insert('workTasks', {
        id: newId('wtk'),
        programId: program.id,
        workforceId: program.workforceId,
        unitId: unit.id,
        stepIndex: task.stepIndex + 1,
        stepKey: next.key,
        mode: next.mode,
        status: 'open',
        workerId: null,
        assignedAt: null,
        dueAt: null,
        submittedAt: null,
        decidedAt: null,
        decidedBy: null,
        returns: 0,
        proofIds: [],
        history: [{ at: now, actorId: reviewerId, action: 'opened', note: `after ${step.label.toLowerCase()} was approved` }],
        createdAt: now
      });
    }
    store.update('workUnits', unit.id, patch);
    return { task: store.find('workTasks', (t) => t.id === task.id), unit: store.find('workUnits', (u) => u.id === unit.id) };
  });
}

/** Approve every submission with zero flags that this reviewer did not submit. */
export function approveClean(reviewerId, workforceId) {
  wf.requireManager(workforceId, reviewerId);
  const ready = store.filter('workTasks', (t) => t.workforceId === workforceId && t.status === 'submitted' && t.workerId !== reviewerId)
    .filter((t) => store.find('workProofs', (p) => p.id === t.proofIds[t.proofIds.length - 1])?.flags === 0);
  for (const t of ready) reviewTask(reviewerId, t.id, { decision: 'approve' });
  return { approved: ready.length };
}

// ---------------------------------------------------------------------------
// TRACK RECORD — capability-specific counts, derived. Never a score.
// ---------------------------------------------------------------------------

export function trackRecord(userId) {
  const tasks = store.filter('workTasks', (t) => t.workerId === userId && t.proofIds.length > 0);
  const groups = new Map();
  let lastActiveAt = null;
  for (const t of tasks) {
    const program = getProgram(t.programId);
    if (!program) continue;
    const template = getTemplate(program.templateKey);
    const g = groups.get(template.key) ?? { templateKey: template.key, templateLabel: template.label, submitted: 0, approved: 0, rejected: 0, returned: 0, inReview: 0, decided: 0, steps: {} };
    const stepLabel = template.steps[t.stepIndex]?.label ?? t.stepKey;
    const s = g.steps[t.stepKey] ?? { stepKey: t.stepKey, stepLabel, approved: 0, rejected: 0 };
    g.submitted++;
    g.returned += t.returns;
    if (t.status === 'approved') { g.approved++; s.approved++; }
    if (t.status === 'rejected') { g.rejected++; s.rejected++; }
    if (t.status === 'submitted') g.inReview++;
    g.steps[t.stepKey] = s;
    groups.set(template.key, g);
    const at = t.decidedAt ?? t.submittedAt;
    if (at && (!lastActiveAt || at > lastActiveAt)) lastActiveAt = at;
  }
  const byTemplate = [...groups.values()].map((g) => {
    g.decided = g.approved + g.rejected;
    return {
      ...g,
      steps: Object.values(g.steps),
      statement: `${g.submitted} submitted · ${g.approved} approved · ${g.rejected} rejected${g.inReview ? ` · ${g.inReview} in review` : ''}`
    };
  }).sort((a, b) => b.submitted - a.submitted);
  return {
    userId,
    byTemplate,
    lastActiveAt,
    note: 'Counts of reviewed work by task type. Not a score, not a rating — the sample size is always shown.'
  };
}

// ---------------------------------------------------------------------------
// EARNINGS — derived. A task earns its frozen step fee when it was approved
// AND its unit reached an approved outcome. Nothing is stored as a balance.
// ---------------------------------------------------------------------------

export function earnings(userId) {
  const approved = store.filter('workTasks', (t) => t.workerId === userId && t.status === 'approved');
  const settlements = store.filter('workforceSettlements', (s) => s.workerId === userId);
  const settledTask = new Map();
  for (const s of settlements) if (s.status !== 'refused') for (const id of s.taskIds) settledTask.set(id, s);

  const rows = approved.map((t) => {
    const program = getProgram(t.programId);
    const unit = store.find('workUnits', (u) => u.id === t.unitId);
    const fee = program.rateCard.steps[t.stepIndex]?.feeKes ?? 0;
    const state = unit.status === 'approved' ? 'payable' : unit.status === 'in_progress' ? 'awaiting_outcome' : 'outcome_failed';
    const s = settledTask.get(t.id) ?? null;
    return {
      taskId: t.id,
      programId: program.id,
      programTitle: program.title,
      stepLabel: getTemplate(program.templateKey).steps[t.stepIndex]?.label ?? t.stepKey,
      subjectLabel: unit.subjectLabel,
      feeKes: fee,
      state,
      unitStatus: unit.status,
      closedReason: unit.closedReason,
      approvedAt: t.decidedAt,
      week: state === 'payable' ? isoWeekOf(unit.decidedAt) : null,
      countedKes: state === 'payable' ? fee : 0,
      settlementId: s?.id ?? null,
      settlementStatus: s?.status ?? null
    };
  }).sort((a, b) => (a.approvedAt < b.approvedAt ? 1 : -1));

  const byWeek = new Map();
  for (const r of rows) {
    if (r.state !== 'payable') continue;
    const w = byWeek.get(r.week) ?? { week: r.week, tasks: 0, kes: 0, unsettledTasks: 0, unsettledKes: 0 };
    w.tasks++;
    w.kes += r.feeKes;
    if (!r.settlementId) { w.unsettledTasks++; w.unsettledKes += r.feeKes; }
    byWeek.set(r.week, w);
  }
  const weeks = [...byWeek.values()].sort((a, b) => (a.week < b.week ? 1 : -1)).map((w) => {
    const s = settlements.filter((x) => x.week === w.week && x.status !== 'refused');
    return { ...w, currency: 'KES', settlements: s.map((x) => ({ id: x.id, status: x.status, amountKes: x.amountKes })) };
  });
  const sum = (pred) => rows.filter(pred).reduce((s, r) => s + r.feeKes, 0);
  return {
    userId,
    currency: 'KES',
    rows,
    weeks,
    payableKes: sum((r) => r.state === 'payable'),
    awaitingOutcomeKes: sum((r) => r.state === 'awaiting_outcome'),
    unsettledKes: sum((r) => r.state === 'payable' && !r.settlementId),
    confirmedKes: sum((r) => r.settlementStatus === 'confirmed'),
    note: 'Each approved task earns its stated flat fee once its unit is approved. Derived from the task rows on every read — nothing is stored as a balance, and none of it is money until finance confirms a settlement.'
  };
}

// ---------------------------------------------------------------------------
// SETTLEMENT — weekly, per worker, finance-confirmed, ledger-backed. A week can
// be settled only once it has ended, so its set of approved units is final.
// ---------------------------------------------------------------------------

export function requestSettlement(financeId, workerId, week) {
  const key = String(week ?? '').trim();
  if (!/^\d{4}-W\d{2}$/.test(key)) fail('a week is required, as YYYY-Www (for example 2026-W38)');
  if (financeId === workerId) fail('finance cannot settle their own work', 403, 'self_settlement');
  if (key >= isoWeekOf(nowIso())) fail('a week can be settled once it has ended', 409, 'week_open');
  const earn = earnings(workerId);
  const rows = earn.rows.filter((r) => r.week === key && r.state === 'payable' && !r.settlementId);
  if (!rows.length) fail('no unsettled approved work in that week', 409, 'no_activity');
  const amount = rows.reduce((s, r) => s + r.feeKes, 0);
  return store.transaction(() => {
    const tx = createTransaction({
      amount,
      type: 'work_task_fee',
      description: `Workforce — ${rows.length} approved task${rows.length === 1 ? '' : 's'} (week ${key})`,
      counterparty: workerId,
      metadata: { workerId, week: key, tasks: rows.length, taskIds: rows.map((r) => r.taskId), programIds: [...new Set(rows.map((r) => r.programId))] }
    });
    transitionTransaction(tx.id, 'pending', 'awaiting finance confirmation of workforce task fees');
    const now = nowIso();
    return store.insert('workforceSettlements', {
      id: newId('wfs'),
      workerId,
      week: key,
      taskIds: rows.map((r) => r.taskId),
      tasks: rows.length,
      amountKes: amount,
      currency: 'KES',
      ledgerId: tx.id,
      status: 'pending',
      requestedBy: financeId,
      confirmedBy: null,
      confirmedAt: null,
      refusedReason: null,
      createdAt: now,
      updatedAt: now
    });
  });
}

export function decideSettlement(settlementId, financeId, { accept = true, note = '' } = {}) {
  const row = store.find('workforceSettlements', (s) => s.id === settlementId);
  if (!row) fail('settlement not found', 404, 'not_found');
  if (row.status !== 'pending') fail(`this settlement is already ${row.status}`, 409, 'invalid_state');
  if (row.workerId === financeId) fail('finance cannot confirm their own settlement', 403, 'self_settlement');
  const reason = clean(note, 300);
  return store.transaction(() => {
    if (!accept) {
      if (!reason || reason.length < REASON_MIN) fail('say why the settlement is refused');
      transitionTransaction(row.ledgerId, 'failed', reason.slice(0, 200));
      return store.update('workforceSettlements', row.id, { status: 'refused', refusedReason: reason, updatedAt: nowIso() });
    }
    transitionTransaction(row.ledgerId, 'confirmed', 'workforce task fees confirmed by finance');
    return store.update('workforceSettlements', row.id, { status: 'confirmed', confirmedBy: financeId, confirmedAt: nowIso(), updatedAt: nowIso() });
  });
}

export function listSettlements({ workerId = null, status = null } = {}) {
  return store.filter('workforceSettlements', (s) => (!workerId || s.workerId === workerId) && (!status || s.status === status))
    .slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((s) => ({ ...s, workerName: wf.personName(s.workerId) }));
}

/** Workers with ended weeks that still hold unsettled approved work (finance queue). */
export function settlementCandidates() {
  const current = isoWeekOf(nowIso());
  const workers = [...new Set(store.filter('workTasks', (t) => t.status === 'approved' && t.workerId).map((t) => t.workerId))];
  const out = [];
  for (const w of workers) {
    for (const wk of earnings(w).weeks) {
      if (wk.week < current && wk.unsettledTasks > 0) out.push({ workerId: w, workerName: wf.personName(w), week: wk.week, tasks: wk.unsettledTasks, amountKes: wk.unsettledKes });
    }
  }
  return out.sort((a, b) => (a.week < b.week ? -1 : 1));
}

// ---------------------------------------------------------------------------
// VIEWS — what the worker, the reviewer and the organisation read.
// ---------------------------------------------------------------------------

export function programHeadline(p) {
  const template = getTemplate(p.templateKey);
  return {
    id: p.id,
    workforceId: p.workforceId,
    workforceName: wf.getWorkforce(p.workforceId)?.name ?? null,
    title: p.title,
    objective: p.objective,
    templateKey: p.templateKey,
    templateLabel: template.label,
    unitNoun: template.unitNoun,
    mode: p.mode,
    audience: p.audience,
    status: p.status,
    deadline: p.deadline,
    target: p.target,
    unitPriceKes: p.unitPriceKes,
    rateCard: p.rateCard,
    territories: p.territoryIds.map((id) => ({ id, name: wf.getTerritory(id)?.name ?? 'Unknown', quota: p.territoryTargets?.[id] ?? null })),
    revision: p.revision
  };
}

/** The organisation's dashboard for one program — every number derived. */
export function programDashboard(programId, viewerId) {
  const p = getProgram(programId);
  if (!p) fail('program not found', 404, 'not_found');
  wf.requireManager(p.workforceId, viewerId);
  const template = getTemplate(p.templateKey);
  const units = unitsOf(p.id);
  const tasks = store.filter('workTasks', (t) => t.programId === p.id);
  const count = (s) => units.filter((u) => u.status === s).length;
  const approved = count('approved');
  const committedKes = p.target * p.unitPriceKes;
  const verifiedKes = approved * p.unitPriceKes;
  return {
    sourceRequestId: viewerId === p.ownerId ? p.sourceRequestId ?? null : null,
    program: programHeadline(p),
    counts: {
      target: p.target,
      inProgress: count('in_progress'),
      awaitingReview: tasks.filter((t) => t.status === 'submitted').length,
      approved,
      rejected: count('rejected'),
      notConverted: count('not_converted'),
      abandoned: count('abandoned'),
      remaining: remainingCapacity(p)
    },
    progressPct: p.target ? Math.round((approved / p.target) * 1000) / 10 : 0,
    money: {
      currency: 'KES',
      committedKes,
      verifiedKes,
      remainingKes: committedKes - verifiedKes,
      workerKes: approved * p.rateCard.workerPoolKes,
      briefFeeKes: approved * p.rateCard.briefFeeKes,
      note: 'Verified = approved units × the price per unit. Brief does not hold funds; this is what the approved outcomes are worth under the program terms.'
    },
    funnel: template.steps.map((s, i) => {
      const st = tasks.filter((t) => t.stepIndex === i);
      return {
        stepKey: s.key, label: s.label, mode: s.mode,
        open: st.filter((t) => t.status === 'open').length,
        assigned: st.filter((t) => t.status === 'assigned').length,
        submitted: st.filter((t) => t.status === 'submitted').length,
        approved: st.filter((t) => t.status === 'approved').length,
        rejected: st.filter((t) => t.status === 'rejected').length
      };
    }),
    coverage: p.territoryIds.map((id) => ({
      territoryId: id,
      name: wf.getTerritory(id)?.name ?? 'Unknown',
      quota: p.territoryTargets?.[id] ?? null,
      approved: units.filter((u) => u.territoryId === id && u.status === 'approved').length,
      inProgress: units.filter((u) => u.territoryId === id && u.status === 'in_progress').length
    })),
    results: units.filter((u) => u.status === 'approved').slice(-50).reverse().map((u) => ({
      unitId: u.id, subjectLabel: u.subjectLabel, territory: u.territoryId ? wf.getTerritory(u.territoryId)?.name : null, approvedAt: u.decidedAt
    }))
  };
}

function lastProof(task) {
  const id = task.proofIds[task.proofIds.length - 1];
  return id ? store.find('workProofs', (p) => p.id === id) : null;
}

/** A task as its assigned worker sees it: the step contract, subject and fee. */
export function taskView(task, viewerId) {
  const program = getProgram(task.programId);
  const template = getTemplate(program.templateKey);
  const unit = store.find('workUnits', (u) => u.id === task.unitId);
  const assignedToViewer = task.workerId === viewerId;
  const manager = wf.canManage(task.workforceId, viewerId);
  const proof = lastProof(task);
  return {
    id: task.id,
    status: task.status,
    stepIndex: task.stepIndex,
    stepCount: template.steps.length,
    step: templateView(template).steps[task.stepIndex],
    feeKes: program.rateCard.steps[task.stepIndex]?.feeKes ?? 0,
    program: { id: program.id, title: program.title, templateLabel: template.label, unitNoun: template.unitNoun, deadline: program.deadline, workforceName: wf.getWorkforce(program.workforceId)?.name ?? null },
    territory: unit.territoryId ? { id: unit.territoryId, name: wf.getTerritory(unit.territoryId)?.name ?? null } : null,
    unitStatus: unit.status,
    subjectLabel: unit.subjectLabel,
    // The subject's details (phone, owner) only for the person doing the
    // step and the managers — not for everyone browsing open work.
    subject: assignedToViewer || manager ? unit.subject : null,
    execution: assignedToViewer || manager ? task.execution ?? null : null,
    assignedAt: task.assignedAt,
    dueAt: task.dueAt,
    returns: task.returns,
    lastReview: proof?.review ?? null,
    lastProof: proof && (assignedToViewer || manager) ? { id: proof.id, attempt: proof.attempt, submittedAt: proof.submittedAt, checks: proof.checks, flags: proof.flags } : null
  };
}

/** The reviewer's queue: submitted work with evidence, checks and context. */
export function reviewQueue(workforceId, viewerId) {
  wf.requireManager(workforceId, viewerId);
  return store.filter('workTasks', (t) => t.workforceId === workforceId && t.status === 'submitted')
    .map((t) => {
      const program = getProgram(t.programId);
      const template = getTemplate(program.templateKey);
      const unit = store.find('workUnits', (u) => u.id === t.unitId);
      const proof = lastProof(t);
      const record = trackRecord(t.workerId).byTemplate.find((r) => r.templateKey === template.key);
      return {
        taskId: t.id,
        programId: program.id,
        programTitle: program.title,
        templateLabel: template.label,
        stepLabel: template.steps[t.stepIndex].label,
        stepIndex: t.stepIndex,
        stepCount: template.steps.length,
        mode: t.mode,
        fields: template.steps[t.stepIndex].fields.map((f) => ({ key: f.key, label: f.label })),
        worker: { userId: t.workerId, name: wf.personName(t.workerId), record: record?.statement ?? 'First submission of this type' },
        ownSubmission: t.workerId === viewerId,
        territory: unit.territoryId ? wf.getTerritory(unit.territoryId)?.name ?? null : null,
        subjectBefore: unit.subject,
        proof,
        previous: t.proofIds.slice(0, -1).map((id) => store.find('workProofs', (p) => p.id === id)?.review).filter(Boolean)
      };
    })
    .sort((a, b) => (a.proof.flags - b.proof.flags) || (a.proof.submittedAt < b.proof.submittedAt ? -1 : 1));
}

/** Programs a worker can see: their workforces' programs + network programs. */
function visiblePrograms(userId) {
  const memberWorkforces = new Set(store.filter('workforceMembers', (m) => m.userId === userId && m.status !== 'offboarded').map((m) => m.workforceId));
  return store.filter('workPrograms', (p) => p.status === 'open' && p.ownerId !== userId &&
    (p.audience === 'network' || memberWorkforces.has(p.workforceId)));
}

/** Read-only discovery projection. Same visibility and eligibility as My work;
 * no expiration sweep, task assignment, claim, payment or new authority. */
export function discoveryPrograms(userId) {
  if (!userId) return [];
  return visiblePrograms(userId)
    .filter(p => Date.parse(`${p.deadline}T23:59:59.999+03:00`) >= Date.now())
    .map(p => {
      const template = getTemplate(p.templateKey);
      return { program: programHeadline(p), createdAt: p.createdAt,
        remaining: remainingCapacity(p), eligibility: eligibility(userId, p, 0),
        firstStep: { label: template.steps[0].label, mode: template.steps[0].mode, feeKes: p.rateCard.steps[0].feeKes } };
    }).filter(p => p.remaining > 0);
}

/** The worker's home: available work, next steps, held tasks, today, money. */
export function workerHome(userId) {
  sweepExpired();
  const profile = wf.getProfile(userId);
  const available = visiblePrograms(userId).map((p) => {
    const elig = eligibility(userId, p, 0);
    const template = getTemplate(p.templateKey);
    return {
      program: programHeadline(p),
      firstStep: { label: template.steps[0].label, mode: template.steps[0].mode, feeKes: p.rateCard.steps[0].feeKes, hours: template.steps[0].hours },
      remaining: remainingCapacity(p),
      eligible: elig.eligible,
      reasons: elig.reasons,
      blockers: elig.blockers,
      territories: elig.territoryIds.map((id) => ({ id, name: wf.getTerritory(id)?.name ?? 'Unknown', remaining: remainingCapacity(p, id) }))
    };
  }).filter((a) => a.remaining > 0)
    .sort((a, b) => (Number(b.eligible) - Number(a.eligible)) || (a.program.deadline < b.program.deadline ? -1 : 1));

  const openSteps = store.filter('workTasks', (t) => t.status === 'open')
    .map((t) => ({ t, program: getProgram(t.programId) }))
    .filter(({ program }) => program && program.status !== 'paused' && program.ownerId !== userId)
    .map(({ t, program }) => {
      const unit = store.find('workUnits', (u) => u.id === t.unitId);
      const elig = eligibility(userId, program, t.stepIndex, unit.territoryId);
      return elig.eligible ? { ...taskView(t, userId), reasons: elig.reasons } : null;
    }).filter(Boolean);

  const mine = store.filter('workTasks', (t) => t.workerId === userId);
  const today = nowIso().slice(0, 10);
  const earn = earnings(userId);
  return {
    profile,
    terms: wf.termsView(),
    memberships: wf.myWorkforces(userId).filter((m) => m.role !== 'owner').map((m) => {
      const row = store.find('workforceMembers', (x) => x.id === m.memberId);
      return { ...m, onboarding: row ? wf.onboardingChecklist(row) : null, territories: (row?.territoryIds ?? []).map((id) => wf.getTerritory(id)?.name ?? 'Unknown') };
    }),
    available,
    openSteps,
    held: mine.filter((t) => t.status === 'assigned').map((t) => taskView(t, userId)),
    inReview: mine.filter((t) => t.status === 'submitted').map((t) => taskView(t, userId)),
    recent: mine.filter((t) => ['approved', 'rejected'].includes(t.status))
      .sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1)).slice(0, 15).map((t) => taskView(t, userId)),
    today: {
      submitted: mine.filter((t) => t.submittedAt?.slice(0, 10) === today).length,
      approved: mine.filter((t) => t.status === 'approved' && t.decidedAt?.slice(0, 10) === today).length,
      inReview: mine.filter((t) => t.status === 'submitted').length,
      earnedKes: earn.rows.filter((r) => r.state === 'payable' && r.approvedAt?.slice(0, 10) === today).reduce((s, r) => s + r.feeKes, 0)
    },
    earnings: earn,
    record: trackRecord(userId),
    limits: { maxHeld: MAX_HELD_TASKS, maxBatch: MAX_CLAIM_BATCH }
  };
}

/** The organisation's desk for one workforce: HR, territories, programs, queue. */
export function workforceDesk(workforceId, viewerId) {
  const workforce = wf.requireManager(workforceId, viewerId);
  const role = wf.roleIn(workforceId, viewerId);
  const members = wf.roster(workforceId).map((m) => ({ ...m, record: trackRecord(m.userId) }));
  const units = store.filter('workUnits', (u) => u.workforceId === workforceId);
  const programs = store.filter('workPrograms', (p) => p.workforceId === workforceId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((p) => {
      const d = programDashboard(p.id, viewerId);
      return { ...d.program, counts: d.counts, progressPct: d.progressPct, money: d.money };
    });
  return {
    workforce: { id: workforce.id, name: workforce.name, description: workforce.description, joinCode: role === 'owner' || role === 'supervisor' ? workforce.joinCode : null, partnerId: workforce.partnerId },
    role,
    territories: wf.territoriesOf(workforceId).map((t) => ({
      ...t,
      members: members.filter((m) => m.status === 'active' && m.territoryIds.includes(t.id)).length,
      approved: units.filter((u) => u.territoryId === t.id && u.status === 'approved').length,
      inProgress: units.filter((u) => u.territoryId === t.id && u.status === 'in_progress').length
    })),
    members,
    counts: {
      applied: members.filter((m) => m.status === 'applied').length,
      readyToActivate: members.filter((m) => m.onboarding.readyForActivation).length,
      active: members.filter((m) => m.status === 'active').length,
      suspended: members.filter((m) => m.status === 'suspended').length,
      awaitingReview: store.filter('workTasks', (t) => t.workforceId === workforceId && t.status === 'submitted').length
    },
    programs,
    templates: TEMPLATE_KEYS.map((k) => templateView(getTemplate(k)))
  };
}

/** Private work photos: readable by the submitter and the workforce managers. */
export function canReadWorkforceEvidence(userId, uploadId) {
  if (!userId) return false;
  const proof = store.find('workProofs', (p) => p.photos.includes(uploadId));
  if (!proof) return false;
  return proof.workerId === userId || wf.canManage(proof.workforceId, userId);
}

export function isWorkforceEvidence(uploadId) {
  return Boolean(store.find('workProofs', (p) => p.photos.includes(uploadId)));
}
