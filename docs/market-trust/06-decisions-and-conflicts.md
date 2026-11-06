# 06. Decisions and conflicts

## A. Conflicts with rules already set for this project

These are not design questions. They need your decision before any build.

### C1. Paid services versus "free for now"

The blueprint's revenue model includes business subscriptions, a paid verification fee, sponsored discovery, analytics contracts and lead fees.

Your standing rule: no feature paywalled, no membership subscription, no logistics fee. Build future-ready infrastructure, but do not turn on revenue collection.

**Proposed resolution:** the spec keeps these as **future, disabled by default**. Sponsored placements are not built until disclosure rules are written. Verification is free at pilot stage.

**Decision needed:** confirm this.

### C2. Cash rewards and reward balances

The blueprint wants cash-convertible rewards, withdrawable through M-Pesa, funded from real revenue.

Your standing rules: keep mock payment mode until database and payment testing are complete; no lending or deposit taking; credit goes to a licensed partner; no stored value without a licence.

The blueprint itself says the legal status of a reward balance is unresolved and needs specialist advice.

**Proposed resolution:** build the ledger and tasks first. Cash withdrawals stay off, in mock mode, until a written legal opinion for Kenya is in hand.

**Decision needed:** do you accept that rewards are points-only in the pilot, with cash off until legal review?

### C3. Club and association scope

The blueprint excludes club membership management, and the first product is commerce intelligence. Brief already has chamas, vendor lists, groups and events. Those stay as they are. The spec does not touch them.

**Decision needed:** confirm that the existing club-type features are out of scope for MarketTrust and stay as they are.

### C4. Chama and credit

Your rule: Chama bulk buying comes after trust and network are established, and credit is out of scope until a licensed structure exists. The blueprint does not mention credit, so nothing here conflicts. Recorded for completeness.

## B. Technical conflicts with the existing app

### T1. API prefix

Blueprint: `/api/v1`. Brief: `/api/...` with no version, across all live routes. Changing the prefix breaks the live site. **Proposed:** new routes under `/api/trust/...`, no version segment until a breaking change exists.

### T2. Money stored as Float

Blueprint rule: decimal money, never floating point. Brief: `stock_items.unit_price`, `cost_price` and `wholesale_price` are `Float`. The new tables use integer minor units.

**Proposed:** leave the existing columns alone for now. A separate, tested migration can convert them later. Flagged so the two systems are not mixed up in reports.

### T3. Two rating systems already exist

`vendor_list_reviews` (average rating on vendor lists) and `knowledge_reviews` (directory sessions) both use 1–5 stars. Neither is about a business or branch.

**Proposed:** keep both as they are. Do not show them in the MarketTrust score. Consider merging the display later, with a decision.

### T4. Country tenancy

Blueprint: every country is a first-class tenant from day one. Brief: Kenya only, and there is no `countries` table.

**Proposed:** add `countries` and `country_code` columns in phase 1, with Kenya only. Other countries wait until a second market is confirmed. This is cheap now and expensive later.

### T5. PostGIS

Blueprint: PostGIS for geo search. Brief: no PostGIS in the existing models.

**Proposed:** start with latitude and longitude plus a database index. Add PostGIS only after confirming the extension is available on the chosen database host. I have not checked that.

### T6. Reputation formula

The pasted formula lost the definitions of its symbols. `04-trust-rewards-fraud.md` gives a reconstruction, marked as an assumption.

**Decision needed:** confirm the reconstruction, or send the original definitions.

## C. Facts I did not verify

The blueprint makes claims about:

- The EAC Cross-Border Payment System Masterplan and the Rwanda–Tanzania instant-payment work.
- CBK licensing thresholds and a National Payment System Bill.
- Kenya's Data Protection Commissioner registration requirements.
- Payment provider and market size figures.

I did not check these in this work. They are listed here so that a lawyer or analyst verifies them before any decision depends on them. Nothing in these spec files relies on them except the legal hard gate in `04`.

## D. Open decisions summary

| ID | Question | Recommended answer |
|---|---|---|
| D1 | Is the blueprint a reference for MarketTrust inside Brief, with its own branch and phases? | Yes. Phases run in order, each with its own acceptance tests. |
| D2 | Confirm C1: no paid service at pilot. | Yes |
| D3 | Confirm T1: `/api/trust/...` prefix, no version yet. | Yes |
| D4 | Confirm C2: points-only rewards until legal review. | Yes |
| D5 | Confirm T4: add `countries` with Kenya only. | Yes |
| D6 | Confirm T6: the reconstructed scoring formula, or send the originals. | Confirm |
| D7 | Who gives the legal opinion, and when? | Needed before any cash feature |
| D8 | Which two categories for the Kisumu pilot? The blueprint suggests electronics, groceries and building materials. | Confirm the three, or name the ones you want |

## E. Recommended first step after this spec

Phase 1 foundation: `countries`, `evidence_assets`, `audit_events`, plus the test that proves each one is append-only where required. No public feature yet. This matches the blueprint's own Phase 0 exit rule: no feature work until the schema, API, permissions and acceptance tests are approved.
