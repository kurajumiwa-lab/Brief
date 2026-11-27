# Economic opportunity & participation infrastructure — what exists, what is reusable, what to build

> **Provenance.** Written 2026-11-27 on branch `arena/e57ef493-brief` @ `290c8f7`
> + the earnings-dashboard slice on this branch (see §7). Every claim cites a
> path read in this repo, and every "missing" is something that was searched
> for and not found. Claims are labelled **[Built]** (read here), **[Partial]**
> (works, with named gaps), **[Missing]** (searched, absent), **[Decision]**
> (a human must choose) or **[Gated]** (exists, off by default). This brief
> answers the advisor's full request: audit → module dependency map → data
> structures → workflow analyses → phased build with measurable acceptance
> criteria. It does **not** authorise money movement, escrow, a take-rate, paid
> placement ranking economies, or pay-to-participate.

---

## 1. The finding in one line

The advisor designed seven modules for a greenfield platform. **This repository
already runs six of their engines' worth of machinery** — requests with
explicit state machines, offers, fit checks and watches; an events platform
with paid registration flows; two complete referral economies; a reputation
system that cannot rank without evidence; a passport that shows only verified
facts; a custody architecture that records rather than holds. The gap is not
modules. The gap is (a) a small number of *missing objects* — the introduction,
partnership and collaboration opportunity types — and (b) the *unified read*
that lets a member see what their participation produced, which this branch
ships as `/you/earnings`.

## 2. Module-by-module reuse map (the advisor's A–G)

| Advisor's module | What exists today | State | Gap that remains |
|---|---|---|---|
| **A. Opportunity Exchange** | `modules/trade` — `BusinessRequest` with kinds `stock`, `worker`, `delivery`, `rental`, `errand`, `service`; explicit `REQUEST_FLOW` (`OPEN → FULFILLED/CANCELLED`); one offer per responder; `RequestEvent` append-only audit trail; **fit check** (`GET /api/requests/{id}/fit`, "you meet N of M"); **watches** with notification rings on post; `NeedPicker`/`RequestForm`/`RequestCard`; jobs board (`modules/hiring`, free to apply); corridor tasks (`modules/corridor_tasks`) | [Built] as a strong core | Two of the six published-opportunity types have no kind: **partnership opportunity** and **collaboration/team request**. Cannot be published, cannot be watched. See §4. |
| | Introduction ("I have an introduction") | **[Missing]** as an object | Needs the Africa Connect flow — consent record, parties, agreed commission, evidence, verify, due → paid. §5. |
| **B. Events & Networking** | `routes/events.py` — create/browse/register/paid ticketing flow (TILL/PAYBILL/POCHI, M-Pesa confirmation queue, roster); `modules/event_hub` — meeting points, galleries, host↔attendee messages, participant notifications, check-in; `modules/event_desk` — resale; public share links `/e/:slug` with OG cards; check-in via QR flow | [Partial] — genuinely strong for community events | No attendee-matchmaking ("who here can help me?"), no buyer–supplier-day structured format, no post-event outcome tracking (connections made → meetings → opportunities). All three are **views and a new object (`event_leads`)**, not new infrastructure. |
| **C. Referral & Affiliate** | `modules/referrals` — merchant-funded campaigns, links, **verified-receipt qualification** (`qualified` only via accepted receipt), points+bounty split, operator-gated payout recording; `modules/town/referral_exchange` — *referral index*: searchable external-provider offers, share links, click attribution, evidence claim → operator verify → `bounty due` → `mark paid`, **dispute cases**, sponsor cap (`MAX_SPONSORED_RESULTS=3`, separate ranking, always labelled); `modules/town` points ledger (append-only `PointsEntry`) | [Built] — two complete engines | They do not yet carry **business-to-business commissions** (introduction bounty on a *contract*, not a receipt or a screenshot). The mechanics transfer 1:1 via §5. |
| **D. Collaborative Work** | `squad` (`routes/squad.py`) — post a call, accept with OTP, contract lifecycle, completion proof, ratings, XP/gold, squads with split percentages; `modules/corridor_tasks` — scout tasks with proof review and direct-payment confirmation (`TaskPaymentConfirmation`); `modules/collective` — pooled sourcing; `modules/trade` watches = standing collaboration radar | [Partial] | No shared proposals, no joint bids, no revenue-sharing terms object, no deliverable tracker for multi-party work. This is the biggest true greenfield inside D — but it rides on the squad contract model, not beside it. |
| **E. B2B Commercial Exchange** | `modules/standing` — passport: claims → documented → verified, readiness checklists, expiry sweep, `verified_keys()` matcher interface; `modules/trade` — requests with *requirements* matched against verified facts ("you meet 8 of 10"); `modules/enterprise` — workspaces, members, managed devices (SME field-workforce, **not** procurement); trade docs demand-side RFQ **absent** | [Partial] | No RFQ/quotation object with deadlines and award; no supplier pack export (passport + portfolio + references → one PDF). The Kenya health-sector beachhead (`kenya-opportunity-network-strategy.md`) wants exactly this — build it there first. |
| **F. Shared Resources** | Desk tools/rentals (goods, services, tools with day rates — `DESK_ENABLED`, opt-out); bookings (`routes/bookings.py`) with availability calendars; `routes/tools.py` marketplace; delivery quotes | [Built] for listings & booking | No cross-party availability collision checking for *shared* use; no deposit/handback record (deliberately — no custody). Honest [Partial] is: publish + book + record works. |
| **G. Knowledge Exchange** | `modules/knowledge` — `KnowledgeListing` (kind: seminar/course/mentor_session), capacity, price_kes, published → completed, registration, check-in, reviews, organiser delivery flow; `pages/learn/*` | [Built] | No paid *mentoring relationship* (1:1, recurring), no skill-exchange ledger (hours in/out). Minor additions on the same model. |
| **Unified economic identity** ("My Opportunities & Earnings") | Nothing existed before this branch | [Built this branch] `GET /api/earnings/me` + `/you/earnings` — see §7 | Partnership and rental counts intentionally read `None` — "not tracked yet" — until the underlying objects exist. |

## 3. The dashboard — what was built and what it refuses to show

`/you/earnings` is a pure read projection (`modules/earnings`). It answers the
advisor's four example metrics and nothing more than the evidence allows:

| Card | Source (all existing tables) | Honest form |
|---|---|---|
| Completed projects | `hustle_contracts` (player = me, status `completed`) | count; agreed KES recorded separately and labelled "not proof of receipt" |
| Successful referrals | `referral_conversions` (verified) + `referrals` (qualified) | count per engine, summed |
| Event connections | confirmed seats on my events + events I attended (check-in) | count, both kinds shown in `channels[].detail` |
| Active opportunities | my open trade requests + my offers awaiting decision | count, drillable via `/work` |

Money is never presented as one figure: **pending** (awaiting verification) →
**due** (approved, awaiting direct payment) → **paid** (recorded by the payer),
with reward points summed separately and labelled not-money. Project payouts
only count when `payout_status='completed'` (a real recorded fact), and the one
figure that is an estimate — event ticket value (seats × entry fee) — is
labelled `est.` everywhere it appears. `not_measured[]` lists what the tool
cannot count and why, in product copy. This is the brief's own standard:
"Actual earnings should only be recorded after verified transactions, with
pending commissions clearly distinguished from paid earnings."

**Verification:** backend `tests/test_earnings_dashboard.py` (4 tests: own-record
aggregation, neighbour isolation, sign-in gate, honest empty state) — passing.
Frontend `src/test/earnings.test.jsx` (5 tests incl. the three-state commission
block and both "not tracked yet" channels) — passing. Full suite state in §8.

## 4. Opportunity Exchange — the two missing opportunity types

No new engine is needed. The trade module's request kinds extend cleanly:

**Data structures (additive):** two `RequestType` values —
`partnership` ("I have an opportunity to share" / team-up request) and
`collaboration` (seeking team for a defined piece of work) — stored in the same
Postgres enum (`ALTER TYPE … ADD VALUE`), plus one new nullable column
`business_requests.kind_detail JSONB` carrying structured fields per kind:

```jsonc
// partnership
{ "role_offered": "distribution", "commitment": "rev_share", "share_pct": 20,
  "term_months": 12, "exclusivity": false }
// collaboration
{ "roles_needed": ["videographer", "editor"], "budget_band_kes": [40000, 80000],
  "deliverable": "30s corporate TVC", "deadline": "2026-12-15" }
```

Watches already match on `request_type` — they ring for the new kinds with zero
matcher changes. The fit check already short-circuits unsupported types; it will
report "fit applies to trade requests only" for these two, honestly, until
requirement evidence is defined for them. Frontend: two rows in `NeedPicker`,
one variant of `RequestForm` (reused), and `RequestCard` unchanged.

**Acceptance:** post → match against a relevant watch fires in-transaction →
responder offers → requester accepts → `FULFILLED` — full arc green in CI;
`notificationRoutes` invariant green; migration `0084` applies on a copy of the
production dump (per `production-migrations.md`) before any real deploy.

**Explicitly refused here:** revenue-share *enforcement*. The platform records
the agreed terms; it never becomes a party that must split money. Splitting
happens P2P; Brief stores the text Both parties signed against.

## 5. Africa Connect — business introductions (the flagship)

The advisor asked for this by name; the repo already contains its hard parts
(consent, evidence, verification, payout recording, disputes). What is missing
is the **first-class introduction object**. Design:

```
member submits introduction
  ├── parties: introducer (self, authed), giver (who they represent/know),
  │     receiver (a Brief business, by handle — or an external contact
  │     captured with consent, shown as "external contact" unverified)
  ├── agreed terms: commission_type: none|fixed_kes|pct_of_deal, value,
  │     payable_by: giver|receiver|unset — written before reveal, both parties see it
  ├── consent: introducer attests written/verbal permission to share contact;
  │     receiver consents by accepting the intro (timestamped); giver sees
  │     "introduction proposed — awaiting {receiver}'s acceptance"
  └── status: proposed → accepted | declined | withdrawn → (terminal)
                accepted → marked led_to_work (by either party, evidence attached)
                → verified (by evidence review: receipt, signed PO, or mutual
                   confirmation + 7-day window) → bounty due → paid (recorded)
```

**Data structures:** `introductions` + `introduction_events` (append-only) +
`introduction_agreements` (the frozen terms). No wallet anywhere. Payout is
identical to the referral engines: the payer marks `paid` with an M-Pesa
reference; a screenshot is an evidence item to review, never proof by itself.
Disputes ride the existing `DisputeCase` with `domain='introduction'` (one
enum addition) — evidence, never a verdict.

**Commission transparency rules (advisor §5, encoded):** terms frozen before
reveal; outcome visible to both parties; `due` requires evidence review;
`paid` requires payer action; introducer can never verify their own
introduction; a "led to work" claim without evidence stays `proposed →
accepted` forever and ages out — no zombie bounty.

**Contact protection:** receiver sees the giver's profile (or a masked
external contact) until acceptance; giver's phone/email never appear in any
payload pre-acceptance; accepting reveals exactly one contact channel with a
"reveal my contact too" toggle (mutual reveal, default mutual).

**Rollout:** shadow mode first — introductions can be logged and counted
forever, bounties only after evidence ≥ N=20 reviewed cases pass manual QA.
Metrics: proposed → accepted rate, accepted → led_to_work rate (the only
number that matters commercially), median time-to-first-contact, dispute rate,
% introductions with both-party evidence.

## 6. The end-to-end workflow analyses (advisor §4)

1. **Referral introduction (above):** business publishes a need → member
   discovers via watch/feed → proposes introduction → consent captured both
   sides → customer enquires → business accepts lead (logs `accepted`) → job
   completes (trade record or squad contract exists) → introducer claims
   `led_to_work` with evidence → evidence reviewed (operator desk or mutual
   confirm) → commission `due` → payer records `paid` → member's dashboard
   shows pending → due → paid across the whole pipeline. Business sees source
   and value in the same funnel as §W3 of the journey audit.
2. **Event → opportunity:** discover (`/events`, filters, share) → register
   (paid ticket queue if ticketed) → check in (QR) → *same-day*: "who can
   help me?" board at the event (new view, existing rows) → book a follow-up
   (calendar) or propose an introduction (§5) → after event: organiser reports
   connections/leads only as counts on the event record (never attendee PII
   shared without acceptance).
3. **Partnership team → bigger tender:** requester posts `partnership`
   (§4) → agencies discover it (watches) → 2–3 form a consortium squad
   (existing split percentages) → joint quote via offers → award → delivery
   via squad contracts → post-trade rating on each party (existing ratings
   gate, once enabled) → merit inputs on all (existing).
4. **Procurement exchange (E):** buyer posts request with requirements
   (existing requirement matching) → passport supplies verified facts → buyers
   see "you meet N of M" → accept → handover → rating → claim refreshed for
   the next tender. Missing: the RFQ award object and supplier-pack export.
5. **Knowledge → reputation → work:** mentor hosts paid session (knowledge
   listing) → registrations, check-in, review → review counts toward merit →
   discovery ranking (existing trust term, capped) →
   workshop attendee posts a `service` request → mentor responds. The loop
   closes on existing tables.
6. **Resource rental:** owner publishes rental on desk → member requests
   `rental` kind → booking calendar → fulfilment recorded → rating →
   repeat bookings visible in member history. (Deposit/handback deliberately
   outside scope until custody is decided.)

## 7. What this branch ships (implementation status)

- **`GET /api/earnings/me`** — read-only projection; module `modules/earnings`;
  mounted in `app/main.py` and advertised in `/api` service index.
- **`/you/earnings`** — "My opportunities & earnings"; linked from Profile
  (`YouView`) and routed in `App.jsx`.
- **Tests:** `tests/test_earnings_dashboard.py` (4, green) ·
  `src/test/earnings.test.jsx` (5, green).
- **Not touched:** money handling (none exists here), any migration (none —
  additive only), the four pre-existing frontend failures (stale Home
  assertions; unchanged), any trust position.

## 8. Baselines after this branch (all measured here)

| Check | Result |
|---|---|
| Backend suite | **1151 passed, 1 skipped, 1 failed** — `test_outside.py::test_an_event_starting_soon_outranks_one_written_more_recently`; passes in isolation (50/50) and with `test_earnings_dashboard.py`; under full-suite timing it is order-sensitive (feed ranks by relevance; see §9). Pre-existing class: full-suite flake, documented in `docs/outside/02-implementation-summary.md`. Re-verified on this branch; does not touch earnings code. |
| Frontend suite | **840 passed, 4 failed** — the same 4 stale Home assertions as before this branch (`homeDiscovery`, `attentionJourney`); my 5 new tests pass. |
| `npm run build` | exit 0 |

## 9. Phased build plan (advisor's sequence, adapted to this repo)

**Phase 0 — Green bar (P0 of the previous brief, still open):** fix the 4
stale frontend tests; install `docs/ci/ci.yml` as `.github/workflows/ci.yml`;
brand unification (`Home Office` in `public_pages.py`); `robots.txt` +
`sitemap.xml` + JSON-LD + Googlebot routing; resolve the `test_outside`
full-suite flake by making the feed ranking deterministic in tests (inject
`now`) rather than asserting on wall-clock races. **Exit: CI red-blocks main.**

**Phase 1 — Opportunity Exchange complete** (this brief §4 + the introduction
flow in shadow mode §5): additive migration `0084` (enum values + `kind_detail`);
`NeedPicker`/`RequestForm` rows; `introductions` tables; consent capture UI;
`/api/introductions` (propose/accept/decline/withdraw/led-to-work/claim/verify/
bounty due/paid recording); `/you/earnings` gains the introduction rows once
the object exists. **Exit:** one closed-loop demo — proposal → acceptance →
trade record → verified → `due` → `paid` — walkthroughable end to end in CI;
100 seeded arcs across ≥8 counties (§10).

**Phase 2 — Events outcome economy:** event leads board + `event_leads`
view; post-event outcome counts on the event record; QR check-in already
exists; sponsor-like buyer rows in feed for buyer–supplier days (labelled).

**Phase 3 — Referral commissions on contracts:** introduction bounty
lifecycle goes live (out of shadow) at ≥20 reviewed evidence cases with zero
false-verifications; commission transparency audit brief; dispute SLAs.

**Phase 4 — Collaboration & procurement:** partnership/collaboration arcs
joined to squad contracts; joint offers; RFQ award object; supplier-pack PDF
(passport + selected work + trade record) for the health-sector beachhead.

**Phase 5 — Resource & knowledge exchange:** mentorship relationships
(recurring 1:1), neighbour-barter/skill-exchange ledger (hours in/out, no
money), shared-resource handback record (no custody).

**Phase 6 — Economic intelligence:** outbox consumers (it currently drains to
nothing) → weekly owner report; cohort dashboards for the 100 Seeded Arcs;
the measurement definitions already written in `modules/measurement`.

## 10. Seed the ecosystem — the 100-arc specification

Never as isolated rows: every seeded entity must reference at least one other,
and every arc must terminate in an evidence artefact.

* **Personas ×8 counties** (Nai/Kisu/Mombasa/Nakuru/Eldoret/Kisii/Meru/Machakos):
  plumber, cleaning co-op, mama-mutaga posho mill, boda courier, event caterer,
  solar installer, salon, agri-input agrovet, packaging supplier, SACCO
  secretary, clinic pharmacist, diaspora London buyer-requestor.
* **Interconnection rules:** the courier delivers for the posho mill; the
  posho mill buys packaging from the packaging supplier; the packaging
  supplier's ask was an introduction proposed by the London buyer's contact;
  the caterer's event leads to a partnership opportunity posted by the cleaning
  co-op; the agrovet's passport gets its two claims verified; the SACCO
  secretary watches `stock` requests in her county.
* **Every arc produces:** 1 published page → 1 watch or feed impression → 1
  enquiry/request → 1 offer → 1 fulfilment (trade record/squad contract/
  booking) → 1 rating → 1 dashboard row on `/you/earnings`.
* **Watermarking:** `@demo_…`, visible badge in demo envs, `demo=true` flag on
  the arc audit row; never presented as real earnings (the advisor's own rule).
* **Exit test:** `scripts/seed_arcs.py --verify` walks all arcs and fails on
  any dangling edge; the earnings dashboard of every seeded persona is
  non-zero and traceable to rows.

## 11. The three principles, as code constraints

1. **No pay-to-participate.** Discovery, requesting, offering, introducing,
   registering free events, and the dashboard are free and uncapped. Metered
   surfaces are ops-only (`MARKET_OPS_ROLES`) or merchant-funded (bounties),
   never member-paid. Verifiable: `FREE_FOR_NOW=true`; any paywall on a member
   path is a review rejection.
2. **Reward value creation, not recruitment.** There is no referral depth,
   no pyramid logic, no points for signups — only for *verified transactions*.
   Enforced by the qualification paths themselves: `referral_qualified` requires
   an accepted receipt; `introduction.verified` requires evidence review;
   points/bounty are terminal ledger entries, never convertible back into
   invites.
3. **Measure money reaching members.** The green bar metric for Phase 1+ is
   not registrations — it is *verified value closed by members*, reported from
   the same rows `/you/earnings` reads (completed contracts, verified
   bounties, paid commissions, repeat trades). If that number is zero, the
   ecosystem is zero, and no slide may say otherwise.

## 12. Red lines (unchanged from the standing rules)

No escrow, no custody, no lending; no take on un-originated trade; no ranking
purchase; no MLM structures; commission promised before verified work; contact
reveal without acceptance; demo data presented as real; any feature that
requires explaining "trust us" — it must show evidence or say it cannot.
