# P0 implementation directive — "Record a trade, end to end"

> **Status:** approved for engineering. Author: product. Owner: CRO (implementation).
> **Date:** 2026-10-12. **Supersedes:** nothing. **Implements:** the P0 slice of
> `feature-teardown-2026.md` §7.1.
>
> **This is an implementation directive, not a marketplace mandate.** It
> authorises one workflow and two supporting surfaces. It does not authorise
> payments, escrow, a pickup network, a take-rate, or any physical-logistics
> capability. Anything in §10 will be rejected at review.
>
> Read §2 before estimating. Most of this is already built.

---

## 0. What this authorises, and what it does not

**Authorised:**

- Ship a single end-to-end workflow: **reorder → trade record → handover confirmation → ledger entry.**
- Build two new surfaces: **Repeat a previous order** and **My records.**
- Build the **vendor dashboard** as specified in §4.1, as the entry point to the above.
- Run the controlled validation described in `feature-teardown-2026.md` §11.

**Not authorised:**

- Moving real money. `TRADE_PAYMENTS_ENABLED` and `TRADE_SETTLEMENT_ENABLED`
  stay `false` for this release. See §8.
- Releasing escrow. Escrow is not in P0 at all.
- Building a pickup-point network, a courier fleet, or warehousing.
- Any take-rate, commission or facilitation fee. `TRADE_PLATFORM_FEE_RATE`
  stays `0.0`.
- Any consumer/shopper-facing surface.

**The one-line test for any scope question:** *does this help one vendor record
one real trade they already made?* If yes, it is in scope. If it needs a
licence, a vehicle, a warehouse or a lawyer, it is not.

---

## 1. The three technical decisions, hardened into rules

### Decision 1 — One end-to-end workflow

> **Rule 1.1.** P0 delivers exactly one vertical slice. A vendor must be able to
> go from "I bought this last Tuesday" to "this trade is on my record with a
> confirmed handover" without leaving the app. No horizontal features.

> **Rule 1.2.** The slice is measured end-to-end, not per-screen. Success is
> *trades recorded with a confirmed handover*, not screens shipped. See §9.

### Decision 2 — Trade completion and payment settlement are separate

This is the most important rule in the document, and the codebase already
agrees with it. Two states, two tables, never one field.

> **Rule 2.1.** Goods state lives on `stock_movements.status`
> (`pending → confirmed → shipped → received | cancelled`). Money state lives on
> `order_transactions.settlement_status` (`not_started | pending |
> pending_approval | settled | blocked_by_dispute | refund_pending | refunded |
> failed | unavailable | not_applicable`). **They are orthogonal and must stay
> on separate tables.**

> **Rule 2.2 — do not add a combined `order_status` field.** A single derived
> status is how you get a false confirmation: goods handed over while payment
> is disputed, or payment settled while goods were never received, both
> collapsing into one green tick. If the UI needs a summary, compute it in the
> serializer from both states and **show both states whenever they disagree.**

> **Rule 2.3.** In P0, `settlement_status` will be `not_started` or
> `not_applicable`. That is the correct end state for this release. A P0 trade
> is *complete* when it is `received`, regardless of settlement.

> **Rule 2.4 — disambiguation, because this will be misread.** "Ledger entry"
> in the workflow means the **trade ledger**: `MovementEvent` audit rows on the
> movement, plus the immutable KES price snapshot on `order_transactions`. It
> does **not** mean the custody ledger, a disbursement, or any money movement.
> No money moves in P0.

### Decision 3 — Pickup points and escrow are experiments

> **Rule 3.1.** Pickup and payment capabilities ship behind independent
> configuration and are **off by default**. Each must be disableable in
> production without a deploy and without breaking the core workflow.

> **Rule 3.2.** P0 must be fully functional, and fully demonstrable, with every
> flag in §8 set to its default (`off`). A demo that requires turning a flag on
> has failed.

> **Rule 3.3.** No code may be written against pickup or escrow before the
> vendor validation in `feature-teardown-2026.md` §11 reports. The P0 slice is
> the instrument used to run that validation — it is not the validation's
> conclusion.

---

## 2. What already exists — do not rebuild

**Read this before estimating.** The workflow is mostly built and unusually
strictly guarded. P0 is two new surfaces plus the UI for flows that already run
server-side. An estimate that rebuilds any of the following is wrong.

| Capability | Where it lives | State |
|---|---|---|
| Goods state machine, transitions, actor checks | `services/stock_engine.py` — `_TRANSITIONS`, `transition()` | **Built** |
| Money state machine (10 states) | `modules/orders/models.py` — `OrderTransaction.settlement_status` | **Built** |
| Immutable KES price snapshot at movement creation | `modules/orders/audit.py` — `ensure_order_transaction()`, `kes_integer()`, `platform_fee_for()` | **Built** |
| Handover proof — 6-digit code, SHA-256 stored, 24h expiry, returned once | `modules/orders/router.py` — `POST /{movement_id}/receipt-code` | **Built** |
| Receipt confirmation — **only the selected provider can call it** | `modules/orders/router.py` → `stock_engine.transition(..., "receive", receipt_code=...)` | **Built** |
| Movement audit trail | `modules/orders/models.py` — `MovementEvent`; `audit.record_movement_event()` | **Built** |
| Anti-false-confirmation guards | `stock_engine.transition()` — see §7.2 | **Built** |
| Payment readiness gate (5 sequential checks) | `modules/orders/router.py` — `_payment_readiness()` | **Built** |
| Pickup fields (address, hours, instructions, ready flag) | `OrderTransaction.pickup_*`, `ready_for_collection` | **Built** |
| Delivery quotes / courier selection | `DeliveryQuoteRequest`, `DeliveryQuote` | **Built** |
| Order list + detail screens | `pages/orders/OrdersPage.jsx`, `OrderDetailPage.jsx` | **Built** |
| Shipment tracking panel | `components/tools/ShipmentPanel.jsx` | **Built** |
| Design system: Stat, DigitalNumber, EmptyState, ErrorState, Skeleton, Spinner, Toast, Drawer, Modal, Shelf, ConfirmDialog, Card, Chip, Badge, Tabs, ErrorBoundary | `src/components/ui/` | **Built** |

**Not built — this is the actual P0 gap:**

1. **Reorder.** Zero occurrences of `reorder` in the backend or frontend. This
   is the one new backend surface.
2. **My records / trade export.** No export path exists anywhere.
3. **The dashboard.** The surfaces exist; the P0 dashboard composition does not.

---

## 3. The P0 workflow

```
[Dashboard] ──► Repeat a previous order ──► Review & confirm ──► Movement created
                                                                      │
                        ┌─────────────────────────────────────────────┘
                        ▼
              pending ──(supplier)──► confirmed ──(supplier)──► shipped
                                                                   │
                                              buyer generates 6-digit code
                                                                   │
                                              provider enters the code
                                                                   ▼
                                                              received
                                                                   │
                                              MovementEvent rows written
                                              price snapshot already locked
                                                                   ▼
                                                    [My records] ← searchable
```

**Step 1 — Reorder.** Vendor picks a past movement. The app pre-fills
supplier, item, quantity and last-agreed unit price. **The price is a
proposal, never a commitment** — the supplier confirms or counters, exactly as
today (`confirm` transition, supplier-side).

**Step 2 — Trade record.** On confirmation, `ensure_order_transaction()` writes
the immutable KES snapshot. This is the record's financial spine: later
catalogue edits never rewrite an agreement. **Never recompute a historical
amount from current catalogue data.**

**Step 3 — Handover.** Buyer generates the receipt code; the selected provider
enters it. The buyer **cannot** mark their own order received — that rule is
already enforced server-side (`stock_engine.transition`, `receive` branch).
Preserve it.

**Step 4 — Ledger entry.** `MovementEvent` rows record each transition with
actor and timestamp. The trade now appears in **My records**.

---

## 4. Screens

### 4.1 Vendor dashboard (`/`, P0 slice)

The entry point. It is a launcher, not a report.

```
┌─────────────────────────────────────────┐
│ [store]  My shop                    [●] │   ← connection dot: live / stale / offline
│          Trade overview                 │
├─────────────────────────────────────────┤
│  ┌───────────────┐  ┌───────────────┐   │
│  │ Needs action  │  │ Trades to date│   │
│  │      3        │  │      12       │   │
│  │ 2 awaiting you│  │ since 12 Oct  │   │
│  └───────────────┘  └───────────────┘   │
├─────────────────────────────────────────┤
│  [repeat]  Repeat a previous order      │   ← primary action
│            Same supplier, same crate  › │
├─────────────────────────────────────────┤
│  [clipboard] Recent trade               │
│            #BR-4471 · Mama Mboga    ›   │
│            KES 4,800 · awaiting you     │
├─────────────────────────────────────────┤
│  [book]    My records                   │
│            Search and export          › │
└─────────────────────────────────────────┘
```

**Three deliberate departures from the concept mock:**

1. **"Needs action" is the hero, not "Today's trades."** A pilot vendor's first
   week has no trades today. A tile that reads `0` on day one reads as broken.
   "Needs action" is non-zero the moment anyone owes them anything, and it is
   the pull into the workflow.
2. **"Trades to date" replaces "Today's trades"** and is hidden entirely until
   ≥1 trade exists (see §5, empty states). Counting from zero is a bug that
   looks like a feature.
3. **Tiles are `Stat` components with tabular numerals** (`components/ui/Stat.jsx`,
   `DigitalNumber.jsx`). Do not hand-roll a metric tile.

The mock's `—` placeholders are correct as a *design* artefact. In the shipped
screen, every figure is either a real number or the tile is not rendered.

### 4.2 Repeat a previous order

- List of past movements, newest first, supplier + item + qty + last price.
- Each row: **Repeat** → pre-filled confirm sheet.
- **Price-change banner when the supplier's current price differs from the
  price you last paid.** Show both, plain: *"Last time KES 240/kg · now
  KES 260/kg."* Never silently substitute.
- Out-of-stock / delisted supplier → row is disabled with a reason, not hidden.
- Confirm is a `ConfirmDialog` naming supplier, item, quantity and total.

### 4.3 Handover

Two roles, one screen:

- **Buyer:** `Generate code` → 6 digits, large, monospace, with **Share via
  SMS** (market handovers happen on bad connections — see §5, offline).
  Code is shown **once**. `Regenerate` invalidates the previous code and is
  behind a confirm.
- **Provider:** 6-digit entry (`Input`, numeric, auto-advance). On submit the
  movement moves to `received`.

Never show the words *paid* or *settled* anywhere on this screen in P0.

### 4.4 My records

- Searchable list of recorded trades: date, counterparty, item, quantity,
  amount, goods status, **and settlement status shown separately** (Rule 2.2).
- `Export` → CSV. Columns: date, reference, counterparty handle, item,
  quantity, unit, unit price KES, total KES, goods status, settlement status.
- **Footer, always visible:** *"This is your record of trades on Brief_. It is
  not a receipt, an invoice, or a tax document."*

---

## 5. UI states — every surface ships all of these

| State | Requirement |
|---|---|
| **Empty** | Copy, then one primary action. Never a blank panel. `EmptyState`. |
| **First-run** | Vendor with zero trades: **hide both stat tiles.** Show: a one-line "Record your first trade" + `Repeat` replaced by `New order`. Do not render `0`. |
| **Loading** | `Skeleton` matching final layout. No layout shift on resolve. |
| **Error** | `ErrorState` + `Retry`. **Never** a silent empty list — an empty list from a failed request is a lie. |
| **Stale** | Data >60s old: keep showing it, dim the connection dot, `Updated 3 min ago`. Trade apps must not blank out on a slow network. |
| **Offline** | Show last known state with an offline banner. Queue the ack; reconcile on reconnect. **Never block a handover on connectivity.** |
| **Optimistic** | Acks render immediately, marked pending, with a clear revert if the server rejects. |
| **Conflict** | Server rejects a transition (409) → replace the pending row with the server's truth + the reason verbatim (`"Movement is 'shipped', expected 'confirmed' to ship"`). Never a generic "something went wrong". |
| **Expired** | Receipt code past 24h → expired state + `Regenerate`. Never a dead input. |
| **Forbidden** | Buyer attempting self-receipt → not an error state; the control simply does not exist for them. |

**The offline case is the one that will be got wrong.** Handovers happen in
markets with poor connectivity. The receipt code must be readable, shareable
and re-generatable offline, and the ack must queue. Do not design this screen
as though the network is reliable.

---

## 6. Motion

Respect `prefers-reduced-motion` everywhere. Use the existing `Drawer`,
`Modal` and `Shelf` motion primitives; do not invent new ones.

| Moment | Motion |
|---|---|
| Tile figure updates | `DigitalNumber` count, ≤300ms. Never animate from 0 on load. |
| Movement advances (pending→confirmed→…) | Progress step advances, 200ms ease-out. One state change, one motion. |
| Receipt code generated | Digits fade in staggered, 40ms apart — it reads as a code, not a number. |
| Ack accepted | Single 150ms checkmark, then the trade moves to its new group. |
| Ack rejected (conflict) | 200ms shake, then settle into the server's truth. |
| Export ready | Toast, not a modal. |

No confetti, no celebratory full-screen states, no streak counters. A trade is
not a game.

---

## 7. Backend rules

### 7.1 The state machines

```
GOODS   pending ──confirm──► confirmed ──ship──► shipped ──receive──► received
              └────────────── cancel (either side, pre-receipt) ──────┘
MONEY   not_started ──► pending ──► pending_approval ──► settled
                          │              │
                          └──► failed    └──► blocked_by_dispute ──► refund_pending ──► refunded
        unavailable  ·  not_applicable
```

- `confirm` and `ship`: **supplier only.** `receive`: **selected provider only.**
  `cancel`: either side, before receipt. All already enforced — preserve.
- Every transition writes a `MovementEvent` with actor and timestamp.
- `received` is the only state that should be described as *complete*.

### 7.2 Invariants already enforced — do not weaken

These live in `stock_engine.transition()`. They are the reason the workflow is
trustworthy. Preserve every one and cover each with a test:

1. **The buyer cannot mark their own order received.** Only the selected
   supplier or courier can, using the buyer's code.
2. `ship` and `receive` require a selected, non-expired fulfilment option.
3. `ship` and `receive` require a confirmed pickup address **and** the
   supplier's `ready_for_collection` flag.
4. The selected quote's pickup address must equal the transaction's — a
   mid-flight change invalidates the selection.
5. **No dispatch or receipt while a payment is `pending`.** This is the
   anti-false-confirmation rule at its sharpest.
6. No dispatch or receipt while a dispute is `open` or `in_review`.
7. `cancel` is refused once a payment is `pending` or `completed` — the path
   becomes a dispute, so the money and the goods are reconciled together.
8. `cancel` after `shipped` is refused for any non-self-pickup order.
9. Amounts are snapshotted at movement creation and never recomputed.
10. KES is rounded `ROUND_HALF_UP` in `kes_integer()`. No banker's rounding on
    money. No floats in stored amounts.

### 7.3 New backend surface — reorder

- New endpoint, read-only source: derive candidates from the vendor's own
  movement history. **No new table** unless a candidate needs one; prefer a
  query over `stock_movements` joined to `stock_items`.
- **Idempotency:** every reorder creation accepts an `Idempotency-Key`. A
  double-tap on a phone must never create two movements. This is the most
  likely real-world bug in this feature.
- **Concurrency:** reorder against a stock line must re-read availability at
  creation time and fail cleanly if the supplier's stock changed since the
  candidate list was served. Show *"Only 6 crates left; adjust quantity"*, not
  a 500.
- The last price is a **proposal**. It does not bind the supplier; the existing
  `confirm` transition does.
- Reorder must not bypass any invariant in §7.2.

### 7.4 Export

- CSV, UTF-8, one row per movement, amounts in whole KES.
- Server-side cap and pagination; never build the whole file in memory for a
  vendor with a long history.
- Export is a **record of trades on Brief_** and carries the §4.4 disclaimer in
  the file's first line, not only on screen.

---

## 8. Feature flags and kill switches

Defaults are the shipped configuration. **Changing any of these in a PR is a
review-blocking event requiring named product sign-off.**

| Flag | File | Default | P0 behaviour |
|---|---|---|---|
| `TRADE_PAYMENTS_ENABLED` | `app/config.py` | `false` | **Must stay false.** Order payments disabled. |
| `TRADE_SETTLEMENT_ENABLED` | `app/config.py` | `false` | **Must stay false.** No supplier settlement. |
| `TRADE_PLATFORM_FEE_RATE` | `app/config.py` | `0.0` | **Must stay 0.0.** No take-rate. |
| `PSP_PROVIDER` | `app/config.py` | `mock` | **Must stay `mock`.** Cannot move real money. |
| `TRADE_PSP_SUB_ACCOUNT` | `app/config.py` | `""` | Must stay empty. |

**Required CI guard:** add a test asserting that with default configuration,
`_payment_readiness()` returns `enabled: False`, and that the mock PSP cannot
produce a charge against a real rail. A PR that flips any flag above fails CI
without an explicit override and a named approver.

**Explicitly:** the "no real money" boundary in this directive is not a promise
in a document — it is a config default, a blocking CI check, and a review
gate. All three must land in P0.

---

## 9. Acceptance criteria

```gherkin
Feature: Record a trade end to end (P0)

  Background:
    Given the deployment runs with all §8 flags at their defaults
    And vendor A (buyer) and vendor B (supplier) both exist

  Scenario: Repeat a previous order
    Given A has a movement in state "received" with B for 10 crates at KES 240
    When A opens "Repeat a previous order" and repeats that movement
    Then a draft is pre-filled with B, the item, 10 crates and KES 240
    And the total is shown as KES 2,400
    And the price is labelled as last paid, not as agreed

  Scenario: A supplier's price rose since the last order
    Given B's current price for the item is KES 260
    When A repeats the previous order
    Then A sees "Last time KES 240" and "Now KES 260" side by side
    And A must explicitly confirm before submitting

  Scenario: Double-tap does not create two orders
    When A submits the reorder twice with the same idempotency key
    Then exactly one movement exists
    And both requests return the same movement id

  Scenario: Stock changed between listing and ordering
    Given B has 6 crates available and A reorders 10
    When A submits
    Then the request is refused with "Only 6 crates left; adjust quantity"
    And no movement is created

  Scenario: Handover needs both parties
    Given a movement in state "shipped" with B as the selected provider
    When A generates a receipt code
    Then A sees a 6-digit code and can share it by SMS
    And the code is displayed once and is not retrievable from any GET
    When B enters the correct code
    Then the movement becomes "received"

  Scenario: The buyer cannot mark their own order received
    Given a movement in state "shipped"
    When A attempts to confirm receipt with the code
    Then the request is refused with 403
    And the movement remains "shipped"

  Scenario: An expired code cannot be used
    Given a receipt code issued more than 24 hours ago
    When B enters it
    Then it is refused as expired and A can regenerate a new code
    And the previous code is invalidated

  Scenario: Goods and money states stay separate
    Given a movement in state "received"
    And settlement_status is "not_applicable"
    When A views the trade in My records
    Then both the goods status and the settlement status are shown separately
    And the trade is described as complete on the goods state alone
    And no surface anywhere implies payment was made or settled

  Scenario: A 409 replaces optimistic state with the truth
    Given A's client shows the movement as "confirmed"
    And the server has already moved it to "shipped"
    When A attempts to cancel
    Then the client shows "shipped" and the server's reason verbatim
    And it does not show a generic failure message

  Scenario: Handover survives a bad connection
    Given B's device is offline at the moment of handover
    When B enters the code
    Then the ack is queued locally and shown as pending
    And when connectivity returns the ack is submitted automatically
    And if the server rejects it, B sees the server's reason

  Scenario: Export matches what the screen showed
    When A exports My records
    Then every row matches the on-screen list
    And amounts are whole KES with ROUND_HALF_UP rounding
    And the file's first line carries the "not a receipt, invoice or tax document" disclaimer

  Scenario: Empty states are honest
    Given A has never recorded a trade
    When A opens the dashboard
    Then no stat tile shows zero
    And A sees a single "Record your first trade" action

  Scenario: No money can move
    Given all §8 flags at defaults
    When any payment, settlement or payout path is invoked
    Then it is refused with the reason from _payment_readiness()
    And no PSP call is made against a real rail
```

---

## 10. Out of scope — will be rejected at review

| Not in P0 | Why |
|---|---|
| Escrow, payments, settlement, payouts, refunds | Not authorised. Flags stay false (§8). |
| Pickup-point network, agent recruitment | Experiment, gated on validation (Rule 3.3). |
| Any take-rate or fee | `TRADE_PLATFORM_FEE_RATE` stays `0.0`. |
| Warehousing, fleet, cold chain, inventory ownership | This is how Twiga and Wasoko died. |
| Shopper/consumer surface | Founding constraint. |
| Composite reputation or trust scores | House rule: no number a small business cannot audit. |
| A combined `order_status` field | Rule 2.2. |
| Streaks, XP, leaderboards, gamified currency | Not this product. |
| Tender alerts, document verification, SACCO integration | Later tiers. |
| AI-suggested prices or auto-orders | Consequential actions need human approval. |
| Rewriting `stock_engine.transition()` | Extend it. The invariants are the asset. |

---

## 11. Definition of done

P0 is done when **all** of the following hold:

1. Every scenario in §9 passes in CI, including the "No money can move" scenario.
2. Every surface in §4 implements every state in §5.
3. A vendor with no history has a coherent first-run experience with no zeros
   rendered as statistics.
4. The CI guard in §8 blocks a PR that flips any payment flag.
5. `TRADE_PAYMENTS_ENABLED`, `TRADE_SETTLEMENT_ENABLED` and
   `TRADE_PLATFORM_FEE_RATE` are unchanged from their defaults on `main`.
6. A trade can be recorded end to end on a throttled 3G connection with a
   30-second disconnect in the middle of handover.
7. No new table was added where a query would do, and no existing invariant in
   §7.2 was weakened. Evidence: the existing backend suite still passes in full.

**Then, and only then**, the validation in `feature-teardown-2026.md` §11 runs
against real vendors — and its result decides whether pickup points and escrow
are built at all.
