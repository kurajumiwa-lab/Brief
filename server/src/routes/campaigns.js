// CAMPAIGNS ROUTES — extracted from index.js (zero behaviour change).
// Each route keeps its original body verbatim; only its home file changed.
import crypto from 'node:crypto';
import { store } from '../store.js';
import { callerId } from '../identity.js';
import * as campaigns from '../domain/campaign.js';
import * as events from '../domain/events.js';
import * as referrals from '../domain/referrals.js';
import * as checkin from '../domain/checkin.js';
import * as ticketMarket from '../domain/ticketMarket.js';
import * as signals from '../domain/signal.js';
import * as ledger from '../domain/ledger.js';
import * as analytics from '../domain/analytics.js';
import * as advertising from '../domain/advertising.js';
import { requireAuth, now } from './helpers.js';

// Owner-only guard. Returns the campaign, or sends the response and returns
// null. 404 for a campaign that is not yours: existence is not disclosed.
function ownedCampaign(req, res) {
  const c = store.find('campaigns', (x) => x.id === req.params.id);
  if (!c) { res.status(404).json({ error: 'campaign not found' }); return null; }
  if (c.ownerId !== callerId(req)) { res.status(404).json({ error: 'campaign not found' }); return null; }
  return c;
}

import { requireFeature } from '../features.js';

export function register(app) {
app.use('/api/campaigns', requireFeature('campaigns'));
app.use('/api/tickets', requireFeature('campaigns'));
app.use('/api/public/campaigns', requireFeature('campaigns'));
app.get('/api/campaigns', (req, res) => {
  res.json({ campaigns: campaigns.listCampaigns(callerId(req)) });
});



app.post('/api/campaigns', (req, res) => {
  // AUTHORIZATION. Creating a campaign is an authoring act, and an anonymous
  // caller previously got one with `ownerId: null` -- which it could then
  // publish, because the ownership guard compares the stored owner to the
  // caller and null === null. Anyone could put a campaign on Brief's public
  // surface with no identity behind it. Outsiders do not need this: they
  // already have /api/public/campaigns/:slug/register.
  if (!requireAuth(req, res)) return;
  try {
    // ownerId comes from the caller, never req.body.
    const c = campaigns.createCampaign(callerId(req), {
      title: req.body?.title,
      description: req.body?.description,
      type: req.body?.type,
      location: req.body?.location,
      startsAt: req.body?.startsAt,
      endsAt: req.body?.endsAt,
      capacity: req.body?.capacity === undefined ? null : req.body.capacity,
      price: req.body?.price === undefined ? 0 : Number(req.body.price),
      goalAmount: req.body?.goalAmount ?? null,
      currency: req.body?.currency,
      circleId: req.body?.circleId ?? null,
      metadata: req.body?.metadata,
      venue: req.body?.venue ?? null,
      agenda: req.body?.agenda ?? null,
      seriesId: req.body?.seriesId ?? null,
      festival: req.body?.festival ?? null,
      unlisted: req.body?.unlisted ? true : false,
      // Attach an existing Brief object instead of creating one. Authority is
      // checked in the domain layer against source membership.
      objectId: req.body?.objectId ?? null
    });
    res.status(201).json({ campaign: c });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});



app.get('/api/campaigns/:id', (req, res) => {
  const c = ownedCampaign(req, res);
  if (!c) return;
  res.json({ campaign: campaigns.getCampaign(c.id) });
});



app.patch('/api/campaigns/:id', (req, res) => {
  const c = ownedCampaign(req, res);
  if (!c) return;
  try {
    // ownerId is the SERVER's caller, never req.body: it authorises object
    // attachment inside the domain layer.
    res.json({ campaign: campaigns.updateCampaign(c.id, req.body ?? {}, callerId(req)) });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});

app.delete('/api/campaigns/:id', (req, res) => {
  const c = ownedCampaign(req, res);
  if (!c) return;
  try {
    if (c.status !== 'cancelled' && c.status !== 'closed') {
      try { campaigns.transitionCampaign(c.id, 'cancelled'); } catch {}
    }
    store.remove('campaigns', c.id);
    if (c.ownsObject !== false && c.objectId) {
      store.remove('objects', c.objectId);
    }
    res.json({ ok: true, removed: true });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});



for (const [action, next] of [['publish','published'],['close','closed'],['cancel','cancelled'],['complete','completed'],['golive','live']]) {
  app.post(`/api/campaigns/:id/${action}`, (req, res) => {
    const c = ownedCampaign(req, res);
    if (!c) return;
    try {
      res.json({ campaign: campaigns.transitionCampaign(c.id, next) });
    } catch (e) {
      res.status(400).json({ error: String(e.message ?? e) });
    }

  });
}

// Private analytics. Owner only -- derived from records on every read.
/**
 * The canonical share payload: one URL, plus intent links for the channels
 * that genuinely support them. Owner-only, like the rest of the dashboard.
 */

app.get('/api/campaigns/:id/share', (req, res) => {
  const c = ownedCampaign(req, res);
  if (!c) return;
  res.json({ share: campaigns.shareView(c, process.env.BRIEF_PUBLIC_ORIGIN || null) });
});


/**
 * Records that the creator distributed the link. Emits a signal ONLY -- it
 * moves no money, changes no capacity and touches no campaign field.
 */

app.post('/api/campaigns/:id/share', (req, res) => {
  const c = ownedCampaign(req, res);
  if (!c) return;
  if (c.status === 'draft') {
    return res.status(400).json({ error: 'publish the campaign before sharing it' });
  }
  campaigns.recordShare(c, req.body?.channel ?? 'link');
  res.json({ campaign: campaigns.getCampaign(c.id) });
});



app.get('/api/campaigns/:id/analytics', (req, res) => {
  const c = ownedCampaign(req, res);
  if (!c) return;
  res.json({ analytics: campaigns.analytics(c.id) });
});



app.get('/api/campaigns/:id/registrations', (req, res) => {
  const c = ownedCampaign(req, res);
  if (!c) return;
  res.json({ registrations: campaigns.listRegistrations(c.id) });
});


/**
 * The creator confirms that payment for a held spot actually arrived.
 *
 * No payment provider is connected, so the creator is the only party who knows
 * cash changed hands. This records that fact as a REAL settled transaction and
 * lets the ordinary settlement path promote the registration -- it does not
 * write a registration status directly, and it writes no counter.
 *
 * Owner-only. The amount is taken from the CAMPAIGN price, never from the
 * request body, so a caller cannot mint arbitrary revenue here.
 */

app.post('/api/campaigns/:id/registrations/:regId/confirm-payment', (req, res) => {
  const c = ownedCampaign(req, res);
  if (!c) return;
  const row = store.find('registrations', (r) => r.id === req.params.regId);
  if (!row || row.campaignId !== c.id) {
    return res.status(404).json({ error: 'registration not found' });
  }
  if (c.price <= 0 && !row.amount) {
    return res.status(400).json({ error: 'campaign is free; nothing to confirm' });
  }
  if (row.status !== 'started') {
    return res.status(409).json({ error: `registration is ${row.status}, not awaiting payment` });
  }
  try {
    // A pot settles the supporter's stated amount; an event settles its
    // fixed price. One row, the amount that actually changed hands.
    let tx = ledger.createTransaction({
      amount: row.amount ?? c.price,
      currency: c.currency,
      type: 'sale',
      description: `Payment confirmed by organiser for ${c.title}`,
      // The money belongs to the person who paid (the registration's bound
      // identity), not to the organiser confirming it arrived.
      counterparty: row.userId ?? null,
      campaignId: c.id,
      registrationId: row.id,
      circleId: c.circleId ?? null,
      objectId: c.objectId ?? null
    });
    for (const step of ['pending', 'confirmed', 'settled']) {
      tx = ledger.transitionTransaction(tx.id, step, 'organiser confirmed payment');
    }
    const registration = campaigns.promoteRegistrationForSettledTransaction(tx);
    // Settled money against a Circle moves its target, exactly as any other
    // settlement does. Same existing signal, no special case.
    if (tx.circleId) {
      signals.emitSignal({
        type: 'target_progressed',
        circleId: tx.circleId,
        value: tx.amount,
        metadata: { transactionId: tx.id, currency: tx.currency }
      });
    }
    res.status(201).json({
      registration: registration ?? store.find('registrations', (r) => r.id === row.id),
      transaction: tx,
      analytics: campaigns.analytics(c.id)
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});



app.post('/api/campaigns/:id/registrations/:regId/status', (req, res) => {
  const c = ownedCampaign(req, res);
  if (!c) return;
  const row = store.find('registrations', (r) => r.id === req.params.regId);
  if (!row || row.campaignId !== c.id) return res.status(404).json({ error: 'registration not found' });
  try {
    res.json({ registration: campaigns.setRegistrationStatus(req.params.regId, req.body?.status) });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});


// --- The gate (check-in) ----------------------------------------------------
//
// A ticket is a campaign registration carrying an opaque code. These routes are
// the GATE OPERATOR's surface: scan a code, see who it is and whether they are
// paid, and check them in exactly once. Operator identity comes from the
// authenticated caller (a host), never from the request body.

/** Look a ticket up by its scannable code. Host-only: a code is a gate secret. */

app.get('/api/tickets/:code', (req, res) => {
  if (!requireAuth(req, res)) return;
  // Resale-aware resolution: a transferred ticket only answers to its
  // CURRENT code version. The scanned payload is "CODE#n"; the # never
  // survives a URL, so the version travels as ?v=n and is recomposed here.
  const scanned = req.query.v != null ? `${req.params.code}#${req.query.v}` : req.params.code;
  const gate = ticketMarket.resolveGateCode(scanned);
  if (!gate.ok) {
    if (gate.reason === 'stale_code') {
      return res.status(409).json({
        error: 'This code is no longer valid — the ticket was transferred and has a newer code.',
        reason: 'stale_code'
      });
    }
    if (gate.reason === 'void') {
      return res.status(410).json({ error: 'This ticket was voided and cannot be used.', reason: 'void' });
    }
    return res.status(404).json({ error: 'ticket not found' });
  }
  const registration = gate.registration;
  const view = checkin.ticketView(registration);
  // Only the campaign's host may inspect a ticket — a code must not be a way
  // to read the roster anonymously.
  const c = store.find('campaigns', (x) => x.id === registration.campaignId);
  if (!c || c.ownerId !== callerId(req)) return res.status(404).json({ error: 'ticket not found' });
  res.json({ ticket: view });
});


/** Check a ticket in at the gate. Host-only, idempotent, honest refusals. */

app.post('/api/tickets/:code/check-in', (req, res) => {
  const me = requireAuth(req, res);
  if (!me) return;
  // The gate scans ONE code per seat, and only the CURRENT version admits:
  // every transfer kills the previous QR outright. ("CODE#n" arrives as
  // ?v=n because a # is a URL fragment and never reaches the server.)
  const scannedIn = req.query.v != null ? `${req.params.code}#${req.query.v}` : req.params.code;
  const gate = ticketMarket.resolveGateCode(scannedIn);
  if (!gate.ok) {
    if (gate.reason === 'stale_code') {
      return res.status(409).json({
        error: 'This code is no longer valid — the ticket was transferred and has a newer code.',
        reason: 'stale_code'
      });
    }
    if (gate.reason === 'void') {
      return res.status(410).json({ error: 'This ticket was voided and cannot be used.', reason: 'void' });
    }
    return res.status(404).json({ error: 'ticket not found' });
  }
  const registration = gate.registration;
  const scannedBase = gate.ticket ? gate.ticket.code : String(req.params.code).toUpperCase();
  if (!registration) return res.status(404).json({ error: 'ticket not found' });
  const c = store.find('campaigns', (x) => x.id === registration.campaignId);
  if (!c || c.ownerId !== me) return res.status(404).json({ error: 'ticket not found' });

  const result = checkin.checkIn(scannedBase, me);
  if (!result.ok) {
    const status = result.reason === 'cancelled' ? 410
      : result.reason === 'unpaid' ? 402
      : result.reason === 'invalid_transition' ? 409
      : 400;
    const message = {
      cancelled: 'This ticket has been cancelled.',
      unpaid: 'Payment is still pending for this ticket.',
      invalid_transition: 'This ticket cannot be checked in right now.',
      not_found: 'Ticket not found.'
    }[result.reason] ?? 'Check-in failed.';
    return res.status(status).json({ error: message, reason: result.reason, ticket: result.ticket ?? null });
  }
  res.json({
    ok: true,
    already: Boolean(result.already),
    ticket: result.ticket,
    checkedInCount: checkin.checkedInCount(registration.campaignId)
  });
});


// --- T3: campaign updates (owner authors; public reads) ---------------------

app.post('/api/campaigns/:id/updates', (req, res) => {
  const me = requireAuth(req, res);
  if (!me) return;
  try {
    const update = campaigns.postCampaignUpdate(me, req.params.id, {
      title: req.body?.title, body: req.body?.body
    });
    res.status(201).json({ update });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});

app.get('/api/campaigns/:id/updates', (req, res) => {
  res.json({ updates: campaigns.listCampaignUpdates(req.params.id) });
});

// The PUBLIC page is slug-addressed (it never learns internal ids), so the
// updates feed is readable by slug too — published campaigns only.
app.get('/api/public/campaigns/:slug/updates', (req, res) => {
  const c = campaigns.getPublicBySlug(req.params.slug);
  if (!c) return res.status(404).json({ error: 'campaign not found' });
  res.json({ updates: campaigns.listCampaignUpdates(c.id) });
});

// --- PUBLIC (no authentication; only published/live campaigns resolve) ------


app.get('/api/public/campaigns/:slug', (req, res) => {
  const c = campaigns.getPublicBySlug(req.params.slug);
  if (!c) return res.status(404).json({ error: 'campaign not found' });
  // Coarse, server-derived fingerprint: never trusted as identity, never
  // returned to any client, and only used to report `viewers` alongside raw
  // page loads. A crawler and a refresh are still indistinguishable.
  const viewerRef = crypto
    .createHash('sha256')
    .update(String(req.ip || '') + '|' + String(req.get('user-agent') || ''))
    .digest('hex')
    .slice(0, 16);
  campaigns.recordView(c, viewerRef);
  // Traffic attribution for the member whose link brought the visitor:
  // deduped per visitor per day, capped per day, worth one point each.
  try { referrals.recordTraffic(req.query?.via ?? req.query?.ref ?? null, viewerRef); } catch { /* attribution must never break a public read */ }
  res.json({ campaign: campaigns.publicView(c, req.auth?.userId ?? null) });
});

// --- PUBLIC CONTEXT (T4 detail model) ---------------------------------------
//
// The rich detail screen needs three rails of derived context — related events,
// more from the same host, and series occurrences. All three are scanned from
// real campaign rows on read (see domain/events.js); none is stored, none is
// seeded. A public read, like the detail endpoint itself.

app.get('/api/public/campaigns/:slug/context', (req, res) => {
  const c = campaigns.getPublicBySlug(req.params.slug);
  if (!c) return res.status(404).json({ error: 'campaign not found' });
  res.json({
    related: events.relatedEvents(c, 6),
    fromHost: events.hostEvents(c.ownerId, c.id, 6),
    seriesOccurrences: events.seriesOccurrences(c.seriesId ?? null, c.id, 12)
  });
});



app.post('/api/public/campaigns/:slug/register', (req, res) => {
  const c = campaigns.getPublicBySlug(req.params.slug);
  if (!c) return res.status(404).json({ error: 'campaign not found' });
  const trackingHash = req.body?.trackingHash ?? req.query?.trackingHash ?? null;
  if (trackingHash && !advertising.assetForTrackingHash(String(trackingHash), c.id)) {
    return res.status(400).json({ error: 'tracking asset does not belong to this campaign' });
  }
  try {
    const reg = campaigns.register(c, {
      attendeeRef: req.body?.attendeeRef,
      name: req.body?.name ?? null,
      contact: req.body?.contact ?? null,
      amount: req.body?.amount ?? null,
      trackingHash: trackingHash ? String(trackingHash) : null,
      // Only a verified session binds. Dev-fallback / anonymous walk-ins are
      // not guessed to be the local user.
      userId: req.auth?.userId ?? null
    });
    // The member whose link brought this registration earns event points —
    // deduped by campaign + attendee, credited after the row is real.
    const viaCode = req.body?.via ?? req.query?.via ?? null;
    if (viaCode) {
      try { referrals.recordEventSignup(viaCode, c.id, req.body?.attendeeRef); } catch { /* attribution must never break a registration */ }
    }
    // Only the registrant's own record, never the roster. The ticketCode is
    // the attendee's own gate credential, so it is returned to THEM (and only
    // to them) here — a code is the thing they show at the gate, not a roster
    // leak.
    res.status(201).json({
      registration: { id: reg.id, status: reg.status, createdAt: reg.createdAt, ticketCode: reg.ticketCode ?? null },
      campaign: campaigns.publicView(campaigns.getPublicBySlug(req.params.slug) ?? c, req.auth?.userId ?? null)
    });
  } catch (e) {
    const full = /full|not open/.test(String(e.message));
    res.status(full ? 409 : 400).json({ error: String(e.message ?? e) });
  }
});
}

