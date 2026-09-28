// OPS ROUTES — extracted from index.js (zero behaviour change).
// Each route keeps its original body verbatim; only its home file changed.
import { store } from '../store.js';
import { callerId, PLATFORM_ROLES } from '../identity.js';
import * as ops from '../ops.js';
import * as ledger from '../domain/ledger.js';
import * as settlement from '../domain/settlement.js';
import * as payment from '../domain/payment.js';
import * as analytics from '../domain/analytics.js';
import * as trust from '../domain/trust.js';
import * as corrections from '../domain/corrections.js';
import * as sourceTrust from '../domain/sourceTrust.js';
import * as seed from '../domain/seed.js';
import * as notifications from '../domain/notifications.js';
import * as campaigns from '../domain/campaign.js';
import { requireAuth, requireCap, recordAudit } from './helpers.js';
import * as members from '../domain/members.js';
import * as workflow from '../domain/workflow.js';
import * as engineReview from '../domain/engine/review.js';
import * as deadLetters from '../domain/engine/deadLetters.js';
import * as schedules from '../domain/engine/schedules.js';
import * as intake from '../domain/engine/intake.js';
import * as signalLog from '../domain/signal.js';
import * as workPayment from '../domain/workPayment.js';

export function register(app) {
/**
 * Operational diagnostics. Authenticated: it names which credentials are
 * absent, which is useful to an operator and to nobody else.
 */

app.get('/api/ops/diagnostics', (req, res) => {
  if (!requireCap(req, res, 'ops.read')) return;
  res.json({
    startup: ops.startupDiagnostics({ store, capabilities: { payments: ledger.providerStatus() } }),
    readiness: ops.readiness({ store, reconcilers: [
      { name: 'settlement', run: () => settlement.reconcile() },
      { name: 'payments', run: () => payment.reconcileIntents() }
    ] }),
    counts: Object.fromEntries(
      ['objects', 'orders', 'ledgerTransactions', 'paymentIntents', 'payouts', 'signals', 'users', 'sessions']
        .map((c) => [c, store.all(c).length])
    ),
    // Failed jobs and rejected webhooks, which is where silent breakage hides.
    recentErrors: store.all('errors').slice(-20),
    rejectedCallbacks: store.all('paymentCallbacks').filter((c) => !c.accepted).slice(-10).length
  });
});


/** Take a backup on demand. Atomic-write store, so a copy is consistent. */

app.post('/api/ops/backup', (req, res) => {
  const me = requireCap(req, res, 'ops.run');
  if (!me) return;
  const result = ops.backup(store);
  if (result.ok) recordAudit('ops.backup', { actorId: me, objectType: 'store', objectId: result.file, after: { size: result.size } });
  if (!result.ok) return res.status(400).json(result);
  res.json({ ...result, pruned: ops.pruneBackups(store) });
});


// --- Analytics + operations (host/operator) ---------------------------------


app.get('/api/ops/analytics', (req, res) => {
  if (!requireCap(req, res, 'ops.read')) return;
  res.json({ analytics: analytics.dashboard() });
});



app.get('/api/ops/reports', (req, res) => {
  if (!requireCap(req, res, 'ops.read')) return;
  // Enrich each report with the object it points at (title/type/publication)
  // so the reviewer can see what they are deciding about without a second
  // lookup. Never the object row itself.
  const reports = trust.openReports().map((r) => ({
    ...r,
    target: trust.reportTarget(r)
  }));
  res.json({ reports });
});



app.post('/api/ops/reports/:id/resolve', (req, res) => {
  const me = requireCap(req, res, 'moderate');
  if (!me) return;
  try {
    const report = trust.resolveReport(req.params.id, me, req.body?.action ?? 'dismiss');
    recordAudit('ops.report.resolve', { actorId: me, objectType: 'report', objectId: req.params.id, after: { status: report?.status ?? null }, reason: req.body?.reason ?? null });
    res.json({ report });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});



app.get('/api/ops/contributors', (req, res) => {
  if (!requireCap(req, res, 'ops.read')) return;
  res.json({ contributors: trust.contributorLeaderboard() });
});


// --- Corrections (trust layer) ----------------------------------------------
// A lightweight fix for bad extracted information. The correction row keeps
// the ORIGINAL source value verbatim; the object's provenance is never
// rewritten. Creating a correction applies it; rejecting marks the row and
// the operator corrects back explicitly if a fix was wrong. Both steps are
// audited with a reason.

app.get('/api/ops/corrections', (req, res) => {
  if (!requireCap(req, res, 'ops.read')) return;
  const { objectId, status } = req.query ?? {};
  try {
    res.json({
      corrections: corrections.listCorrections({
        objectId: typeof objectId === 'string' ? objectId : null,
        status: typeof status === 'string' ? status : null
      })
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});

app.post('/api/ops/corrections', (req, res) => {
  const me = requireCap(req, res, 'moderate');
  if (!me) return;
  const { objectId, field, value, reason, isMeta } = req.body ?? {};
  try {
    const result = corrections.correctObject({
      objectId, field, value, reason, isMeta: isMeta === true,
      operatorId: me
    });
    // A real correction is exactly the kind of change the return loop exists
    // for: notify anyone who saved or follows the corrected object.
    try { notifications.generateAll(); } catch { /* never break moderation */ }
    recordAudit('ops.correction.apply', {
      actorId: me,
      objectType: 'correction',
      objectId: result.correction.id,
      before: { objectId, field, original: result.correction.originalValue },
      after: { value: result.correction.correctedValue, changed: result.changed },
      reason: result.correction.reason
    });
    res.status(201).json({ correction: result.correction, changed: result.changed });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});

app.post('/api/ops/corrections/:id/reject', (req, res) => {
  const me = requireCap(req, res, 'moderate');
  if (!me) return;
  try {
    const result = corrections.rejectCorrection(req.params.id, me, req.body?.reason);
    recordAudit('ops.correction.reject', {
      actorId: me,
      objectType: 'correction',
      objectId: req.params.id,
      reason: result.correction.decisionReason
    });
    res.json({ correction: result.correction });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});


// --- Source-level trust (trust layer) ---------------------------------------
// An operator decision about a source's standing. Never a public rating:
// it influences ranking/discovery only (degraded ranks lower, disabled stops
// contributing to the default feed). "Trusted" grants no ranking boost.

app.get('/api/ops/sources/trust', (req, res) => {
  if (!requireCap(req, res, 'ops.read')) return;
  res.json({ sources: sourceTrust.sourceTrustList() });
});

app.post('/api/ops/sources/:id/trust', (req, res) => {
  const me = requireCap(req, res, 'moderate');
  if (!me) return;
  const { status, reason } = req.body ?? {};
  try {
    const source = sourceTrust.setSourceTrust(req.params.id, me, status, reason);
    recordAudit('ops.source.trust', {
      actorId: me,
      objectType: 'source',
      objectId: req.params.id,
      after: { trustStatus: source.trustStatus },
      reason: source.trustReason
    });
    res.json({ source });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});



app.get('/api/ops/unverified', (req, res) => {
  if (!requireCap(req, res, 'ops.read')) return;
  res.json({ objects: store.filter('objects', (o) => o.verificationStatus === 'unverified' && o.publication !== 'removed') });
});


/**
 * T8 (F4 Attention): every dispute, platform-wide. A disputed order is
 * deliberately TERMINAL in the order state machine -- there is no half
 * resolution flow -- so the operator's duty is visibility, not a pretend
 * resolve button. Rows are read-only here; remedies live in refunds,
 * moderation and the ledger, each audited on its own route.
 */
app.get('/api/ops/disputes', (req, res) => {
  if (!requireCap(req, res, 'ops.read')) return;
  const rows = store.all('disputes').slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ disputes: rows });
});


/**
 * THE REFUND QUEUE — money a withdrawal promised and the ledger refused.
 *
 * When an offer is withdrawn, every refundable payment is refunded through the
 * ledger on the spot. Anything the ledger will not refund becomes a
 * `refundObligations` row with status `owed`, carrying the ledger's own refusal
 * and the transaction it belongs to. This is the surface for those: an unpaid
 * refund must be a row on a queue a person can see, because the alternative —
 * a refund that silently did not happen — is the failure mode the whole
 * withdrawal flow exists to prevent.
 *
 * Read-only by design, like the disputes wall: the remedy is a ledger
 * transition, which happens on the money routes, not here.
 */
app.get('/api/ops/refund-obligations', (req, res) => {
  if (!requireCap(req, res, 'ops.read')) return;
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : 'owed';
  const rows = campaigns.listRefundObligations({ status: status === 'all' ? null : status });
  const owedRows = store.filter('refundObligations', (o) => o.status === 'owed');
  res.json({
    obligations: rows,
    owed: {
      count: owedRows.length,
      total: owedRows.reduce((s, o) => s + (Number(o.amount) || 0), 0),
      currency: owedRows[0]?.currency ?? 'KES'
    }
  });
});

/**
 * T8 (F4 Attention): the resale listing wall -- active listings plus the
 * removed ones WITH their reasons, so the moderation loop
 * (flag -> inspect -> decide -> audit) can be read end to end after the fact.
 * Removal itself stays on its own moderate-capability route, audited there.
 */
app.get('/api/ops/ticket-listings', (req, res) => {
  if (!requireCap(req, res, 'ops.read')) return;
  const rows = store.all('ticketListings').slice()
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  res.json({ listings: rows });
});


/**
 * Seed / clear demo content IN-PROCESS. The CLI script wrote to a data file
 * that the running server (which holds the store in memory) never re-reads, so
 * on the deployed site the data never appeared. These routes run the seed
 * against the live in-memory store, so it is visible immediately.
 *
 * Authenticated (the local bootstrapped account counts), and the seed is
 * clearly-tagged, removable, and creates no money — a harmless demo affordance,
 * not a privileged surface.
 */

app.post('/api/ops/seed', (req, res) => {
  const me = requireCap(req, res, 'admin');
  if (!me) return;
  const seeded = seed.runSeed();
  recordAudit('ops.seed', { actorId: me, objectType: 'store', after: { seeded: seeded?.length ?? seeded } });
  res.json({ seeded });
});



/**
 * The append-only audit trail, newest first. Every consequential operator
 * action lands here via recordAudit(). Readable by any operator role because
 * the question it answers -- "who did what, when" -- is not privileged.
 */
app.get('/api/ops/audit', (req, res) => {
  if (!requireCap(req, res, 'ops.read')) return;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = store.all('auditLog').slice(-limit).reverse();
  res.json({ audit: rows, total: store.all('auditLog').length });
});

/**
 * Assign or clear platform roles for a user. Admin-only, audited with
 * before/after. Roles are never read from this request for authorisation --
 * only written to the target user's own row.
 */
// --- MEMBERS: the admin's directory for onboarding real people -------------

app.get('/api/ops/members', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const me = requireCap(req, res, 'admin');
  if (!me) return;
  res.json(members.listMembers({ query: req.query?.q ?? '', page: Number(req.query?.page ?? 0) || 0 }));
});

app.get('/api/ops/members/:id', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const me = requireCap(req, res, 'admin');
  if (!me) return;
  try {
    const profile = members.memberProfile(me, req.params.id);
    recordAudit('ops.member.view', { actorId: me, objectType: 'user', objectId: req.params.id });
    res.json({ profile });
  } catch (e) {
    res.status(e.status ?? 400).json({ error: String(e.message ?? e) });
  }
});

app.get('/api/ops/onboarding', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const me = requireCap(req, res, 'admin');
  if (!me) return;
  res.json(members.onboardingView());
});

app.post('/api/ops/members/:id/status', (req, res) => {
  const me = requireCap(req, res, 'admin');
  if (!me) return;
  try {
    res.json(members.setMemberStatus(me, req.params.id, { status: req.body?.status, reason: req.body?.reason ?? '' }));
  } catch (e) {
    res.status(e.status ?? 400).json({ error: String(e.message ?? e) });
  }
});

app.post('/api/ops/roles', (req, res) => {
  const me = requireCap(req, res, 'admin');
  if (!me) return;
  const userId = String(req.body?.userId ?? '').trim();
  const roles = Array.isArray(req.body?.roles) ? req.body.roles : [];
  const valid = [...new Set(roles.map(String))].filter((r) => PLATFORM_ROLES.includes(r));
  const user = store.find('users', (u) => u.id === userId || u.handle === userId);
  if (!user) return res.status(404).json({ error: 'user not found' });
  if (user.id === me && !valid.includes('admin')) return res.status(409).json({ error: 'you cannot remove your own admin access' });
  const before = Array.isArray(user.platformRoles) ? user.platformRoles : [];
  store.update('users', user.id, { platformRoles: valid });
  recordAudit('ops.roles.set', {
    actorId: me, objectType: 'user', objectId: user.id,
    before: { platformRoles: before }, after: { platformRoles: valid },
    reason: req.body?.reason ?? null
  });
  res.json({ user: { id: user.id, handle: user.handle, platformRoles: valid } });
});

app.post('/api/ops/seed/clear', (req, res) => {
  const me = requireCap(req, res, 'admin');
  if (!me) return;
  const cleared = seed.clearSeed();
  recordAudit('ops.seed.clear', { actorId: me, objectType: 'store', after: { cleared: cleared?.length ?? cleared } });
  res.json({ cleared });
});

// ===========================================================================
// THE OPERATIONS ENGINE'S CONTROL PLANE (EVENT-ENGINE.md §9)
//
// The console may read any projection, work the queues, and change policy. It
// may NOT set a status directly or move money outside the ledger — every route
// below either reads, or performs a named action that emits its own event.
// ===========================================================================

/** One object answering "what is the engine doing right now?". */
app.get('/api/ops/engine', (req, res) => {
  if (!requireCap(req, res, 'ops.read')) return;
  res.json({
    engine: workflow.engineStatus(),
    intake: intake.stats(),
    reconciliation: {
      // A refund the ledger refused is an obligation, not a silence.
      refundObligations: store.filter('refundObligations', (o) => o.status === 'owed').length,
      settlementEscalations: store.filter('settlementEscalations', (e) => e.status === 'open').length
    }
  });
});

/**
 * THE QUEUE THAT MUST NOT BE INVISIBLE.
 *
 * Every terminal automation failure lands here with the payload, the attempt
 * count and the failing system's own words. Ordered oldest-first on purpose:
 * the oldest failure is the one most likely to have been quietly hurting
 * somebody for longest.
 */
app.get('/api/ops/dead-letters', (req, res) => {
  if (!requireCap(req, res, 'ops.read')) return;
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : 'open';
  res.json({
    deadLetters: deadLetters.list({ status: status === 'all' ? null : status, limit: Number(req.query.limit) || 100 }),
    stats: deadLetters.stats()
  });
});

/**
 * Resolve one. `resolution` says HOW it was dealt with, because "resolved" with
 * no verb is not a record a reader can learn from. The act emits its own event.
 */
app.post('/api/ops/dead-letters/:id/resolve', (req, res) => {
  const me = requireCap(req, res, 'ops.run');
  if (!me) return;
  const row = deadLetters.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'dead letter not found' });
  const resolution = ['retried', 'discarded', 'noted'].includes(req.body?.resolution) ? req.body.resolution : 'noted';
  try {
    const resolved = deadLetters.resolve(row.id, { by: me, note: req.body?.note ?? null, resolution });
    recordAudit('ops.dead_letter.resolve', {
      actorId: me, objectType: 'dead_letter', objectId: row.id,
      before: { status: 'open' }, after: { status: resolved.status, resolution }, reason: req.body?.note ?? null
    });
    res.json({ deadLetter: resolved });
  } catch (e) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

/** The human-escalation queue: what the automation could not decide. */
app.get('/api/ops/review-items', (req, res) => {
  if (!requireCap(req, res, 'ops.read')) return;
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : 'pending';
  res.json({
    items: engineReview.list({
      status: status === 'all' ? null : status,
      kind: typeof req.query.kind === 'string' && req.query.kind ? req.query.kind : null,
      overdueOnly: req.query.overdue === '1'
    }),
    stats: engineReview.stats()
  });
});

/**
 * Decide one. A person's decision is recorded as a person's decision — the
 * `auto_*` statuses are reserved for the rules, which is what makes the
 * automation frontier measurable instead of asserted.
 */
app.post('/api/ops/review-items/:id/decide', (req, res) => {
  const me = requireCap(req, res, 'ops.run');
  if (!me) return;
  const row = engineReview.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'review item not found' });
  try {
    const decided = engineReview.decide(row.id, {
      decision: req.body?.decision,
      by: me,
      byKind: 'operator',
      note: req.body?.note ?? null
    });
    recordAudit('ops.review.decide', {
      actorId: me, objectType: 'review_item', objectId: row.id,
      before: { status: row.status }, after: { status: decided.status, decision: decided.decision },
      reason: req.body?.note ?? null
    });
    res.json({ reviewItem: decided });
  } catch (e) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

/** The payout frontier: what is waiting on a person, and what is still owed. */
app.get('/api/ops/payouts', (req, res) => {
  if (!requireCap(req, res, 'ops.read')) return;
  const queue = workPayment.releaseQueue();
  res.json({
    queue,
    thresholds: { payoutAutoMax: workPayment.PAYOUT_AUTO_MAX, key: workPayment.RELEASE_THRESHOLD_KEY },
    owedOrders: queue.filter((s) => s.status === 'release_requested').length
  });
});

/** Rules, including the engine's own, with their frontier level. */
app.get('/api/ops/rules', (req, res) => {
  if (!requireCap(req, res, 'ops.read')) return;
  res.json({
    rules: workflow.listWorkflows({ includeSystem: true }),
    catalogue: workflow.ACTION_TYPES,
    status: workflow.engineStatus()
  });
});

/** Enable/disable or re-level a rule. Changing the level is an event. */
app.post('/api/ops/rules/:id', (req, res) => {
  const me = requireCap(req, res, 'ops.run');
  if (!me) return;
  const wf = workflow.getWorkflow(req.params.id);
  if (!wf) return res.status(404).json({ error: 'rule not found' });
  try {
    const updated = workflow.updateWorkflow(wf.id, {
      enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined,
      frontier: req.body?.frontier,
      updatedBy: me
    });
    recordAudit('ops.rule.update', {
      actorId: me, objectType: 'workflow', objectId: wf.id,
      before: { enabled: wf.enabled, frontier: wf.frontier },
      after: { enabled: updated.enabled, frontier: updated.frontier },
      reason: req.body?.note ?? null
    });
    res.json({ rule: updated });
  } catch (e) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

/** What the clock is holding: durable "do this at that time" rows. */
app.get('/api/ops/schedules', (req, res) => {
  if (!requireCap(req, res, 'ops.read')) return;
  res.json({ schedules: schedules.list({ status: req.query.status ?? null }), stats: schedules.stats() });
});

/** Run the engine by hand. Same code path the cadence uses. */
app.post('/api/ops/engine/tick', async (req, res) => {
  const me = requireCap(req, res, 'ops.run');
  if (!me) return;
  const result = await workflow.tick();
  recordAudit('ops.engine.tick', { actorId: me, objectType: 'engine', after: result });
  res.json({ tick: result, status: workflow.engineStatus() });
});

/**
 * THE TIMELINE — what happened to one entity, in order, from the log alone.
 *
 * This is the payoff of keeping an append-only log: no join, no per-feature
 * history table, and the answer includes the events nobody wrote a UI for.
 */
/** 'work_order' -> 'workOrder', so the metadata key can be derived. */
function camel(snake) {
  return String(snake).replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

app.get('/api/ops/entities/:kind/:id/timeline', (req, res) => {
  if (!requireCap(req, res, 'ops.read')) return;
  const { kind, id } = req.params;
  // THREE SHAPES, because the log has three eras and only the newest carries
  // the envelope: `entityKind/entityId` (the envelope), `objectId` (how every
  // pre-envelope event described its subject), and `metadata.<kind>Id` (how
  // features that are not objects — campaigns, work orders, ledger rows —
  // linked themselves to the thing that caused them).
  const idField = `${camel(kind)}Id`;
  const rows = store
    .filter('signals', (s) =>
      (s.entityKind === kind && s.entityId === id) ||
      s.objectId === id ||
      s.metadata?.[idField] === id ||
      s.correlationId === id
    )
    .slice()
    .sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0));
  // A correlation id groups a whole business process (a work order's life),
  // which is usually what a person actually wants: not this row's events, but
  // everything that happened because of it.
  const correlation = rows.find((r) => r.correlationId)?.correlationId ?? null;
  const correlated = correlation
    ? store.filter('signals', (s) => s.correlationId === correlation).sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))
    : [];
  res.json({
    entity: { kind, id },
    events: rows,
    correlated: correlated.length > rows.length ? correlated : [],
    count: rows.length
  });
});

/** The raw log, filtered. Read-only, capped, newest-last so a reader can follow it. */
app.get('/api/ops/signals', (req, res) => {
  if (!requireCap(req, res, 'ops.read')) return;
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const type = typeof req.query.type === 'string' && req.query.type ? req.query.type : null;
  const entityId = typeof req.query.entityId === 'string' && req.query.entityId ? req.query.entityId : null;
  const fromSeq = Number(req.query.fromSeq) || 0;
  let rows = store.all('signals').filter((s) => Number(s.seq ?? 0) > fromSeq);
  if (type) rows = rows.filter((s) => s.type === type);
  if (entityId) rows = rows.filter((s) => s.entityId === entityId);
  rows = rows.sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0)).slice(-limit);
  res.json({ signals: rows, cursor: rows.at(-1)?.seq ?? null, count: rows.length });
});

/** Intake rows: what arrived at the edge, and what happened to it. */
app.get('/api/ops/intake', (req, res) => {
  if (!requireCap(req, res, 'ops.read')) return;
  res.json({
    events: intake.list({ status: req.query.status ?? null, source: req.query.source ?? null, limit: Number(req.query.limit) || 100 }),
    stats: intake.stats()
  });
});
}

