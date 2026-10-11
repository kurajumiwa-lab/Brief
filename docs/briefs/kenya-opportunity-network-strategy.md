# The Opportunity Network — Kenya-first go-to-market and product-gap strategy

> **Provenance.** Strategy brief for the Brief_ platform, written 2026-10-11 against
> the repository at v2.11 (`main` + the `standing` module) and against public
> sources listed in Appendix A. It answers the go-to-market request: initial
> niche, validated unmet needs, competitor differentiation, MVP backlog,
> architecture, pricing, acquisition and measurable milestones. Everything is
> labelled **[Built]** (read from this repo), **[Evidence]** (public source,
> dated in Appendix A), **[Assumption]** (belief to test) or **[Target]**
> (a number we commit to). No claim of compliance, reliability or endorsement is
> made anywhere in this document, and none may be made in the product.

---

## 0. Reading rules — verified facts, estimates and AI output stay separate

Three product rules from the source brief are treated here as non-negotiable,
because they are also the product's only defensible trust position:

1. **Verified facts are separated from estimates and AI suggestions** — in the
   UI, in the API payloads and in every notification. The v2.11 passport is the
   reference implementation: a claim is `declared`, `documented`, `verified`,
   `rejected`, `expired` or `withdrawn`, and only verifier-cleared statuses are
   ever public. **[Built]**
2. **No opaque reputation scores.** Nothing in this strategy produces a number
   that a small business cannot audit back to recorded events. Where outcomes
   are shown they are counts and named events, never a composite grade. **[Built]**
   (`services/discovery.py` explains every ranking with `reasons`;
   `TrustSignals.jsx` only ever shows a rate whose sample size is known.)
3. **Consequential AI actions require human approval.** AI may draft, summarise,
   match and suggest; it may not send an introduction, an offer, a bid or an
   outreach message. This brief's "growth coach" and "market-entry
   intelligence" sections are constrained by that rule. **[Target]**

---

## 1. The recommendation, in one page

### 1.1 The initial niche

**Document-gated supply networks in Kenya's devolved health sector** — the
suppliers who must prove verified standing to sell into county hospitals and
SHA-funded programmes, and the county-facility buyers who are actively looking
for alternatives to a failing central supply channel.

Concretely, the first two customer populations:

- **Supply side (who pays):** MSMEs and distributors supplying county health
  facilities (medical consumables, equipment service, cleaning, catering,
  construction, logistics) plus the health-tech vendors whose products must be
  DHA-certified to be procurable. They share one bottleneck: paper. CR12, KRA
  TCC, eTIMS status, county permits, PPB licences, SHA/DHA requirements, AGPO
  certificates — each dated, each expiring, each re-requested by every buyer.
- **Demand side (who pulls):** procurement, finance and hospital-admin staff at
  county facilities, and programme offices running SHA/DHA/AGPO readiness.
  They do not need a marketplace; they need a shortlist they can defend, with
  the basis of every verified fact visible.

### 1.2 Why this niche and not a general "B2B network"

| Reason | Evidence |
|---|---|
| The pain is dated, not aspirational | SHA E-Contracting portal went live 2026-09-17 with a cycle running 2026-10-01 → 2029-06-30; incomplete applications expire after 7 days. DHA's integration deadline was extended to 2026-09-30 — enforcement and renewal demand is now. **[Evidence]** |
| The buying channel is visibly broken | KEMSA order fill was ~41% in FY24/25 with ~19.5-day waits; counties are tendering private suppliers directly and donor commodities are moving back through KEMSA by end-2026. Every unsupplied order is a buyer looking for a verifiable alternative. **[Evidence]** |
| The segment is already credentialled but underserved | AGPO reserves 30% of public procurement; >160,000 enterprises were registered by end-2022 — yet only 7.71% of sampled 2013–16 tenders were awarded to AGPO firms. The paper exists; the visibility and assembly do not. **[Evidence]** |
| The moat we have is the one this segment needs | Consent-based introductions, an auditable claim trail, explainable matching and a relationship graph — not stock, not logistics, not alerting. **[Built]** |
| It is a beachhead, not the whole market | Every other regulated, document-gated buyer (food & hospitality, NCA construction, export trade, general AGPO) uses the same catalogue and the same machinery. The sector checklists already exist for exactly this reason. **[Built]** |

### 1.3 What we sell first

> "Get your business verified once, keep it current, and be findable — with the
> reason you meet (or don't meet) each requirement shown to the buyer."

The first paid product is **readiness + verified visibility**, not networking.
Networking is the retention layer; documents are the entry point, because
documents are what blocks money this quarter.

### 1.4 When we walk away

Kill or re-scope the beachhead if, by 2027-03-31, any of these hold
**[Target]**:

- fewer than 25% of interviewed suppliers rank document-gated eligibility in
  their top three business problems (wrong pain);
- the cost of getting one claim to `verified` exceeds KES 900 *and* fewer than
  40% of activated businesses convert to paid (verification economics fail);
- buyer-side users run fewer than 10 shortlists in 90 days after onboarding
  (no demand pull — we become another directory).

---

## 2. Validated unmet needs — what we know and what we must confirm

Everything in the "evidence so far" column is **public information**, not
validated customer demand. The right-hand columns are the jobs of the first
six weeks. An unmet need only enters the roadmap when at least one buyer-side
and one supplier-side interview independently describe it *and* one paying
design partner commits to the current workaround's cost.

| # | Candidate need | Evidence so far | What would falsify it | Validation in the first 6 weeks |
|---|---|---|---|---|
| N1 | **Proving standing is expensive and repetitive.** The same CR12 (KES 650, often under 6 months old), KRA TCC, eTIMS status, BO filing and county permit set is re-requested per buyer, per cycle. | KYB chain documented across BRS/eCitizen, KRA, county permits. **[Evidence]** | Suppliers say buyers accept whatever is on file and rarely re-request; or a consultant absorbs the work at negligible cost. | 15 supplier interviews; collect the actual document set of the last won and last lost bid; time-and-cost diary for one cycle. |
| N2 | **Documents expire silently and eligibility is lost.** SHA requires incorporation docs, KRA TCC, SHA compliance certificate and county permit; incomplete applications expire in 7 days. | SHA E-Contracting requirements and 7-day expiry; DHA 26-component checklist. **[Evidence]** | Suppliers track expiry in a book/WhatsApp and have never lost an application to it. | Reconstruct the last 12 months of each design partner's submission timeline; count near-misses. |
| N3 | **Verifying a supplier costs the buyer more than trusting one.** Facilities buying around KEMSA have no cheap way to check whether a new supplier can actually deliver and is genuinely registered. | KEMSA fill ~41%; counties tendering private suppliers; post-contract visibility named as a gap in the source document. **[Evidence + source document]** | Buyers say the county's own prequalification list is sufficient and fast. | Shadow two county prequalification exercises; measure elapsed time and the number of suppliers that fall out for paper reasons. |
| N4 | **AGPO/JV/consortium assembly is manual and slow.** 30% is reserved; 7.71% reached. Small firms cannot assemble a compliant team under time pressure. | AGPO reservation and award-gap studies. **[Evidence]** | AGPO firms say they bid alone by choice and win enough; or assemblies are done by brokers they trust. | Interview 20 AGPO-registered enterprises that bid in the last 12 months; map how their last consortium was formed. |
| N5 | **Dated compliance windows create spikes buyers will pay to survive.** DHA certification (26 components), SHA 2026/28 accreditation, eTIMS-driven return validation from Jan 2026. | DHA regulations, SHA portal launch, eTIMS enforcement. **[Evidence]** | Deadlines slide again and buyers treat them as paper exercises. | Track published notices for 6 weeks; count how many facilities/vendors publicly advertise for help. |
| N6 | **Post-contract visibility is missing on both sides** (order timeline, delivery acknowledgement, invoice/payment status) — a named gap in the source document. | Source document §5; custody/payment ledger already exists in the repo. **[Built/Evidence]** | Both sides say WhatsApp + a driver is good enough and disputes are rare. | Instrument two live orders end-to-end without the platform (diary study). |
| N7 | **Fragmented local supply chains** — the source document's core framing. | e-GP mandatory e-submission plus 47 county portals; aggregators already cover alerting. **[Evidence]** | Aggregators' coverage is sufficient for our beachhead. | Test whether TenderSoko/Jorpex/TenderHQ already answer "who in this county can actually deliver X by Friday". |

**Deliberately deferred** until N1–N3 convert: verified temporary work (gig)
features. The labour-abuse evidence (HRW, May 2026; ILO treaty talks, June
2026) says any entry here must lead with pay transparency, protections and a
dispute hold — that is a second product, not a beachhead. **[Evidence]**

---

## 3. Competitive landscape and differentiation

### 3.1 The categories we are actually compared against

| Category | Examples seen in the market | What they sell | Why we do not fight them head-on | Where we lose if we drift |
|---|---|---|---|---|
| Tender aggregators | Jorpex ($49/mo), TenderSoko (~33k tenders + TendAI), TenderHQ (AI eligibility) | Alerts, search, bid-eligibility summarising | Alerting is commoditised; e-GP made e-submission mandatory, so the alert is worth less than the paperwork it creates | If we build a tender board, we become a worse aggregator |
| B2B marketplaces / trade platforms | capmad, mysokoni, nexizo, Eyby | Verified listings, escrow, RFQs, trust scores | They compete on verification and trust scores; verification is table stakes, and opaque scores are banned in our product by design | If we list stock, we inherit their economics |
| Distribution / logistics | Wasoko–MaxAB (~450k merchants, merged), MaxAB | Warehousing, delivery, working capital | Asset-heavy distribution economics have been brutal; the merged entity pivoted to fintech/profitability | If we take stock risk, we die their death |
| KYB / compliance vendors | Registration agents, CR12/eTIMS consultants, KYB APIs | Documents and filings for a fee | They solve one cycle; the fact they create is invisible to the next buyer | If we become an agent, we lose the reusable-fact moat |
| HMIS / health systems | Accredited HMIS vendors, DHA-certified systems | Systems of record for facilities | Their certification burden is enormous (26 components) and they need demand-side proof, not replacement | If we build an HMIS, we break the guardrail and lose their partnership |
| Informal channels | WhatsApp groups, county-level supplier lists, brokers | Trust through personality | The relationship graph is our moat — we make it verifiable and transferable | If we try to replace the group, we lose the group |

### 3.2 The differentiation statement

> **Brief_ is the workflow layer where a small business's verified facts, its
> relationships and its opportunities live together — with a reason attached to
> every claim, a consent record attached to every introduction, and an audit
> trail attached to both. We are not a system of record, not a tender board and
> not a marketplace.**

Three things competitors cannot copy cheaply:

1. **Consent-based introductions with attribution.** The graph is opt-in and
   the platform remembers who introduced whom — this is a governance feature
   before it is a growth feature, and it is already the shape of the
   connection/patron machinery in the repo. **[Built]**
2. **Explainable fit, not a score.** "You meet 8 of 10 requirements; here is
   the one you miss and how to close it" — implemented as `fit_for()` over
   requirement checklists, never as an opaque ranking. **[Built v2.11]**
3. **Verified facts as a portable asset.** A verified claim is reusable across
   every buyer and every cycle precisely because it is not owned by the
   transaction that produced it. **[Built v2.11]**

### 3.3 Where we deliberately do *not* compete

- **We do not replace mandatory systems.** eTIMS, e-GP, HMIS and KEMSA's
  ordering processes stay authoritative. We integrate, mirror and link out;
  the product never writes to a mandatory system without operator approval and
  never implies that a profile constitutes compliance. **[Guardrail]**
- **We do not sell reliability claims.** We show recorded outcomes and
  separately labelled buyer-reported experiences with visible sample sizes;
  we do not publish a grade a small business cannot audit. **[Guardrail]**

---

## 4. Product gap: what exists today, what must be built

### 4.1 Already shipped against the source document (v2.11)

| Source-document capability | Repo state | Where |
|---|---|---|
| Small-business readiness / document vault | **Shipped.** 18-claim catalogue (identity, tax, licences, cover, ownership) with printed validity vs platform review windows; declared → documented → verified lifecycle; reopening on document change; expiry sweep with 30/14/7-day reminders | `app/modules/standing/` |
| Verified facts separated from estimates | **Shipped.** Public passport exposes live verified status only — no evidence, verifier identity or rejection history | `GET /api/passport/...` |
| "You meet 8 of 10 requirements" | **Shipped.** Requests carry up to 12 requirement claims; `fit_for()` counts and names the gaps; `eligible_on_paper` informs but never blocks an offer | `app/modules/trade/service.py` |
| Human approval before consequential actions | **Shipped for verification.** Self-verification is 403, rejection requires a reason stored verbatim | `standing/router.py` |
| Saved searches / opportunity alerts | **Shipped.** `RequestWatch` (≥1 filter, max 10) with match notifications inside the request transaction | `app/modules/trade/` |
| Business circles | **Shipped (pre-existing).** Groups, vendor lists, patrons, deal rooms | `routes/groups.py`, `vendor_lists.py` |
| Networking moat (opportunity graph) | **Partially shipped.** Connections, patrons, discovery with reasons; no introduction workflow yet | `services/discovery.py`, `market_patrons.py` |
| Post-contract visibility | **Partially shipped.** Order journey, delivery quotes, custody ledger; no supplier-facing acknowledgement loop | `routes/*`, `models/payments.py` |

### 4.2 The gap — everything the source document asks for that is not built

| Gap | Priority | Why it cannot wait |
|---|---|---|
| **Consent-based introduction workflow** (request → accept → made → outcome, with attribution) | P2, first thing after validation | This is the named networking moat; without it the platform is a directory |
| **Team/org accounts and roles** | P1 | A supplier is not one seat: director, accountant and a bid clerk share the paper |
| **Verification desk throughput tooling** (queues, SLA, reviewer notes, dispute path) | P1 | Verification cost is the unit economics of the whole model |
| **Reminder delivery beyond polling** (email/SMS fallback for expiring claims and matches) | P1 | Suppliers do not sit in the app; pull-only notifications lose the expiry save |
| **Consortium / bid-team builder** (assemble against a checklist; coverage view; AGPO ownership constraints) | P2 | Directly addresses the 30% reserved / 7.71% awarded gap |
| **Buyer-side shortlist view** (run a requirement checklist against the network) | P2 | The demand-side pull that makes supply-side payment worth it |
| **Admin/support inbox distinct from business chat** | P2 | Verification questions and disputes currently have no home |
| **Market-entry intelligence** (thresholded aggregates from the outbox) | P3 | Needs transaction volume first; must be privacy-thresholded |
| **Growth coach** (drafted, human-approved next actions) | P3 | Cheap once the outbox and facts exist; never auto-sends |
| **Outbound integration layer** (eTIMS status, KRA PIN/TCC, BRS/CR12, DHA checklist mapping, e-GP link-out) | P4 | Every one needs the no-API fallback ladder from §6 |

### 4.3 Non-goals (explicit, permanent)

No POS; no replacement for HMIS, eTIMS, e-GP or any mandatory system; no
tender alerting product; no escrow or lending without the licence question
settled; no public composite reputation scores; no automatic submission to
any government portal; no holding of medical stock; no implication that a
platform profile equals compliance.

---

## 5. MVP backlog (P1 → P4)

Acceptance is written so a reviewer can test it, in the repo's own style.

### P1 — Trust and activation (weeks 0–8 from validation start)

| # | Story | Done when |
|---|---|---|
| P1.1 | "As a verifier, I can work a queue with an SLA." | Queue view shows age per item; reviewer can request more evidence, verify, or reject with a mandatory reason; every action appends to `claim_events`; median turnaround visible **[Target] ≤72 h** |
| P1.2 | "As a business, I am told when a claim will expire, outside the app." | Email/SMS digests fire on the 30/14/7-day windows, mirroring the in-app reminders; idempotent across restarts; unsubscribe honoured |
| P1.3 | "As a team, we share one passport." | Org invites second/third seat with roles (owner, finance, clerk); every seat action logged; no role can self-verify |
| P1.4 | "As a first-time supplier, I get a personal readiness list." | Onboarding asks sector + buyer type, then shows exactly the applicable claims from `claims_for_sector` with cost/issuer/lead time; ≥60% of new signups complete one upload within 14 days **[Target]** |
| P1.5 | "As a buyer, I can see why a supplier appears." | Every result links to the fact, its status and its date; no result shows an unexplained rank or grade |
| P1.6 | "As a user on a 2G/interrupted connection, uploads do not die." | Multipart upload retries with resumable parts; queued actions survive app close; verified on a throttled connection |

Guardrail test for P1: a fresh account, a dummy buyer and a hostile screenshot —
nothing unverified is public, nothing implies compliance, no reliability claim
appears anywhere.

### P2 — Networking and transactions (weeks 6–16)

| # | Story | Done when |
|---|---|---|
| P2.1 | "As a business, I can request an introduction with consent and attribution." | Introduction states: `requested → accepted/declined → made → outcome`; target consent recorded; requester rate-limited (≤5/week); attribution survives the introduction; declining is free and never penalised |
| P2.2 | "As a bid lead, I can assemble a compliant team against a checklist." | Select requirements → coverage view shows who covers what and who is missing; AGPO ownership constraints surfaced from declared (not assumed) facts; output is a private bid room (reusing deal rooms) |
| P2.3 | "As a buyer, I can run my checklist against the network." | Import/paste a requirement list → ranked fits with reasons and a "missing must-have" flag; export a shortlist with the basis of every fact |
| P2.4 | "As either side, I can see the contract's journey." | Order timeline with delivery acknowledgement by the receiver and invoice/payment status from the custody ledger; disputed states route to the support inbox |
| P2.5 | "As support, I have one inbox for verification and disputes." | Separate from business chat; tickets link to the claim/order; SLA and escalation visible |

### P3 — Intelligence (weeks 14–24)

| # | Story | Done when |
|---|---|---|
| P3.1 | "As a programme, I can see readiness aggregates." | Dashboards built off outbox read models; k-anonymity threshold enforced (no cell below the threshold); no named-business inference possible |
| P3.2 | "As a supplier, I get a growth coach I approve." | Suggestions reference the business's own recorded events; every outbound action requires explicit approval; the AI's confidence is labelled as an estimate |
| P3.3 | "As a market entrant, I can see where demand exists." | County/sector aggregates from recorded demand: most-requested requirements, time-to-fill, common failure reasons |

### P4 — Ecosystem integrations (month 6+)

| # | Story | Done when |
|---|---|---|
| P4.1 | **No-API fallback ladder in one place.** | `API → authenticated export/import → attested upload with reviewer → manual` is implemented once and reused by every adapter; sync status and provenance recorded per fact |
| P4.2 | "As a business, I can prove my eTIMS/KRA status." | A status check or approved import records the fact with source and timestamp; failure is stated honestly, never softened |
| P4.3 | "As a health-tech vendor, I can map my DHA checklist." | The 26-component checklist maps onto a standing checklist; progress is mine to publish, and the platform never claims certification |
| P4.4 | "As a bidder, I can jump to e-GP for the official action." | Deep links out; we never re-host or re-submit |

---

## 6. Architecture

### 6.1 Stance

The platform is a **workflow and integration layer**, not a system of record.
Mandatory systems stay authoritative; the platform records *what the business
proved, to whom, when*, plus the workflow around it.

```
 external systems (authoritative)         Brief_ (workflow layer)
 ┌───────────────────────────┐           ┌──────────────────────────────────┐
 │ e-GP · county portals     │◄─ links ──│ trade    requests · offers · fits │
 │ eTIMS · KRA · BRS         │◄─imports─►│ standing claims · evidence ·      │
 │ SHA portal · DHA portals  │  attest   │          verifications · expiry   │
 │ HMIS (facility SoR)       │           │ network  intros · circles ·       │
 └───────────────────────────┘           │          consortia · patrons      │
                                          │ ops      verification desk ·      │
          sync status + provenance ──────►│          support inbox · appeals  │
          recorded on every fact          │ ledger   custody · orders · holds │
                                          └──────────────────────────────────┘
                                   event_outbox  →  read models (P3)
```

### 6.2 Rules that keep the architecture honest

1. **One writer per domain, one audit trail per fact.** Claims are append-only
   (`claim_events`); introductions, consortia and approvals follow the same
   pattern so any state change can be replayed. **[Built pattern]**
2. **The transactional outbox is the only cross-module channel.** Emit inside
   the caller's transaction; consumers drain with `FOR UPDATE SKIP LOCKED` on
   the worker loop. Read models and integrations are consumers, never writers. **[Built]**
3. **Every imported fact carries provenance**: source system, method (API /
   export / attested upload), fetched-at, reviewer, and next review date.
   Where an API does not exist the fallback ladder in P4.1 applies. **[Target]**
4. **Three data states, always labelled**: *verified* (reviewer-cleared
   evidence), *declared* (the business's own words — never styled as verified),
   *suggested* (AI output — always dismissible, never auto-executed). **[Target]**
5. **Human approval before consequential actions.** AI drafts introductions,
   summaries and coach steps; a person sends. Each approval is recorded with
   who, when and what was shown. **[Target]**
6. **Mobile-first, low-bandwidth, recoverable.** The SPA stays small and
   route-split; uploads and queued actions survive interrupted connections;
   voice notes remain first-class for low-literacy/high-bandwidth-cost use. **[Built + P1.6]**
7. **Data protection as an operating duty.** ODPC registration covers both
   controller and processor roles for vendors handling health-sector data;
   evidence is never public, only the fact status; retention and deletion are
   declared per data class. **[Evidence + Target]**

### 6.3 What we are not building

No microservices, no event broker, no warehouse, no separate identity service —
the modular monolith, Postgres, the outbox and the worker loop carry this plan
through P2. The architecture becomes a conversation only at the point where
verification throughput or integration volume outgrows a single writer.

---

## 7. Pricing

All numbers are **[Assumption]** — first-principles anchors to be tested in
pricing interviews, not published commitments.

### 7.1 Structure

| Tier | KES/month (est.) | Who | Included |
|---|---|---|---|
| **Starter** | Free | Any business | Passport with declared facts, public directory presence, 10 matches/month, 1 seat. Declared facts are clearly labelled and never styled as verified |
| **Readiness** | 2,900 (29,000/yr) | Suppliers with dated eligibility | Document vault, renewal calendar, fit checks on any request, priority verification queue (2 claim reviews/quarter included), 3 seats, email/SMS reminders |
| **Network** | 9,500 | Businesses that sell through relationships | Everything in Readiness + consent-based introductions (fair-use), consortium builder, private circles, watch alerts, 10 seats, dedicated desk |
| **Institution** | from 90,000 | Counties, programmes, large buyers, HMIS vendors | Buyer-side checklists and shortlists, seats for procurement/ finance, export/API access, readiness dashboards, SLA |
| **Verification add-on** | 1,500 per extra reviewed claim | Any tier | Human review of one additional claim, same SLA |
| **Introduction success fee** | 1–2% of first contract (pilot) | Network tier | Only through the recorded introduction and only with voluntary confirmation; disclosed before acceptance |

### 7.2 Pricing anchors and guardrails

- Anchors: tender aggregators sit around $49/month; the estimated cost of
  assembling one document set through a consultant is KES 15,000–60,000 per
  cycle (**[Assumption]** — validate with N1 interviews). Readiness must look
  cheap beside both.
- **Verification cannot be bought.** Payment buys queue priority and included
  reviews; it never buys a better status. A rejected claim stays rejected.
- **No pay-to-rank.** Ranking comes from the explainable matcher; sponsored
  placement, if ever introduced, must be visually separated from fact-based
  ranking (product decision: not before P3).
- The demand side is free at the point of search; institutions pay for seats,
  exports and SLAs because they need defensible shortlists, not access.

---

## 8. Customer acquisition (sequenced)

### Phase A (months 0–3): 100 hand-verified businesses

| Motion | Detail | Metric |
|---|---|---|
| Design-partner sprint | 15 suppliers + 5 buyer-side staff interviewed; 10 suppliers onboarded by hand; each gets its passport built with them | 10 design partners with ≥2 verified claims each |
| Accountant/consultant channel | The people who already shepherd CR12/TCC/permits; offer partner seats so they manage clients inside the platform instead of by email | 3 active consultant partners; ≥30 businesses onboarded through them |
| Association clinics | AGPO groups, women/youth business networks, county supplier associations; run "what SHA/DHA will ask you for" clinics with the actual checklists | ≥5 clinics; ≥40% of attendees finish one upload |
| Referral loop | Attribution is a first-class record; introducers see outcomes of their introductions | ≥20% of signups from an attributed introduction |

### Phase B (months 3–9): demand-side pull

| Motion | Detail | Metric |
|---|---|---|
| Buyer shortlist pilots | 3 county facilities / programme offices run their requirement list against the network; published shortlist basis | 3 pilots; ≥10 shortlists run |
| Dated-deadline content | Accurate, link-out guides to the official portals for SHA contracting, DHA certification and eTIMS changes — a guide, never a gatekeeper | Organic signups; portal link-out click-through |
| Sector events | County health summits and supplier days where procurement staff and suppliers are in one room | ≥2 events/quarter; qualified conversations per event |
| HMIS/vendor partnerships | Certified vendors need demand-side proof and readiness tooling for their own DHA files; we do not touch their system of record | 2 vendor partnerships signed |

### Phase C (months 9+): expand the catalogue, not the brand

Add adjacent sectors — general AGPO, food & hospitality, NCA construction,
export trade — using the sector checklists already in the catalogue, led by the
sector where the first paying cohort came from. Public procurement remains the
spine; the sector is the wedge.

### Channel economics to watch

CAC per paying business, verification cost per claim, activation rate
(signup → first verified claim), introduction acceptance rate, and — the one
that matters — **outcome rate**: introductions that end in a recorded contract
or completed order. Anything else is a vanity metric. **[Target]**

---

## 9. Milestones and measurable outcomes

Dates from 2026-10-11. Every number is **[Target]**.

| Milestone | Date | Product | Verified businesses | Commercial | Guardrails |
|---|---|---|---|---|---|
| **M0 — Validation closed** | 2026-12-15 | P1.1–P1.4 shipped to design partners | 100 (≥2 verified claims each; ≥60% with a verified identity claim) | 3 paying design partners; pricing interviews (n≥15) | Zero unverified public facts; verification SLA ≤72 h held for 4 consecutive weeks |
| **M1 — Beachhead traction** | 2027-03-31 | P2.1–P2.3 shipped; P1.5–P1.6 closed | 350 | 25 paid; 10% signup→paid; first 5 recorded outcomes | Introduction accept rate ≥30%; declines never penalised; <2% dispute rate on verified facts |
| **M2 — Demand pull proven** | 2027-06-30 | P2.4–P2.5; readiness dashboard v1 | 800 | 2 institutional accounts; NRR ≥90% | ≥10 buyer shortlists run; expiry-save rate (renewed before lapse) ≥60% |
| **M3 — Repeatable motion** | 2027-09-30 | P3.1–P3.2; first 2 integration adapters (P4.1–P4.2) | 1,500 across ≥3 counties | NRR ≥100%; CAC payback ≤9 months | Aggregate read models pass k-anonymity review; zero auto-sent AI actions |
| **M4 — Platform year** | 2027-12-31 | Consortium builder used in ≥20 real bids; P4.3–P4.4 | 2,500 across ≥6 counties and the first adjacent sector | Institutional ARR ≥ 40% of total; success-fee pilot decision | Every published fact traceable to a recorded event; no compliance implication in any UI string (audited) |

Leading indicators tracked weekly from M0: signups by channel, upload
completion, verification turnaround, watch creation, match views, introduction
requests, accepted introductions, outcomes, renewals saved, support tickets per
100 verified businesses.

---

## 10. Risks, and how this strategy fails

| Risk | Why it is real | Mitigation |
|---|---|---|
| **Verification economics** | Human review does not scale like software | Catalogue distinguishes printed validity from platform review windows; attestation for low-stakes claims; review only what a stated requirement needs; measure cost per claim weekly against the kill criterion |
| **Legal exposure on rejected claims** | A "rejected" status could damage a business | Rejections are private, reasons mandatory and stored verbatim, one appeal path (existing governance appeals), never public |
| **Rule changes** | DHA/e-GP/SHA timelines have already moved once | Link out to authoritative portals; treat every deadline as a moving target; sell readiness, not dates |
| **Disintermediation after the introduction** | Once parties are connected they can leave | The value stays in the record: expiries, next bids, attribution, fit on the *next* opportunity |
| **Channel dependency on consultants** | They may see us as competition | Partner mode keeps them paid for their skill while the platform holds the facts |
| **Trust incident** | One unverified claim presented as verified destroys the position | The three-state labelling is a release gate, not a feature; guardrail tests in P1 and M4 audit |
| **Demand-side apathy** | Buyers may not care about verifiability until something goes wrong | Anchor the demand side to documented failures (N3/N6 diarists) and to procurement defensibility, not to convenience |

---

## Appendix A — evidence ledger (public sources consulted 2026-10-11)

| Fact used | Source |
|---|---|
| SHA E-Contracting portal live 2026-09-17; cycle 2026-10-01 → 2029-06-30; required documents; 7-day expiry of incomplete applications | healthcaremea.com; ghafla.co.ke; pulse.co.ke; kdrtv.co.ke; kenyans.co.ke |
| DHA certification compulsory (Digital Health Act 2023; Data Exchange Regulations 2025; HIM Procedures Regulations 2025); only certified systems connect to the CIHIS ESB; 26-component checklist; accreditation tied to SHA 2026/28 contracting; deadline extended to 2026-09-30; ODPC duties | hanmak.co.ke; allafrica.com (2026-09-01); lgmhealthadvisory.org; afyastack.co.ke; amgadvocates.com; certification.dha.go.ke; afyalink.dha.go.ke |
| KEMSA fill rate ~41% FY24/25 (~19.5-day waits); Sh7.6bn owed; FY26/27 allocation Sh20.9bn (+302%); counties bypassing KEMSA | the-star.co.ke; nation.africa |
| AGPO 30% reservation (PPADA 2015 ss.155/157; ≥70% ownership, 100% management control; youth 18–35); >160,000 enterprises by end-2022; 7.71% of sampled 2013–16 tenders awarded | stratfordjournalpublishers.org; business.co.ke (Aug 2026); icr-facility.eu; hivos.org |
| Kenyan KYB chain: BRS/eCitizen incorporation, CR12 (KES 650, often <6 months old), KRA PIN/TCC/eTIMS, beneficial-ownership filing, county single business permit | maps.prodafrica.com; businessplans.co.ke; afrisetup.com; helloduty.com; commenda.io |
| eTIMS mandatory; returns validated against eTIMS data from Jan 2026; buyer KRA PIN mandatory for B2B | betasuiteerp.com; tuko.co.ke; businesspro.co.ke; vatabout.com |
| Aggregator market: Jorpex ($49/mo), TenderSoko (~33k tenders + TendAI), TenderHQ; e-GP mandatory e-submission; 47 county portals | jorpex.com; tenderhq.online; api.tendersoko.com; tenders.co.ke |
| African B2B platforms competing on verification/trust scores | capmad.com; mysokoni.co.ke; nexizo.ai; techbooky.com (Eyby, Jul 2026) |
| Gig-worker conditions and ILO treaty talks (reason to defer gig features) | nation.africa (HRW, May 2026); genevasolutions.news; theguardian.com |
| Distribution economics (Wasoko–MaxAB, ~450k merchants; fintech pivot) | africasignal.com; unreasonablegroup.com; qz.com |

## Appendix B — validation script (first six weeks)

1. **Suppliers (n=15):** last won bid, last lost bid — walk the document set one
   by one. Who asked for what, how old, what did it cost, what expires next.
   Then: "show me the last time a document expiry cost you money."
2. **Buyer-side (n=5):** last prequalification exercise — elapsed days, staff
   hours, how many suppliers fell out for paper reasons versus real capability.
3. **AGPO consortium (n=20):** how was your last team assembled; what would
   have made it faster; who did you trust to lead.
4. **Pricing (n=15):** forced choice between Readiness at KES 2,900 and a
   consultant cycle at their stated cost; then the willingness-to-pay ladder.
5. **Falsification review:** if neither buyer nor supplier independently names
   N1–N3, stop and re-open the niche decision before writing another line of code.
