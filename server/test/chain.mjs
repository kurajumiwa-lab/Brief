#!/usr/bin/env node
// ---------------------------------------------------------------------------
// THE SERVER TEST CHAIN — every suite, one honest total.
//
// WHY THIS EXISTS
//
//   `npm test` used to be one long `&&` chain. Fail-fast sounds disciplined and
//   is actually a way to hide work: ONE broken suite stops the chain, and every
//   suite behind it neither runs nor appears anywhere in the output. That is
//   not hypothetical — it is how this repository spent months measuring far
//   less than it claimed:
//
//     * `test/businessFeed.mjs` spawned a child process with
//       `cwd: process.cwd()` and a specifier of './server/src/domain/...'.
//       Run from the repo root that resolves; `npm test` runs with cwd=server/,
//       so it asked for server/server/src/... and died. The fifty-three suites
//       after it never ran.
//     * Six suites were in no list at all: engine, huduma, livecamp,
//       orchestration, stories, yard-loop — 387+ passing checks that could not
//       fail, because nothing ran them.
//
//   This runner runs everything, names every failure, prints what was actually
//   measured, and exits non-zero if anything failed. It exists for the same
//   reason preview/run-suites.sh does, on the server side: a suite that never
//   runs cannot fail, and that is the same class of lie as a test that cannot
//   fail (see test/harness.mjs, which was written for the same offence).
//
// THE ORPHAN GUARD
//
//   A test file in neither list fails the chain BY NAME, and a listed suite
//   that no longer exists fails too. Forgetting to add a suite is how a suite
//   stops existing; a rename is how a suite silently leaves the chain.
//
// Usage:
//   npm test                      run everything
//   node test/chain.mjs engine    run only suites whose path matches "engine"
//   node test/chain.mjs --list    print the plan without running it
// ---------------------------------------------------------------------------

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;            // .../server/test
const SERVER = path.dirname(HERE);           // .../server — the cwd `npm test` implies
const TIMEOUT_MS = Number(process.env.BRIEF_TEST_TIMEOUT_MS) || 300_000;

/**
 * The order is deliberate: run.js is the broadest suite and fails fastest, and
 * the feature suites follow roughly in the order a user meets them. New suites
 * go at the end so adding one never disturbs what came before.
 */
const SUITES = [
  'test/run.js',
  'test/discovery.mjs',
  'test/feed-experience.mjs',
  'test/trust.mjs',
  'test/personal.mjs',
  'test/entities.mjs',
  'test/graph.mjs',
  'test/collections.mjs',
  'test/notifications.mjs',
  'test/spaces.mjs',
  'test/requests.mjs',
  'test/supply.mjs',
  'test/matching.mjs',
  'test/quotes.mjs',
  'test/workOrders.mjs',
  'test/listingEdits.mjs',
  'test/procurement.mjs',
  'test/participantTrust.mjs',
  'test/workPayment.mjs',
  'test/attribution.mjs',
  'test/partner.mjs',
  'test/fieldAgent.mjs',
  'test/workforce.mjs',
  'test/adminMembers.mjs',
  'test/orderTracking.mjs',
  'test/productReviews.mjs',
  'test/businessFeed.mjs',
  'test/lipaMdogo.mjs',
  'test/tableBanking.mjs',
  'test/integrity.mjs',
  'test/tableBankingLoop.mjs',
  'test/tableBankingWelfare.mjs',
  'test/tableBankingMinutes.mjs',
  'test/tableBankingTemplates.mjs',
  'test/tableBankingOps.mjs',
  'test/tableBankingInvites.mjs',
  'test/quoteVotes.mjs',
  'test/circleRoom.mjs',
  'test/guardians.mjs',
  'test/tableBankingTreasurer.mjs',
  'test/minutesPdf.mjs',
  'test/eventExpiry.mjs',
  'test/spaceLifecycle.mjs',
  'test/spaceHealth.mjs',
  'test/pickups.mjs',
  'test/roles.mjs',
  'test/invites.mjs',
  'test/tableBankingArchive.mjs',
  'test/gaps.mjs',
  'test/priceSignals.mjs',
  'test/eventDetail.mjs',
  'test/eventWithdrawal.mjs',
  'test/whatsappOutbound.mjs',
  'test/spaceHttpAuth.mjs',
  'test/pulse.mjs',
  'test/spaceProfile.mjs',
  'test/spaceEditsAfterPublish.mjs',
  'test/spaceModes.mjs',
  'test/spaceMoneyScope.mjs',
  'test/stockLog.mjs',
  'test/shopBrief.mjs',
  'test/plannedWeather.mjs',
  'test/errands.mjs',
  'test/errandKinds.mjs',
  'test/spaceAudience.mjs',
  'test/spacePublicPage.mjs',
  'test/flows.mjs',
  'test/discoverSummary.mjs',
  'test/worldSignal.mjs',
  'test/position.mjs',
  'test/commitments.mjs',
  'test/reciprocity.mjs',
  'test/precedent.mjs',
  'test/decisions.mjs',
  'test/settlement/manual.mjs',
  'test/integration.mjs',
  'test/groups.mjs',
  'test/shopTeam.mjs',
  'test/spaceModeration.mjs',
  'test/engine.mjs',
  'test/huduma.mjs',
  'test/livecamp.mjs',
  'test/orchestration.mjs',
  'test/stories.mjs',
  'test/yard-loop.mjs',
];

/**
 * Files that look like suites and are not, each with the reason it is excluded.
 * Keeping the reasons here is what stops the next reader from "fixing" the list
 * by adding them, and stops a real suite from hiding among them.
 */
const NOT_SUITES = {
  'test/chain.mjs': 'this runner — it runs suites, it is not one',
  'test/harness.mjs': 'the shared harness — suites import it; it asserts nothing by itself',
  'test/test-env.mjs': 'the isolation preload — imported FIRST by suites that need a private store',
  'test/group-fixtures.mjs': 'group setup imported by the group suites, not a suite',
  'test/.apiclient.mjs': 'generated typed client used BY livecamp.mjs, not a suite'
};

// --- orphan guard -----------------------------------------------------------
// Every runnable file under test/ must be in one of the two lists. Dotfiles are
// libraries by convention (.apiclient.mjs) and are listed above anyway.

function discover(dir, prefix = 'test') {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...discover(full, rel));
    else if (/\.(mjs|js)$/.test(entry.name)) found.push(rel);
  }
  return found;
}

function guard() {
  const problems = [];
  const known = new Set([...SUITES, ...Object.keys(NOT_SUITES)]);
  for (const file of discover(HERE)) {
    if (!known.has(file)) problems.push(`  ${file}  is in neither list — add it to SUITES or NOT_SUITES (with a reason)`);
  }
  for (const suite of SUITES) {
    if (!fs.existsSync(path.join(SERVER, suite))) problems.push(`  ${suite}  is listed but does not exist — a rename must not silently shrink the chain`);
  }
  return problems;
}

// --- running ----------------------------------------------------------------

/** Pull a check count out of the several summary formats these suites print. */
function summarise(out) {
  const a = out.match(/PASSED\s+(\d+)\s+FAILED\s+(\d+)/);
  if (a) return { checks: Number(a[1]), failed: Number(a[2]) };
  const b = out.match(/^\s*PASS\s+(\d+)(?:\s+FAILED\s+(\d+))?\s*$/m);
  if (b) return { checks: Number(b[1]), failed: Number(b[2] ?? 0) };
  const c = out.match(/(\d+)\s+checks?\s+passed/i);
  if (c) return { checks: Number(c[1]), failed: 0 };
  return null;
}

const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const filters = args.filter((a) => !a.startsWith('--'));
const selected = filters.length ? SUITES.filter((s) => filters.some((f) => s.includes(f))) : SUITES;

if (listOnly) {
  console.log(selected.map((s) => '  ' + s).join('\n'));
  console.log(`\n${selected.length} suite(s)`);
  process.exit(0);
}

const problems = guard();
if (problems.length) {
  console.log('THE CHAIN IS MISCONFIGURED:\n' + problems.join('\n'));
  process.exit(2);
}

console.log(`Running ${selected.length} server suite(s)...\n`);

const failures = [];
let checked = 0;
let passed = 0;
const started = Date.now();

for (const suite of selected) {
  const t0 = Date.now();
  // cwd is the server package, explicitly: the old chain inherited whatever
  // directory npm was in, which is what let a working directory decide whether
  // a suite passed.
  const run = spawnSync(process.execPath, [suite], {
    cwd: SERVER,
    env: process.env,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024
  });
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const summary = summarise(out);
  if (summary) checked += summary.checks;

  const timedOut = run.error?.code === 'ETIMEDOUT';
  const ok = !timedOut && run.status === 0;
  const label = suite.replace(/^test\//, '').padEnd(26);

  if (ok) {
    passed++;
    console.log(`  ✓ ${label}${summary ? String(summary.checks).padStart(5) + ' checks' : '         ok'}   ${seconds}s`);
    continue;
  }

  const why = timedOut ? `timed out after ${TIMEOUT_MS / 1000}s` : `exit ${run.status}`;
  console.log(`  ✗ ${label}  ${why}   ${seconds}s`);
  for (const line of out.split('\n').filter((l) => /^\s*(FAIL|FAILURES)/.test(l)).slice(0, 6)) {
    console.log(`      ${line.trim()}`);
  }
  failures.push({ suite, why, tail: out.trim().split('\n').slice(-12) });
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log('\n' + '-'.repeat(72));
console.log(`${selected.length} suites · ${passed} passed · ${failures.length} failed · ${checked} checks · ${seconds}s`);

if (failures.length) {
  console.log('\nWHAT FAILED, WITH ITS LAST WORDS:');
  for (const f of failures) {
    console.log(`\n  ${f.suite} (${f.why})`);
    for (const line of f.tail) console.log(`    ${line}`);
  }
  console.log('\nRESULT: NOT GREEN');
  process.exit(1);
}

console.log('RESULT: GREEN');
