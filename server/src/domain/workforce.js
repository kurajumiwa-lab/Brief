// ---------------------------------------------------------------------------
// WORKFORCE — a distributed team run from phones, without a central office.
//
// An organisation (a distributor, a SACCO, an NGO, a bank's agent program)
// creates a WORKFORCE. People join it with a code, complete an onboarding
// checklist on their own phone, are placed in TERRITORIES by a supervisor, and
// are activated by a human. After that they take work from the organisation's
// Work Programs (domain/workExecution.js).
//
//   workforce (org)          stored: name, owner, join code, optional partner
//     ├─ territories         stored: named zones, optional map centre + radius
//     └─ members             stored: role, status, territories, history
//          └─ worker profile stored ONCE per person, shared across workforces
//
// HONESTY (the standing laws, restated for this domain):
//   * Workers are INDEPENDENT. The terms they accept say so in plain words
//     (workTemplates.WORK_TERMS). Nothing here models employment, salary,
//     hours or attendance.
//   * The onboarding checklist is DERIVED from rows every time it is read.
//     There is no stored "onboarding step" counter to disagree with reality.
//   * "Briefed" means the worker read a template's briefing and said so. It
//     is not a certification and is never shown as one.
//   * Activation is a HUMAN act by the owner or a supervisor, refused until
//     the checklist is complete. A reason is required to suspend or offboard.
//   * Authority is scoped to ONE workforce and checked in the query. A
//     supervisor in workforce A has no authority in workforce B.
//   * No score, no rating. Performance is capability-specific counts
//     (workExecution.trackRecord), always with the sample size visible.
// ---------------------------------------------------------------------------

import { store, newId } from '../store.js';
import { getUser } from './auth.js';
import { TEMPLATES, TEMPLATE_KEYS, WORK_MODES, WORK_TERMS_VERSION, WORK_TERMS } from './workTemplates.js';

export const MEMBER_ROLES = ['worker', 'supervisor'];
export const MEMBER_STATUS = ['applied', 'active', 'suspended', 'offboarded'];
export const REASON_MIN = 4;

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const nowIso = () => new Date().toISOString();

export function fail(message, status = 400, code = 'validation_error', extra = {}) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  Object.assign(e, extra);
  throw e;
}

const clean = (v, max = 120) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const cleanList = (list, max = 12, len = 60) =>
  [...new Set((Array.isArray(list) ? list : []).map((x) => clean(x, len)).filter(Boolean))].slice(0, max);

function newJoinCode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    let s = '';
    for (let i = 0; i < 8; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!store.find('workforces', (w) => w.joinCode === s)) return s;
  }
  fail('could not allocate a join code', 500, 'internal');
}

function personName(userId) {
  const u = getUser(userId);
  const profile = store.find('workerProfiles', (p) => p.userId === userId);
  return profile?.displayName || u?.displayName || u?.handle || 'Brief member';
}

// ---------------------------------------------------------------------------
// AUTHORITY — owner, supervisor, worker. Resolved per workforce, per call.
// ---------------------------------------------------------------------------

export function getWorkforce(id) {
  return store.find('workforces', (w) => w.id === id) ?? null;
}

/** The caller's current membership row in a workforce (not offboarded), or null. */
export function membershipOf(workforceId, userId) {
  if (!userId) return null;
  return store.find('workforceMembers', (m) =>
    m.workforceId === workforceId && m.userId === userId && m.status !== 'offboarded') ?? null;
}

/** 'owner' | 'supervisor' | 'worker' | null — the caller's role in this workforce. */
export function roleIn(workforceId, userId) {
  const wf = getWorkforce(workforceId);
  if (!wf || !userId) return null;
  if (wf.ownerId === userId) return 'owner';
  const m = membershipOf(workforceId, userId);
  if (!m || m.status !== 'active') return null;
  return m.role;
}

/** Owner or ACTIVE supervisor: may review work, manage members and territories. */
export function canManage(workforceId, userId) {
  const r = roleIn(workforceId, userId);
  return r === 'owner' || r === 'supervisor';
}

export function requireManager(workforceId, userId) {
  const wf = getWorkforce(workforceId);
  // Foreign ids are not found, not forbidden: existence is not disclosed.
  if (!wf) fail('workforce not found', 404, 'not_found');
  if (!canManage(workforceId, userId)) {
    if (membershipOf(workforceId, userId)) fail('only the owner or a supervisor can do that', 403, 'forbidden');
    fail('workforce not found', 404, 'not_found');
  }
  return wf;
}

export function requireOwner(workforceId, userId) {
  const wf = requireManager(workforceId, userId);
  if (wf.ownerId !== userId) fail('only the workforce owner can do that', 403, 'forbidden');
  return wf;
}

// ---------------------------------------------------------------------------
// WORKFORCES
// ---------------------------------------------------------------------------

export function createWorkforce(ownerId, { name, description = '', partnerId = null } = {}) {
  if (!ownerId || !getUser(ownerId)) fail('an owner is required', 401, 'unauthenticated');
  const n = clean(name, 80);
  if (!n || n.length < 3) fail('give the workforce a name of at least 3 characters');
  if (partnerId && !store.find('partners', (p) => p.id === partnerId)) fail('partner not found', 404, 'not_found');
  const now = nowIso();
  return store.insert('workforces', {
    id: newId('wkf'),
    ownerId,
    name: n,
    description: clean(description, 400) ?? '',
    // Optional link to a contracted distribution partner, so a partner's
    // cohort can also be its workforce. Attribution stays in attribution.js.
    partnerId: partnerId ?? null,
    joinCode: newJoinCode(),
    createdAt: now,
    updatedAt: now
  });
}

/** Every workforce the caller owns, supervises, or belongs to. */
export function myWorkforces(userId) {
  const owned = store.filter('workforces', (w) => w.ownerId === userId);
  const memberOf = store.filter('workforceMembers', (m) => m.userId === userId && m.status !== 'offboarded');
  const rows = [
    ...owned.map((w) => ({ workforce: w, role: 'owner', status: 'active', memberId: null })),
    ...memberOf
      .map((m) => ({ workforce: getWorkforce(m.workforceId), role: m.role, status: m.status, memberId: m.id }))
      .filter((r) => r.workforce && r.workforce.ownerId !== userId)
  ];
  return rows.map(({ workforce, role, status, memberId }) => ({
    id: workforce.id,
    name: workforce.name,
    description: workforce.description,
    role,
    status,
    memberId,
    // Only managers see the join code: a worker cannot hand out entry.
    joinCode: role === 'owner' || (role === 'supervisor' && status === 'active') ? workforce.joinCode : null
  }));
}

export function rotateJoinCode(workforceId, actorId) {
  requireOwner(workforceId, actorId);
  return store.update('workforces', workforceId, { joinCode: newJoinCode(), updatedAt: nowIso() });
}

// ---------------------------------------------------------------------------
// TERRITORIES — where work happens. A name and the places inside it; a map
// centre and radius are optional and, when present, are what the field-proof
// location check measures against. A territory without a map area records
// the worker's location but says plainly that it was not checked.
// ---------------------------------------------------------------------------

function cleanGeo({ lat = null, lng = null, radiusKm = null } = {}) {
  if (lat === null && lng === null && radiusKm === null) return { center: null, radiusKm: null };
  const la = Number(lat), lo = Number(lng), r = Number(radiusKm);
  if (!Number.isFinite(la) || la < -90 || la > 90) fail('latitude must be between -90 and 90');
  if (!Number.isFinite(lo) || lo < -180 || lo > 180) fail('longitude must be between -180 and 180');
  if (!Number.isFinite(r) || r <= 0 || r > 200) fail('radius must be between 0 and 200 km');
  return { center: { lat: la, lng: lo }, radiusKm: r };
}

export function createTerritory(workforceId, actorId, { name, areas = [], lat = null, lng = null, radiusKm = null } = {}) {
  requireManager(workforceId, actorId);
  const n = clean(name, 60);
  if (!n) fail('a territory needs a name');
  if (store.find('workforceTerritories', (t) => t.workforceId === workforceId && t.status === 'active' && t.name.toLowerCase() === n.toLowerCase())) {
    fail('this workforce already has a territory with that name', 409, 'duplicate');
  }
  const geo = cleanGeo({ lat, lng, radiusKm });
  const now = nowIso();
  return store.insert('workforceTerritories', {
    id: newId('ter'),
    workforceId,
    name: n,
    areas: cleanList(areas, 20),
    center: geo.center,
    radiusKm: geo.radiusKm,
    status: 'active',
    createdBy: actorId,
    createdAt: now,
    updatedAt: now
  });
}

export function updateTerritory(territoryId, actorId, patch = {}) {
  const t = store.find('workforceTerritories', (x) => x.id === territoryId);
  if (!t) fail('territory not found', 404, 'not_found');
  requireManager(t.workforceId, actorId);
  const next = { updatedAt: nowIso() };
  if (patch.name !== undefined) {
    const n = clean(patch.name, 60);
    if (!n) fail('a territory needs a name');
    next.name = n;
  }
  if (patch.areas !== undefined) next.areas = cleanList(patch.areas, 20);
  if (patch.lat !== undefined || patch.lng !== undefined || patch.radiusKm !== undefined) {
    const geo = cleanGeo({ lat: patch.lat ?? null, lng: patch.lng ?? null, radiusKm: patch.radiusKm ?? null });
    next.center = geo.center;
    next.radiusKm = geo.radiusKm;
  }
  if (patch.status !== undefined) {
    if (!['active', 'archived'].includes(patch.status)) fail('status must be active or archived');
    next.status = patch.status;
  }
  return store.update('workforceTerritories', t.id, next);
}

export function territoriesOf(workforceId, { includeArchived = false } = {}) {
  return store.filter('workforceTerritories', (t) =>
    t.workforceId === workforceId && (includeArchived || t.status === 'active'));
}

export function getTerritory(id) {
  return store.find('workforceTerritories', (t) => t.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// WORKER PROFILE — one per person, shared across every workforce they join.
// ---------------------------------------------------------------------------

export function getProfile(userId) {
  return store.find('workerProfiles', (p) => p.userId === userId) ?? null;
}

const KE_PHONE = /^(?:\+?254|0)(?:7|1)\d{8}$/;
export function normalizePhone(raw) {
  const s = String(raw ?? '').replace(/[\s()-]/g, '');
  if (!KE_PHONE.test(s)) return null;
  return '+254' + s.replace(/^(?:\+?254|0)/, '');
}

export function saveProfile(userId, input = {}) {
  if (!userId || !getUser(userId)) fail('sign in to set up your worker profile', 401, 'unauthenticated');
  const existing = getProfile(userId);
  const displayName = clean(input.displayName ?? existing?.displayName, 60);
  if (!displayName) fail('your name is required — it is what a supervisor sees');
  const phone = normalizePhone(input.phone ?? existing?.phone);
  if (!phone) fail('a Kenyan mobile number is required (07…, 01… or +254…)');
  const modes = cleanList(input.modes ?? existing?.modes ?? [], 2).filter((m) => WORK_MODES.includes(m));
  if (!modes.length) fail('choose at least one way of working: home, field or both');
  const device = {
    smartphone: Boolean(input.device?.smartphone ?? existing?.device?.smartphone ?? false),
    gps: Boolean(input.device?.gps ?? existing?.device?.gps ?? false)
  };
  const availableDays = [...new Set((Array.isArray(input.availableDays) ? input.availableDays : existing?.availableDays ?? [])
    .map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  const now = nowIso();
  const row = {
    displayName,
    phone,
    modes,
    device,
    areas: cleanList(input.areas ?? existing?.areas ?? [], 12),
    languages: cleanList(input.languages ?? existing?.languages ?? [], 6, 30),
    availableDays,
    updatedAt: now
  };
  if (existing) return store.update('workerProfiles', existing.id, row);
  return store.insert('workerProfiles', {
    id: newId('wpr'),
    userId,
    ...row,
    termsAcceptedVersion: null,
    termsAcceptedAt: null,
    briefings: [],
    createdAt: now
  });
}

export function acceptTerms(userId, { version } = {}) {
  const p = getProfile(userId);
  if (!p) fail('set up your worker profile first', 409, 'profile_required');
  if (version !== WORK_TERMS_VERSION) {
    fail('these terms have changed — read the current version and accept it', 409, 'stale_terms', { currentVersion: WORK_TERMS_VERSION });
  }
  return store.update('workerProfiles', p.id, { termsAcceptedVersion: WORK_TERMS_VERSION, termsAcceptedAt: nowIso(), updatedAt: nowIso() });
}

/** The worker says they read a template's briefing. Recorded, not certified. */
export function acknowledgeBriefing(userId, templateKey) {
  const p = getProfile(userId);
  if (!p) fail('set up your worker profile first', 409, 'profile_required');
  if (!TEMPLATE_KEYS.includes(templateKey)) fail('unknown work template');
  if (p.briefings.some((b) => b.templateKey === templateKey)) return p;
  return store.update('workerProfiles', p.id, {
    briefings: [...p.briefings, { templateKey, at: nowIso() }],
    updatedAt: nowIso()
  });
}

export function isBriefed(profile, templateKey) {
  return Boolean(profile?.briefings?.some((b) => b.templateKey === templateKey));
}

export function termsCurrent(profile) {
  return profile?.termsAcceptedVersion === WORK_TERMS_VERSION;
}

export function termsView() {
  return { version: WORK_TERMS_VERSION, lines: WORK_TERMS };
}

// ---------------------------------------------------------------------------
// MEMBERS — joining, the derived onboarding checklist, and the lifecycle.
// ---------------------------------------------------------------------------

function pushHistory(member, entry) {
  return [...(member.history ?? []), { at: nowIso(), ...entry }].slice(-100);
}

export function joinByCode(userId, code) {
  if (!userId || !getUser(userId)) fail('sign in to join a workforce', 401, 'unauthenticated');
  const c = String(code ?? '').trim().toUpperCase();
  const wf = store.find('workforces', (w) => w.joinCode === c);
  if (!wf) fail('that code does not match a workforce', 404, 'not_found');
  if (wf.ownerId === userId) fail('you own this workforce', 409, 'self_join');
  const existing = membershipOf(wf.id, userId);
  if (existing) return existing;
  const now = nowIso();
  return store.insert('workforceMembers', {
    id: newId('wkm'),
    workforceId: wf.id,
    userId,
    role: 'worker',
    status: 'applied',
    territoryIds: [],
    supervisorId: null,
    appliedAt: now,
    activatedAt: null,
    history: [{ at: now, actorId: userId, action: 'joined', note: 'joined with the workforce code' }],
    createdAt: now,
    updatedAt: now
  });
}

/**
 * THE ONBOARDING CHECKLIST — derived on every read, never stored. Each item
 * says what is done and, when not, what exactly is missing.
 */
export function onboardingChecklist(member) {
  const profile = getProfile(member.userId);
  const fieldWorker = Boolean(profile?.modes?.includes('field'));
  const items = [
    {
      key: 'profile',
      label: 'Worker profile',
      done: Boolean(profile),
      detail: profile ? `${profile.displayName} · ${profile.modes.join(' + ')}` : 'Add your name, phone and how you work'
    },
    {
      key: 'terms',
      label: 'Independent-work terms',
      done: termsCurrent(profile),
      detail: termsCurrent(profile) ? `Accepted ${profile.termsAcceptedAt.slice(0, 10)}` : 'Read and accept the current terms'
    },
    {
      key: 'briefing',
      label: 'At least one task briefing read',
      done: Boolean(profile?.briefings?.length),
      detail: profile?.briefings?.length
        ? profile.briefings.map((b) => TEMPLATES[b.templateKey]?.label ?? b.templateKey).join(', ')
        : 'Open a task type and read how it is done'
    },
    {
      key: 'territory',
      label: fieldWorker ? 'Placed in a territory' : 'Territory (not needed for home-only work)',
      done: !fieldWorker || member.territoryIds.length > 0,
      detail: member.territoryIds.length
        ? member.territoryIds.map((id) => getTerritory(id)?.name ?? 'Unknown').join(', ')
        : fieldWorker ? 'A supervisor places you in a territory' : 'Home-only workers work remotely'
    }
  ];
  const ready = items.every((i) => i.done);
  items.push({
    key: 'activation',
    label: 'Activated by a supervisor',
    done: member.status === 'active',
    detail: member.status === 'active'
      ? `Active since ${String(member.activatedAt ?? '').slice(0, 10)}`
      : ready ? 'Ready — waiting for a supervisor to activate you' : 'Finish the steps above first'
  });
  return {
    items,
    readyForActivation: ready && member.status === 'applied',
    complete: items.every((i) => i.done),
    doneCount: items.filter((i) => i.done).length,
    total: items.length
  };
}

export const MEMBER_ACTIONS = ['assign_territories', 'set_role', 'set_supervisor', 'activate', 'suspend', 'reinstate', 'offboard'];

/**
 * One entry point for every HR action on a member. The caller must manage the
 * workforce; role changes are owner-only; nobody acts on themselves.
 * `onRelease` lets the execution layer return held tasks on suspend/offboard
 * without this module importing it (no cycle).
 */
// Territory ids for a placement: unique, and every one live in this workforce.
function placement(workforceId, territoryIds) {
  const ids = [...new Set(Array.isArray(territoryIds) ? territoryIds : [])];
  for (const id of ids) {
    const t = getTerritory(id);
    if (!t || t.workforceId !== workforceId || t.status !== 'active') fail('territory not found in this workforce', 404, 'not_found');
  }
  return ids;
}

export function memberAction(workforceId, actorId, memberId, { action, territoryIds, role, supervisorId, reason } = {}, { onRelease = null } = {}) {
  const wf = requireManager(workforceId, actorId);
  const m = store.find('workforceMembers', (x) => x.id === memberId && x.workforceId === workforceId);
  if (!m) fail('member not found', 404, 'not_found');
  if (!MEMBER_ACTIONS.includes(action)) fail(`action must be one of ${MEMBER_ACTIONS.join(', ')}`);
  if (m.userId === actorId) fail('you cannot take HR actions on your own membership', 403, 'self_action');
  if (m.status === 'offboarded') fail('this person was offboarded; they can rejoin with the code', 409, 'invalid_state');
  const actorRole = roleIn(workforceId, actorId);
  // A supervisor cannot act on another supervisor: only the owner can.
  if (m.role === 'supervisor' && actorRole !== 'owner') fail('only the owner can manage a supervisor', 403, 'forbidden');
  const why = clean(reason, 300);
  const now = nowIso();

  switch (action) {
    case 'assign_territories': {
      const ids = placement(workforceId, territoryIds);
      return store.update('workforceMembers', m.id, {
        territoryIds: ids,
        history: pushHistory(m, { actorId, action, note: ids.map((id) => getTerritory(id).name).join(', ') || 'no territory' }),
        updatedAt: now
      });
    }
    case 'set_role': {
      if (wf.ownerId !== actorId) fail('only the owner can change roles', 403, 'forbidden');
      if (!MEMBER_ROLES.includes(role)) fail(`role must be one of ${MEMBER_ROLES.join(', ')}`);
      return store.update('workforceMembers', m.id, {
        role,
        history: pushHistory(m, { actorId, action, note: role }),
        updatedAt: now
      });
    }
    case 'set_supervisor': {
      if (supervisorId) {
        const s = store.find('workforceMembers', (x) => x.workforceId === workforceId && x.userId === supervisorId && x.role === 'supervisor' && x.status === 'active');
        if (!s && supervisorId !== wf.ownerId) fail('that person is not an active supervisor here', 404, 'not_found');
        if (supervisorId === m.userId) fail('a person cannot supervise themselves');
      }
      return store.update('workforceMembers', m.id, {
        supervisorId: supervisorId ?? null,
        history: pushHistory(m, { actorId, action, note: supervisorId ? personName(supervisorId) : 'none' }),
        updatedAt: now
      });
    }
    case 'activate': {
      if (m.status !== 'applied') fail(`this member is ${m.status}, not waiting for activation`, 409, 'invalid_state');
      // A manager may place and activate in one step. The checklist is judged
      // on the proposed placement and both are written together, so a refused
      // activation leaves nothing half-applied.
      const placing = Array.isArray(territoryIds);
      const ids = placing ? placement(workforceId, territoryIds) : m.territoryIds;
      const checklist = onboardingChecklist({ ...m, territoryIds: ids });
      if (!checklist.readyForActivation) {
        const missing = checklist.items.filter((i) => !i.done && i.key !== 'activation').map((i) => i.label);
        fail(`onboarding is not complete: ${missing.join(', ')}`, 409, 'onboarding_incomplete', { missing });
      }
      let history = m.history;
      if (placing && ids.join() !== (m.territoryIds ?? []).join()) {
        history = pushHistory(m, { actorId, action: 'assign_territories', note: ids.map((id) => getTerritory(id).name).join(', ') || 'no territory' });
      }
      return store.update('workforceMembers', m.id, {
        status: 'active',
        activatedAt: now,
        territoryIds: ids,
        history: pushHistory({ ...m, history }, { actorId, action, note: why ?? 'onboarding complete' }),
        updatedAt: now
      });
    }
    case 'suspend':
    case 'offboard': {
      if (!why || why.length < REASON_MIN) fail(`say why — at least ${REASON_MIN} characters; the person reads this`);
      if (action === 'suspend' && m.status !== 'active') fail('only an active member can be suspended', 409, 'invalid_state');
      const updated = store.update('workforceMembers', m.id, {
        status: action === 'suspend' ? 'suspended' : 'offboarded',
        history: pushHistory(m, { actorId, action, note: why }),
        updatedAt: now
      });
      if (onRelease) onRelease(m, action);
      return updated;
    }
    case 'reinstate': {
      if (m.status !== 'suspended') fail('only a suspended member can be reinstated', 409, 'invalid_state');
      return store.update('workforceMembers', m.id, {
        status: 'active',
        history: pushHistory(m, { actorId, action, note: why ?? 'reinstated' }),
        updatedAt: now
      });
    }
    default:
      return fail('unknown action');
  }
}

/** Roster rows for managers: identity, status, territories and checklist. */
export function roster(workforceId) {
  return store.filter('workforceMembers', (m) => m.workforceId === workforceId && m.status !== 'offboarded')
    .map((m) => {
      const profile = getProfile(m.userId);
      const u = getUser(m.userId);
      return {
        memberId: m.id,
        userId: m.userId,
        name: personName(m.userId),
        handle: u?.handle ?? null,
        phone: profile?.phone ?? null,
        modes: profile?.modes ?? [],
        device: profile?.device ?? null,
        role: m.role,
        status: m.status,
        territoryIds: m.territoryIds,
        territories: m.territoryIds.map((id) => getTerritory(id)?.name ?? 'Unknown'),
        supervisorId: m.supervisorId,
        supervisorName: m.supervisorId ? personName(m.supervisorId) : null,
        appliedAt: m.appliedAt,
        activatedAt: m.activatedAt,
        onboarding: onboardingChecklist(m),
        history: m.history.slice(-10)
      };
    })
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'applied' ? -1 : 1));
}

export { personName };
