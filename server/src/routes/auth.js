// AUTH ROUTES — extracted from index.js (zero behaviour change).
// Each route keeps its original body verbatim; only its home file changed.
import * as auth from '../domain/auth.js';
import * as referrals from '../domain/referrals.js';
import * as attribution from '../domain/attribution.js';
import * as federated from '../domain/federated.js';
import * as emailAuth from '../domain/emailAuth.js';
import { limitAuth, clearAuthLimit } from './authLimits.js';
import * as onboarding from '../domain/onboarding.js';
import * as person from '../domain/person.js';
import { callerId, platformRolesOf, capabilitiesOf } from '../identity.js';
import { requireAuth } from './helpers.js';

import { requireFeature } from '../features.js';

// Build the provenance context a sign-up arrived with, from body and query
// (UTM / deep-link / invite params). Anything unrecognised is ignored by
// attribution.capture — the row only ever carries known provenance fields.
function acquisitionContext(req) {
  const q = req.query ?? {};
  const b = req.body ?? {};
  return {
    partnerKey: b.partnerKey ?? b.partner ?? q.partner ?? q.partner_key,
    partnerName: b.partnerName,
    programKey: b.programKey ?? b.program ?? q.program ?? q.program_key,
    programName: b.programName,
    cohortKey: b.cohortKey ?? b.cohort ?? q.cohort ?? q.cohort_key,
    cohortName: b.cohortName,
    inviteCode: b.inviteCode ?? b.invite ?? q.invite,
    channel: b.channel ?? q.channel,
    source: b.source,
    utmSource: b.utmSource ?? q.utm_source,
    utmMedium: b.utmMedium ?? q.utm_medium,
    utmCampaign: b.utmCampaign ?? q.utm_campaign,
    utmContent: b.utmContent ?? q.utm_content,
    referrerId: null
  };
}

export function register(app) {
app.use('/api/auth', requireFeature('auth'));
app.post('/api/auth/register', (req, res) => {
  if (!limitAuth(req, res, 'register-ip', 60)) return;
  try {
    const user = auth.createUser({
      handle: req.body?.handle,
      password: req.body?.password,
      displayName: req.body?.displayName
    });
    // Registering signs you in; requiring an immediate second round trip to
    // log in adds friction for no security benefit.
    const { token, session } = auth.issueSession(user.id);
    const mine = person.ensurePersonForUser(user.id);
    // First rung of the ladder: an account exists. Recording it here (rather
    // than letting the client claim it) keeps activation measured from the
    // real moment of sign-up.
    onboarding.ensureProfile(user.id);
    onboarding.recordEvent(user.id, 'signed_in', { provider: 'password', created: true });
    // Referral attribution: a code the new member brought with them credits
    // the DIRECT referrer only, once — depth is hard-capped at one level.
    try { referrals.recordSignup(user.id, req.body?.ref ?? req.body?.refCode ?? null); } catch { /* attribution must never break registration */ }
    // Provenance: capture partner/program/cohort/invite/channel ONCE (first
    // touch wins). Never blocks registration, and never fabricates a partner.
    try {
      const ctx = acquisitionContext(req);
      const ref = req.body?.ref ?? req.body?.refCode ?? null;
      if (ref) ctx.referrerId = referrals.userIdForCode(ref);
      attribution.capture(user.id, ctx);
    } catch { /* attribution must never break registration */ }
    res.status(201).json({
      user: { ...auth.publicUser(user), personId: mine.id },
      token,
      expiresAt: session.expiresAt,
      onboarding: onboarding.stateFor(user.id)
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});



app.post('/api/auth/login', (req, res) => {
  if (!limitAuth(req, res, 'login-ip', 40) || !limitAuth(req, res, 'login-handle', 12, req.body?.handle)) return;
  try {
    const { token, session } = auth.login({
      handle: req.body?.handle,
      password: req.body?.password
    });
    clearAuthLimit('login-handle', req.body?.handle);
    const user = auth.getUser(session.userId);
    const mine = person.ensurePersonForUser(user.id);
    onboarding.ensureProfile(user.id);
    onboarding.recordEvent(user.id, 'signed_in', { provider: 'password', created: false });
    res.json({
      user: { ...auth.publicUser(user), personId: mine.id },
      token,
      expiresAt: session.expiresAt,
      onboarding: onboarding.stateFor(user.id)
    });
  } catch (e) {
    // 401, not 400: these are credential failures, not malformed requests.
    res.status(401).json({ error: String(e.message ?? e) });
  }
});



app.post('/api/auth/logout', (req, res) => {
  const token = auth.tokenFromRequest(req);
  const revoked = token ? auth.revokeSession(token) : false;
  res.json({ ok: true, revoked });
});


/** Sign out everywhere. Requires a live session -- you may only revoke your own. */

app.post('/api/auth/logout-all', (req, res) => {
  const me = requireAuth(req, res);
  if (!me) return;
  res.json({ ok: true, revoked: auth.revokeAllSessions(me) });
});


/** Who am I? The client uses this to decide between signed-in and signed-out UI. */
app.get('/api/auth/me', (req, res) => {
  const me = callerId(req);
  if (!me) {
    return res.status(401).json({ error: 'authentication required', code: req.authError ?? 'no_token' });
  }
  const user = auth.getUser(me);
  // A dev-fallback caller has no user row. Say so plainly rather than
  // fabricating a profile. A real session always carries the person id —
  // whoAmI is the only player id Play may use.
  if (!user) {
    return res.json({
      user: { id: me, handle: null, displayName: 'Local user', devFallback: true },
      method: req.auth?.method ?? 'dev_fallback'
    });
  }
  const mine = person.ensurePersonForUser(user.id);
  res.json({
    user: {
      ...auth.publicUser(user),
      personId: mine.id,
      // Operator-surface truth: what this account may operate. Derived only
      // from stored rows + deployment bootstrap, never from the request.
      platformRoles: platformRolesOf(user.id),
      capabilities: capabilitiesOf(user.id)
    },
    method: req.auth?.method ?? 'dev_fallback'
  });
});


// ---------------------------------------------------------------------------
// FEDERATED SIGN-IN
//
// The first screen leads with Google because typing a handle and a password is
// the slowest possible first thirty seconds. Telegram is NOT required to be a
// member: it stays available for people already inside the Mini App and is
// never a gate for anyone else.
// ---------------------------------------------------------------------------

/** What the sign-in screen may honestly offer on THIS deployment. */
app.get('/api/auth/providers', (_req, res) => {
  res.json({ providers: federated.providerStatus() });
});

/**
 * Continue with Google.
 *
 * The ID token is verified against Google's published keys — issuer,
 * audience, expiry, signature and email_verified are all checked. Without a
 * configured GOOGLE_CLIENT_ID this refuses with 503 and says why; it never
 * mints a session from a claim it cannot check.
 */
app.post('/api/auth/google', async (req, res) => {
  if (!federated.googleConfigured()) {
    return res.status(503).json({
      error: 'Google sign-in is not configured on this deployment',
      code: 'provider_not_configured',
      remedy: 'Set GOOGLE_CLIENT_ID on the server and the matching VITE_GOOGLE_CLIENT_ID on the client.'
    });
  }
  if (!limitAuth(req, res, 'google-ip', 40)) return;
  const verified = await federated.verifyGoogleIdToken(req.body?.credential);
  if (!verified.ok) {
    return res.status(401).json({ error: 'google credential rejected', reason: verified.reason });
  }
  try {
    const { user, created } = auth.signInWithVerifiedIdentity({
      provider: 'google',
      subject: verified.claims.subject,
      email: verified.claims.email,
      displayName: verified.claims.displayName
    });
    const { token, session } = auth.issueSession(user.id);
    const mine = person.ensurePersonForUser(user.id);
    onboarding.ensureProfile(user.id);
    onboarding.recordEvent(user.id, 'signed_in', { provider: 'google', created });
    if (req.body?.source) onboarding.setSource(user.id, req.body.source);
    if (created) { try { attribution.capture(user.id, acquisitionContext(req)); } catch { /* attribution must never break sign-in */ } }
    res.status(created ? 201 : 200).json({
      user: { ...auth.publicUser(user), personId: mine.id },
      token,
      expiresAt: session.expiresAt,
      created,
      onboarding: onboarding.stateFor(user.id)
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});

/** A request only DELIVERS a proof to the mailbox. It never returns a credential. */
app.post('/api/auth/email-link/request', async (req, res) => {
  if (!emailAuth.deliveryConfigured()) return res.status(503).json({ error: 'email sign-in is not configured' });
  if (!limitAuth(req, res, 'email-ip', 10) || !limitAuth(req, res, 'email-target', 4, req.body?.email)) return;
  try {
    await emailAuth.requestEmailSignIn(req.body?.email);
    // Same answer for existing/new accounts and send failure. Do not disclose
    // the target's membership or whether an external provider accepted mail.
    res.json({ ok: true, message: 'If delivery is available, check that inbox for a sign-in link.' });
  } catch (e) {
    if (e.message === 'enter a valid email address') return res.status(400).json({ error: e.message });
    res.status(503).json({ error: 'email sign-in is temporarily unavailable' });
  }
});

/** Proof is a random, single-use, ten-minute mailbox-delivered challenge. */
app.post('/api/auth/email-link', (req, res) => {
  if (!limitAuth(req, res, 'email-redeem-ip', 40)) return;
  let redeemed;
  try { redeemed = emailAuth.redeemEmailSignIn(req.body?.token); }
  catch { return res.status(503).json({ error: 'email sign-in is temporarily unavailable' }); }
  if (!redeemed.ok) return res.status(401).json({ error: 'this link cannot identify you' });
  try {
    const { user, created, token, session } = redeemed;
    const mine = person.ensurePersonForUser(user.id);
    onboarding.ensureProfile(user.id);
    onboarding.recordEvent(user.id, 'signed_in', { provider: 'email_link', created });
    if (created) { try { attribution.capture(user.id, acquisitionContext(req)); } catch { /* optional */ } }
    res.status(created ? 201 : 200).json({
      user: { ...auth.publicUser(user), personId: mine.id }, token,
      expiresAt: session.expiresAt, created, onboarding: onboarding.stateFor(user.id)
    });
  } catch { res.status(503).json({ error: 'sign-in was verified; please retry from your account' }); }
});

// The old member-generated credential endpoint is retired, including on
// deployments that still hold a BRIEF_LINK_SECRET or an old signed link.
app.post('/api/auth/email-link/mint', (_req, res) => {
  res.status(410).json({ error: 'member-generated sign-in links are discontinued' });
});
}
