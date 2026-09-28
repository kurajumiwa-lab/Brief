// ---------------------------------------------------------------------------
// MEMBERS (the admin's user directory) — onboarding users at a glance.
//
// Preparing to onboard real people, an operator needs three honest answers:
//   WHO is here        the directory: handle, display name, standing, roles,
//                      verification state — derived from real rows, searchable.
//   WHERE THEY STOPPED the onboarding view: each member's highest climbed
//                      rung and their latest activation event, plus a funnel
//                      of named events. Nobody is invented; a member with no
//                      events says "no events yet".
//   WHAT I CAN DO      grant/revoke platform roles (existing audited route)
//                      and suspend/reinstate an account — a suspension revokes
//                      every session immediately and refuses new logins; the
//                      action is audited with before/after like every
//                      consequential operator act.
//
// Nothing here stores a derived value. The directory is computed per request.
// ---------------------------------------------------------------------------

import { store } from '../store.js';
import { recordAudit } from '../routes/helpers.js';
import { RUNGS } from './onboarding.js';
import { hasCapability, platformRolesOf } from '../identity.js';
import * as workforce from './workforce.js';
import { trackRecord } from './workExecution.js';

const PAGE = 30;

/** The rung a member has genuinely climbed to: the highest rung whose
 *  activation event exists, else null. Derived, never stored. */
/** Which recorded events COUNT as having climbed each rung. 'reach' has no
 *  named activation event yet, so nobody is shown as having reached it — an
 *  honest blank beats an invented claim. */
const RUNG_MARKS = {
  identity: ['signed_in'],
  orient: ['goal_chosen', 'place_chosen'],
  value: ['object_saved', 'object_confirmed'],
  contribute: ['capture_saved'],
  reach: []
};

function rungOf(userId) {
  const events = new Set(
    store.filter('activationEvents', (e) => e.userId === userId).map((e) => e.name)
  );
  // The ladder's own order is the claim; walking it backwards finds the truth.
  for (let i = RUNGS.length - 1; i >= 0; i--) {
    const marks = RUNG_MARKS[RUNGS[i].id] ?? [];
    if (marks.some((m) => events.has(m))) return RUNGS[i].id;
  }
  return null;
}

function latestEventOf(userId) {
  // Row order is the tie-break: events recorded in the same millisecond
  // still have a true order, and "latest" must mean the LAST one written.
  const rows = store.filter('activationEvents', (e) => e.userId === userId);
  let best = null;
  let bestKey = '';
  for (const e of rows) {
    const key = `${String(e.at ?? e.createdAt ?? '')}`;
    if (key >= bestKey) {
      bestKey = key;
      best = e;
    }
  }
  return best;
}

/** The member's strongest verification: an approved one outranks a pending
 *  one. Honest 'none' when they never submitted. */
function verificationOf(userId) {
  const rows = store.filter('verificationRecords', (v) => v.userId === userId);
  if (rows.some((r) => r.status === 'approved')) return 'approved';
  if (rows.some((r) => r.status === 'pending')) return 'pending';
  return 'none';
}

function memberView(u) {
  const latest = latestEventOf(u.id);
  return {
    id: u.id,
    handle: u.handle,
    displayName: u.displayName ?? u.handle,
    createdAt: u.createdAt ?? null,
    status: u.status ?? 'active',
    platformRoles: Array.isArray(u.platformRoles) ? u.platformRoles : [],
    effectiveRoles: platformRolesOf(u.id),
    verification: verificationOf(u.id),
    onboarding: {
      rung: rungOf(u.id),
      latestEvent: latest ? (latest.name ?? null) : null,
      latestAt: latest ? (latest.at ?? latest.createdAt ?? null) : null,
      finished: Boolean(store.find('onboardingProfiles', (p) => p.userId === u.id && p.finishedAt))
    },
    shop: store.find('shops', (s) => s.ownerId === u.id && s.id)
      ? { name: store.find('shops', (s) => s.ownerId === u.id).name }
      : null
  };
}

/** Search + page the directory. Query matches handle or display name. */
export function listMembers({ query = '', page = 0 } = {}) {
  const q = String(query ?? '').trim().toLowerCase().replace(/^@/, '');
  page = Number(page);
  if (!Number.isSafeInteger(page) || page < 0) page = 0;
  let users = store.all('users').slice().sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')) || String(a.id).localeCompare(String(b.id)));
  if (q) users = users.filter((u) => (u.handle ?? '').toLowerCase().includes(q) || String(u.displayName ?? '').toLowerCase().includes(q));
  const total = users.length;
  const rows = users.slice(page * PAGE, page * PAGE + PAGE).map(memberView);
  return { rows, total, page, pageSize: PAGE };
}

/** The onboarding funnel: counts of named activation events, newest members
 *  with where they stopped, and the share who finished onboarding at all. */
export function onboardingView() {
  const events = store.all('activationEvents');
  const byName = {};
  for (const e of events) byName[e.name] = (byName[e.name] ?? 0) + 1;

  const users = store.all('users').slice().sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))).slice(0, 12);
  const finished = store.filter('onboardingProfiles', (p) => p.finishedAt).length;

  return {
    funnel: byName,
    members: users.map(memberView),
    totals: {
      members: store.all('users').length,
      withAnyEvent: new Set(events.map((e) => e.userId)).size,
      finishedOnboarding: finished
    },
    rungs: RUNGS.map((r) => ({ id: r.id, label: r.label })),
    note: 'Every count is a scan of real rows. A member with no events has genuinely not started.'
  };
}

/** Suspend or reinstate. Suspension revokes every live session NOW — the
 *  decision takes effect on the next request, not the next login. */
export function setMemberStatus(operatorId, userId, { status, reason = '' } = {}) {
  if (operatorId === userId && status === 'suspended') { const e = new Error('you cannot suspend your own account'); e.status = 409; throw e; }
  if (!['active', 'suspended'].includes(status)) throw new Error('status must be active or suspended');
  const user = store.find('users', (u) => u.id === userId || u.handle === userId);
  if (!user) { const e = new Error('user not found'); e.status = 404; throw e; }
  if (operatorId === user.id && status === 'suspended') { const e = new Error('you cannot suspend your own account'); e.status = 409; throw e; }
  if (user.status === status) return { user: memberView(user), changed: false, sessionsRevoked: 0 };
  const why = String(reason ?? '').trim();
  if (status === 'suspended' && why.length < 4) throw new Error('say why the account is suspended — the reason is audited');

  let revoked = 0;
  if (status === 'suspended') {
    for (const s of store.filter('sessions', (s) => s.userId === user.id && !s.revokedAt)) {
      store.update('sessions', s.id, { revokedAt: new Date().toISOString() });
      revoked++;
    }
  }
  const before = { status: user.status ?? 'active' };
  store.update('users', user.id, { status });
  recordAudit('ops.member.status', {
    actorId: operatorId,
    objectType: 'user',
    objectId: user.id,
    before,
    after: { status },
    reason: why || null
  });
  return { user: memberView(store.find('users', (u) => u.id === user.id)), changed: true, sessionsRevoked: revoked };
}

/** Admin-only, explicit projection. Never return a raw user, vendor or proof:
 * those rows may contain password hashes, sessions, private commercial evidence
 * or customer data. Reading this profile is itself audited by the route. */
export function memberProfile(actorId, userId) {
  if (!hasCapability(actorId, 'admin')) {
    const e = new Error('this directory requires the admin capability');
    e.status = actorId ? 403 : 401;
    throw e;
  }
  const u = store.find('users', (row) => row.id === userId);
  if (!u) { const e = new Error('member not found'); e.status = 404; throw e; }
  const p = workforce.getProfile(u.id);
  const spaces = store.filter('spaces', (row) => row.ownerId === u.id).map((row) => ({
    id: row.id, name: row.name, type: row.type ?? null,
    visibility: row.visibility ?? 'private', status: row.status ?? 'active',
    // A private/unlisted/archived space must not acquire a public link here.
    publicSlug: row.visibility === 'public' && row.status === 'active' && !row.publicPageModeration?.hidden ? row.slug ?? null : null,
    createdAt: row.createdAt ?? null
  }));
  const businesses = store.filter('vendors', (row) => row.ownerId === u.id).map((row) => ({
    id: row.id, name: row.displayName, status: row.status ?? null,
    businessType: row.enterprise?.businessType ?? null,
    publication: row.enterprise?.publication ?? 'private'
  }));
  const memberships = store.filter('workforceMembers', (row) => row.userId === u.id).map((row) => ({
    id: row.id, workforceId: row.workforceId,
    name: workforce.getWorkforce(row.workforceId)?.name ?? 'Workforce unavailable',
    role: row.role, status: row.status,
    territories: (row.territoryIds ?? []).map((id) => workforce.getTerritory(id)?.name ?? 'Territory unavailable'),
    onboarding: workforce.onboardingChecklist(row)
  }));
  return {
    member: memberView(u),
    account: { email: u.email ?? null, authProvider: u.authProvider ?? 'password' },
    spaces, businesses,
    worker: p ? {
      displayName: p.displayName, phone: p.phone, modes: p.modes,
      areas: p.areas ?? [], languages: p.languages ?? [], availableDays: p.availableDays ?? [],
      termsAcceptedAt: p.termsAcceptedAt ?? null,
      briefings: (p.briefings ?? []).map((b) => ({ templateKey: b.templateKey, at: b.at }))
    } : null,
    memberships,
    ownedWorkforces: store.filter('workforces', (row) => row.ownerId === u.id).map((row) => ({ id: row.id, name: row.name })),
    record: trackRecord(u.id)
  };
}
