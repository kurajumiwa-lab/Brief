// ---------------------------------------------------------------------------
// FEDERATED IDENTITY — Google token verification. Legacy signed email
// recognition links were unsafe: a signature did not prove mailbox ownership.
// Their mint and redemption functions are intentionally retired.

import crypto from 'node:crypto';
import { deliveryConfigured } from './emailAuth.js';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

// --- configuration ---------------------------------------------------------

export function googleClientId() {
  return process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || null;
}

export function googleConfigured() {
  return Boolean(googleClientId());
}

/** What the client may show as a sign-in option. Honest, derived, no flags. */
export function providerStatus() {
  return {
    password: { configured: true, label: 'Handle and password' },
    google: {
      configured: googleConfigured(),
      clientId: googleClientId(),
      label: 'Continue with Google',
      reason: googleConfigured() ? null : 'GOOGLE_CLIENT_ID is not set on the server'
    },
    // Telegram is a door, not a requirement. It only appears when a bot token
    // exists, and never blocks membership.
    telegram: {
      configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      required: false,
      label: 'Telegram Mini App',
      reason: process.env.TELEGRAM_BOT_TOKEN ? null : 'TELEGRAM_BOT_TOKEN is not set on the server'
    },
    emailLink: { configured: deliveryConfigured(), label: 'Email sign-in', reason: deliveryConfigured() ? null : 'Verified email delivery is not configured' }
  };
}

// --- Google ID token verification -----------------------------------------

function b64urlToBuffer(part) {
  return Buffer.from(String(part).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function decodeSegment(part) {
  return JSON.parse(b64urlToBuffer(part).toString('utf8'));
}

let jwksCache = { at: 0, keys: [] };

async function fetchGoogleKeys(fetchImpl = fetch) {
  // Google rotates keys; a five-minute cache is the documented sweet spot
  // between hammering the endpoint and holding a retired key.
  if (Date.now() - jwksCache.at < 5 * 60 * 1000 && jwksCache.keys.length) {
    return jwksCache.keys;
  }
  const res = await fetchImpl(GOOGLE_JWKS_URL);
  if (!res || !res.ok) throw new Error('google_jwks_unavailable');
  const body = await res.json();
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  if (!keys.length) throw new Error('google_jwks_empty');
  jwksCache = { at: Date.now(), keys };
  return keys;
}

/** Test seam: let a suite install keys without touching the network. */
export function _setGoogleKeys(keys) {
  jwksCache = { at: keys ? Date.now() : 0, keys: keys ?? [] };
}

/**
 * Verify a Google ID token end to end.
 *
 * Returns `{ ok:true, claims }` or `{ ok:false, reason }`. Never throws for a
 * bad token — a malformed credential is an ordinary 401, not a crash.
 */
export async function verifyGoogleIdToken(idToken, { fetchImpl = fetch, now = Date.now() } = {}) {
  const clientId = googleClientId();
  if (!clientId) return { ok: false, reason: 'provider_not_configured' };
  if (typeof idToken !== 'string' || idToken.split('.').length !== 3) {
    return { ok: false, reason: 'malformed_token' };
  }

  const [headerPart, payloadPart, signaturePart] = idToken.split('.');
  let header;
  let claims;
  try {
    header = decodeSegment(headerPart);
    claims = decodeSegment(payloadPart);
  } catch {
    return { ok: false, reason: 'malformed_token' };
  }
  if (header.alg !== 'RS256') return { ok: false, reason: 'unsupported_algorithm' };

  let keys;
  try {
    keys = await fetchGoogleKeys(fetchImpl);
  } catch (e) {
    return { ok: false, reason: String(e.message ?? e) };
  }
  const jwk = keys.find((k) => k.kid === header.kid) ?? null;
  if (!jwk) return { ok: false, reason: 'unknown_key' };

  let verified = false;
  try {
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    verified = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${headerPart}.${payloadPart}`),
      key,
      b64urlToBuffer(signaturePart)
    );
  } catch {
    return { ok: false, reason: 'signature_check_failed' };
  }
  if (!verified) return { ok: false, reason: 'bad_signature' };

  if (!GOOGLE_ISSUERS.includes(String(claims.iss))) return { ok: false, reason: 'bad_issuer' };
  if (String(claims.aud) !== String(clientId)) return { ok: false, reason: 'bad_audience' };
  if (!claims.exp || Number(claims.exp) * 1000 <= now) return { ok: false, reason: 'expired' };
  if (!claims.sub) return { ok: false, reason: 'no_subject' };
  if (!claims.email) return { ok: false, reason: 'no_email' };
  if (claims.email_verified === false) return { ok: false, reason: 'email_not_verified' };

  return {
    ok: true,
    claims: {
      subject: String(claims.sub),
      email: String(claims.email).trim().toLowerCase(),
      displayName: String(claims.name ?? claims.given_name ?? claims.email).trim(),
      picture: claims.picture ? String(claims.picture) : null
    }
  };
}

// Retain explicit refusals for legacy direct callers; neither an HMAC nor
// knowledge of an address is proof of its owner's consent.
export function mintEmailLinkToken() { throw new Error('legacy email links are disabled'); }
export function redeemEmailLinkToken() { return { ok: false, reason: 'legacy_link_revoked' }; }
