// Email ownership is proved by delivery to the mailbox, not by a member's
// ability to type its address. Legacy signed ?bt= links have NO redemption path.
import crypto from 'node:crypto';
import { store, newId } from '../store.js';
import * as auth from './auth.js';

export const EMAIL_LINK_TTL_MS = 10 * 60 * 1000;
export const PURPOSE = 'email_sign_in_v2';
const fingerprint = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function deliveryConfigured() {
  try {
    const origin = new URL(process.env.BRIEF_PUBLIC_ORIGIN);
    return origin.protocol === 'https:' && origin.username === '' && origin.password === '' &&
      Boolean(process.env.RESEND_API_KEY && process.env.BRIEF_EMAIL_FROM);
  } catch { return false; }
}

/** This transport is never used until an operator configures a real sender. */
export async function deliverEmail({ email, token, fetchImpl = fetch }) {
  if (!deliveryConfigured()) return false;
  const url = new URL('/?bt=' + encodeURIComponent(token), process.env.BRIEF_PUBLIC_ORIGIN).toString();
  try {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: process.env.BRIEF_EMAIL_FROM, to: [email], subject: 'Sign in to Brief',
        text: `Use this link to sign in to Brief. It expires in 10 minutes and works once.\n\n${url}\n\nIf you did not request it, ignore this message.` })
    });
    return response.ok;
  } catch { return false; }
}

/** Only the delivery callback receives the plaintext secret; the API never does. */
export async function requestEmailSignIn(email, { deliver = deliverEmail, now = Date.now() } = {}) {
  const normalized = auth.normaliseEmail(email);
  if (normalized.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized))
    throw new Error('enter a valid email address');
  const token = crypto.randomBytes(32).toString('base64url');
  const row = store.insert('emailChallenges', {
    id: newId('eml'), fingerprint: fingerprint(token), email: normalized,
    purpose: PURPOSE, expiresAt: now + EMAIL_LINK_TTL_MS, usedAt: null,
    createdAt: new Date(now).toISOString()
  });
  let sent = false;
  try { sent = await deliver({ email: normalized, token }); } catch { /* failed delivery is not proof */ }
  if (!sent) store.update('emailChallenges', row.id, { usedAt: new Date().toISOString() });
  return sent;
}

/** Consume the proof and issue the session in ONE durable transaction. */
export function redeemEmailSignIn(token, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token))
    return { ok: false, reason: 'invalid_or_expired' };
  return store.transaction(() => {
    const row = store.find('emailChallenges', (c) => c.fingerprint === fingerprint(token) && c.purpose === PURPOSE);
    if (!row || row.usedAt || row.expiresAt <= now || row.expiresAt > now + EMAIL_LINK_TTL_MS)
      return { ok: false, reason: 'invalid_or_expired' };
    store.update('emailChallenges', row.id, { usedAt: new Date(now).toISOString() });
    const { user, created } = auth.signInWithVerifiedIdentity({ provider: 'email_link', email: row.email });
    const { token: sessionToken, session } = auth.issueSession(user.id);
    return { ok: true, user, created, token: sessionToken, session };
  });
}
