# Outside — deprecated features and compatibility decisions

Every entry here says what changed, what was preserved, and why. Nothing was
deleted that another module reads.

## 1. Trade value removed from public identity

**What changed.** `frontend/src/pages/vendor/VendorProfile.jsx:617` rendered
`label="Trade value"` with `currency(perf.total_trade_value)` on a **public**
profile — a person's worth, as a KSh figure, on the page anyone could open.
That stat is gone, replaced by `Completed` (`vendor.movements_completed`),
which counts things a person followed through on and exists for everyone,
including someone who has never sold anything.

**What was preserved.** Everything underneath:
* `vendor_performance.total_trade_value` — column untouched.
* `GET /api/analytics/*` — still returns `trade_value`, `supplied_value`,
  `sourced_value`, `share_of_network_pct` with the same values.
* `backend/tests/test_v22.py` — all 8 trade-value assertions still pass
  unmodified.

**Why.** A market-value score on a public profile says that a house party, a
community cleanup and a request for company are worth zero. They are not; they
are content. The brief's rule — "trading is a capability, not the identity of
the application" — cannot hold while the profile leads with a currency figure.

## 2. Trade value demoted in your own analytics

**What changed.** In `frontend/src/pages/analytics/Analytics.jsx`, the hero
`<Stat label="Trade value">` moved out of the first grid. The first grid now
leads with `Movements settled` and `Counterparties`; trade value sits in the
second row with the hint *"commerce only — your events, posts and requests
aren't counted here."*

**What was preserved.** The label, the value, the API field and the test
(`v22.test.jsx:260` asserts the text renders — it still does). This is your own
private business report on real settled movements; the objection was to it
being the first thing the app says about you, not to it existing.

## 3. Forced onboarding modal removed from the shell

**What changed.** `components/layout/Shell.jsx` no longer renders
`<OnboardingFlow />`. It previously mounted on every screen and opened itself
whenever `GET /api/onboarding` reported `completion < 1` — i.e. until the
person had completed a *business profile* and walked a market radar. That is
shelf-specific onboarding: you had to set up a shop before the app was usable.

**What replaced it.** `components/home/LocationPrompt.jsx` — an inline,
dismissible card on Home that asks for the one thing Outside actually needs
(a location), offers the typed fallback, and never returns once dismissed
(`localStorage` key `outside.onboarding.dismissed.v1`).

**What was preserved.** `components/onboarding/OnboardingFlow.jsx`,
`SetupChecklist.jsx` and `GET /api/onboarding` are all still in the tree and
reachable. They stopped interrupting; they were not removed.

## 4. Navigation relabelled, not removed

`Home · Browse · Work · Inbox · Business` became
`Home · Explore · Create · Activity · Profile`.

**Every v3 URL still resolves** and still highlights exactly one tab — the
`EXPLORE_ROOTS` / `ACTIVITY_ROOTS` / `ME_ROOTS` arrays in
`config/navigation.js` absorb the old destinations, and
`isBrowsePath` / `isWorkPath` are kept as aliases so anything importing them
keeps working.

**The one test change this required:** `src/test/navigation.test.jsx` pinned
the old labels and the old area membership. It was rewritten to pin the new
map, and gained a test the old one lacked — that no path ever highlights two
tabs.

## 5. Design tokens retuned in place

**What changed.** Values in `frontend/src/styles/tokens.css`, and the type
scale in `tailwind.config.js` (`4xl` 2.25rem→1.875rem, `5xl` 3rem→2.25rem) so
headings stop competing with content.

**What was preserved.** Every token *name*. `bg-brand-500`, `text-ink-3`,
`border-edge-1`, `shadow-glass` and every other existing usage resolves
unchanged — this is a re-skin, not a refactor of 199 files.

Two naming decisions worth recording:
* `--orchid-*` keeps its legacy name but is now a cool slate (was purple), used
  for identity and selected state. Renaming it would have touched every
  component using it for no user-visible gain.
* `--accent-*` was darkened from `245 158 11` to `217 119 6` at the 500 step so
  amber text reaches 4.5:1 on white. The ramp shifted down one step; `accent-50`
  through `accent-400` are unchanged.

## 6. Not deprecated, deliberately

* **`network_score` and `parasitism_index`** (121 references). These score
  *relationships*, not money — fulfilment rate, reciprocity, contribution,
  reliability. They are not trade-value scoring and they stay.
* **`GET /api/surface/feed`** — still mounted. Outside's feed is a new endpoint
  with location and ranking; the old one is untouched for anything reading it.
* **Prices everywhere** — `StockItem.unit_price`, `Event.entry_fee`,
  `BusinessRequest.budget_kes`, `ToolListing.price_per_unit` were already
  nullable and remain so. The change is that no UI or validator now treats a
  missing price as an incomplete record.

## 7. Known limitations carried forward

* **Post audiences are coarse.** `visibility: community` currently resolves to
  "author only" because there is no post-to-community membership model yet.
  `_authorised_row()` in `router.py` says this explicitly rather than silently
  widening access.
* **Activity has no notification preferences yet.** `GET /activity` returns a
  `preferences` block with an empty `muted_groups` so the control can be added
  without an API change.
* **Unread chat counts are client-side.** `chat_room_participants` has no
  read-state column, so `/activity` reports rooms and rooms-active-today rather
  than inventing an unread number the schema cannot support.
* **Search pagination recomputes scores per page.** The cursor is
  `(created_at, id)` applied *before* ranking, which guarantees no duplicates
  across pages but means a page boundary is not a strict global rank cut.
