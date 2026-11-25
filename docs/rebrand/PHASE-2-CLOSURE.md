# Wasta rebrand — Phase 2 closure record

**Status:** complete, accepted, **not pushed, not merged, not deployed.**
**Branch:** `arena/de76d74f-brief`
**Base:** `8dc756adcdffeed4983842a425039faced6f832b` (= `main` = `origin/main`)
**Head:** `49b6ef051d526bfcb584e2db810b25c6a221b13b`

Every number below was measured from the committed trees with `git show` /
`git diff`, not recalled. Where an earlier report was wrong, the correction is
stated explicitly rather than quietly fixed.

---

## 1. Commits and parent relationships

A linear, fast-forward-only chain of three commits. No history was rewritten
and nothing was force-pushed.

| # | Hash | Parent | Subject | Files |
|---|------|--------|---------|-------|
| A | `3ae7c951de92b201a488088a41aaf9d1c9d5a7bf` | `8dc756a` | Wasta Phase 2a: public pages and trust-core consistency | 8 |
| B | `2a2e7e5c304c64d0a023392b9edbac8a5ec0f56c` | `3ae7c95` | Wasta Phase 2b: trust and marketplace surfaces | 12 |
| C | `49b6ef051d526bfcb584e2db810b25c6a221b13b` | `2a2e7e5` | Wasta Phase 2c: the remaining brand references | 38 |

Local branch and `origin/arena/de76d74f-brief` both still point at `8dc756a`.
**Nothing has left this machine.**

---

## 2. Complete changed-file inventory

**55 files changed, +143 / −158** across the three commits: 54 modified and 1
renamed. No files added, no files deleted.

**Every path is under `frontend/src/`.** Zero changes to `backend/`,
`migrations/`, `Dockerfile`, `.github/`, CI config, environment or
infrastructure.

### Source files — 46

| File | Commits |
|---|---|
| `App.jsx` | B |
| `components/desk/OfferingForm.jsx` | C |
| `components/discover/HowWastaWorks.jsx` **(renamed from `HowBriefWorks.jsx`, R089)** | B |
| `components/discover/MarketplaceHero.jsx` | B |
| `components/discover/MerchCard.jsx` | C |
| `components/discover/ShopToolbar.jsx` | B |
| `components/events/EventPaymentCard.jsx` | C |
| `components/forms/EventForm.jsx` | C |
| `components/home/CounterShelf.jsx` | C |
| `components/inbox/TradePassModal.jsx` | C |
| `components/layout/Sidebar.jsx` | B |
| `components/leads/LeadLedgerPanel.jsx` | C |
| `components/page/PaymentTag.jsx` | C |
| `components/receipts/ReceiptScanner.jsx` | C |
| `components/receipts/VoucherConfirmationCard.jsx` | C |
| `components/receipts/VoucherWallet.jsx` | C |
| `components/start/StartView.jsx` | C |
| `components/trust/TrustSignals.jsx` | C |
| `components/you/PortfolioView.jsx` | A |
| `config/constants.js` | C |
| `lib/tradeRecordsCsv.js` | C |
| `pages/billing/SubscriptionPage.jsx` | C |
| `pages/create/CreatePage.jsx` | C |
| `pages/enterprise/EnterprisePage.jsx` | C |
| `pages/events/PublicRateCardPage.jsx` | A |
| `pages/explore/ExplorePage.jsx` | B |
| `pages/growth/GrowthPlannerPage.jsx` | C |
| `pages/jobs/JobsPages.jsx` | C |
| `pages/merit/MeritPage.jsx` | C |
| `pages/offers/OffersBrowsePage.jsx` | C |
| `pages/orders/OrderDetailPage.jsx` | C |
| `pages/orders/TradeRecordsPage.jsx` | C |
| `pages/page/PageEditor.jsx` | C |
| `pages/pos/POSBridge.jsx` | C |
| `pages/referrals/ReferralLandingPage.jsx` | C |
| `pages/referrals/ReferralsPage.jsx` | C |
| `pages/street/StreetPage.jsx` | C |
| `pages/surface/SurfaceFeed.jsx` | B |
| `pages/tasks/TasksPortal.jsx` | C |
| `pages/templates/TemplatePacksPage.jsx` | C |
| `pages/trades/InviteShopPage.jsx` | C |
| `pages/trades/TradeProofsPage.jsx` | C |
| `pages/trust/TrustMePage.jsx` | B |
| `pages/trust/TrustStaffPage.jsx` | B |
| `pages/trust/trustCore.js` | A |
| `pages/work/PriceWorkPage.jsx` | C |

### Test files — 9

| File | Commits |
|---|---|
| `test/brand.test.js` | A, B, C |
| `test/discoverMerch.test.jsx` | B |
| `test/leadLedger.test.jsx` | C |
| `test/marketTrust.test.jsx` | A, B |
| `test/pages.test.jsx` | A |
| `test/portfolioLanding.test.jsx` | A |
| `test/storefront.test.jsx` | A |
| `test/streetEngine.test.jsx` | C |
| `test/tradeProofs.test.jsx` | C |

---

## 3. Final brand-reference scan

Scan rule is the one `brand.test.js` enforces: every `.js`/`.jsx`/`.html` file
under `frontend/src` excluding `test/`, matching `\bBrief\b`, skipping comment
lines and five exact exemptions.

| Tree | Backlog | Source scan |
|---|---|---|
| `8dc756a` (base) | 44 files / 73 occ | — |
| `3ae7c95` (A) | 41 / 66 | — |
| `2a2e7e5` (B) | 35 / 54 | — |
| `49b6ef0` (C) | 0 / 0 | **0 files / 0 occurrences** |

The `PHASE_2_BACKLOG` map is now `{}`. Its ceiling logic is unchanged line for
line (`const allowed = PHASE_2_BACKLOG[rel] ?? 0`), so an empty map means "zero
references remain" rather than "the check was switched off". Verified by
reintroducing "Brief" into `PriceWorkPage.jsx` and confirming the guard **fails**,
then restoring it. The same negative test was run at Commit B.

### Preserved English and identifiers (5 exemptions, all verified present)

| Use | Location | Why |
|---|---|---|
| `Morning Brief` | `App.jsx` comments ×2 | the feature, a different noun from the product |
| `/brief` | `App.jsx:463`, `DeskPage.jsx:142`, `TaskTrack.jsx:32`, `SurfaceFeed.jsx`, `TasksPortal.jsx` | a route; links live in WhatsApp threads |
| `label="Brief"` | `EventDeskPage.jsx:653` | the everyday noun for a short summary |
| `NAV_BRIEF` / `"brief"` key | `Sidebar.jsx`, `TaskTrack.jsx` | exported inventory and URL segment |
| `BRIEF_LANDING_ENABLED`, `brief_stock_template.csv` | `flags.js`, download | shipped flag and filename |

---

## 4. Test and build results

Measured, not estimated.

| Check | Result |
|---|---|
| Full frontend suite (`vitest run`) | **729 passed / 729**, 98 files |
| Production build (`vite build`) | **✓ 11.21s** (Commit C); 10.48s (A); 10.18s (B) |
| Build warnings | only the pre-existing `>500 kB` chunk-size advisory |

Run after **each** of the three commits, not once at the end.

### Seven pre-existing failures were resolved, and proven pre-existing

At `8dc756a` before Phase 2, seven tests were already failing. Proven by
stashing the Commit A work and re-running the four affected suites at the base
commit — the same seven failed there. Causes: stale assertions against Phase 1
copy, and two address tests asserting `*.vendorworld.ke`, a domain that was
never registered and that `pageAddress()` correctly no longer produces.

Two bugs in the guard itself were also fixed, both introduced during Phase 1a
and invisible because Phase 1a ran no tests:

- `Brief_` was matched case-insensitively, flagging the live feature flag
  `BRIEF_LANDING_ENABLED` and the filename `brief_stock_template.csv`. Now
  case-sensitive — which is what a stray underscore actually is.
- The brand-core check read raw file text, so `brand.js`'s history comment
  counted as a live offender. Comments are now stripped first.

Both narrow false positives; neither widens what may pass.

---

## 5. Explicitly preserved

### Routes and navigation

No route path was added, removed, renamed or reordered. `/brief` still
redirects to `/me`. `/tasks/brief` is still reachable and `TaskTrack` still
redirects there. `DeskPage` still links to `/brief`. `SurfaceFeed`'s door still
points at `/brief` — only its **label** changed to `Workspace`. `NAV_BRIEF`
keeps its exported name and its three paths.

APIs, database fields, integrations, permissions and business logic: untouched.
The entire diff is string literals, comments and JSX text nodes.

### Financial safeguards

The product must not hold client capital or lend. Every disclaimer retained its
meaning *and its negative*:

| Location | Final text |
|---|---|
| `EventPaymentCard.jsx:22` | "…They mark it received; **Wasta does not hold the money.**" |
| `EventForm.jsx:102` | "Money goes directly to you. **Wasta never collects or holds it**…" |
| `CounterShelf.jsx:137` | "Records only. **Wasta holds no money for you and lends you none**…" |
| `PaymentTag.jsx:37` | "**Wasta does not hold the money** or confirm the payment." |
| `MeritPage.jsx:256` | "**Wasta holds no funds and lends none.**" |
| `PageEditor.jsx:198` | "**Wasta never collects or holds it**…" |

The trade-record disclaimer ("not a receipt, an invoice, or a tax document")
survives verbatim in `tradeRecordsCsv.js:4` and `TradeRecordsPage.jsx:17`.
"Nobody is paid from Wasta", "Wasta moved no money" and "Wasta sent it nowhere"
keep their negatives. No payment or ranking behaviour changed; no paid ranking
was introduced.

### Trust and verification semantics

- "This shop already has a **verified** Wasta page" — the `verified` state is
  unchanged; probationary and unverified branches untouched.
- `TrustStaffPage`'s non-staff branch is intact: the server still refuses
  anyone who is not staff, and still refuses anyone checking their own business.
- `TrustMePage` still states a shop waits for a check before it appears.
- `TradeProofs` "Not on Wasta" still marks the unmatched state, and the
  not-yet-listed sentence still says nobody can confirm it.
- "Wasta has not checked this rider" retains its negation.
- `trustCore.js` `STATUS_LABEL` now agrees with `lib/i18n.js`, which had already
  said Wasta — the same badge had been rendering two different names.

---

## 6. Correction to Commit A's backlog count

**Commit A's message contains a false statement.** It reads:

> PHASE_2_BACKLOG tightened: 3 rows removed, 14 -> 11 files.

The arithmetic is **44 − 3 = 41**, and 41 is exactly what Commit A produced when
measured from its tree. The "14 → 11" matches no measurement at any commit. It
was written into the commit message and repeated in the report before being
checked.

**Correct figures:**

| Point | Files / occurrences |
|---|---|
| Base `8dc756a` | 44 / 73 |
| After A | **41 / 66** |
| After B | 35 / 54 |
| After C | 0 / 0 |

The commit's *content* is correct; only that one sentence is wrong. It was left
in history rather than amended, because rewriting history is prohibited.

A second, smaller error: Commit B left one stale row
(`pages/explore/ExplorePage.jsx`), so the backlog read 35/54 while a live scan
measured 34/53. That row was removed in Commit C.

---

## 7. Outstanding issues

### 7.1 "Home office" terminology — deferred, 13 frontend files

The label is live on `/office` and in the navigation drawer. It was deferred by
owner decision before Phase 2 and is **not** part of the brand-name work: it is
a separate terminology question, not a leftover "Brief".

Measured scope, frontend (`frontend/src`, excluding tests) — **exactly 13 files**:

| # | File | Rendered? |
|---|---|---|
| 1 | `App.jsx` | comment |
| 2 | `components/home/IdentityStrip.jsx` | comment |
| 3 | `components/layout/Sidebar.jsx` | comment |
| 4 | `components/office/SavedItemsPanel.jsx` | **3 rendered** |
| 5 | `components/you/YouView.jsx` | **3 rendered** |
| 6 | `config/flags.js` | comment |
| 7 | `config/identity.js` | **1 rendered** |
| 8 | `config/navigation.js` | **1 rendered** (the nav label) |
| 9 | `hooks/useOffice.js` | comment |
| 10 | `lib/api.js` | comment |
| 11 | `pages/home/TodayPage.jsx` | comment |
| 12 | `pages/office/OfficeJoinPage.jsx` | **3 rendered** |
| 13 | `pages/office/OfficePage.jsx` | **3 rendered** (incl. two `<h1>`) |

Rendered occurrences: **14** across 7 files. Comment-only: 6 files.

**The frontend is not the whole problem.** The backend also returns
user-facing "Home office" strings, so a frontend-only rename would leave the
API and the UI disagreeing:

- `backend/app/modules/office/service.py:147` — default office name `"Home office"`
- `backend/app/modules/office/service.py:545` — privacy label `"Home office"`
- `backend/app/modules/office/service.py:561`, `:630` — validation messages
- `backend/app/modules/office/service.py:429` — iCalendar `PRODID:-//Brief//Home office//EN` (also still says **Brief**)
- `backend/app/main.py:373-374` — OpenAPI tags `"Home office"`

Also outside `frontend/src`: 6 test files assert the exact string, `logo.svg`
carries two comments recording the retired wordmark, and `stores/*.js` use
`homeoffice-…-v1` localStorage keys that must not be renamed (renaming would
orphan every existing user's saved data).

### 7.2 Trademark and domain clearance

`BRAND.domain` is intentionally `""` — `vendorworld.ke` was display-only, never
registered, never referenced by `VITE_PAGE_DOMAIN`. `pageAddress()` therefore
returns `/p/{handle}`. No trademark search, domain registration or market
clearance for "Wasta" has been performed. **This cannot be settled in code.**

### 7.3 Canonical production host

Undecided and owner-owned. Both Vercel and Railway currently serve production
at `8dc756a`. Vercel's last deployment (`dpl_GJh8WNriTsf2DyGKX9qvGoFVwSJG`,
`brief-brief7.vercel.app`) is READY but is behind the branch by three commits.
Railway is owner-run and was not reachable from this environment. Choosing the
canonical host is a decision, not a task.

---

## Next proposed work

A **separate terminology audit** of the "Home office" label — classify every
occurrence (rendered vs comment vs identifier vs stored key vs API contract),
propose consistent Wasta terminology, and recommend a ruling **before** any
implementation is requested. It must be approved as its own piece of work; it
is not a Phase 2 remainder.

Nothing in this record was pushed, merged or deployed.
