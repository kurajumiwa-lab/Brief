# The six engines, audited against the code that claims to run them — and the five broken workflows

> **Provenance.** Written 2026-11-27 on branch `arena/e57ef493-brief` @ `290c8f7`
> (`main` after PR #147). Every count below was measured on this checkout in this
> session; every claim about code cites a path. Claims are labelled
> **[Built]** (read in this repo), **[Measured]** (a command run today),
> **[Missing]** (searched for, not found), **[Gated]** (exists, switched off by
> default) or **[Decision]** (a product owner must choose; engineering cannot).
> This brief contains no new scope. It demonstrates understanding of how people
> work inside the ecosystem, maps what exists onto the six engines, names the
> five most commercially important broken workflows, and proposes a prioritised
> plan with acceptance criteria. Nothing here authorises money movement, a
> take-rate, escrow, or any change to the trust position.

---

## 0. Measured baseline (this checkout, 2026-11-27)

| Check | Command | Result |
|---|---|---|
| Backend suite | `python -m pytest -q` (venv, bundled PostgreSQL 16) | **1148 passed, 1 skipped** [Measured] — README's "one pre-existing failure in `test_smoke.py`" no longer reproduces |
| Frontend suite | `npx vitest run` | **4 failed, 835 passed** across 107 files [Measured] — see §6.0a |
| Production build | `npm run build` | exit 0, ~10 s [Measured] |
| Migrations | `backend/alembic/versions` | 83 revisions, single head `0083_merit` [Built] |
| Routes | `frontend/src/App.jsx` | 138 `<Route>`s [Built] |
| Backend endpoints | `grep -rhoE '@(router\|public)\.(get\|post\|put\|patch\|delete)'` | **830** decorators across `routes/` (43 files) + `modules/` (48 packages) [Built] |
| CI | `.github/workflows/` | **absent**; prepared at `docs/ci/ci.yml` [Built] — so a red suite on `main` is invisible |

The two facts that shape everything below:

1. **The build is green, the frontend bar is red, and nothing enforces either.**
   Production ships from a repo whose only merge gate is human attention.
2. **Anatomy is unusually complete; physiology has a broken organ.** The six
   engines from the strategy brief all have real code. The connective tissue
   that turns a stranger into a customer into a reviewed trade does not run
   end to end — it dead-ends at WhatsApp, and the owner is never told.

---

## 1. How people actually work in here — the four personas, walked through the plumber's ten steps

The strategy brief's worked example (a Nairobi plumbing company) is the right
probe, because it exercises every engine in sequence. Below is each step, where
it lives in this repo, and whether it actually works today.

| # | Step | Where it lives | State |
|---|---|---|---|
| 1 | Creates business profile | `pages/you/IdentityPage`, `professional_card` module, `VendorProfile` | [Built] |
| 2 | Publishes services and service locations | `modules/offerings` (prices, modes), `modules/service_directory`, `pages/page/PageEditor`, `/location-hex` (migration `0080`) | [Built] shapes exist; location *targeting* of demand does not (nothing routes jobs by area yet) |
| 3 | Customers discover it through search | `BrowsePage`/`ExplorePage` in-app [Built]; `/trust` public directory of checked shops [Built]; Google: **nothing** [Missing] — no `robots.txt`, no `sitemap.xml`, Googlebot is served the static SPA head [Missing] | **Broken for strangers** |
| 4 | Customers submit enquiries | `PublicPage` has exactly one CTA: a WhatsApp deep link (`wa.me/...`). Service bookings require sign-in (`Depends(get_current_vendor)` in `routes/bookings.py`). The Business Desk catalogue (`/api/catalog/enquiries`) is for people buying Brief's own offers and is reviewed by *Brief's ops*, not by the plumber [Built — but pointed at the wrong thing] | **Missing** |
| 5 | Business converts enquiries into jobs | `modules/trade` (request → offer → accept, with fit check and watches), `modules/hiring` (free job board), `squad`/`hustle` (job calls, contracts), `DeskPage`/`RequestCard` [Built] | [Gated as a *demand* path] — every one of these starts from a network member or from Brief's own catalogue, never from a public enquiry |
| 6 | Workers receive assignments | `routes/squad.py` (contracts with start/complete/confirm/rate), `modules/corridor_tasks` (scout tasks), `TasksPortal`, `calendar/BookPage` | [Built] for network work; unreachable from a public lead |
| 7 | Owner tracks execution | `DeskPage`, `WorkPage`, `orders/OrderDetailPage` (polls every 15 s), `TaskTrack` | [Built] |
| 8 | Customers pay and leave genuine feedback | Payments: **record-only**, `TRADE_PAYMENTS_ENABLED=false`, `PSP_PROVIDER=mock` [Gated, deliberately — see P0 directive]. Feedback: `modules/social_trust` (delivery reports, stock proofs, public card), `modules/ratings` (post-trade, transaction-linked) — **but `POST_TRADE_RATING_GATE_ENABLED=false` in backend *and* frontend flags, so every rating route returns 404** [Gated off]; reviews (`routes/reviews.py`) are reviews of *lists*, not of trades | **Incomplete** |
| 9 | Business sees conversion and performance analytics | `routes/analytics.py` — trade analytics (counterparties, price position, trend). `/api/ops/measurement` — activation/repeat metrics, behind `require_operator`, i.e. Brief's staff only, and `MARKET_OPS_ROLES=""` means **nobody qualifies in a fresh deploy** [Gated]. There is no page-view → click → enquiry → won funnel anywhere [Missing] | **Missing** |
| 10 | Improves marketing based on results | Referrals (`modules/referrals`, public codes), receipt rewards (`modules/town`), GrowthPlanner, Morning Brief — all [Built], all running on *trade* data, none fed by acquisition data (because #9 doesn't exist) | **Hollow** — the loop closes on no inputs |

**The one-sentence physiology failure:** every path into this platform that
starts outside it — a Google search, a friend's WhatsApp forward of a shop
page, a receipt scan — terminates in an untracked, unmeasured WhatsApp
conversation, and the business is handed a beautiful record of trades it
already had but no evidence its page produced anything.

### The four personas, in one paragraph each

- **The worker** arrives for income. Today they can be *given* work (squad job
  calls, corridor tasks, bookings, the free job board) and they can *build* a
  page that proves record of work. They cannot be *found by a stranger with
  money* except through WhatsApp forwarding, and they will not know the
  difference, because no event tells them.
- **The business owner** arrives for customers and operational relief. The
  operating side genuinely works — requests, offers, orders, stock, tasks,
  records, ratings gates. The customer side is a poster on a wall with no
  letterbox: views are uncounted, clicks are uncounted, enquiries do not
  exist, so the page's only provable output is trade the owner already had.
- **The stranger** (the plumber's actual customer) is served one static HTML
  head regardless of which business is being looked at, then one button. They
  cannot book, enquire, or see whether this business is *actually* verified —
  they can see "Verified" badges on registrations, but with `VERIFIER_HANDLES=""`
  there is nobody allowed to confer one in a fresh deploy [Gated].
- **The enterprise buyer** (a county hospital, an NGO, a SACCO) needs a
  defensible shortlist: verified standing, traceable work, accountability.
  `modules/enterprise` is *field-workforce tooling* — workspaces, managed
  Android devices, remote commands. There is no RFQ, no shortlist export, no
  supplier pack. The Kenya opportunity-network beachhead (health-sector
  document-gated supply) is designed in `docs/briefs/kenya-opportunity-network-strategy.md`
  and is **not built**; only its keystone — the standing passport — exists.

### Brief's own ops, the fifth persona

A fresh production deployment has **no human backstop enabled**:
`MARKET_OPS_ROLES=""` (Business Desk enquiry inbox dark), `VERIFIER_HANDLES=""`
(verification desk refuses everyone), `GOVERNANCE_COOPERATIVE_ENABLED=false`,
`POST_TRADE_RATING_GATE_ENABLED=false`, `FREE_FOR_NOW=true`,
`TRADE_PAYMENTS_ENABLED=false`. Each default is deliberate and individually
defensible. Collectively they mean: **a deploy nobody has configured is a
brochure, not an ecosystem.** That is a launch-checklist problem disguised as a
config detail, and §5-P0 treats it as one.

---

## 2. Module dependency map — the six engines as built

Read this as: engine → the code that implements it → what it depends on →
what silently degrades when the dependency is missing.

| Engine | Built here (paths) | Feeds / depends on | When the dependency is absent |
|---|---|---|---|
| **01 Talent & opportunity** | `modules/hiring` (free-to-apply jobs), `squad`/`hustle` (job calls → contract → confirm → rate), `modules/corridor_tasks` + `ScoutMarketplacePage` (field tasks), `modules/offerings`, `service_directory`, `professional_card`, `/jobs`, `/work`, `/tasks`, `/desk` | Depends on 06 (ratings finality), 02 (work orders), notifications. Feeds 05 (merit inputs) | Worker never hears the job call; squad contracts complete into silence |
| **02 Business operating** | `modules/trade` (request/offer/fit/watches), `modules/orders` (live order journey, delivery quotes, settlement state machine), `modules/stock`, `office/`, `modules/routine(s)`, `TaskTrack`, `DeskPage`, `orders/OrderDetailPage` | Depends on 06 (counterparty trust), storage, outbox. Feeds 05 (ledger, analytics) | The desk is an inbox of record, not a control room; nothing reaches the field worker |
| **03 Discovery & trust** | `modules/social_trust` (public card, delivery reports, stock proofs, `/api/social-trust/public/{handle}`), `modules/trust` (MarketTrust shops/branches/reviews, `/api/trust/public/*`), `modules/standing` (passport: claims → documented → verified, readiness checklists, expiry sweep), `services/discovery.py` (explainable ranking, fixed weights, reasons attached), `modules/merit` (six capped evidence families, decay shown not silent), `network_search`; `/page/:handle`, `/p/:handle`, `/@handle`, `/trust` | Depends on verifiers existing (06), ratings gate (06), `is_verified` (which nothing sets — see Mall). Feeds 01 (who gets the work), 04 (the destination demand lands on) | A stranger cannot distinguish proof from posture at the moment of decision |
| **04 Marketing & demand** | `modules/referrals` (public codes, campaigns, operator-verified conversions), `modules/town` (receipt rewards → referral index → scout lead fees), `modules/growth` (planner), `modules/leads` (scout leads + monthly statements), Morning Brief, `services/og_cards.py` (share images), share-card meta for `/p/:handle`, `/e/:slug`, `/invite/:slug` — injected server-side, **only for chat-app crawlers** | Depends on 03 (a destination worth landing on), notifications (reach), acquisition events [**Missing**]. Feeds 01/02 (enquiries, jobs) | Demand exists only where a human forwards a link; nothing compounds |
| **05 Data & intelligence** | `routes/analytics.py` + `analytics_service` (trade-only), `modules/measurement` (activation/repeat/completion — operator-only), `modules/pulse`, `price_index`, `platform/event_outbox` (raw event log; **drain() is a durable no-op — zero consumers** [Built]) | Depends on every engine (it is the projection of all of them). Feeds 01/02 (what to do next), ops gating (k-anonymity: `BENCHMARK_MIN_VENDORS=25`, `..._PER_CELL=5`) | Intelligence is a histogram of what already settled, not a signal of what is coming |
| **06 Trust & transaction** | `modules/standing` (verify lifecycle, verifier desk, expiry reminders), `modules/ratings` (transaction-linked, **404 unless enabled**), `modules/billing` (subscription state machine; `billing_live()` honestly returns `False` under mock PSP [Built]), payments/custody ledger (**records; never holds** — `TRADE_PAYMENTS_ENABLED=false`), `chamas`/`murabaha` (group/halal flows), `modules/governance` (cooperative, `GOVERNANCE_COOPERATIVE_ENABLED=false`) | Depends on config (ops roles, verifier allowlist), legal basis flags. Feeds every engine (it is the substrate) | The flywheel turns on nothing; three of five trust mechanisms are dark in a default deploy |

**Cross-cutting facts the map must carry:** the backend runs two generations of
structure (`app/routes/` 43 files, `app/modules/` 48 packages) — both live,
both registered in `app/main.py`; notifications are **pull-only**
(`notificationAPI.list` consumed by the Inbox; no push/SMS/email code exists
anywhere in the backend [Missing — searched `twilio|africastalking|sendgrid|mailgun|ses|resend|smtplib`]);
there is no service worker and no `manifest.json` (the capabilities report's
"absent: service worker/offline queue" still holds); the outbox is the designed
seam for intelligence and has no consumers.

---

## 3. The five most commercially important broken or incomplete workflows

Ranked by what a paying cohort would actually touch first. Each is systemic —
each is *the* missing link in a journey the rest of the codebase already serves.

### W1 — A stranger cannot become a customer: demand capture is absent on the public surfaces

**The workflow:** Google/WhatsApp/referral → `/page/:handle` → *do something that
reaches the business inside Brief* → owner sees it → converts it to a job.

**Where it breaks:** the public page's only interactive element is
`https://wa.me/{phone}` (`PublicPage.jsx`, validated to Kenyan mobile format).
Bookings require an authenticated vendor account (`routes/bookings.py`). The one
public-facing enquiry endpoint that exists (`POST /api/catalog/enquiries`) is for
Brief's own desk catalogue and is routed to Brief's market-ops inbox, whom the
plumber is not. There is no `page_enquiry` table, no "source: page" attribution,
no convert-to-job action. [Missing]

**Commercial weight:** this is step 4 of the journey and the entry to steps
5–10. Without it, every other investment — pages, standing, merit, growth —
produces no attributable demand. It is the difference between "a very good
record-keeping app" and "an ecosystem."

**Honest constraint:** the WhatsApp button must stay. Most Kenyan trade closes
on WhatsApp and always will; the fix captures intent *in addition to* the
hand-off, it does not replace it.

### W2 — The stranger never arrives: business pages are invisible to search

**The workflow:** customer searches "plumber Nairobi West" → lands on the
business's Brief page → trust is established from the URL → W1.

**Where it breaks:** (a) no `robots.txt`, no `sitemap.xml` [Missing]; (b)
`vercel.json` sends only chat-crawler user agents (`WhatsApp|facebookexternalhit|…`)
to the meta-injecting backend handler — **Googlebot gets the static SPA shell**
whose `<title>` is `Wasta — The power of the right connections.` and whose
`og:site_name` is hardcoded `Home Office` (`backend/app/routes/public_pages.py:77,157,162`) —
three product names in one head; (c) no JSON-LD `LocalBusiness`; (d) no
per-page canonical for crawlers; (e) the share-card routes (`/p/:handle`,
`/invite/:slug`) work for WhatsApp, which means the *only* demand channel with
working metadata is human forwarding. [Missing]

**Commercial weight:** "every credible business and professional should have a
discoverable digital destination that can attract demand from Google" is
engine 04 and step 3 of the journey; today the destination exists but the road
into town is unpaved. This also devalues W1's fix — an enquiry form nobody can
find captures nothing.

### W3 — The owner is blind to the funnel: there is no acquisition analytics anywhere

**The workflow:** owner opens Analytics → sees *views → contacts → enquiries →
won → KES recorded*, understands which page edits and posts move it, acts.

**Where it breaks:** `routes/analytics.py` serves trade analytics only (value,
units, counterparties, price position — no views, no contacts, no enquiries).
`/api/ops/measurement` is activation/repeat/completion — for **Brief's
operators** (`require_operator`), not the owner, and measures whether software
was used, not whether it produced customers. No event table records a page
view, a contact click, or an enquiry; no owner-facing surface renders a
funnel. [Missing]

**Commercial weight:** step 9 and step 10 are the entire compounding loop —
proof of value → retention → expansion → referral. Without it the platform
cannot demonstrate ROI to a cohort, cannot price anything on value, and cannot
tell a business its page sent it three jobs worth KES 45,000. It is also the
measurement half of `defensible-trade-loop-validation.md` — you cannot run the
validation cohort without funnel instrumentation.

### W4 — Trust does not reach the stranger: the flywheel is wired but switched off

**The workflow:** stranger lands on the page → sees *evidence that survives
scrutiny* (verified claims with an audit trail, a count of completed jobs, a
rating from people who paid) → dares to enquire.

**Where it breaks:** (a) `VERIFIER_HANDLES=""` — the passport's verifier desk is
disabled in a default deploy; no claim can become `verified`, so the passport
is permanently theoretical [Gated]; (b) `POST_TRADE_RATING_GATE_ENABLED=false`
in backend (`config.py`) *and* frontend (`config/flags.js`) — every
transaction-linked rating endpoint returns 404, so the review would-be
automatic on completed bookings/movements does not exist [Gated]; (c) what is
public today is self-declaration (page credentials marked `Verified` only when
already `verified` — but none can be), plus self-reported completed bookings;
(d) `Mall`'s `is_verified` gate is client-side with the server gate explicitly
"not built yet" (comment in `Mall.jsx`). [Gated / Missing]

**Commercial weight:** engine 03 is the substrate for 01, 02 and 06. Every
seeded demo can look perfect to a friend and hollow to a stranger. Worse, the
trust that *does* exist (merit, standing, social_trust) is computed but
under-shown: merit/rank is visible inside the app, not as decision-grade
evidence beside the WhatsApp button.

**Honest constraint:** enabling these flags is not just a deploy edit — it
appoints humans (verifiers, moderators). The engineering deliverable is the
route to *on*, the runbook, and the k≥5 aggregation rules, not a flipped bit.

### W5 — The platform cannot reach the person: notifications are pull-only

**The workflow:** enquiry/job-call/watch-match/payment event → owner is notified
→ owner acts within the customer's attention window (~hours in Kenya's trade
market).

**Where it breaks:** there is no push, no SMS, no email path in the backend
[Missing — searched]. The Inbox is read-on-open pull; `OrderDetailPage` polls
only while the screen is open; there is no service worker, so a closed browser
gets nothing; the watch-notification machinery (a *perfect* push payload — "a
request matching your watch was posted") fires in-transaction but lands where
nobody is looking. [Missing]

**Commercial weight:** engine 02/04 collapse without reach. An enquiry answered
in 4 hours converts; one answered in 4 days is a dead lead the business will
blame on "the app." This is also a cohort-retention issue: the notification is
the only thing that pulls a business back after day 3.

---

## 4. Explicitly not in the five, and why

- **Payments cannot actually charge.** `PSP_PROVIDER=mock`, `billing_live()`
  returns `False` with an honest reason, `FREE_FOR_NOW=true`, subscriptions
  exist as a state machine that cannot be filled. This is the single largest
  commercial fact on the page and it is a **[Decision]**, not a defect: the P0
  directive forbids money movement, the custody brief (`payment-custody-architecture.md`)
  assumes a provider contract that does not exist yet, and flipping
  `PSP_PROVIDER=intasend` without a signed commercial agreement is how
  reconcile breaks at 3 a.m. Owner action required: choose a provider and a
  pricing decision, then one milestone to make charging real.
- **The enterprise "reduced risk" engine is not built** — the module is SME
  field-workforce tooling. A county hospital cannot yet get a defensible
  supplier shortlist from this product. That is the Kenya health-sector
  beachhead and deserves its own milestone after P1 evidence exists; it must
  not be smuggled into the mass-market plan.
- **The outbox has no consumers.** Deliberate (`event_outbox.py`: "a durable
  no-op"). It becomes urgent the moment W3 exists, because W3's aggregates
  belong in projections, not request handlers. Sequenced after W3, not before.
- **`routes/` vs `modules/` dual generations.** Untidy, functional, both live;
  consolidating is churn with no user-visible payoff. Leave it.
- **The 4 failing frontend tests** [Measured] — stale assertions from before
  the marketplace-first Home redesign (`TodayView` renders a different tree;
  `home-chats` no longer exists anywhere in `src/`). They are a P0 hygiene fix,
  not a product decision — but their existence proves the red-bar point, so
  they appear in §5-P0 rather than being quietly deleted.

---

## 5. Prioritised implementation plan with measurable acceptance criteria

House rule applied to every item: the smallest change that makes the workflow
real; no new engine, no new module generation, no parallel client; every
user-visible claim remains honest (no "verified" without a verifier, no
"sent" without delivery, no funnel without events).

### P0 — Stop the bleeding (days; no product bets)

**P0.1 Restore a green bar and make it enforceable.**
Reconcile `homeDiscovery.test.jsx` / `attentionJourney.test.jsx` with the
marketplace-first `TodayView` (update or re-derive the asserted testids —
do **not** delete the invariants); install `.github/workflows/ci.yml` (it is
ready at `docs/ci/ci.yml`); require it on `main`.
*Accept when:* `npx vitest run` → 0 failures; CI green on this branch's PR;
`main` cannot merge a red frontend.

**P0.2 One name, everywhere a user or a crawler can read it.**
Fix `index.html` (`Wasta` title is fine; align `og:*`), and purge
`Home Office` from `public_pages.py` (lines 77, 145, 146, 157, 162), README
(currently `# Brief`), and any served surface. Extend `brand.test.js` to cover
`frontend/index.html` and add a backend meta-builder test asserting
`site_name` equals the configured product name.
*Accept when:* `grep -ri 'home office\|my shop app\|byway\|ogallo' frontend/index.html backend/app/routes/public_pages.py README.md` → 0 hits; new backend test passes; rendered `<head>` on `/page/x` carries exactly one product name.

**P0.3 The road in from search.**
Add `robots.txt` (allow `/page/`, `/p/`, `/trust`, `/rate-card/`; disallow
`/api/`, `/ops`, `/more`), generate `sitemap.xml` of published pages (server
route, `Cache-Control`, skip unpublished/`noindex` pages — the share-card
code already knows the published set), add JSON-LD `LocalBusiness` to the
crawler HTML, and extend the `vercel.json` rewrites so **Googlebot and
bingbot** (not only chat crawlers) get the meta-injected document for
`/page/*` and `/p/*`.
*Accept when:* `curl -A Googlebot https://<host>/page/<handle>` returns that
business's own `<title>`, canonical, `og:*`, and a parseable `LocalBusiness`
JSON-LD; `sitemap.xml` returns 200 with one `<url>` per published page;
`robots.txt` validates; a CI check fails if any of the three is absent.

**P0.4 Tell the truth in the README.**
Replace "1071 tests / one pre-existing failure" with the measured 1148 and
record the frontend baseline; keep the migrations warning. *Accept when:*
README §Tests matches a fresh CI run.

### P1 — Make the loop run, end to end, for one real cohort (the money slice)

**P1.1 Demand capture on the public page (W1).**
New migration (additive): `page_enquiries` (id, handle FK, name, phone,
message, service_id nullable, source, `created_at`, status
`new|answered|won|lost`). New endpoint `POST /api/public/pages/{handle}/enquiries`
— no auth, 5/min/IP + honeypot, phone optional, Tanzanian/Kenyan formats
accepted, store hash + last4 only, never full phone at rest without the
owner's reveal action; PII never logged. Owner UX: an "Enquiries" card on the
Desk and the Inbox with one-tap actions — *Answer* (opens WhatsApp with the
customer prefilled, logs `answered`) and *Convert* (creates a trade
`BusinessRequest` addressed to the enquirer as a contact record, prefilled
from the enquiry, tagged `source=page_enquiry`). WhatsApp button stays above
the fold; the form sits below it.
*Accept when:* an anonymous POST from a fresh IP succeeds and the owner sees
the row with source attribution in the same session; honeypot submission is
accepted (200) but stores nothing; rate limit trips at the 6th call; phone
at rest is hash+last4 (backend test); owner → convert produces a request
prefilled with name/message in ≤2 taps (component test); endpoint tests +
`notificationRoutes` invariant still green.

**P1.2 The owner's funnel (W3).**
New migration: `acquisition_events` (handle FK, `kind` in
`page_view|contact_click|enquiry_submitted|enquiry_won`, `viewer_day` DATE,
unique `(handle, kind, viewer_day)` — day-grained, no fingerprints, no IPs).
Record `page_view` server-side from the crawler/preview handler **and** from
the SPA via an idempotent beacon; `contact_click` from the WhatsApp link;
`enquiry_submitted`/`enquiry_won` from P1.1. Owner surface: "Your page this
month" — views, contact clicks, enquiries, won, win-rate, and a plain-English
sentence ("Your page sent you 3 enquiries; 1 became paid work"). Ops surface:
same aggregates behind `require_operator` for the cohort readout.
*Accept when:* injected events appear exactly once per day per kind (DB test);
the owner's page renders the funnel with zero paywalled fields; no event row
contains a name, phone, IP, or device string (schema test); the weekly cohort
report can be rebuilt from raw rows (script under `backend/scripts/`, run in
CI against seeded data).

**P1.3 Reach the field (W5).**
Service worker + `manifest.json` (also closes the low-bandwidth gap: offline
shell, read-only cached Inbox). Web Push (VAPID) subscribed at first
notification permission grant; server sends push for the five highest-value
notification types (watch match, enquiry, offer accepted, booking, payment
recorded). SMS adapter behind `SMS_PROVIDER`/`SMS_API_KEY` (Africa's
Talking-compatible HTTP POST, default **off**) with opt-out honoured on the
first STOP reply and a per-business monthly cap with honest UI when it is
exhausted. No provider keys in the repo; `.env.example` documents the shape.
*Accept when:* in staging with flags on, an enquiry produces a push in ≤10 s
and an SMS in ≤60 s; with flags off, the UI never shows an unsent message as
"sent"; opt-out suppresses within one send; push payload contains no PII
beyond handle and event kind; all new code path-tested and the SW does not
cache authenticated API responses.

**P1.4 Turn the flywheel (W4).**
Appoint verifiers (`VERIFIER_HANDLES`) and write the verifier runbook brief;
enable `POST_TRADE_RATING_GATE_ENABLED` in staging and verify the full path
(completed booking → prompt → rating recorded → aggregate visible);
render on the public page, only where k≥5: "N jobs completed · M rated
5/4/3★". Give Mall a server gate for `is_verified` (a nightly-computed
`mall_status` derived from verified claims — the current gate is a
client-side filter whose server check the page itself says is unbuilt).
*Accept when:* ≥50 real claims moved to `verified` in staging by the appointed
verifiers; ≥20 post-trade ratings recorded by real (seeded-then-real) parties;
public page shows the aggregate only at k≥5 (below it, nothing — not a smaller
sentence); Mall shows only server-verified rows; zero self-verifications
accepted (403 path under test); runbook exists at `docs/briefs/verifier-runbook.md`.

**P1.5 Prove it with 100 complete journeys — the gate before onboarding anyone real.**
Extend `seed_showcase.py` into `seed_journeys.py`: 100 demo businesses across
≥8 Kenyan counties and 6 verticals (plumbing, cleaning, agri-input, catering,
salon, logistics), each with a plausible page, ≥3 services, **and a scripted
full arc** — a seeded customer account submits an enquiry → owner answers →
converts → trade recorded with handover confirmation → post-trade rating →
non-zero funnel on the owner's dashboard. Every seeded identity is watermarked
`demo.` and visibly badged in demo environments.
*Accept when:* `python seed_journeys.py --verify` exits 0 for 100/100 accounts;
each account's funnel reads views ≥1, enquiries ≥1, won ≥1; the cohort report
(P1.2) renders for all of them; a cold external reviewer can pick any seeded
account and audit every number on its page back to a row (the house rule); the
whole run is idempotent and re-runnable.

**P1 exit criteria (cohort gate):** 100/100 journeys green; in a 25-business
controlled Nairobi/Kisumu cohort run for 30 days, ≥25% receive ≥1 page enquiry,
≥50% of those answer within 4 h, ≥10 complete the arc to a rating, and the
median "time from enquiry to first answer" is measured (not assumed). If those
miss, onboarding stops and the funnel is re-instrumented — not the pitch.

### P2 — Only after P1 evidence exists

Outbox consumers feeding a weekly owner report ("your page sent you 3 jobs
worth KES 41,500 — here is the one thing to improve"); enterprise shortlist
export (RFQ → passport-attached supplier pack PDF) for the health-sector
beachhead brief; live subscription charging (needs the payment **[Decision]**
landed first — provider contract, pricing, legal review — before any code);
web-push campaigns/digests; JSON-LD `areaServed`/`openingHours` richness.

### Sequencing and dependencies

```
P0.1 ─┐
P0.2 ─┤ (independent, parallel)
P0.3 ─┤  P0.3 must land before P1.5 seeds pages worth indexing
P0.4 ─┘
P1.1 ──► P1.2 (funnel needs enquiry events) ──► P1.5 (journeys need both)
P1.3 ──► P1.1 (capture without reach wastes the lead) — build in parallel, ship together
P1.4 ──► P1.5 (the arc ends in a rating; ratings must work first)
P2 ──► strictly gated on P1 exit criteria
```

Estimated effort (one engineer, honest): P0 ≈ 3–5 days; P1.1 ≈ 4–6 days;
P1.2 ≈ 3–4 days; P1.3 ≈ 5–8 days (SW + push + SMS + tests); P1.4 ≈ 2 days
plus verifier time; P1.5 ≈ 3–4 days. **Total ≈ 4–5 weeks**, of which the only
hard external dependencies are SMS provider onboarding (P1.3) and verifier
appointments (P1.4).

---

## 6. The honest gaps register (what this brief does not claim)

0a. **The frontend suite is red today** [Measured]: 4 failures in
   `attentionJourney.test.jsx` and `homeDiscovery.test.jsx`, asserting a
   pre-redesign Home (`home-chats` testid no longer exists in `src/`).
   Either the tests or the redesign is wrong; P0.1 resolves which, with
   product input. Nobody should merge anything until this is decided.
0b. **This author has not deployed, migrated, or load-tested anything.**
   Counts cite the checkout; all timings ("≤5 s", "≤60 s") are staging
   acceptance targets, not production measurements.
0c. **The production database is 26 migrations behind the code** per
   `README.md` / `docs/briefs/production-migrations.md` — applying anything
   that touches post-`0057` features to production requires that runbook first.
   Every P1 migration here is additive and safe to stage; none is safe to
   apply ad hoc.
0d. **Search Console, analytics accounts, and the SMS provider do not exist
   yet.** P1 acceptance is framed so it can be executed without them, but the
   Google indexing claim in W2 can only be closed with one real registration.
0e. **Payments remain record-only by design.** No item in this plan moves
   or holds money, lends, or takes a rate on un-originated trade — consistent
   with the P0 directive and the custody brief.
0f. **Brand truth is unresolved upstream.** The repo calls itself "Brief",
   the rendered product says "Wasta", and `public_pages.py` says "Home
   Office". P0.2 picks the name via whoever owns the mark; the engineering is
   trivial, the decision is not.

---

## 7. Answering the standard question

> "If I gave this platform to a real Kenyan freelancer or business owner
> tomorrow, would it materially improve their ability to find work, earn
> money, organise operations, attract customers and grow — without needing me
> to explain how everything works?"

**Today: no — and the reason is precise.** The organising, the records, the
in-network work, and the trust substrate largely work and need no explanation.
The attraction of the stranger — the one job an operating ecosystem cannot
delegate to word-of-mouth — does not work at all, and the owner is not told
whether their page worked. **After P0 + P1: yes, for the acquisition slice** —
a business would get a page a stranger can find, a way for that stranger to
ask for work that lands in the owner's pocket, a record of what the page
produced, and a genuine review when the job is done. That is
"physiology" in the sense of the strategy brief: not more organs, but blood
actually reaching the extremities.

The wrong next move is any new engine. The right next move is making one
Nairobi plumber's page send that plumber one job — 100 seeded times, then 25
real times — and refusing to celebrate until it does.
