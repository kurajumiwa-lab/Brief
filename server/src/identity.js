// ---------------------------------------------------------------------------
// CALLER IDENTITY
//
// ONE place answers "who is making this request?". Every authorisation check
// in the server inherits from it, which is why authentication could be added
// without touching a single route.
//
// Two identity sources, in strict priority order:
//
//   1. A VERIFIED SESSION (domain/auth.js) -- a real, expiring, revocable
//      token resolved by the auth middleware. This always wins.
//   2. The single-user development fallback -- the historical `usr_me`
//      constant, permitted only outside production (or by an explicit
//      BRIEF_DEV_AUTH=1 is refused at startup and never activates it).
//
// What has NOT changed: no route ever reads an actor identity out of the
// request body or query string. A client-supplied `userId` is a forgeable
// claim, not an identity.
// ---------------------------------------------------------------------------

import { devAuthAllowed } from './domain/auth.js';
import { store } from './store.js';

// The existing single-user constant. Pre-existing routes already assume this
// identity for source membership and provenance; circles now match them.
export const CURRENT_USER = 'usr_me';

/**
 * The authenticated caller for this request, or null when there is none.
 *
 * SECURITY: deliberately ignores req.body and req.query. An actor identity
 * must never come from a place the caller controls.
 *
 * A verified session takes precedence over the development fallback, so a
 * logged-in actor is always themselves -- never `usr_me` -- even in dev mode.
 * A token that was presented but failed verification (expired, revoked,
 * forged) does NOT fall through to the development identity: that would turn
 * an expired session into a silent privilege grant.
 */
export function callerId(req) {
  if (req?.auth?.userId) return req.auth.userId;
  if (req?.authError) return null;
  return devAuthAllowed() ? CURRENT_USER : null;
}

/**
 * Identity for routes that MUST have a real actor. Returns null when the
 * caller is anonymous, so the route can answer 401 rather than acting as
 * somebody.
 */
export function requireCallerId(req) {
  return callerId(req);
}

/**
 * Whether caller identity is genuinely verified. Currently false: the identity
 * is assumed from a single-user deployment, not proven. Surfaced through
 * /api/capabilities so the limitation is visible rather than implied away.
 */
export function authStatus() {
  const dev = devAuthAllowed();
  const insecureDevInProd = process.env.NODE_ENV === 'production' && process.env.BRIEF_DEV_AUTH === '1';
  return {
    // Authentication IS implemented: users, scrypt password hashing, expiring
    // revocable sessions, bearer tokens.
    configured: true,
    method: 'session_token',
    // Whether the single-user fallback is still accepting unauthenticated
    // requests as `usr_me`. Reported, never hidden.
    devFallback: dev,
    insecure: insecureDevInProd,
    reason: insecureDevInProd
      ? 'BRIEF_DEV_AUTH=1 is forbidden in production: startup refuses it, ' +
        'and the development identity cannot be enabled. Remove this setting.'
      : dev
        ? 'Session authentication is active. The single-user development ' +
          'fallback is also enabled (non-production), so unauthenticated ' +
          'requests are treated as the local user. A verified session always ' +
          'takes precedence.'
        : 'Session authentication is active and required. Unauthenticated ' +
          'requests have no identity and are refused by private routes.'
  };
}

// ---------------------------------------------------------------------------
// AUTHORISATION
//
// Deliberately NOT a general RBAC system. Three small predicates cover every
// authority question the current data model can actually pose.
// ---------------------------------------------------------------------------

/** True when the caller is acting on their own record. */
export function isSelf(req, userId) {
  return callerId(req) === userId;
}

/**
 * True when the caller coordinates this circle. Coordinator is the only
 * elevated role in the model, and it is read from a stored membership row --
 * never from the request.
 */
export function isCoordinator(store, req, circleId) {
  const me = callerId(req);
  // `status !== 'ended'` is not decoration: leaving a circle must end the
  // member's POWER even though the row survives as history. A soft delete that
  // the authority checks ignore is a privilege that never expires.
  const row = store.find(
    'members',
    (m) => m.circleId === circleId && m.userId === me && m.role === 'coordinator' && m.status !== 'ended'
  );
  return Boolean(row);
}

/**
 * A circle with no members yet has no coordinator, so its creator would be
 * locked out. Treat "no members at all" as open for the first join, which is
 * how a real circle bootstraps. Any later join needs a coordinator.
 */
export function circleHasNoMembers(store, circleId) {
  // "no members" means no LIVE members. A circle everybody left is reclaimable;
  // a circle whose history rows still count as membership would be shut forever.
  return store.filter('members', (m) => m.circleId === circleId && m.status !== 'ended').length === 0;
}

/**
 * The caller's membership row in a circle, or null when they do not belong.
 *
 * Role is always READ FROM THE STORE, never from the request. A client can
 * claim any role it likes in a body; it cannot forge a membership row.
 */
export function membershipOf(store, req, circleId) {
  const me = callerId(req);
  return store.find('members', (m) => m.circleId === circleId && m.userId === me && m.status !== 'ended');
}

/**
 * Roles permitted to act operationally inside a circle.
 *
 * 'observer' is deliberately excluded: an observer may read a circle but may
 * not take on work, complete it, or vote. That is the whole meaning of the
 * role, and it is enforced here rather than by hiding buttons in the client.
 */
export const OPERATIONAL_ROLES = ['coordinator', 'contributor', 'scout', 'logistics'];

export function canOperate(store, req, circleId) {
  const row = membershipOf(store, req, circleId);
  return Boolean(row && OPERATIONAL_ROLES.includes(row.role));
}

/**
 * May the caller govern this object's visibility?
 *
 * Objects carry no ownerId -- they are extracted from sources, not authored.
 * Authority therefore derives from the EXISTING provenance chain:
 *
 *     object -> objectSources -> source -> sourceMemberships -> userId
 *
 * A caller who has a membership on a source the object came from may publish
 * or retract it. Anyone else may not. This deliberately reuses the membership
 * machinery rather than adding an owner column: the relationship already
 * exists in the data, it simply was not being consulted.
 *
 * An object with NO source provenance (manually captured via brief-it) is
 * governed by whoever captured it; `capturedBy` is recorded at save time.
 */
export function canGovernObject(store, req, objectId) {
  const me = callerId(req);
  const object = store.find('objects', (o) => o.id === objectId);
  if (!object) return false;

  // Manually captured objects: the capturer governs.
  if (object.capturedBy) return object.capturedBy === me;

  const links = store.filter('objectSources', (os) => os.objectId === objectId);
  if (links.length === 0) {
    // No provenance and no capturer. Refuse rather than default to open --
    // an unattributable object is not something any caller can publish.
    return false;
  }
  return links.some((l) =>
    store.find(
      'sourceMemberships',
      (m) => m.sourceId === l.sourceId && m.userId === me && m.accessGranted
    )
  );
}

// ---------------------------------------------------------------------------
// PLATFORM ROLES (operator surface authorisation)
//
// Circle roles govern circles. These govern the PLATFORM: the /api/ops and
// /api/admin surfaces, sweeps, reconciliation, seeding and moderation.
//
// Roles come from exactly two places, and never from a request:
//   1. the user's own row (platformRoles), assigned by an admin; and
//   2. deployment bootstrap lists (BRIEF_ADMINS / BRIEF_REVIEWERS /
//      BRIEF_FINANCE / BRIEF_OPERATORS), so a fresh deploy can name its
//      operators without hand-editing a data file.
//
// Capabilities are additive per role, so a route asks for a CAPABILITY, never
// for a role name -- adding a role later cannot silently widen old routes.
// ---------------------------------------------------------------------------

export const PLATFORM_ROLES = ['viewer', 'operator', 'reviewer', 'finance', 'admin'];

export const ROLE_CAPABILITIES = {
  viewer: ['ops.read'],
  operator: ['ops.read', 'ops.run'],
  reviewer: ['ops.read', 'ops.run', 'moderate'],
  finance: ['ops.read', 'ops.run', 'finance'],
  admin: ['ops.read', 'ops.run', 'moderate', 'finance', 'admin']
};

function envHandles(name) {
  const raw = process.env[name];
  if (!raw) return [];
  return String(raw).split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

/** The caller's platform roles: stored assignment ∪ deployment bootstrap. */
export function platformRolesOf(userId) {
  if (!userId) return [];
  const user = store.find('users', (u) => u.id === userId);
  const stored = Array.isArray(user?.platformRoles) ? user.platformRoles : [];
  const handle = typeof user?.handle === 'string' ? user.handle.toLowerCase() : null;
  const bootstrapped = [
    ...(handle && envHandles('BRIEF_ADMINS').includes(handle) ? ['admin'] : []),
    ...(handle && envHandles('BRIEF_REVIEWERS').includes(handle) ? ['reviewer'] : []),
    ...(handle && envHandles('BRIEF_FINANCE').includes(handle) ? ['finance'] : []),
    ...(handle && envHandles('BRIEF_OPERATORS').includes(handle) ? ['operator'] : [])
  ];
  const all = [...new Set([...stored, ...bootstrapped])];
  return all.filter((r) => PLATFORM_ROLES.includes(r));
}

export function capabilitiesOf(userId) {
  const caps = new Set();
  for (const role of platformRolesOf(userId)) {
    for (const cap of ROLE_CAPABILITIES[role] ?? []) caps.add(cap);
  }
  return [...caps];
}

export function hasCapability(userId, capability) {
  return capabilitiesOf(userId).includes(capability);
}
