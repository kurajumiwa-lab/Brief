// ---------------------------------------------------------------------------
// AUTHENTICATION
//
// A real authentication boundary: users, password hashing, sessions, tokens,
// expiry and revocation. No external provider is required -- this IS the
// provider, and it is server-authoritative.
//
// WHY THIS SHAPE.
//
// Brief already funnels every authority question through `callerId(req)`.
// That was built deliberately so authentication could be added in ONE place
// without touching 83 routes or re-deriving object authority. This module
// supplies the verified identity; `identity.js` consumes it. Nothing else
// changes.
//
// WHAT IS NOT HERE, AND WHY.
//
// No OAuth, no magic links, no SMS OTP. Each needs a configured external
// provider (Google client secret, an email sender, an SMS gateway) that this
// deployment does not have. Inventing them would be exactly the "API-shaped
// function" the build rules forbid. Password sessions need nothing external
// and are genuinely verifiable, so that is what is implemented.
//
// PASSWORD STORAGE.
//
// scrypt with a per-user random salt, from node:crypto. Not a hand-rolled
// hash, and not a fast one: scrypt is memory-hard, so an attacker who steals
// the store cannot cheaply brute-force it. Comparison is timing-safe.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { store, newId } from '../store.js';

/** Sessions live 30 days unless revoked. Long enough for a phone, short
 *  enough that a stolen token is not permanent. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const SCRYPT_N = 16384; // CPU/memory cost
const SCRYPT_KEYLEN = 64;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto
    .scryptSync(String(password), salt, SCRYPT_KEYLEN, { N: SCRYPT_N })
    .toString('hex');
  return { salt, hash: derived };
}

/**
 * Timing-safe comparison. A plain `===` on hashes leaks information through
 * how long the comparison takes; `timingSafeEqual` does not.
 */
function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Tokens are random, not derived from user data, and only their HASH is
 * stored. A leaked database therefore does not hand over usable sessions.
 */
function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function tokenFingerprint(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Handles are compared case-insensitively so "Wanjiku" and "wanjiku" are
 *  the same person, which is what a user expects. */
function normaliseHandle(handle) {
  return String(handle ?? '').trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// USERS
// ---------------------------------------------------------------------------

/** Public projection. Never leaks salt, hash, or anything derived from them. */
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    handle: user.handle,
    displayName: user.displayName,
    // Present only for accounts that actually carry a verified email (Google
    // sign-in, delivered email proof). A password account has none and says so
    // with null rather than an empty string that looks like an address.
    email: user.email ?? null,
    authProvider: user.authProvider ?? 'password',
    createdAt: user.createdAt,
    status: user.status
  };
}

export function createUser({ handle, password, displayName = null }) {
  const h = normaliseHandle(handle);
  if (!h) throw new Error('handle is required');
  if (!/^[a-z0-9_.-]{3,32}$/.test(h)) {
    throw new Error('handle must be 3-32 characters: letters, numbers, dot, dash or underscore');
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('password must be at least 8 characters');
  }
  if (store.find('users', (u) => u.handle === h)) {
    throw new Error('that handle is taken');
  }

  const { salt, hash } = hashPassword(password);
  const now = new Date().toISOString();
  return store.insert('users', {
    id: newId('usr'),
    handle: h,
    displayName: String(displayName ?? handle).trim() || h,
    passwordSalt: salt,
    passwordHash: hash,
    status: 'active',
    createdAt: now,
    updatedAt: now
  });
}

export function getUser(id) {
  return store.find('users', (u) => u.id === id);
}

export function getUserByHandle(handle) {
  return store.find('users', (u) => u.handle === normaliseHandle(handle));
}

// ---------------------------------------------------------------------------
// FEDERATED ACCOUNTS (Google and mailbox-delivered, single-use email proofs)
//
// A verified email is an identity Brief can trust because Google verified
// the claim or a single-use proof was delivered to the target mailbox.
// These accounts still get a password hash — a random one they never learn —
// so that every account row has the same shape and no code path has to ask
// "is this one of the passwordless ones?" before it can verify anything.
//
// The verification itself lives in domain/federated.js. This module only
// binds an already-verified claim to an account.
// ---------------------------------------------------------------------------

export function normaliseEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

export function getUserByEmail(email) {
  const e = normaliseEmail(email);
  if (!e) return null;
  return store.find('users', (u) => normaliseEmail(u.email) === e);
}

/**
 * Turn an email into a free handle.
 *
 * The local part, sanitised, with a numeric suffix only if it is taken. The
 * handle is a display convenience here; the email is the identity.
 */
function handleFromEmail(email) {
  const base = normaliseEmail(email).split('@')[0].replace(/[^a-z0-9_.-]/g, '').slice(0, 24) || 'member';
  const padded = base.length >= 3 ? base : `${base}${'0'.repeat(3 - base.length)}`;
  if (!getUserByHandle(padded)) return padded;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${padded.slice(0, 28)}${i}`;
    if (!getUserByHandle(candidate)) return candidate;
  }
  throw new Error('could not allocate a handle');
}

/**
 * Sign in (or create) the account behind a VERIFIED identity claim.
 *
 * The caller must have verified the claim already — this function does not,
 * and cannot, check a signature. Returns `{ user, created }`.
 */
export function signInWithVerifiedIdentity({ provider, subject = null, email, displayName = null }) {
  const e = normaliseEmail(email);
  if (!e) throw new Error('a verified email is required');
  if (!provider) throw new Error('a provider is required');

  let user = getUserByEmail(e);
  if (user) {
    if (user.status !== 'active') throw new Error('this account is not active');
    // Bind the provider subject the first time we see it, so a later email
    // change at the provider still resolves to the same Brief account.
    const patch = {};
    if (subject && !user.providerSubject) {
      patch.providerSubject = subject;
      patch.authProvider = provider;
    }
    if (Object.keys(patch).length) user = store.update('users', user.id, patch);
    return { user, created: false };
  }

  // A random password the person never sees. They sign in through the
  // provider; nothing about this account is guessable.
  const { salt, hash } = hashPassword(crypto.randomBytes(32).toString('hex'));
  const now = new Date().toISOString();
  const created = store.insert('users', {
    id: newId('usr'),
    handle: handleFromEmail(e),
    displayName: String(displayName ?? '').trim() || e.split('@')[0],
    email: e,
    authProvider: provider,
    providerSubject: subject,
    passwordSalt: salt,
    passwordHash: hash,
    status: 'active',
    createdAt: now,
    updatedAt: now
  });
  return { user: created, created: true };
}

// ---------------------------------------------------------------------------
// SESSIONS
// ---------------------------------------------------------------------------

/**
 * Exchange credentials for a session token.
 *
 * The SAME error is returned for an unknown handle and a wrong password. A
 * different message for each would let an attacker enumerate who has an
 * account.
 */
export function login({ handle, password }) {
  const user = getUserByHandle(handle);
  const failure = new Error('invalid handle or password');

  if (!user) {
    // Spend comparable work even when the user does not exist, so response
    // time does not reveal existence.
    hashPassword(String(password ?? ''), 'decoy-salt-value');
    throw failure;
  }
  if (user.status !== 'active') throw new Error('this account is not active');
  if (!verifyPassword(String(password ?? ''), user.passwordSalt, user.passwordHash)) {
    throw failure;
  }

  return issueSession(user.id);
}

export function issueSession(userId) {
  const token = newToken();
  const now = Date.now();
  const row = store.insert('sessions', {
    id: newId('ses'),
    userId,
    // Only the fingerprint is persisted. The raw token is returned once and
    // never stored, so it cannot be read back out of the database.
    tokenFingerprint: tokenFingerprint(token),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    revokedAt: null
  });
  return { token, session: { id: row.id, userId, expiresAt: row.expiresAt } };
}

/**
 * Resolve a raw token to a live session.
 *
 * Returns a REASON on failure rather than a bare null, so the caller can
 * answer "expired" differently from "revoked" or "never existed" without
 * guessing. Expiry and revocation are both checked here: a session row
 * existing is not the same as a session being valid.
 */
export function resolveSession(token) {
  if (!token || typeof token !== 'string') {
    return { ok: false, reason: 'no_token' };
  }
  const fp = tokenFingerprint(token);
  const row = store.find('sessions', (s) => s.tokenFingerprint === fp);
  if (!row) return { ok: false, reason: 'unknown_token' };
  if (row.revokedAt) return { ok: false, reason: 'revoked' };
  if (Date.parse(row.expiresAt) <= Date.now()) return { ok: false, reason: 'expired' };

  const user = getUser(row.userId);
  if (!user) return { ok: false, reason: 'unknown_user' };
  if (user.status !== 'active') return { ok: false, reason: 'inactive_user' };

  return { ok: true, session: row, user };
}

export function revokeSession(token) {
  const fp = tokenFingerprint(token);
  const row = store.find('sessions', (s) => s.tokenFingerprint === fp);
  if (!row || row.revokedAt) return false;
  store.update('sessions', row.id, { revokedAt: new Date().toISOString() });
  return true;
}

/** Revoke every session for a user -- "sign out everywhere". */
export function revokeAllSessions(userId) {
  const rows = store.filter('sessions', (s) => s.userId === userId && !s.revokedAt);
  for (const r of rows) store.update('sessions', r.id, { revokedAt: new Date().toISOString() });
  return rows.length;
}

// ---------------------------------------------------------------------------
// REQUEST BINDING
// ---------------------------------------------------------------------------

/**
 * Extract a bearer token. Header first, then a cookie for browser navigation
 * (a public campaign link opened on a phone has no opportunity to set a
 * header). Query strings are deliberately NOT accepted: tokens there leak
 * into server logs, proxy logs and Referer headers.
 */
export function tokenFromRequest(req) {
  const header = req.headers?.authorization ?? '';
  if (/^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, '').trim();

  const cookie = req.headers?.cookie ?? '';
  const match = /(?:^|;\s*)brief_session=([^;]+)/.exec(cookie);
  if (match) return decodeURIComponent(match[1]);

  return null;
}

/**
 * Is the single-user development fallback permitted?
 *
 * PRODUCTION IS NEVER IMPLICITLY INSECURE. In production the fallback is off
 * regardless of BRIEF_DEV_AUTH. Production also refuses that override at
 * startup. Outside production it stays
 * on, which is what keeps local development and the existing test suite
 * usable without a login for every call.
 */
export function devAuthAllowed() {
  if (process.env.NODE_ENV === 'production') return false;
  if (process.env.BRIEF_DEV_AUTH === '1') return true;
  if (process.env.BRIEF_DEV_AUTH === '0') return false;
  return process.env.NODE_ENV !== 'production';
}

/**
 * Attach the verified identity to the request. Runs before every route.
 *
 * A REAL SESSION ALWAYS WINS over the development fallback, so multi-actor
 * tests and real clients behave identically whether or not dev mode is on.
 */
export function authMiddleware(req, _res, next) {
  const token = tokenFromRequest(req);
  if (token) {
    const result = resolveSession(token);
    if (result.ok) {
      req.auth = {
        userId: result.user.id,
        handle: result.user.handle,
        sessionId: result.session.id,
        method: 'session'
      };
    } else {
      // Record WHY it failed. A route that requires authentication can then
      // say "expired" instead of a blanket 401, and a bad token never
      // silently falls through to the development identity.
      req.auth = null;
      req.authError = result.reason;
    }
  } else {
    req.auth = null;
  }
  next();
}
