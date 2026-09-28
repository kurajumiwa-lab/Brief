# The event/state engine — what Brief already has, what it is missing, and the one piece built today

**Branch:** `arena/01a0e5ae-brief`

You asked for the layer underneath the UI: the edge/event boundary, the state
machines, the tables, the workers — and for events to be editable and
withdrawable because an offer can be taken back. This document answers that
against **this** codebase rather than in the abstract. It has three parts:

1. the architecture you drew, mapped onto what is already here (with file paths);
2. the honest gap list — what the diagram needs and this repo does not have;
3. the piece that is now built: **withdrawal is a state, not a delete**, plus
   post-publication edits that are recorded and, when they change the deal,
   announced.

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
2. **There is no runner, so nothing is "always on".** Signals are emitted and
   fan out to webhooks, but no consumer turns a signal into a *next state*:
   `task.offered → match_workers` has no counterpart here for listings,
   campaigns or orders. Automation today is either inline in a request or a
   sweep in `index.js`. The three kinds you named —
   reactive / scheduled / state-based — have exactly one implementation each
   (webhook dispatch / the hourly settlement reconciler / nothing).
   *Smallest honest fix:* an `automationRules` collection (`{ on: signalType,
   when: predicate, do: actionName }`) plus one `automationRuns` row per
   attempt, reusing `queue.js` for execution. Rules are data, actions are
   named functions, every run is a row with the outcome.
3. **Dead-letter is only half built.** `queue.js` records a failed job into
   `errors` and moves on: no attempt count, no backoff, no terminal state, no
   "these need a person" queue. A job that failed once is indistinguishable
   from one that failed forty times.
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

## 4. What I would build next, in order

1. **`intakeEvents` + `intake.once(key, fn)`** — one idempotency boundary in
   front of every webhook and public write. (Days, not weeks; and it retires
   four bespoke implementations.)
2. **`automationRules` + a runner with attempt rows**, reusing `queue.js`, with
   the three shapes you named: reactive (on a signal), scheduled (on a clock),
   state-based (`status == X AND age > Y`). First rules worth writing:
   * campaign past `endsAt` and still `published` → `closed` (today it is only a
     read-time opinion);
   * listing `quantityAvailable == 0` → `sold_out` (already inline — move it to
     a rule so the transition is logged with its cause);
   * ticket resale listing flagged by the fraud screen → `NEEDS_REVIEW`.
3. **A general `review` state** (`{ subjectType, subjectId, reason, openedAt,
   ownerId }`) with the ops wall reading it, so escalation stops being a
   settlement-only concept.
4. **Replay projection + a disagreement test** — rebuild `discoverSummary` and
   a campaign's analytics from `signals` + rows, and assert they match. That
   test is what makes the log trustworthy enough to build on.
5. **Then** the automation frontier as data: per-operation policy rows
   (deterministic → auto, threshold → rule, ambiguous → review), so the console
   becomes a control plane rather than the machinery.

Everything above is additive: no collection in this list replaces an existing
one, and every rule's execution is a row.
