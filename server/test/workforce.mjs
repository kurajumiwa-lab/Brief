// WORKFORCE — onboarding, territories, programs, proof, review, earnings,
// settlement. Domain rules first, then the HTTP surface with real sessions.
import './test-env.mjs';
import assert from 'node:assert/strict';
process.env.BRIEF_DEV_AUTH = '0';

const { store } = await import('../src/store.js');
const auth = await import('../src/domain/auth.js');
const uploads = await import('../src/domain/upload.js');
const ledger = await import('../src/domain/ledger.js');
const wf = await import('../src/domain/workforce.js');
const work = await import('../src/domain/workExecution.js');
const tpl = await import('../src/domain/workTemplates.js');
const { isoWeekOf } = await import('../src/domain/fieldAgent.js');
store._reset();

let count = 0;
const test = async (name, fn) => { await fn(); count++; console.log('PASS ' + name); };
const rejects = (fn, code) => assert.throws(fn, (e) => {
  if (code && e.code !== code) { console.error('expected', code, 'got', e.code, e.message); return false; }
  return true;
});
const user = (handle) => auth.createUser({ handle, password: 'workforce-test-passphrase' });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
let photoSeq = 0;
const photo = (ownerId, purpose = 'private_work') =>
  uploads.saveUpload({ ownerId, bytes: Buffer.concat([png, Buffer.from(`p${++photoSeq}`)]), purpose }).upload.id;
const future = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

// Nairobi West-ish centre; points ~1 km and ~30 km away.
const NW = { lat: -1.3100, lng: 36.8200 };
const NEAR = { lat: -1.3150, lng: 36.8250, accuracyM: 12 };
const FAR = { lat: -1.0500, lng: 36.9000, accuracyM: 12 };

const owner = user('wf_owner');
const supervisor = user('wf_supervisor');
const jane = user('wf_jane');      // field + home worker
const amina = user('wf_amina');    // home-only caller
const stranger = user('wf_stranger');
const finance = user('wf_finance');
store.update('users', finance.id, { platformRoles: ['finance'] });

const completeProfile = (u, modes = ['home', 'field'], areas = []) => {
  wf.saveProfile(u.id, { displayName: u.handle, phone: '0712345678', modes, device: { smartphone: true, gps: true }, areas, availableDays: [0, 1, 2, 3, 4, 5, 6] });
  wf.acceptTerms(u.id, { version: tpl.WORK_TERMS_VERSION });
  wf.acknowledgeBriefing(u.id, 'merchant_onboarding');
};

let force, west, east, mJane, mAmina, mSup, program;

await test('templates: every template\'s step shares sum to 100 and modes are known', () => {
  for (const t of Object.values(tpl.TEMPLATES)) {
    assert.equal(t.steps.reduce((s, x) => s + x.share, 0), 100);
    assert.ok(['home', 'field', 'hybrid'].includes(tpl.templateMode(t)));
  }
  assert.equal(tpl.templateMode(tpl.TEMPLATES.merchant_onboarding), 'hybrid');
  assert.equal(tpl.templateMode(tpl.TEMPLATES.lead_calling), 'home');
});

await test('rate card is exact integer KES: steps sum to the pool, pool + fee = price', () => {
  for (const key of tpl.TEMPLATE_KEYS) {
    for (const price of [20, 99, 250, 301, 1000, 12345, 1000000]) {
      const card = work.rateCard(tpl.TEMPLATES[key], price);
      assert.equal(card.briefFeeKes + card.workerPoolKes, price);
      assert.equal(card.steps.reduce((s, x) => s + x.feeKes, 0), card.workerPoolKes);
      for (const s of card.steps) assert.ok(Number.isInteger(s.feeKes) && s.feeKes >= 0);
    }
  }
  const card = work.rateCard(tpl.TEMPLATES.merchant_onboarding, 300);
  assert.deepEqual([card.briefFeeKes, card.workerPoolKes, card.steps[0].feeKes, card.steps[1].feeKes], [60, 240, 60, 180]);
  // No bonus, tier, speed or multiplier anywhere in the terms.
  assert.ok(!/bonus|tier|multiplier|speed/i.test(JSON.stringify(card)));
});

await test('workforce: created with a join code; foreign ids are not found; strangers cannot manage', () => {
  force = wf.createWorkforce(owner.id, { name: 'Acme Field Team' });
  assert.match(force.joinCode, /^[A-Z2-9]{8}$/);
  rejects(() => wf.createWorkforce(owner.id, { name: 'ab' }), 'validation_error');
  rejects(() => wf.requireManager(force.id, stranger.id), 'not_found');
  rejects(() => wf.requireManager('wkf_nope', owner.id), 'not_found');
  west = wf.createTerritory(force.id, owner.id, { name: 'Nairobi West', areas: ['South C', 'Madaraka'], lat: NW.lat, lng: NW.lng, radiusKm: 5 });
  east = wf.createTerritory(force.id, owner.id, { name: 'Embakasi', areas: ['Pipeline'] });
  rejects(() => wf.createTerritory(force.id, owner.id, { name: 'nairobi west' }), 'duplicate');
  rejects(() => wf.createTerritory(force.id, owner.id, { name: 'Bad', lat: 200, lng: 1, radiusKm: 2 }), 'validation_error');
  rejects(() => wf.createTerritory(force.id, stranger.id, { name: 'Sneaky' }), 'not_found');
});

await test('joining: by code only, owner cannot join own workforce, rejoin is idempotent', () => {
  rejects(() => wf.joinByCode(jane.id, 'WRONGCODE'), 'not_found');
  rejects(() => wf.joinByCode(owner.id, force.joinCode), 'self_join');
  mJane = wf.joinByCode(jane.id, force.joinCode.toLowerCase());
  assert.equal(mJane.status, 'applied');
  assert.equal(wf.joinByCode(jane.id, force.joinCode).id, mJane.id);
  mAmina = wf.joinByCode(amina.id, force.joinCode);
  mSup = wf.joinByCode(supervisor.id, force.joinCode);
  // An applied member has no management authority and no join code.
  assert.equal(wf.canManage(force.id, jane.id), false);
  assert.equal(wf.myWorkforces(jane.id)[0].joinCode, null);
});

await test('onboarding checklist is derived; activation refused until complete; names what is missing', () => {
  let c = wf.onboardingChecklist(mJane);
  assert.equal(c.readyForActivation, false);
  assert.equal(c.items.find((i) => i.key === 'profile').done, false);
  const err = (() => { try { wf.memberAction(force.id, owner.id, mJane.id, { action: 'activate' }); } catch (e) { return e; } })();
  assert.equal(err.code, 'onboarding_incomplete');
  assert.ok(err.missing.includes('Worker profile'));

  rejects(() => wf.saveProfile(jane.id, { displayName: 'Jane', phone: '12345', modes: ['field'] }), 'validation_error');
  completeProfile(jane);
  c = wf.onboardingChecklist(store.find('workforceMembers', (m) => m.id === mJane.id));
  // Field worker still needs a territory.
  assert.equal(c.items.find((i) => i.key === 'territory').done, false);
  rejects(() => wf.memberAction(force.id, owner.id, mJane.id, { action: 'activate' }), 'onboarding_incomplete');
  wf.memberAction(force.id, owner.id, mJane.id, { action: 'assign_territories', territoryIds: [west.id] });
  mJane = wf.memberAction(force.id, owner.id, mJane.id, { action: 'activate' });
  assert.equal(mJane.status, 'active');
  assert.ok(wf.onboardingChecklist(mJane).complete);

  // Home-only worker needs no territory.
  completeProfile(amina, ['home']);
  mAmina = wf.memberAction(force.id, owner.id, mAmina.id, { action: 'activate' });
  assert.equal(mAmina.status, 'active');
});

await test('terms are versioned; a stale version is refused', () => {
  wf.saveProfile(supervisor.id, { displayName: 'Sup', phone: '+254722000111', modes: ['home'] });
  rejects(() => wf.acceptTerms(supervisor.id, { version: 'old-terms' }), 'stale_terms');
  wf.acceptTerms(supervisor.id, { version: tpl.WORK_TERMS_VERSION });
  wf.acknowledgeBriefing(supervisor.id, 'merchant_onboarding');
  wf.memberAction(force.id, owner.id, mSup.id, { action: 'activate' });
});

await test('HR authority: only owner sets roles; supervisors cannot act on supervisors; nobody acts on self', () => {
  rejects(() => wf.memberAction(force.id, jane.id, mAmina.id, { action: 'suspend', reason: 'no reason' }), 'forbidden');
  mSup = wf.memberAction(force.id, owner.id, mSup.id, { action: 'set_role', role: 'supervisor' });
  assert.equal(wf.canManage(force.id, supervisor.id), true);
  rejects(() => wf.memberAction(force.id, supervisor.id, mSup.id, { action: 'suspend', reason: 'self check' }), 'self_action');
  rejects(() => wf.memberAction(force.id, supervisor.id, mJane.id, { action: 'set_role', role: 'supervisor' }), 'forbidden');
  rejects(() => wf.memberAction(force.id, supervisor.id, mJane.id, { action: 'assign_territories', territoryIds: ['ter_foreign'] }), 'not_found');
  // A supervisor can place a worker in territories.
  wf.memberAction(force.id, supervisor.id, mJane.id, { action: 'assign_territories', territoryIds: [west.id] });
  // Authority is scoped to ONE workforce.
  const other = wf.createWorkforce(stranger.id, { name: 'Other Team' });
  rejects(() => wf.requireManager(other.id, supervisor.id), 'not_found');
});

await test('program: owner only; field work needs territory; quotas cannot exceed target; rate card frozen', () => {
  const base = { title: 'Onboard retailers in Nairobi', templateKey: 'merchant_onboarding', target: 5, unitPriceKes: 300, deadline: future(7) };
  rejects(() => work.createProgram(force.id, supervisor.id, { ...base, territoryIds: [west.id] }), 'forbidden');
  rejects(() => work.createProgram(force.id, owner.id, { ...base, territoryIds: [] }), 'validation_error');
  rejects(() => work.createProgram(force.id, owner.id, { ...base, territoryIds: [west.id], territoryTargets: { [west.id]: 9 } }), 'validation_error');
  rejects(() => work.createProgram(force.id, owner.id, { ...base, territoryIds: [west.id], deadline: '2020-01-01' }), 'validation_error');
  rejects(() => work.createProgram(force.id, owner.id, { ...base, territoryIds: [west.id], unitPriceKes: 12.5 }), 'validation_error');
  program = work.createProgram(force.id, owner.id, { ...base, territoryIds: [west.id, east.id], territoryTargets: { [west.id]: 4 } });
  assert.equal(program.status, 'draft');
  assert.equal(program.mode, 'hybrid');
  assert.equal(program.rateCard.steps[1].feeKes, 180);
});

await test('claiming: drafts are not claimable; eligibility explains itself in words, never a score', () => {
  rejects(() => work.claim(jane.id, program.id), 'not_found');
  program = work.changeProgramStatus(program.id, owner.id, { action: 'publish', revision: program.revision });
  rejects(() => work.changeProgramStatus(program.id, owner.id, { action: 'publish', revision: 1 }), 'stale_revision');
  const e = work.eligibility(jane.id, program, 0);
  assert.equal(e.eligible, true);
  assert.ok(e.reasons.some((r) => r.includes('Briefed on merchant onboarding')));
  assert.ok(e.reasons.includes('Remote — no travel needed'));
  const s = work.eligibility(stranger.id, program, 0);
  assert.equal(s.eligible, false);
  assert.ok(s.blockers.includes('Only members of this workforce can take this work'));
  assert.ok(!JSON.stringify(e).match(/score|percent|%/i));
  // Field step: Amina (home-only) is blocked, Jane placed in West is not.
  const f = work.eligibility(amina.id, program, 1, west.id);
  assert.ok(f.blockers.some((b) => b.includes('do not do field work')));
  assert.ok(work.eligibility(jane.id, program, 1, east.id).blockers.some((b) => b.includes('Not placed in Embakasi')));
  rejects(() => work.claim(stranger.id, program.id), 'not_eligible');
  rejects(() => work.claim(owner.id, program.id), 'not_eligible');
});

let aminaTasks;
await test('claim: batch, territory quota, capacity and idempotent retries', () => {
  aminaTasks = work.claim(amina.id, program.id, { count: 3, territoryId: west.id, idempotencyKey: 'batch-1' });
  assert.equal(aminaTasks.length, 3);
  const retry = work.claim(amina.id, program.id, { count: 3, territoryId: west.id, idempotencyKey: 'batch-1' });
  assert.deepEqual(retry.map((t) => t.id).sort(), aminaTasks.map((t) => t.id).sort());
  // West quota is 4: only one left there.
  rejects(() => work.claim(amina.id, program.id, { count: 2, territoryId: west.id }), 'full');
  rejects(() => work.claim(amina.id, program.id, { count: 11 }), 'validation_error');
  rejects(() => work.claim(amina.id, program.id, { territoryId: 'ter_nope' }), 'not_eligible');
  assert.equal(work.remainingCapacity(program), 2);
  assert.equal(work.remainingCapacity(program, west.id), 1);
});

let clean1, dup, noGate;
await test('proof: hard failures are refused at the door and write nothing', () => {
  [clean1, dup, noGate] = aminaTasks;
  const before = store.all('workProofs').length;
  rejects(() => work.submitProof(amina.id, clean1.id, { fields: { businessName: 'Mama Njeri Shop' } }), 'missing_field');
  rejects(() => work.submitProof(amina.id, clean1.id, { fields: { businessName: 'X', ownerName: 'Y', phone: '999', category: 'z', area: 'a', interested: 'yes' } }), 'invalid_field');
  rejects(() => work.submitProof(amina.id, clean1.id, { fields: { businessName: 'X', ownerName: 'Y', phone: '0711000001', category: 'z', area: 'a', interested: 'maybe' } }), 'invalid_field');
  rejects(() => work.submitProof(jane.id, clean1.id, { fields: {} }), 'not_found');
  assert.equal(store.all('workProofs').length, before);
});

await test('proof: clean submission passes checks; a duplicate phone is flagged, not refused', () => {
  const p1 = work.submitProof(amina.id, clean1.id, { fields: { businessName: 'Mama Njeri Shop', ownerName: 'Njeri', phone: '0711000001', category: 'Groceries', area: 'South C', interested: 'yes' } });
  assert.equal(p1.flags, 0);
  assert.equal(p1.fields.phone, '+254711000001');
  const p2 = work.submitProof(amina.id, dup.id, { fields: { businessName: 'Njeri Two', ownerName: 'Njeri', phone: '+254 711 000 001', category: 'Groceries', area: 'South C', interested: 'yes' } });
  assert.equal(p2.flags, 1);
  assert.ok(p2.checks.some((c) => c.key === 'duplicate' && c.status === 'flag'));
  const p3 = work.submitProof(amina.id, noGate.id, { fields: { businessName: 'Kiosk Baraka', ownerName: 'Otieno', phone: '0711000003', category: 'Airtime', area: 'Madaraka', interested: 'no' } });
  assert.equal(p3.flags, 0);
  rejects(() => work.submitProof(amina.id, clean1.id, { fields: {} }), 'invalid_state');
});

await test('review: never your own; return and reject need a reason; return goes back to the same worker', () => {
  rejects(() => work.reviewTask(jane.id, clean1.id, { decision: 'approve' }), 'forbidden');
  rejects(() => work.reviewTask(supervisor.id, dup.id, { decision: 'reject' }), 'validation_error');
  const r = work.reviewTask(supervisor.id, dup.id, { decision: 'return', reason: 'Same phone as Mama Njeri — confirm the number' });
  assert.equal(r.task.status, 'assigned');
  assert.equal(r.task.workerId, amina.id);
  assert.equal(r.task.returns, 1);
  work.submitProof(amina.id, dup.id, { fields: { businessName: 'Njeri Two', ownerName: 'Njeri', phone: '0711000002', category: 'Groceries', area: 'South C', interested: 'yes' } });
  const t = work.getTask(dup.id);
  assert.equal(t.proofIds.length, 2);
  rejects(() => work.reviewTask(supervisor.id, 'wtk_nope', { decision: 'approve' }), 'not_found');
});

let fieldTask;
await test('hybrid: approving the call opens a field step; a "not interested" gate closes the unit honestly', () => {
  const approved = work.reviewTask(owner.id, clean1.id, { decision: 'approve' });
  assert.equal(approved.unit.status, 'in_progress');
  assert.equal(approved.unit.currentStep, 1);
  assert.equal(approved.unit.subjectLabel, 'Mama Njeri Shop');
  fieldTask = store.find('workTasks', (t) => t.unitId === clean1.unitId && t.stepIndex === 1);
  assert.equal(fieldTask.status, 'open');
  assert.equal(fieldTask.mode, 'field');
  const gated = work.reviewTask(owner.id, noGate.id, { decision: 'approve' });
  assert.equal(gated.unit.status, 'not_converted');
  assert.equal(gated.unit.closedReason, 'Owner was not interested');
  assert.equal(store.find('workTasks', (t) => t.unitId === noGate.unitId && t.stepIndex === 1) ?? null, null);
});

await test('open steps: subject details are private until accepted; ineligible workers cannot accept', () => {
  const homeJane = work.workerHome(jane.id);
  const listed = homeJane.openSteps.find((t) => t.id === fieldTask.id);
  assert.ok(listed, 'Jane (field, West) sees the open visit');
  assert.equal(listed.subject, null);
  assert.equal(listed.subjectLabel, 'Mama Njeri Shop');
  assert.equal(work.workerHome(amina.id).openSteps.find((t) => t.id === fieldTask.id), undefined);
  rejects(() => work.acceptOpenTask(amina.id, fieldTask.id), 'not_eligible');
  const accepted = work.acceptOpenTask(jane.id, fieldTask.id);
  assert.equal(accepted.workerId, jane.id);
  assert.equal(work.taskView(accepted, jane.id).subject.phone, '+254711000001');
  rejects(() => work.acceptOpenTask(supervisor.id, fieldTask.id), 'invalid_state');
});

await test('field proof: photos, location and consent enforced; photos must be your own private work uploads', () => {
  const fields = { locationNote: 'Next to the matatu stage' };
  const consent = { given: true, name: 'Njeri', words: 'Yes, list my shop' };
  rejects(() => work.submitProof(jane.id, fieldTask.id, { fields, location: NEAR, consent }), 'photos_required');
  const foreign = photo(amina.id);
  rejects(() => work.submitProof(jane.id, fieldTask.id, { fields, photos: [foreign, photo(jane.id)], location: NEAR, consent }), 'invalid_photo');
  const pub = photo(jane.id, 'public');
  rejects(() => work.submitProof(jane.id, fieldTask.id, { fields, photos: [pub, photo(jane.id)], location: NEAR, consent }), 'invalid_photo');
  const a = photo(jane.id), b = photo(jane.id);
  rejects(() => work.submitProof(jane.id, fieldTask.id, { fields, photos: [a, b], consent }), 'location_required');
  rejects(() => work.submitProof(jane.id, fieldTask.id, { fields, photos: [a, b], location: NEAR, consent: { given: true } }), 'consent_required');
  const proof = work.submitProof(jane.id, fieldTask.id, { fields, photos: [a, b], location: NEAR, consent });
  const terr = proof.checks.find((c) => c.key === 'territory');
  assert.equal(terr.status, 'pass');
  assert.equal(proof.flags, 0);
  // Photos in a proof cannot be deleted out of the record.
  assert.equal(uploads.deleteUpload(a, jane.id).code, 'evidence_in_use');
});

await test('outcome: approving the last step approves the unit; earnings become payable, derived', () => {
  // Before approval, Amina's call is earned-but-awaiting-outcome.
  let ea = work.earnings(amina.id);
  const callRow = ea.rows.find((r) => r.taskId === clean1.id);
  assert.equal(callRow.state, 'awaiting_outcome');
  assert.equal(ea.payableKes, 0);
  // The not-interested unit's call is honestly not payable.
  assert.equal(ea.rows.find((r) => r.taskId === noGate.id).state, 'outcome_failed');

  rejects(() => work.reviewTask(jane.id, fieldTask.id, { decision: 'approve' }), 'forbidden');
  const r = work.reviewTask(supervisor.id, fieldTask.id, { decision: 'approve' });
  assert.equal(r.unit.status, 'approved');
  ea = work.earnings(amina.id);
  assert.equal(ea.rows.find((r2) => r2.taskId === clean1.id).state, 'payable');
  assert.equal(ea.payableKes, 60);
  const ej = work.earnings(jane.id);
  assert.equal(ej.payableKes, 180);
  // No balance is stored anywhere on the worker's rows.
  for (const row of [wf.getProfile(jane.id), store.find('workforceMembers', (m) => m.userId === jane.id)]) {
    assert.ok(!Object.keys(row).some((k) => /balance|earn|wallet|kes/i.test(k)));
  }
});

await test('photo reuse across units is refused', () => {
  const t = work.claim(jane.id, program.id, { territoryId: west.id })[0];
  work.submitProof(jane.id, t.id, { fields: { businessName: 'Reuse Test', ownerName: 'R', phone: '0711000009', category: 'c', area: 'a', interested: 'yes' } });
  work.reviewTask(owner.id, t.id, { decision: 'approve' });
  const next = store.find('workTasks', (x) => x.unitId === t.unitId && x.stepIndex === 1);
  work.acceptOpenTask(jane.id, next.id);
  const used = store.find('workProofs', (p) => p.taskId === fieldTask.id).photos[0];
  rejects(() => work.submitProof(jane.id, next.id, { fields: { locationNote: 'x' }, photos: [used, photo(jane.id)], location: NEAR, consent: { given: true, name: 'R' } }), 'photo_reused');
  // Outside the territory is a flag, and weak accuracy is a flag.
  const p = work.submitProof(jane.id, next.id, { fields: { locationNote: 'x' }, photos: [photo(jane.id), photo(jane.id)], location: { ...FAR, accuracyM: 400 }, consent: { given: true, name: 'R' } });
  assert.equal(p.checks.find((c) => c.key === 'territory').status, 'flag');
  assert.equal(p.checks.find((c) => c.key === 'accuracy').status, 'flag');
  const r = work.reviewTask(owner.id, next.id, { decision: 'reject', reason: 'Location is 30 km outside Nairobi West' });
  assert.equal(r.unit.status, 'rejected');
  assert.equal(work.earnings(jane.id).rows.find((x) => x.taskId === t.id).state, 'outcome_failed');
});

await test('review queue sorts clean first; approve-clean skips flagged and own work', () => {
  const [a, b] = work.claim(amina.id, program.id, { count: 2, territoryId: east.id });
  work.submitProof(amina.id, a.id, { fields: { businessName: 'Clean Co', ownerName: 'C', phone: '0711000011', category: 'c', area: 'Pipeline', interested: 'yes' } });
  work.submitProof(amina.id, b.id, { fields: { businessName: 'Dup Co', ownerName: 'D', phone: '0711000011', category: 'c', area: 'Pipeline', interested: 'yes' } });
  const q = work.reviewQueue(force.id, owner.id);
  const mine = q.filter((x) => [a.id, b.id, dup.id].includes(x.taskId));
  assert.ok(mine.length >= 2);
  assert.ok(q[0].proof.flags <= q[q.length - 1].proof.flags);
  assert.ok(q.every((x) => typeof x.worker.record === 'string'));
  const res = work.approveClean(owner.id, force.id);
  assert.ok(res.approved >= 1);
  assert.equal(work.getTask(a.id).status, 'approved');
  assert.equal(work.getTask(b.id).status, 'submitted');
  rejects(() => work.reviewQueue(force.id, jane.id), 'forbidden');
});

await test('track record is capability-specific counts with sample size, never a score', () => {
  const rec = work.trackRecord(jane.id);
  const mo = rec.byTemplate.find((r) => r.templateKey === 'merchant_onboarding');
  assert.equal(mo.approved, 2);
  assert.equal(mo.rejected, 1);
  assert.match(mo.statement, /submitted · 2 approved · 1 rejected/);
  assert.ok(!/score|rating|trust/i.test(JSON.stringify(rec.byTemplate)));
});

await test('dashboard: every number derived; committed/verified money follows approved units', () => {
  const d = work.programDashboard(program.id, supervisor.id);
  assert.equal(d.counts.approved, 1);
  assert.equal(d.counts.notConverted, 1);
  assert.equal(d.counts.rejected, 1);
  assert.equal(d.money.committedKes, 5 * 300);
  assert.equal(d.money.verifiedKes, 300);
  assert.equal(d.money.workerKes + d.money.briefFeeKes, d.money.verifiedKes);
  assert.equal(d.progressPct, 20);
  assert.equal(d.coverage.find((c) => c.territoryId === west.id).approved, 1);
  rejects(() => work.programDashboard(program.id, jane.id), 'forbidden');
  rejects(() => work.programDashboard(program.id, stranger.id), 'not_found');
});

await test('settlement: only ended weeks; exact ledger amount; finance-confirmed; no self-dealing; refusal reopens', () => {
  const week = isoWeekOf(new Date().toISOString());
  rejects(() => work.requestSettlement(finance.id, jane.id, week), 'week_open');
  // Move Jane's approved outcome into last week (as if approved then).
  const lastWeek = new Date(Date.now() - 7 * 86400000).toISOString();
  const unit = store.find('workUnits', (u) => u.id === fieldTask.unitId);
  store.update('workUnits', unit.id, { decidedAt: lastWeek });
  const wk = isoWeekOf(lastWeek);
  rejects(() => work.requestSettlement(jane.id, jane.id, wk), 'self_settlement');
  const cands = work.settlementCandidates();
  assert.ok(cands.some((c) => c.workerId === jane.id && c.week === wk && c.amountKes === 180));
  const s = work.requestSettlement(finance.id, jane.id, wk);
  assert.equal(s.amountKes, 180);
  const tx = store.find('ledgerTransactions', (t) => t.id === s.ledgerId);
  assert.equal(tx.type, 'work_task_fee');
  assert.equal(tx.status, 'pending');
  assert.equal(tx.amount, 180);
  rejects(() => work.requestSettlement(finance.id, jane.id, wk), 'no_activity');
  rejects(() => work.decideSettlement(s.id, finance.id, { accept: false, note: '' }), 'validation_error');
  work.decideSettlement(s.id, finance.id, { accept: false, note: 'Wrong week, redo' });
  assert.equal(store.find('ledgerTransactions', (t) => t.id === s.ledgerId).status, 'failed');
  const s2 = work.requestSettlement(finance.id, jane.id, wk);
  work.decideSettlement(s2.id, finance.id, { accept: true });
  assert.equal(store.find('ledgerTransactions', (t) => t.id === s2.ledgerId).status, 'confirmed');
  const e = work.earnings(jane.id);
  assert.equal(e.confirmedKes, 180);
  assert.equal(e.rows.find((r) => r.taskId === fieldTask.id).settlementStatus, 'confirmed');
  rejects(() => work.decideSettlement(s2.id, finance.id, { accept: true }), 'invalid_state');
});

await test('expiry: a held first step past its window is released and its slot abandoned', () => {
  const [t] = work.claim(amina.id, program.id, { territoryId: east.id });
  store.update('workTasks', t.id, { dueAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(work.sweepExpired(), 1);
  assert.equal(work.getTask(t.id).status, 'released');
  assert.equal(store.find('workUnits', (u) => u.id === t.unitId).status, 'abandoned');
  rejects(() => work.submitProof(amina.id, t.id, { fields: {} }), 'invalid_state');
});

await test('suspension: needs a reason, returns held tasks, blocks new claims; reinstate restores', () => {
  const [held] = work.claim(amina.id, program.id, { territoryId: east.id });
  rejects(() => wf.memberAction(force.id, supervisor.id, mAmina.id, { action: 'suspend' }), 'validation_error');
  wf.memberAction(force.id, supervisor.id, mAmina.id, { action: 'suspend', reason: 'Duplicate submissions under review' }, { onRelease: (m, why) => work.releaseHeldFor(m, why) });
  assert.equal(work.getTask(held.id).status, 'released');
  const err = (() => { try { work.claim(amina.id, program.id, { territoryId: east.id }); } catch (e) { return e; } })();
  assert.equal(err.code, 'not_eligible');
  assert.ok(err.blockers.includes('Your membership is suspended'));
  wf.memberAction(force.id, owner.id, mAmina.id, { action: 'reinstate', reason: 'Cleared' });
  assert.equal(work.eligibility(amina.id, work.getProgram(program.id), 0).eligible, true);
});

await test('closing a program withdraws unclaimed next steps but leaves held work alone', () => {
  const p2 = work.changeProgramStatus(
    work.createProgram(force.id, owner.id, { title: 'Second batch', templateKey: 'merchant_onboarding', target: 3, unitPriceKes: 200, deadline: future(3), territoryIds: [west.id] }).id,
    owner.id, { action: 'publish' });
  const [a, b] = work.claim(amina.id, p2.id, { count: 2, territoryId: west.id });
  for (const [t, phone] of [[a, '0711000021'], [b, '0711000022']]) {
    work.submitProof(amina.id, t.id, { fields: { businessName: 'Shop ' + phone, ownerName: 'O', phone, category: 'c', area: 'a', interested: 'yes' } });
    work.reviewTask(owner.id, t.id, { decision: 'approve' });
  }
  const nextA = store.find('workTasks', (t) => t.unitId === a.unitId && t.stepIndex === 1);
  const nextB = store.find('workTasks', (t) => t.unitId === b.unitId && t.stepIndex === 1);
  work.acceptOpenTask(jane.id, nextA.id);
  work.changeProgramStatus(p2.id, owner.id, { action: 'close' });
  assert.equal(work.getTask(nextB.id).status, 'released');
  assert.equal(store.find('workUnits', (u) => u.id === b.unitId).status, 'abandoned');
  assert.equal(work.getTask(nextA.id).status, 'assigned');
  rejects(() => work.claim(amina.id, p2.id), 'invalid_state');
});

await test('network programs: a non-member with a matching declared area can take field work', () => {
  const nomad = user('wf_nomad');
  completeProfile(nomad, ['field'], ['Pipeline']);
  wf.acknowledgeBriefing(nomad.id, 'merchant_verification');
  const p = work.changeProgramStatus(work.createProgram(force.id, owner.id, {
    title: 'Verify Embakasi shops', templateKey: 'merchant_verification', target: 2, unitPriceKes: 150,
    deadline: future(5), territoryIds: [east.id], audience: 'network'
  }).id, owner.id, { action: 'publish' });
  const e = work.eligibility(nomad.id, p, 0);
  assert.equal(e.eligible, true, e.blockers.join('; '));
  assert.ok(e.reasons.includes('Open to the Brief worker network'));
  assert.ok(e.reasons.some((r) => r.startsWith('In Embakasi')));
  assert.ok(work.workerHome(nomad.id).available.some((x) => x.program.id === p.id && x.eligible));
  const [t] = work.claim(nomad.id, p.id);
  assert.equal(store.find('workUnits', (u) => u.id === t.unitId).territoryId, east.id);
  // Territory without a map area: location recorded but honestly not checked.
  const proof = work.submitProof(nomad.id, t.id, { fields: { businessName: 'Pipeline Hardware', trading: 'yes', observed: 'Open, stocked, two staff' }, photos: [photo(nomad.id)], location: FAR });
  assert.equal(proof.checks.find((c) => c.key === 'territory').status, 'not_checked');
});

// ---------------------------------------------------------------------------
// HTTP — real sessions, identity from the session only.
// ---------------------------------------------------------------------------
const { default: app } = await import('../src/index.js');
const server = app.listen(0);
const call = async (path, token, method = 'GET', body) => {
  const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
};
const register = async (handle) => (await call('/api/auth/register', null, 'POST', { handle, password: 'a long test passphrase' })).body;

try {
  const boss = await register('wfh_boss');
  const worker = await register('wfh_worker');
  const outsider = await register('wfh_outsider');
  const fin = await register('wfh_finance');
  store.update('users', fin.user.id, { platformRoles: ['finance'] });

  await test('HTTP: auth required; body identities are ignored', async () => {
    assert.equal((await call('/api/me/work')).status, 401);
    assert.equal((await call('/api/workforces', null, 'POST', { name: 'X' })).status, 401);
    const r = await call('/api/workforces', boss.token, 'POST', { name: 'HTTP Team', ownerId: outsider.user.id });
    assert.equal(r.status, 201);
    assert.equal(r.body.workforce.ownerId, boss.user.id);
  });

  await test('HTTP: full loop — onboard, territory, program, claim, submit, review, dashboard, finance', async () => {
    const forces = (await call('/api/workforces', boss.token)).body.workforces;
    const f = forces.find((x) => x.name === 'HTTP Team');
    assert.ok(f.joinCode);
    const ter = (await call(`/api/workforces/${f.id}/territories`, boss.token, 'POST', { name: 'Westlands', lat: -1.265, lng: 36.805, radiusKm: 4 })).body.territory;
    const join = await call('/api/me/work/join', worker.token, 'POST', { code: f.joinCode });
    assert.equal(join.status, 201);
    assert.equal((await call('/api/me/work/profile', worker.token, 'PUT', { displayName: 'Wanjiru', phone: '0799111222', modes: ['home', 'field'], device: { gps: true, smartphone: true } })).status, 200);
    const terms = (await call('/api/work-templates', worker.token)).body.terms;
    assert.equal((await call('/api/me/work/terms', worker.token, 'POST', { version: terms.version })).status, 200);
    assert.equal((await call('/api/me/work/briefings', worker.token, 'POST', { templateKey: 'merchant_verification' })).status, 200);

    // Outsider cannot see the desk (404), worker (applied) cannot manage.
    assert.equal((await call(`/api/workforces/${f.id}`, outsider.token)).status, 404);
    const desk = (await call(`/api/workforces/${f.id}`, boss.token)).body;
    const member = desk.members.find((m) => m.userId === worker.user.id);
    const act = await call(`/api/workforces/${f.id}/members/${member.memberId}/actions`, boss.token, 'POST', { action: 'activate' });
    assert.equal(act.status, 409);
    assert.ok(act.body.missing.some((m) => m.includes('territory')));
    await call(`/api/workforces/${f.id}/members/${member.memberId}/actions`, boss.token, 'POST', { action: 'assign_territories', territoryIds: [ter.id] });
    assert.equal((await call(`/api/workforces/${f.id}/members/${member.memberId}/actions`, boss.token, 'POST', { action: 'activate' })).status, 200);

    const created = await call(`/api/workforces/${f.id}/programs`, boss.token, 'POST', { title: 'Verify Westlands shops', templateKey: 'merchant_verification', target: 2, unitPriceKes: 250, deadline: future(4), territoryIds: [ter.id] });
    assert.equal(created.status, 201);
    const pid = created.body.program.id;
    assert.equal((await call(`/api/work-programs/${pid}/status`, worker.token, 'POST', { action: 'publish' })).status, 403);
    assert.equal((await call(`/api/work-programs/${pid}/status`, boss.token, 'POST', { action: 'publish' })).status, 200);

    const home = (await call('/api/me/work', worker.token)).body;
    const card = home.available.find((a) => a.program.id === pid);
    assert.equal(card.eligible, true);
    assert.equal(card.firstStep.feeKes, 200);
    const claimed = await call(`/api/work-programs/${pid}/claim`, worker.token, 'POST', { count: 1 });
    assert.equal(claimed.status, 201);
    const tid = claimed.body.tasks[0].id;
    // Upload through the real media route as private work evidence.
    const form = new FormData();
    form.append('file', new Blob([Buffer.concat([png, Buffer.from('http-proof')])], { type: 'image/png' }), 'shop.png');
    form.append('purpose', 'private_work');
    const up = await fetch(`http://127.0.0.1:${server.address().port}/api/media/upload`, { method: 'POST', headers: { authorization: `Bearer ${worker.token}` }, body: form });
    const uploadId = (await up.json()).upload.id;
    const bad = await call(`/api/work-tasks/${tid}/submit`, worker.token, 'POST', { fields: { businessName: 'Sarit Kiosk', trading: 'yes', observed: 'Open' }, photos: [uploadId] });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'location_required');
    const sub = await call(`/api/work-tasks/${tid}/submit`, worker.token, 'POST', { fields: { businessName: 'Sarit Kiosk', trading: 'yes', observed: 'Open and trading' }, photos: [uploadId], location: { lat: -1.262, lng: 36.802, accuracyM: 10 } });
    assert.equal(sub.status, 201);
    assert.equal(sub.body.task.status, 'submitted');

    // Evidence bytes: reviewer yes, outsider no.
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/media/file/${uploadId}`, { headers: { authorization: `Bearer ${boss.token}` } })).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/media/file/${uploadId}`, { headers: { authorization: `Bearer ${outsider.token}` } })).status, 404);

    const queue = (await call(`/api/workforces/${f.id}/review`, boss.token)).body.queue;
    assert.equal(queue.length, 1);
    assert.equal(queue[0].proof.flags, 0);
    assert.equal((await call(`/api/work-tasks/${tid}/review`, outsider.token, 'POST', { decision: 'approve' })).status, 404);
    const rev = await call(`/api/work-tasks/${tid}/review`, boss.token, 'POST', { decision: 'approve' });
    assert.equal(rev.status, 200);
    assert.equal(rev.body.unit.status, 'approved');
    const dash = (await call(`/api/work-programs/${pid}`, boss.token)).body;
    assert.equal(dash.money.verifiedKes, 250);
    const after = (await call('/api/me/work', worker.token)).body;
    assert.equal(after.earnings.payableKes, 200);
    assert.equal(after.today.approved, 1);

    // Finance surface is capability-gated.
    assert.equal((await call('/api/ops/workforce-settlements', worker.token)).status, 403);
    const ops = await call('/api/ops/workforce-settlements', fin.token);
    assert.equal(ops.status, 200);
    assert.ok(Array.isArray(ops.body.candidates));
    const open = await call('/api/ops/workforce-settlements', fin.token, 'POST', { workerId: worker.user.id, week: isoWeekOf(new Date().toISOString()) });
    assert.equal(open.status, 409);
    assert.equal(open.body.code, 'week_open');
  });

  await test('HTTP: place-and-activate is one atomic step; program responses are headlines', async () => {
    const lead = await register('wfh_lead');
    const recruit = await register('wfh_recruit');
    const team = (await call('/api/workforces', lead.token, 'POST', { name: 'Atomic Team' })).body.workforce;
    const zone = (await call(`/api/workforces/${team.id}/territories`, lead.token, 'POST', { name: 'Kilimani', areas: ['Kilimani'] })).body.territory;
    await call('/api/me/work/profile', recruit.token, 'PUT', { displayName: 'Recruit', phone: '0722000111', modes: ['field'], device: { smartphone: true, gps: true }, availableDays: [1, 2, 3] });
    const terms = (await call('/api/work-templates', recruit.token)).body.terms;
    await call('/api/me/work/terms', recruit.token, 'POST', { version: terms.version });
    await call('/api/me/work/briefings', recruit.token, 'POST', { templateKey: 'merchant_onboarding' });
    const joined = (await call('/api/me/work/join', recruit.token, 'POST', { code: team.joinCode })).body.membership;
    const path = `/api/workforces/${team.id}/members/${joined.id}/actions`;
    // Field worker with no territory: plain activate is refused and names what is missing.
    const refused = await call(path, lead.token, 'POST', { action: 'activate' });
    assert.equal(refused.status, 409);
    assert.deepEqual(refused.body.missing, ['Placed in a territory']);
    // A foreign territory id is refused and nothing is written.
    const bad = await call(path, lead.token, 'POST', { action: 'activate', territoryIds: ['wtr_nope'] });
    assert.equal(bad.status, 404);
    let row = store.find('workforceMembers', (x) => x.id === joined.id);
    assert.equal(row.status, 'applied');
    assert.deepEqual(row.territoryIds, []);
    // Placing and activating together works, and both are in the history.
    const ok = await call(path, lead.token, 'POST', { action: 'activate', territoryIds: [zone.id] });
    assert.equal(ok.status, 200);
    row = store.find('workforceMembers', (x) => x.id === joined.id);
    assert.equal(row.status, 'active');
    assert.deepEqual(row.territoryIds, [zone.id]);
    assert.deepEqual(row.history.slice(-2).map((h) => h.action), ['assign_territories', 'activate']);
    // Create and publish return the same headline the desk reads.
    const deadline = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const created = (await call(`/api/workforces/${team.id}/programs`, lead.token, 'POST', { title: 'Kilimani shops', templateKey: 'merchant_verification', target: 3, unitPriceKes: 200, deadline, audience: 'workforce', territoryIds: [zone.id] })).body.program;
    for (const k of ['workforceName', 'templateLabel', 'unitNoun', 'territories', 'rateCard', 'revision']) assert.ok(k in created, k);
    assert.equal(created.workforceName, 'Atomic Team');
    assert.deepEqual(created.territories.map((t) => t.name), ['Kilimani']);
    const published = (await call(`/api/work-programs/${created.id}/status`, lead.token, 'POST', { action: 'publish', revision: created.revision })).body.program;
    assert.equal(published.status, 'open');
    assert.equal(published.templateLabel, created.templateLabel);
  });

  await test('HTTP: consequential actions leave audit rows', async () => {
    const actions = store.all('auditLog').map((a) => a.action);
    for (const a of ['workforce_created', 'workforce_member_activate', 'work_program_created', 'work_program_publish', 'work_task_approve']) {
      assert.ok(actions.includes(a), `missing audit ${a}`);
    }
  });
} finally {
  await new Promise((r) => server.close(r));
}

console.log(`\nPASS ${count}`);
process.exit(0);
