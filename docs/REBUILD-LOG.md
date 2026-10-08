# Rebuild log — layers 3 → 5

Companion to `docs/PRODUCT-ARCHAEOLOGY.md`. That document is the map of the
existing product; this one records every change made on top of it, in the form
the brief asked for:

> **what is changing · why · what old behaviour it replaces · is the underlying
> functionality preserved**

Nothing below changes a backend endpoint, a payload, a state machine or a
permission rule. The one rule applied throughout: **if a mechanic is part of
the core loop, it is preserved and re-presented, never removed.**

---

## Layer 3 — design system (done)

| Change | Why | Replaces | Functionality preserved |
|---|---|---|---|
| Light-first theme with a true dark peer (`.dark` on `<html>`, persisted) | Daylight market use; the old dark-only UI was unreadable outdoors | Permanent near-black surface | Yes — same screens, both themes |
| Trade green `#16A46A` as the single action colour; heritage amber demoted to `accent` (money, markets, stated prices) | One action colour makes the next step obvious; amber kept where it already means "value" | Amber-as-everything | Yes |
| Hairline borders restored; 12px meta floor (`text-2xs`), 11px only for uppercase eyebrows | 10px grey-on-grey was unreadable | Borderless glass panels, 10px type | Yes |
| DSEG7/Orbitron webfonts dropped; seven-segment numerals behind `<DigitalNumber segmented />` | Two decorative webfonts for display numerals cost more than they gave | App-wide seven-segment digits | Yes — the component still exists for the POS/ops surfaces that earn it |
| `aria-pressed` / `aria-selected` / `role="alert"` + visible focus rings everywhere; `prefers-reduced-motion` honoured | Keyboard and screen-reader users could not tell what was selected | Colour-only state | Yes |

## Layer 4 — the core loop, rebuilt as destinations

### 1 · `/browse` — network stock gets its own screen
* **What** The "Network" tab of the Stock Room becomes `/browse`, with
  URL-driven `search / category / sort / quality / stock` state, a category
  chip rail and a quality-ladder filter.
* **Why** Discovery was the third tab of the *seller's* screen — the one place
  a buyer never goes. It is half the core loop and had no address.
* **Replaces** `/stock?tab=network` (which now redirects, with its query
  string intact).
* **Preserved** Same `GET /stock/network-stock` call with the same
  `category / search / min_quantity` params. Sort and the quality filter are
  client-side over the rows the API already returned — no new endpoint, no
  new ranking authority.

### 2 · `/listing/:id` — a canonical page per item
* **What** New page: evidence column (hero, description, four facts,
  provenance, tags, alternatives) + a sticky order panel.
* **Why** An item could only be seen inside a card and ordered through a
  modal. A sourcing decision needs provenance, supplier record and
  alternatives on one screen, and a shareable URL.
* **Replaces** Nothing — `SourceDialog` still exists and still works from
  every card. `/stock/:id` redirects here.
* **Preserved** The order panel posts the **identical** payload
  `POST /stock/{id}/source { quantity, proposed_price, notes }`, respects
  `min_order_quantity`, and caps quantity at `quantity_available`
  (`in_stock − reserved`), never raw in-stock. Alternatives come from the
  existing `GET /stock/{id}/alternatives`.

### 3 · `/orders` — movements, promoted out of a tab
* **What** New destination with All / Incoming / Outgoing / Needs-me filters,
  four counters, and a four-step pipeline rail on every row.
* **Why** The second half of the loop was invisible unless you opened the
  Stock Room's third tab. "What is waiting on me" is the reason to open this
  app at all.
* **Replaces** `/stock?tab=movements` (redirects) and `/movements`.
* **Preserved** `movementActions(m)` — the role-gated confirm / ship /
  receive / cancel state machine — is unchanged, verbatim. `needsMyAction(m)`
  is the store's existing predicate, not a new rule.

### 4 · Home — a marketplace, not a tile wall
* **What** Search-first hub: scoped search → *needs your action* → first-run
  setup → the ten doors → fresh network listings → ranked suppliers → the
  honesty line.
* **Why** Ten equal-weight tiles signpost nothing (the app's own UI report
  said so). The fastest path to the core action now leads the screen.
* **Replaces** The tile wall as the *entire* home.
* **Preserved** **All ten doors are still there**, still counting live rows,
  still rendering `—` for zero, still opening the screen that owns the
  detail. No section was deleted; they were re-weighted.

### 5 · `/@handle` — a shop front
* **What** Cover band + identity/trust header, four judgement numbers
  (fulfilment meter, supplier level, network score, give-&-take), then tabs:
  Shelf · Trade record · About.
* **Why** This is the page every card, movement and chat room links to. It
  has to answer "can I trust them, and what can I buy" above the fold.
* **Replaces** Header card + four stats + grid.
* **Preserved** Same endpoints, same edit drawer with the same fields, same
  `?edit=1` deep link, same connect/message, same `SourceDialog`. The Trade
  record tab surfaces `GET /vendors/{handle}/performance`, which the API has
  always returned and nothing rendered.

### 6 · Honesty fix — no invented sample sizes
* **What** Listing cards used to derive a *supplier level* from
  `vendor_fulfillment_rate` plus a hard-coded `movements_completed: 3`.
  They now show `FulfilmentChip` — the rate the API actually gave.
* **Why** A level needs both a rate and a sample size. Faking the sample
  dressed an unrated vendor as Level 1, which breaks the product's core
  promise that scores are earned.
* **Preserved** `LevelBadge` is unchanged and still used where the real
  completed-movement count is available (shop front, listing supplier card).

## Layer 5 — market-ready polish (in progress)

| Change | Why | Replaces | Preserved |
|---|---|---|---|
| `AuthPage` pitch panel explains the **loop** (publish → source → record) | A B2B network has to explain the mechanic, not list features | Three feature bullets | Yes |
| Registration groups four optional fields behind a disclosure | Eight required-looking fields is the biggest signup drop-off; only four were ever required | A flat eight-field form | Yes — identical register payload and validation |
| `SetupChecklist` on Home: four first-run steps | New vendors landed on an empty network with no first move | Nothing (there was no onboarding) | Additive; dismissible; never blocks |
| Last three amber glow shadows removed (auth wordmark, auth tab, chat room list) | Leftovers from the dark/amber era | `shadow-[0_0_…rgba(245,158,11,…)]` | Visual only |
| Search scope label "Stock" → "Listings" | The home door and the search scope were the same word | Label only (`value: "stock"` unchanged) | Yes |
| Fixed a codemod regression: `bg-accent-\2/\3` in 7 files | Legacy octal escapes broke the esbuild transform — the test suite could not even compile | Broken class strings | Yes |

---

## Verification

```
cd frontend && npx vitest run     # 9 files, 85 tests, all passing
cd frontend && npm run build      # clean, every page code-split
```

* The 77 pre-existing tests still pass unchanged in intent. Two edits were
  needed: `homeSurfaces.test.jsx` gained `stockAPI` / `vendorAPI` mocks because
  the home hub now shows real listings, and its door assertions are unchanged.
* New spec `frontend/src/test/marketplace.test.jsx` (8 tests) locks the
  rebuilt loop: URL → endpoint params, available-not-in-stock, the unchanged
  source payload, the direction filter, and confirm/ship/receive.
* Every endpoint the new screens call was smoke-tested against the running
  demo backend: `network-stock`, `stock/{id}`, `alternatives`, `movements`,
  `vendors/{handle}`, `vendors/{handle}/performance`, `connections`,
  `suggested` — all 200.

## Still open

1. `/chat` deal rooms — not yet re-presented (the negotiation half of the loop).
2. Stock Room (`/stock`) — still the v2 shelf; needs the owner-side rebuild now
   that browse and orders have moved out of it.
3. Responsive + motion pass over the remaining secondary screens.
4. Copy pass on the ten discovery surfaces.
