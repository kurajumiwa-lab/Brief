# The event/state engine — what Brief already has, what it is missing, and the one piece built today

**Branch:** `arena/01a0e5ae-brief`

You asked for the layer underneath the UI: the edge/event boundary, the state
machines, the tables, the workers — and for events to be editable and
withdrawable because an offer can be taken back. This document answers that
against **this** codebase rather than in the abstract. It has five parts:

1. the architecture you drew, mapped onto what is already here (with file paths) — §1;
2. the honest gap list — what the diagram needs and this repo does not have — §2;
3. the piece that is already built: **withdrawal is a state, not a delete**, plus
   post-publication edits that are recorded and, when they change the deal,
   announced — §3;
4. **the design you asked for**: the event schema, the state machines, the
   database tables, the worker processes and the automation frontier — §4–§9;
5. the build order, as commits — §10.

---

## 1. Your diagram, against this repository

The good news: this repo is not a pile of cron jobs. It is already closer to
your diagram than it looks, under different names.

| Your block | What exists here | Where |
|---|---|---|
| Edge / inputs | HTTP routes (74 route modules), webhooks for payment providers, Telegram/WhatsApp connectors, public registration routes | `server/src/routes/`, `server/src/connectors/` |
| Event intake | `rawItems` → `pipeline/ingest.js` → `objects`; `queue.enqueue()` for work that must not block a 200 | `server/src/queue.js`, `server/src/pipeline/` |
| Event bus | **`signals`** — an append-only log of things that really happened, ~150 named types, never emitted by a render | `server/src/domain/signal.js` |
| Fan-out to consumers | The Universal Data Router: every signal is matched against the owner's routing rules and dispatched (webhook/Discord/Slack) with a **delivery ledger** | `server/src/domain/engine/router.js`, `sync.js` |
| Automation rules | **`workflow.js`**: trigger (a signal type) → conditions → actions (`notify`/`tag`/`blast`), swept every 60s, deduped by `(workflowId, signalId)` in `workflowRuns` | `server/src/domain/workflow.js`, `routes/workflow.js` |
| Rules / tiers | Access tiers enforced server-side (sync interval, route caps) | `server/src/domain/engine/tiers.js` |
| Durable state machines | Listings, campaigns, registrations, tickets, orders, ledger, settlement attempts — every one an explicit status set with a legal-transition table | `domain/listing.js`, `domain/campaign.js`, `domain/orderTracking.js`, `domain/ledger.js` |
| Action executor | `setRegistrationStatus`, `transitionTransaction`, `consumeStock`, `voidTicket`, `dispatchForSignal` | the domain modules above |
| Dead-letter → human | `settlementEscalations` (one open escalation per stuck attempt, closed only by a person), `queue` failures written to `errors`, disputes/attention walls | `settlement/reconciler.js`, `routes/ops.js` |
| Human escalation as a state | present for settlement and moderation (`settlementAttempts`, `spaceAbuseReports`), **not** generalised | see §2 |
| Event replay | the raw material is there (`signals`, `ledgerTransactions.history`, `listingRevisions`, `circleRevisions`) — but **nothing rebuilds state from it** | see §2 |

Two properties are already true and worth protecting:

* **Derived, never stored.** Counts, totals, capacity, revenue and trust are
  computed from rows on read. There is no writable counter anywhere in
  `campaign.js` or `listing.js`, which is why a replay is even conceivable.
* **Rows over claims.** A payment is a `ledgerTransactions` row, not a flag on
  a registration; a registration is promoted only by a *settled* transaction
  (`promoteRegistrationForSettledTransaction`), never by a client saying so.

## 2. What is genuinely missing

Ranked by how much damage the absence does:

1. **Idempotency is per-feature, not a boundary.** `huduma`, `lipaMdogo`,
   `matching` and `externalPlaces` each invented their own `idempotencyKey`
   check. `signals` has no dedupe key at all, and neither does the generic
   write path. A webhook that retries three times is three rows.
   *Smallest honest fix:* an `intakeEvents` collection keyed by
   `(source, idempotency_key)` where the *key* is mandatory and the handler
   returns the first outcome; route handlers call `intake.once(key, fn)`.
2. **The runner exists — it is narrow, and it has a live defect.** `workflow.js`
   is genuinely trigger → condition → action over the signal log, swept every
   60 seconds, deduped by `(workflowId, signalId)` in `workflowRuns`. It is not
   missing; it is blind in three specific ways:
   * **A 500-signal window with no cursor.** `sweep()` reads
     `store.all('signals').slice(-limit)`, `limit = 500`. More than five hundred
     signals between two sweeps — a busy hour, or a restart during a burst —
     and the older ones are **never processed, with no record that they were
     skipped**. This is a defect in the running system, not a design preference.
   * **Its actions cannot reach a state machine or the money.** The registry is
     `notify`, `tag`, `blast`. Nothing can close a campaign, settle a work order
     or open a review, so the loop in your diagram stops one step short of *new
     event*.
   * **Failures are recorded and then abandoned.** A failed action is a line
     inside `workflowRuns[].results[]`; a *thrown* action escapes `sweep()` into
     `installSweep()`'s empty `.catch()`, so no run row is written at all and the
     next tick re-runs the actions that already succeeded — a second
     notification to the same person.
   *Smallest honest fix:* keep the engine and add the cursor; widen the action
   registry to named domain transitions and ledger moves; give the run row
   `attempt`/`status`/`nextRetryAt`; promote exhausted runs into `deadLetters`.
   Of the three kinds you named, **reactive exists here**, **scheduled exists
   only as ad-hoc `setInterval` sweeps** (calendar, backups, settlement) and
   **state-based exists nowhere**.
3. **Dead-letter is only half built — in both places.** `queue.js` writes a
   failed job into `errors` and moves on; `workflow.js` writes `ok: false` into a
   run row and moves on. Neither has an attempt count, a backoff, a terminal
   state, or a "these need a person" queue. A job that failed once is
   indistinguishable from one that failed forty times.
4. **`NEEDS_REVIEW` is not a first-class state.** Settlement has escalations and
   moderation has reports, but a listing or a payout cannot sit *in* a review
   state with an owner, an age and an SLA. So "automate 100% and let the hard
   cases fall out" is not yet expressible.
5. **No replay path.** The logs are append-only (good), but there is no
   projection that could be rebuilt into a new service, and no test that would
   notice if a projection and the rows disagreed.
6. **The admin console is still partly the machinery.** Publish, close, cancel
   and confirm-payment are all *operator presses*. Some of that is correct
   (money), some of it is just missing automation (a campaign whose `endsAt`
   passed should close itself, and today `hasEnded()` is only a read-time
   opinion — `domain/events.js`).

## 3. Built today: withdrawal is a state, not a delete

### The defect this closes

`DELETE /api/campaigns/:id` used to transition a published event to `cancelled`
and then **hard-delete the campaign row and its object**. Registrations,
tickets and ledger rows stayed, describing a campaign that no longer existed —
and a host could do it with forty paid attendees, silently: no refund, no
notice, no record. That is the exact failure your architecture is designed to
make impossible: the state machine was bypassed by a delete.

### The rule now

| Situation | Allowed | What happens |
|---|---|---|
| A draft nobody registered for | **delete** | the row and its object go; `campaign_cancelled` with `deleted: true` |
| Anything with a registration, a ticket or a ledger row | **withdraw only** | the row stays; delete is refused with `409 { code: 'withdrawal_required', blockers: [...] }` |
| Withdraw | `draft` / `published` / `live` | `cancelled`; object goes private; **tickets void**; held seats release; **money refunds through the ledger**; holders told |
| Withdraw twice | idempotent | the second call returns the **same receipt** and moves no money |
| Withdraw a `completed` event | refused | it happened; that is a different act |

### Where the state lives

```
campaignWithdrawals   one row per campaign — the receipt: who, why, when, and
                      exactly what moved (tickets voided, seats released,
                      refunds made, refunds owed, people told)
refundObligations     one row per transaction the withdrawal touched:
                      status 'refunded' | 'owed', with the ledger's own words
                      when it refused
campaignRevisions     one row per edit after draft: fields, before, after, actor
```

All three are declared in `server/src/store.js` with the rest of the schema, so
they exist for old databases too.

### Every outcome is a row, including the bad ones

* Money was taken → `ledger.transitionTransaction(tx, 'refunded', …)`. The
  refund is a transition of the authoritative money row, never a second store
  of it. The ledger's history records why.
* The ledger **refused** → a `refundObligations` row with `status: 'owed'`,
  the refusal text, and a `campaign_refund_owed` signal. Visible at
  `GET /api/ops/refund-obligations` (capability-gated), with the total still
  owed. *The goal is not zero failures; it is zero invisible failures.*
* The payment **never settled** → the attempt is transitioned to `failed`, so
  it can never settle into money for an event that is gone. Not counted as a
  refund, because nothing was taken.
* Money was **already refunded** before the withdrawal → left alone, no
  obligation invented.
* Someone already came through the gate → their registration is **not**
  cancelled; the receipt counts them separately, because attendance happened.
* A resale listing with an **open order** → not pulled underneath the buyer;
  named in the receipt for a person to handle. (Resale is off by decision 6,
  but the path is handled rather than assumed.)

### Post-publication edits

* Every change after `draft` writes a `campaignRevisions` row with the
  pre-image, the actor and the timestamp, and emits `object_updated`.
* A change to the **terms somebody relied on** — title, `startsAt`, `endsAt`,
  location, venue, agenda — additionally notifies everyone holding a live
  registration (`event_changed`, deduped per campaign per field-set).
  Changing the description does not.
* Capacity is still locked after publication, but *re-sending the same value*
  is no longer treated as a change: an edit form that round-trips the whole row
  is not moving the goalposts, and refusing it made an honest edit impossible.
* An untouched time is written back **byte-for-byte**. `datetime-local` carries
  minutes, so re-deriving it would have made every unrelated edit "move" a
  7-day-away start by 43 seconds and notify the holders about it. The suite
  asserts the instant is unchanged.

### Where it is wired

| Surface | Call |
|---|---|
| Server | `campaigns.withdrawalPreview` · `withdrawCampaign` · `deleteCampaign` · `refundOrOwe` · `listRefundObligations` · `listCampaignRevisions` |
| HTTP | `POST /api/campaigns/:id/withdraw` · `GET /api/campaigns/:id/withdrawal` (preview + receipt) · `GET /api/campaigns/:id/revisions` · `DELETE` now 409s · `GET /api/ops/refund-obligations` |
| Client API | `getCampaignWithdrawal` · `withdrawCampaign` · `getCampaignRevisions` |
| Host UI | `Wanderly → Hosting`: **Edit details** (the sheet reopens on the row), **Withdraw** (consequences fetched and shown before committing, receipt after), **Delete** (refused with the reasons, and told what to do instead) |
| Host sheet | `HostEventSheet` gains `editing`/`onSaved`: an edit **saves and stops** — it never re-runs `publish` — and sends only what the form can faithfully round-trip, so a line-up it never loaded is not deleted by saving a rename |

### Verified

* `server/test/eventWithdrawal.mjs` — **PASS 10**, and registered in the server
  test chain: preview counts; withdraw (tickets void, seats release, ledger
  refund, holders told); idempotency (one row, no second refund); the refusal
  branch (owed + signal + queue); unsettled-attempt closure; already-refunded
  left alone; delete refused with blockers and allowed without them; the
  withdrawn event leaves the board; edits recorded and announced; the whole
  flow over real HTTP including a stranger's 404.
* `preview/wanderly.jsx` — **10 passed / 0 failed** against a **real server on a
  real port** (this suite boots one): edit → revision → holder notified;
  withdraw → consequences on screen → receipt; the public feed drops it; delete
  refused with blockers; a draft with no history deletes; a rename leaves the
  festival line-up and FAQ untouched.
* Typecheck clean; neighbours green (`eventDetail`, `eventExpiry`, `decisions`,
  `flows`, `integration`, `notifications`, `discoverSummary`, `productReviews`,
  `spaceModeration`, `listingEdits`, `spaceEditsAfterPublish`).

## 4. The event schema

**The decision that avoids a rewrite: this repo already has an event log.**
`signals` is append-only, is never emitted by a render, and every row fans out to
the Universal Data Router's delivery ledger. There are **108 declared types**.
What it does not have is the four things that make a log reliable *at the edge*:
a required idempotency key, a monotonic sequence, a causation chain, and a
normalizer that refuses malformed input. That is what this section adds — not a
second log.

### 4.1 The envelope

| field | type | required | written by | meaning |
|---|---|---|---|---|
| `event_id` | `evt_…` | yes | intake | unique, never reused. Today's `signals.id` (`sig_…`) already qualifies; keep it, add the alias. |
| `type` | string | yes | emitter | one closed vocabulary (`campaign_cancelled`), snake_case, past tense |
| `v` | int | yes | emitter | payload version; a changed shape is `v+1`, never a silent edit |
| `entity_kind` | string | yes | emitter | `campaign` \| `work_order` \| `listing` \| `ledger_transaction` \| `request` \| … |
| `entity_id` | string | yes | emitter | the subject row's id |
| `actor_id` | string \| null | yes | intake | who caused it. `null` means the system, and is never guessed from context |
| `actor_kind` | enum | yes | intake | `user` \| `worker` \| `rule` \| `integration` \| `operator` |
| `occurred_at` | ISO | yes | emitter | when the real-world thing happened (client-supplied at edges) |
| `recorded_at` | ISO | yes | intake | the server clock at acceptance; the difference is not cosmetic on webhooks |
| `idempotency_key` | string | edges | intake | source-scoped, **mandatory** at every boundary: webhook, mobile retry, scheduler slot, rule replay |
| `source` | enum | yes | intake | `http` \| `webhook` \| `scheduler` \| `worker` \| `rule` \| `import` |
| `correlation_id` | string \| null | yes | intake | one business process: a task's whole life, one payout run, one dispute |
| `causation_id` | `evt_…` \| null | yes | intake | the event whose handling produced this one — this is the loop closing |
| `seq` | int | yes | store | monotonic, the total order; the replay cursor and the runner's bookmark |
| `payload` | object | yes | emitter | self-contained enough to replay without joining; ids for the rest |

Seven invariants, and each one buys something specific:

1. **Append-only.** Nothing updates or deletes a log row. A correction is a new
   event (`correction_recorded`), because a log you can edit cannot be replayed.
2. **`seq` is assigned at append and never renumbered.** A restarted process
   resumes exactly where the last one stopped.
3. **Edges must supply `idempotency_key`.** Internal emitters may derive one:
   `campaign_cancelled:cmp_1` is a legitimate key, and means "this one is
   naturally unique".
4. **A duplicate key returns the first outcome and appends nothing.** Not "skips:
   nothing else happens" — *returns the same answer*, so a retrying mobile client
   gets the receipt it was owed, not a second one.
5. **Every action the executor performs emits its own event with
   `causation_id`.** That is what makes the diagram above a loop rather than a
   pipeline: nothing is done that cannot be traced to the thing that asked for it.
6. **Payload self-containment.** A projection must rebuild from the log alone;
   payloads carry values, not "look it up later" references where values are
   available.
7. **The vocabulary is closed.** An unknown type at intake is refused with a
   reason; a typo must never become a permanently silent consumer.

### 4.2 The five fields the signal row is missing

| today | becomes | why it matters here |
|---|---|---|
| `id: 'sig_…'` | `event_id` (keep the value) | stable identity is what dedupe and replay key on |
| `createdAt` | `occurred_at` + `recorded_at` | a Lipa/Stripe webhook can arrive minutes late; only the pair tells you whether that matters |
| `actorId` (a user, or null) | `actor_id` + `actor_kind` | rules, workers and integrations act too — "system" must not be indistinguishable from "a person" |
| `objectId` (only when the row happens to be an object) | `entity_kind` + `entity_id` | work orders, ledger rows and settlements are not objects — and they are precisely the rows with no voice today |
| — | `seq` | total order, replay cursor, runner bookmark |
| — | `idempotency_key` | required at edges, derived internally |
| — | `source`, `correlation_id`, `causation_id`, `v` | origin, process, cause, shape |

Backwards compatible by construction: existing rows keep their fields and gain
the new ones on the next write; readers keep working through the aliases.

### 4.3 The state of the world, measured

I grepped for it, and the finding is the strongest argument for this whole
design:

| path | emits events today |
|---|---|
| campaigns / offers | **yes** — `campaign_created`, `campaign_published`, `campaign_cancelled`, `object_updated`, and (new in §3) `campaign_refund_owed` |
| tickets / resale | **yes** — `ticket_listed`, `ticket_voided`, `ticket_order_opened`, `ticket_order_refunded` |
| commerce / coop | **yes** — `order_placed`, `order_paid`, `order_settled`, `order_disputed`, `payout_ready` |
| automation engine | **partly** — `workflow.js` reacts to signals, but only with `notify`/`tag`/`blast`, and it sees only the last 500 signals (§2.2) |
| **the lifecycle you drew** | **no.** `requests`, `quotes`, `procurement`, `matching`, `workOrders`, `workExecution`, `workSettlements` — zero `emitSignal` calls. History lives inside each row: `workOrders.events`, `workExecution.pushHistory()`. |
| **money** | **no.** `ledger.js` — the only place money actually moves — emits nothing. Whatever reaches the bus about money is emitted by whichever caller remembered to. |

So for exactly the chain in your drawing, the source of truth is a per-row array
that nothing can subscribe to, nothing can replay, and no console can present
without reading every row. **That** is the gap, and it is a smaller job than the
diagram suggests: the tables and the transitions are already well built
(`WORK_STATUSES`, `TASK_STATUS`, `SETTLEMENT_STATUS`, `VALID_TRANSITIONS`); they
simply have no voice.

### 4.4 Intake — the table in front of the log

One collection, one contract, and every boundary uses it:

```
intakeEvents: { id, key, source, event_id, received_at, status,
                attempts, last_error, outcome }
```

* `status` ∈ `processing | processed | duplicate | rejected | failed`.
* Unique by `(source, key)`. In a single-writer JSON store, uniqueness is a
  `lookup`, not a constraint — which is fine, because there is exactly one writer.
* **The write-ahead rule.** The row is written *before* the effect, not after. A
  crash therefore leaves `processing`, not "no record" — and boot recovery has
  something honest to resolve. (If this ever becomes multi-process, that same row
  is the lock, and nothing else about the design changes.)
* `once(key, fn)` returns `{ duplicate, outcome }`. Callers never branch on
  "already done?" themselves — that question is how the four bespoke
  implementations in this repo drift apart.

Where it lands, in value order: payment webhooks (retries are certain), mobile
POSTs (flaky networks), the scheduler (a slot fires twice if the slot is not a
row), and the rule runner (a replay must not re-act).

### 4.5 Your names, mapped onto this repo

The middle column is the row that actually changes; the right column is the event
to emit. Where a name already exists in `SIGNAL_TYPES` it is reused, not renamed:
the vocabulary stays snake_case because 108 types already are.

| your step | the row that changes | event |
|---|---|---|
| `POST /tasks` | `requests` created | `request_created` |
| `task.created` | *(creation is the event)* | — |
| `validate_task` | `requests.status` | `request_validated` \| `request_rejected` (both carry the reason) |
| `task.validated` | `requests.status = 'matching'` | — |
| `match_workers` | `matches` rows (`MATCH_STATUSES`) | `match_suggested` |
| `task.offers_created` | `requestQuotes` / `quoteRequests` | `quote_requested`, `quote_received` |
| `worker.accepted` | `procurements` → `workOrders` (`created`) | `quote_accepted`, `work_order_created` |
| `task.assigned` | `workOrders.status = 'confirmed'`, `participantUserId` | `work_order_confirmed` |
| `task.started` | `workOrders.status = 'in_progress'`; `workUnits` `in_progress` | `work_order_started` |
| `task.completed` | `workOrders.status = 'delivered'` → `'completed'`; `workTasks.status = 'submitted'` | `work_order_delivered`, `work_task_submitted` |
| `payment.release_requested` | `workSettlements.status = 'pending'` | `work_settlement_requested` |
| `payment.released` | `ledgerTransactions.status = 'settled'` + `payouts` | `ledger_settled` |
| `review.requested` | a `schedules` row | `review_requested` |
| `review.created` | `productReviews` | `review_created` |

## 5. The state machines

A machine here is four things, all already the house style in `ledger.js`:
a stored status, a legal-transition table, a guard, and side effects that run
**after** the write. What is missing is the fifth: every transition emits its
event, and every machine declares who may move it.

### 5.1 The machine you drew

`workOrders` is the canonical task (its statuses are `created`,
`specification_pending`, `confirmed`, `in_progress`, `ready`, `dispatched`,
`delivered`, `completed`, `cancelled`, `disputed`); `workTasks` is the human step
inside it (`open`, `assigned`, `submitted`, `approved`, `rejected`, `released`).

| from → to | trigger | guard | who may | side effects | age rule |
|---|---|---|---|---|---|
| — → `created` | `work_order_created` | request confirmed, budget present | requester, ops | match candidates computed | — |
| `created` → `specification_pending` | spec incomplete | required answers missing | participant | notify requester with the exact gaps | > 24h → reminder |
| `created`/`specification_pending` → `confirmed` | `work_order_confirmed` | spec complete, participant accepted | requester, participant | assign, notify, first `workTasks` row `open` | > 48h unstarted → escalate |
| `confirmed` → `in_progress` | `work_order_started` | first unit started | participant | unit `in_progress` | > 7d → check-in |
| `in_progress` → `ready` → `dispatched` → `delivered` | step completions | proofs attached | participant | requester notified per step | > 72h undelivered → escalate |
| `delivered` → `completed` | acceptance | proofs pass validation | requester, ops, rule | settlement request | > 5d → auto-accept if all proofs pass |
| any non-terminal → `cancelled` | cancellation | nothing released yet | requester, ops | refund per policy | — |
| any → `disputed` | dispute opened | within window | either side | settlement frozen, `reviewItems` row | > 7d → ops |
| `workTasks` `open` → `assigned` → `submitted` → `approved`\|`rejected` → `released` | worker actions | geofence/photo/proof rules | worker, reviewer | proof rows; rejection returns to `open` | `assigned` > 48h → withdraw and re-offer |

Note what the last column is: **state-based automation** — the category you
called particularly important. Today none of these ages are watchable, because
an age is only visible if a row records when the state was entered. The machines
already store the timestamp (`assignedAt`, `decidedAt`, `startedAt`); the rule
reads it from an index instead of a scan.

### 5.2 The machines that already exist

| entity | statuses (as built) | needs |
|---|---|---|
| campaign / offer | `draft → published → live → closed \| cancelled \| completed` | events on every transition (mostly there); close-on-`endsAt` as a rule |
| registration | `started → registered → confirmed → checked_in \| no_show \| cancelled` | emit on every move; today promotion is silent |
| ticket | `valid → voided` (+ resale listings `active`/`pending`) | emit `ticket_issued`; `voidForCampaign` already reports what it did |
| ticket order | `open → paid \| cancelled \| refunded` | already emits; add `causation_id` |
| ledger transaction | `created → pending → confirmed → held → settled → refunded`, `failed` terminal | **emit from `transitionTransaction` itself** so money can never move silently |
| settlement attempt | `pending → confirmed \| refused` + `settlementEscalations` | fold the escalation into `reviewItems` (one queue) |
| dispute | open → resolved | `reviewItems` kind `dispute` |
| listing | `draft → published → paused → archived` | publish/archive are events; "sales drop" is a state rule |
| product review | created → (reported → hidden) | `review_created`, `review_reported` |

### 5.3 Editable, withdrawable, deletable — as machine metadata

Your last sentence is a property of the machine, not a feature of the UI, so it
belongs in the definition of each entity:

```
campaign:  editable_in: [draft, published, live]        // material fields notify holders
           withdrawable_in: [draft, published, live]    // refunds through the ledger, tells holders
           deletable_in: [draft]                        // and only when nothing references it
work_order: editable_in: [created, specification_pending, confirmed, in_progress, ready]
           withdrawable_in: [created, specification_pending, confirmed]   // before work starts
           deletable_in: []
listing:   editable_in: [draft, published, paused]
           withdrawable_in: [draft, published, paused]  // → archived, reason recorded
           deletable_in: [draft]
```

One rule decides the verb, everywhere: **if anything else references the row, the
honest operation is withdrawal; deletion is allowed only where it is not a lie.**
That is what is built for offers in §3, and it generalises unchanged.

## 6. Database tables

The store is one JSON document with a single writer (`store.insert/update/
lookup/find`), and `EMPTY` in `server/src/store.js` **is** the schema — 176
collections. Consequences worth designing for rather than around: uniqueness is a
lookup, indexes are derived maps, and the sequencer is a row. None of that is a
reason to add a database; it is a reason to be explicit about both.

New collections, exactly as they would be declared:

```js
  // --- Operations engine (EVENT-ENGINE.md §6) ------------------------------
  intakeEvents: [],   // idempotency at the edge: one row per incoming key
  deadLetters: [],    // terminal failures; never invisible
  reviewItems: [],    // human escalation as a first-class state
  schedules: [],      // durable "do X at T"; survives restart
  engineState: [],    // one row: the cursor + index bookkeeping
```

`workflows` and `workflowRuns` already exist and are **extended, not replaced** —
they are the rule table and the run log; adding `automationRules` beside them
would create two engines and one lie.

| table | fields | indexes needed | retention |
|---|---|---|---|
| `intakeEvents` | `id, key, source, event_id, received_at, status, attempts, last_error, outcome` | `(source, key)` for dedupe; `(status, received_at)` for recovery | `processed`/`duplicate` 90d; `failed`/`rejected` forever |
| `workflows` *(extended)* | today: `id, name, trigger, conditions[], actions[], ownerId, enabled`. Add: `kind` (`reactive` \| `scheduled` \| `state`), `on.state` + `on.age` for age rules, `frontier`, `threshold_key`, `updated_at`, `updated_by`. Existing rows default to `kind: 'reactive'` | `(enabled, kind)`; `trigger` | forever — a rule is configuration with an author |
| `workflowRuns` *(extended)* | today: `id, workflowId, signalId, signalType, results[], at` — written only *after* the actions. Add: `status` (`ok` \| `partial` \| `failed`), `attempt`, `started_at`, `next_retry_at`, `error`, `dead_lettered`, `event_seq`. Write the row **before** running the actions | `(status, next_retry_at)`; `(workflowId, signalId)` for dedupe | forever — this is the proof |
| `deadLetters` | `id, run_id, event_id, action, payload, attempts, first_failed_at, last_failed_at, last_error, status, resolved_by, resolution_note` | `(status, last_failed_at)` | until resolved + 1y |
| `reviewItems` | `id, kind, subject{kind,id}, reason, opened_by, opened_at, deadline_at, decision, decided_by, decided_at, note, event_id` | `(decision, opened_at)`; `(subject.kind, subject.id)` | forever |
| `schedules` | `id, rule_id, key, subject{kind,id}, due_at, fired_at, status` | `(status, due_at)` | 30d after fired |
| `engineState` | `id: 'cursor', last_seq, engine_version, index_version, rules_backfilled_at` | — | one row |

`signals` gains the envelope fields from §4.2 — no new collection, because a
second log would be the worst of both.

Two naming collisions to respect, since 176 collections exist: `events` is taken
(experiences/destinations) and `queueReservations` is taken (venue queues). The
rule table is `workflows` because that engine already exists; `schedules` is new
and deliberately says what it is — a durable "do this at that time", not a cron
string. A reader must never have to guess whether a row is a product object or
engine machinery.

**Indexes and replay.** Each index is a derived map (`engineState.indexes`), kept
current on insert and rebuilt from the log if `index_version` is behind. One test
holds the line: build the index incrementally, rebuild it cold, assert the two
are identical. Without that test, an index quietly becomes a second source of
truth — which is the same class of bug as a lying test chain.

**Migration.** `SCHEMA_VERSION` bump; `EMPTY` additions; then a backfill that is
itself the proof: walk existing `signals` in `createdAt` order, assign `seq`,
widen the envelope, and reconstruct one campaign's status from the log alone —
asserting it equals the stored row. That test is the difference between an event
log and a log you hope is complete.

## 7. Worker processes

One process, no broker. `queue.js` stays the transport (its own header already
says the swap is one file), and the durable rows above are what make that swap
possible without touching a caller.

| process | reads | writes | trigger | on crash |
|---|---|---|---|---|
| `intake` | HTTP / webhook / worker call | `intakeEvents` (write-ahead), `signals` | in-request, synchronous append | boot recovery resolves `processing` rows older than 2 min |
| `workflow.sweep()` *(exists; gains the cursor)* | `signals` from `engineState.last_seq` | `workflowRuns` (write-ahead), then effects | 60s tick (`installSweep`) | resumes at `last_seq`; `(workflowId, signalId)` dedupe makes a re-read harmless |
| `scheduler` | `schedules` due, `kind: 'state'` predicates | `schedules`, `workflowRuns` | 30s tick | slot rows are keyed, so a missed tick fires once, not twice |
| `executor` | an action from a rule or the ops console | effects + its own event | invoked | every action is idempotent by key; unknown outcome → row marked `failed`, retried by policy |
| `retry` | `workflowRuns` with `next_retry_at` | attempts 1→3 (30s, 5m, 1h), then `deadLetters` | tick | nothing is implicit; the ladder is declared per action |
| `recover` | `intakeEvents`, `workflowRuns` (stuck `running`), `schedules` | corrections | boot | — |
| `replay` | `signals` from `seq 0` | a scratch projection, then a diff | offline / on demand | read-only against live state by construction |

The loop, with the real names in it:

```
POST /api/…                    (web · webhook · worker · ops console)
   → intake.once(key)          write-ahead row: this key is now accounted for
   → signals.append            envelope + seq  ← the log IS the outbox
   → workflow.sweep() (cursor) rules are rows; predicates are data, never eval
   → executor action           ledger transition · notify · match · schedule · escalate
   → signals.append            causation_id = the event that caused this   ← the loop closes
```

**Failure doctrine**, which is the thing the current code cannot do. Today a
failure is either a line in `errors`, a line in a run row, or — if it threw — a
`.catch()` that does nothing. The design's version: a run row is written *before*
the actions (`status: 'running'`), updated after (`ok` \| `partial` \| `failed`),
retried on the declared ladder, and finally promoted to a `deadLetters` row
carrying the payload, the attempts and the last error.
`GET /api/ops/dead-letters` lists them with a count on the ops wall, and
resolving one emits `dead_letter_resolved`. **Zero invisible failures** stops
being an aspiration and becomes a test: poison one action, assert exactly one
dead-letter row and one increase in the ops count.

**Replay** is the payoff, and it needs no new machinery: the log is ordered, so
`replay` rebuilds any projection into a scratch collection and diffs it against
live rows. First projections worth rebuilding: campaign status + registration
counts, a work order's timeline, and a ledger balance. When those three agree
with the rows for a month of real data, the log has earned the right to be called
the source of truth — and a new service can be fed by reading it.

## 8. The automation frontier

Your table, instantiated. The level is **data** (`workflows.frontier`, a column on
the rule that already exists), and the thresholds live in one place so a person
can change policy without a deploy.

| operation | frontier | where the decision lives | reviewer | today |
|---|---|---|---|---|
| receipt / confirmation message | 100% auto | reactive rule on `order_paid`, `registration_confirmed` | — | notifications exist; a workflow *could* do it today (notify) but isn't wired to |
| reminder (created + 24h) | 100% auto | `schedules` row | — | does not exist |
| basic listing validation | 100% auto | reactive rule on `listing_published` | — | partly inline in the request |
| offer edit (material change) | 100% auto | reactive: revision row + holder notice | — | **built** (§3) |
| offer withdrawal | 100% auto, with escalation | refund rule; ledger refusal → `refund.owed` | ops (only when refused) | **built** (§3) |
| worker matching | rule-based | reactive rule on `request_validated`, weights in `matchRanking` | — | `matching.js`, synchronous in-request; no signal to trigger on (§4.3) |
| small payout | rule + threshold | `thresholds.payout_auto_max` | — | partial |
| large payout | human | rule above threshold opens `reviewItems` | ops | `settlementEscalations` today |
| fraud suspicion | human review | rule raises `reviewItems`; the flag itself is a rule | ops | ticket resale flagging exists |
| dispute | human | `reviewItems` kind `dispute` | ops | `disputes` + ops route exist |
| account termination | human | `reviewItems`; the action is ops-only | ops + moderation | `spaceAbuseReports` today |
| settlement reconciliation failure | human | existing escalation → `reviewItems` | ops | exists, second queue |

Two rules make the frontier honest rather than decorative:

1. **Automation may raise to a human; only a human may lower the level.** A rule
   that finds itself unable to decide stops and asks. It never decides to decide.
2. **A level change is an event with an author** (`automation_level_changed`), so
   "why is this automatic now?" has an answer that is not a code archaeology
   expedition.

## 9. The console as control plane

The console may: read any projection; work `reviewItems`; retry, resolve or
abandon `deadLetters`; change rule levels and thresholds; replay an entity's
timeline; pause a rule. Every one of those emits an event with the operator as
`actor_id` and `actor_kind: 'operator'`.

The console may not: set a status directly; move money outside the ledger; edit
or delete a log row; edit a receipt.

That is enforceable rather than aspirational, because the machinery it would
bypass is already narrow: `transitionCampaign`, `transitionTransaction`,
`setRegistrationStatus`. The guard is a test that scans route modules for status
writes outside a domain transition — the same shape as the test that already
stops suites from being silently unlisted. The existing `requireCap`
(`ops.read` / `ops.run` / `moderate`) stays the gate.

Already control plane, correctly: `GET /api/ops/refund-obligations`, disputes,
corrections, settlement escalations, `GET /api/ops/audit`. Still machinery and
earmarked to shrink into rules: publish / close / cancel buttons, and any
"confirm payment" a person does because nothing else would.

## 10. Build order

Each step is a commit-sized unit with a test that can fail, and none of them
rewrite a domain.

1. **The envelope + the intake table.** `signals` gains the §4.2 fields; add
   `intakeEvents`, `engineState`; `once(key, fn)`; nothing rewired. Test: the same
   key three times → one row, one outcome, the *same* outcome; unknown type
   refused with a reason; late `occurred_at` preserved; `seq` monotonic across a
   restart.
2. **The ledger speaks.** `transitionTransaction` emits `ledger_<status>` with
   `causation_id` when a caller has one. Test: refund → the log shows the
   movement, and replaying the log rebuilds the same balance.
3. **The runner that already exists gets a cursor and a run row that tells the
   truth.** `engineState.last_seq` replaces `.slice(-500)`; write the run row
   before the actions and update it after; keep `workflows` as the rule table and
   add `kind`, starting with `reactive`. First new rule: a campaign past `endsAt`
   closes itself (today `hasEnded()` is only a read-time opinion). Test: 600
   signals emitted while the sweep is paused are **all** processed, in order —
   the window defect is dead; a thrown action leaves a run row marked `failed`
   and does not re-run its already-successful siblings.
4. **Retry, dead letters, and the ops queue.** The ladder and the terminal state;
   `GET /api/ops/dead-letters`. Test: a poisoned action leaves exactly one
   dead-letter row (not a silent `.catch()`), and one ops count; resolving it
   emits an event. *After this step the system can honestly claim: no automated
   action fails invisibly.*
5. **Review as a state.** `reviewItems` with `PENDING` / `AUTO_APPROVED` /
   `AUTO_REJECTED`; the payout threshold opens one above the line; fold
   `settlementEscalations` into it so there is one queue, not two.
6. **Schedules and age rules.** `schedules`; `kind: 'scheduled'` (the 24h
   reminder) and `kind: 'state'` (the first age rule: `confirmed` > 48h →
   escalate). Test: a schedule fires once across a restart; an age rule escalates
   once, not once per tick.
7. **A voice for the work path.** Emit §4.5's events from `requests`, `quotes`,
   `procurement`, `workOrders`, `workExecution`, `workSettlements`; adopt `once()`
   at the four bespoke idempotency sites (`externalPlaces`, `huduma/orders`,
   `huduma/router`, `lipaMdogo`) and at the payment webhooks; add
   `GET /api/ops/entities/:kind/:id/timeline`.

What this is not: no broker, no Kafka, no microservice split, no AI, no rewrite of
the domains, no new runtime. The log is `signals`, the transport is `queue.js`,
the tables are collections in the same document — and the first four steps are
worth doing even if nothing else here is ever built, because they are what turns
"the admin pressed a button" into "the system recorded what happened."

Everything above is additive: no collection in this list replaces an existing
one, and every rule's execution is a row.
