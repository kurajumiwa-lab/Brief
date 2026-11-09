# Milestone M2: Privacy, verifiable trust, and a clean audit trail

Status: **proposal for review. No development starts until this document is approved.**
Owner decisions are listed in section 10. Nothing here is built yet.

## 0. Where we are

- **S1 (home office) is complete.** Backend and `/office` page are on `arena/83fa6769-brief` (`8fe20d1`, `5bf0e71`, plus the pivot doc `f530b69` and the rider fix `4f2b64d`).
- **Follow-up, not blocking:** `frontend/src/test/calendar.test.jsx` fails on the untouched tree. Its fixtures hard-code the week of 2026-11-02 and depend on the current date. Fix: pin the clock with `vi.setSystemTime` in that test file. Tracked as M2 backlog item B0.
- **Already done in S1:** rider personal phone numbers are no longer returned by any public API.

## 1. Principles (apply to every workstream)

1. **Privacy by default.** Personal data is hidden unless the person opts in, and opt-out is one tap.
2. **Three trust statuses stay separate.** Business verified, transaction verified, and community review are never merged into one score or badge.
3. **Proof is independent of the party it judges.** A shop cannot prove its own sale. A customer's typed reference is not proof.
4. **Append-only audit.** Every status change, consent change, claim, dispute, and restriction writes an event that is never updated or deleted.
5. **No manufactured trust.** No purchased reviews, no fake followers, and no review can remove a legitimate business on its own.
6. **Brief takes no payment and holds no funds.** Any money-related integration must be confirmed as verification-only with counsel before build.

## 2. Current state (from the code, not assumptions)

| Area | What exists | Gap for M2 |
|---|---|---|
| Rider contact | `trust_branches.rider_phone` stored in plain text. Public payload now returns `phone: null`. | No consent flag. Owner enters a rider's number they may not have permission to share. |
| Transaction evidence | `transaction_tokens` (shop-issued till code, optional `receipt_ref`). Reviews with a consumed token get tier `confirmed_token`. | `confirmed_token` is **shop-attested**: the shop issues the code and the same shop is the one benefiting. The label overstates what is proven. No link to any independent record. |
| Phone ownership | `vendors.phone`, `vendors.phone_verified_at` ("set only by a real verification flow"). | **No OTP flow exists.** `phone_verified_at` is never set. |
| Business verification | `business_branches`, `branch_verifications` (manual method + result), `trust_branches.verification_level`. | No claim workflow, no listing ownership history, no evidence threshold. |
| Audit | `audit_events` (action, entity, actor, payload). Append-only by convention, not enforced. | No hash chain, so tampering would not be detectable. |
| Disputes | `review_flags`, `review_moderation`. | No dispute, appeal, or listing restriction. Flags apply to reviews, not to listings. |
| Kiswahili | `lib/i18n.js` contains Kiswahili strings. | No native-speaker review record. Consent, OTP, and dispute copy not yet written. |

## 3. Workstream 1: Rider consent (first, per your order)

### 3.1 Rules

- Consent is given **by the rider**, not by the shop owner. The owner can request consent; only the rider can grant it.
- Default is **off**. A branch with no consent record has no public rider contact.
- Revocation takes effect at once. Public contact stops on the next request, with no cache window.
- The rider's number is **never** in a public response, page, log line, or analytics event, even when consent is on.
- Public contact goes through the platform: an in-app message request (preferred), or a WhatsApp link generated per request, only when consent is on.

### 3.2 Database (migration `0041_rider_consent`)

New **append-only** table `rider_consent_events`:

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| branch_id | uuid fk `trust_branches` | |
| action | varchar(12) | `requested`, `granted`, `revoked`, `expired` |
| channel | varchar(12) | `in_app`, `whatsapp`, `phone` (phone = recorded only, never published) |
| consent_text_version | varchar(20) | Which wording the rider saw (EN and Kiswahili versions tracked) |
| rider_proof_hash | varchar(64) | HMAC of the rider's number. Proves the same number confirmed; the number itself is not stored here |
| actor_vendor_id | uuid null | Owner who requested it |
| created_at | timestamp | |

Derived current state (one column, updated only by a trigger or service that also writes the event):

- `trust_branches.rider_contact_status` varchar(12): `off` (default), `on`, `revoked`
- `trust_branches.rider_contact_channels` jsonb: subset of `in_app`, `whatsapp`
- `trust_branches.rider_phone` moved to a separate table `rider_contacts` with column-level encryption (see 3.5). Only the owner and a staff role can read it.

### 3.3 API

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/trust/branches/{id}/rider/consent-request` | owner | Sends a consent link to the rider's number (WhatsApp or SMS, see decision D3). Creates a `requested` event. |
| POST | `/api/trust/rider-consent/{token}` | rider, no account | Rider opens link, sees the wording, confirms with a one-time code (OTP, section 5), chooses channels. Single-use token, 72-hour expiry. |
| POST | `/api/trust/rider-consent/{token}/revoke` | rider, via the same link or a signed link in every message | Revokes at once. Single-use or per-rider revocation key. |
| POST | `/api/trust/branches/{id}/rider/messages` | buyer, signed in or device key | Buyer writes a message. Stored in the platform. Rider gets a notification. Number never returned. Rate-limited. |
| GET | `/api/trust/public/branches/{id}` | public | Adds `rider.contact: {available, channels}`. No number, ever. |

Changed: `PUT /api/trust/branches/{id}/delivery` no longer accepts `rider_phone` as a public-facing value. It may store a number only after consent is `on`.

### 3.4 Security implications

- A consent link is a bearer token. Store only its hash, make it single-use, expire it in 72 hours, and rate-limit creation per branch.
- A rider who never agreed cannot be contacted by a shop. Consent records prove who agreed, when, and to what wording.
- The owner's own screen shows the rider's number only to the owner, with no public copy.
- Revocation must also block the WhatsApp link generator and the in-app relay. Both check the current status on every request.
- Kenya Data Protection Act 2019: a rider's number is personal data. Counsel must confirm the lawful basis and retention period before build (decision D4).

### 3.5 Encryption

Column-level encryption (Fernet or AES-GCM) for `rider_contacts.phone`. Key in environment or secrets manager, not in the database. Decrypt only in the service that sends a message. Encryption adds operational cost, so the owner must decide whether it is required now (decision D5). Recommended: yes.

### 3.6 Acceptance tests

1. A new branch with a rider has `rider_contact_status = off` and no channels.
2. Public branch payload contains no rider phone for any state (off, on, revoked). A regex test over the full JSON response must find no `+254`, `07`, or `01` numbers.
3. Owner can request consent; the request creates a `requested` event; the rider's number is not in the response.
4. Consent link works once; a second use returns 404; an expired link returns 410.
5. After `granted`, `rider.contact.available` is true only for the granted channels.
6. After `revoked`, the next public GET and the next message attempt both refuse, with no cache delay.
7. The rider's number appears in no log line (test captures log output during the whole flow).
8. Events table rejects `UPDATE` and `DELETE` (database-level test with a restricted role).
9. Kiswahili and English consent text both exist and both carry the reviewed flag before launch.

## 4. Workstream 2: Transaction verification (second)

### 4.1 What records exist today

- **MarketTrust holds no payment ledger.** Brief does not process payments, so it has no independent transaction record of its own.
- **Shop-issued till codes** (`transaction_tokens`) are created by the shop and consumed by the customer. They prove only that the shop chose to issue a code. Under this milestone they are reclassified as **shop-attested**, not verified (see 4.4).
- **M-PESA receipts** are the independent record. Each completed M-PESA transaction has an M-PESA receipt number (`TransID`, 10 characters). Safaricom's systems hold it. Brief can only read it through an integration the shop authorises.

### 4.2 Integration options (to be confirmed)

| Option | How it works | Pros | Cons / missing |
|---|---|---|---|
| **A. Shop paybill/till confirmation (C2B)** | Shop's paybill or till is registered with Daraja. Each payment POSTs a confirmation to Brief's HTTPS endpoint with `TransID`, amount, and account reference. | Strongest. Independent of both parties. | Needs the shop's shortcode, a Daraja production app, Safaricom approval, and a legal view that receiving confirmations is not handling payment. Heavy onboarding per shop. |
| **B. Transaction status query** | Brief queries a shop-owned `TransID` through an initiator with a security credential. | Confirms a specific receipt on demand. | Needs the shop's API initiator credentials and a security credential. Shops will resist sharing these. High risk if mishandled. |
| **C. Customer-submitted M-PESA code** | Customer enters the M-PESA code from their SMS. Brief stores it and marks it pending. | Easy for customers. | **Not proof.** A code can be copied. Only usable as a claim to be checked by A or B. Never sufficient alone. |
| **D. Shop-issued till code** (existing) | Shop issues a one-time code. | Works offline. | Shop-attested only. Same party issues and benefits. |

Recommendation: start with **C plus manual staff check against a shop-provided statement** for the pilot, and build **A** once a shop has a registered paybill. Do not build **B** unless a specific need appears and counsel approves it.

Sources for the M-PESA details above (secondary, to be confirmed against the official Daraja documentation before build): [paybillke.com M-PESA C2B guide](https://paybillke.com/guides/mpesa-c2b-integration-2026) describes the C2B confirmation fields (`TransID`, `BillRefNumber`, `MSISDN`) and the requirement to acknowledge callbacks. [GitHub victorpreston/mpesa-api](https://github.com/victorpreston/mpesa-api) lists the Daraja endpoints and credentials (consumer key, passkey, initiator and security credential) used in the Transaction Status and B2C flows.

### 4.3 Missing access and information (blockers)

- Daraja developer account and a **production** app approved for the relevant products (owner or company must apply).
- Each pilot shop's paybill or till number and written authorisation for Brief to receive confirmations.
- The initiator name and security credential, only if option B is ever approved.
- Counsel's view on whether option A counts as "taking payment" under Brief's no-payment rule.
- Pilot-shop statements or receipts for the manual check path.

### 4.4 Evidence tiers (replaces `confirmed_token`)

| Tier | Meaning | Who sets it | Weight |
|---|---|---|---|
| `verified_transaction` | Independent record matched: a Daraja C2B confirmation or staff check against a shop-provided statement | System or staff, logged | Highest. Only this tier may carry the "verified transaction" label. |
| `shop_attested` | Shop-issued till code consumed by the customer | Shop | Low. Shown as "shop-issued code", not as a verified sale. |
| `unverified` | Review with no transaction evidence | — | Lowest. Shown as community review. |

Migration of existing data: rows with `evidence_tier = 'confirmed_token'` become `shop_attested`. Their weight is reduced. Existing ranking changes must be reviewed (decision D6).

### 4.5 Database changes (migration `0042_transaction_evidence`)

- `transaction_evidence` (append-only): `id`, `branch_id`, `review_id` nullable, `source` (`daraja_c2b`, `staff_statement`, `till_code`, `customer_reference`), `external_ref` (M-PESA `TransID`, hashed for storage, shown masked), `amount_minor`, `currency`, `occurred_at`, `matched_by`, `matched_at`, `status` (`submitted`, `matched`, `rejected`).
- `business_reviews`: rename `evidence_tier` values; add `transaction_evidence_id` fk nullable.
- Unique constraint on `transaction_evidence (source, external_ref)`: one real transaction cannot be used twice.
- Unique constraint on `business_reviews (branch_id, reviewer_identity, transaction_evidence_id)`: one transaction produces one review opportunity per customer.

### 4.6 API changes

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/trust/branches/{id}/transactions/reference` | customer, device key | Submit M-PESA code. Creates `submitted` evidence. Creates no review by itself. |
| POST | `/api/trust/staff/transactions/{id}/match` | staff | Matches against statement or Daraja record. Writes audit event. Two-person rule for amounts above the threshold (D7). |
| POST | `/api/trust/daraja/c2b/confirmation` | Safaricom | Acknowledges with the structured success body, idempotent on `TransID`. Verifies source and HMAC if available. |
| POST | `/api/trust/daraja/c2b/validation` | Safaricom | Only if validation is enabled. Default: not enabled. |

A review may be submitted only against a `matched` evidence row or a `shop_attested` till code. A `submitted` reference alone cannot publish a verified review.

### 4.7 Security implications

- A single M-PESA code cannot be reused across branches or customers (unique constraint).
- Callbacks are accepted only over HTTPS, verified against Safaricom's source if the integration supports it, and acknowledged idempotently. Replays cannot create duplicate evidence.
- Customer-entered codes are stored masked. Full codes are shown only to staff who need them.
- No shop can match its own evidence: the matcher must be a different account from the shop owner.
- Amounts and receipt numbers are personal-financial data. Retention and access are set in decision D4.
- The Safaricom callback is unauthenticated by bearer token, so it must be added to the vendor-only gate as an **exact POST route**, the same way `/api/office/links/accept` is handled. It must not be opened by prefix. Its security then rests on source checks, HTTPS only, and idempotent handling.
- Same for the rider consent POST (`/api/trust/rider-consent/{token}`): exact route, bearer token is the proof, rate-limited.

### 4.8 Acceptance tests

1. A customer-submitted reference alone never produces `verified_transaction`.
2. The same `TransID` submitted twice creates one evidence row and one review opportunity.
3. A shop owner cannot match their own evidence (403).
4. Two different customers cannot both use the same matched transaction for reviews.
5. A till code produces `shop_attested` and is labelled as such in the public payload.
6. The C2B confirmation endpoint returns the structured success body and is idempotent under a replayed callback.
7. Public payload carries counts per tier, never a single merged score.
8. Migration maps `confirmed_token` to `shop_attested` and leaves a row count check of zero loss.

## 5. Workstream 3: Three separate statuses

| Status | Question it answers | Set by | Shown as |
|---|---|---|---|
| **Business verified** | Is this business really controlled by the people who say so? | Claim workflow (section 6) | Verified business badge, with date and method |
| **Transaction verified** | Has a real trade been confirmed by an independent record? | Evidence matching (section 4) | Count of verified transactions and "verified transaction" tag on each review |
| **Community review** | What does a customer think? | Customers | Reviews, labelled "community review" when no verified transaction |

Rules:

- The three are stored in separate fields and shown in separate places on the shop page.
- No combined score is computed or displayed. Any aggregate must show the three counts beside it.
- A business can be verified with zero reviews, and reviews can exist for an unverified business. Each state is labelled.

### 5.1 Database (migration `0043_trust_statuses`)

- `trust_branches.business_status` varchar(16): `unverified`, `claimed`, `verified`, `restricted`, with a link to the claim event.
- `trust_branches.business_verified_at`, `business_verified_method`.
- View `public_trust_summary` returning the three independent fields. Used by the public API so the separation is enforced in one place.

### 5.2 API changes

- `GET /api/trust/public/branches/{id}` returns `trust: {business: {...}, transactions: {verified, shop_attested}, community: {count, average}}`. Each block has its own label and source.
- Existing `verification_level` is kept for backwards compatibility and marked deprecated.

### 5.3 Acceptance tests

1. A branch with zero transactions and verified business shows `business.status = verified` and `transactions.verified = 0`.
2. Community reviews without transaction evidence never increment `transactions.verified`.
3. The response has no field that adds the three together.
4. UI snapshot test: all three labels present and distinct on the shop page, in English and Kiswahili.

## 6. Workstream 4: Claims and disputes (fourth)

### 6.1 Claiming a listing

**Stage 1, basic claim (any registered account):**

1. Claimant enters the business phone number registered on the listing (or the phone on the public business register, if present).
2. Brief sends a one-time code (OTP, 6 digits, 10-minute expiry) to that number. Max 3 sends per number per day, 5 wrong attempts then lockout 1 hour.
3. Correct code: claim status `verified_phone`. Listing business status becomes `claimed`, not `verified`.

**Stage 2, full verification (for `verified` status):** requires one of:

- Business registration number (BRS certificate) plus a matching director or owner ID, reviewed by staff; or
- A second-channel check: a code sent to a registered email, or a short video call with staff where the owner shows the premises; or
- For disputed or high-risk claims: both of the above, plus a second staff reviewer.

**Alternative route** for businesses without reliable SMS access:

- Staff-assisted review using the registration certificate and a WhatsApp video call. Recorded as `method = staff_assisted`, with the reviewer's identity.
- Owner must confirm the listing's contact details from a second source before the change is saved.

**Audit trail for ownership:**

- `listing_claims` (append-only): claim id, listing id, claimant account, method, status, evidence references (stored privately), reviewer, decision, timestamps.
- `listing_ownership_events` (append-only, hash-chained): each row stores a hash of the previous row, so a gap or edit is detectable. Nightly job recomputes the chain and alerts on mismatch.

**Dispute on a claim:** Any existing owner or a new claimant can raise a dispute. Claim is frozen to `restricted` until a staff decision.

### 6.2 Removing or correcting a listing

**Owner requests:** a verified owner may request correction or removal. Removal takes effect after a 7-day cooling-off period unless the owner confirms earlier. Removal is recorded as `archived`, not deleted.

**Customers report:** impersonation, fraud, or incorrect information, through a report button on the shop page. Each report needs a reason from a fixed list, an optional description, and nothing else. Reporters are not identified publicly.

**Temporary restriction (while investigating):**

- Triggered by: an impersonation report with evidence, a fraud report that matches a second independent report, or a staff decision.
- Effect: the listing shows "under review", stops receiving new reviews and any ranking boost, and keeps its history visible.
- Duration: 14 days maximum, extendable once by a second staff member.
- A review, or several bad reviews, is **never** a trigger on its own.

**Protecting legitimate businesses from removal by dislike:**

- Review content disputes go to review moderation (`review_flags`, `review_moderation`), not to listing removal.
- Removal of a verified listing needs: a verified owner request, or two independent reports with evidence, plus a staff decision that a different reviewer confirms.
- Staff actions are logged and visible to the business.

**Appeals:**

- Any restricted or archived listing can be appealed within 14 days.
- Appeal is reviewed by a staff member who did not make the original decision.
- Outcome is final within 30 days, with reasons, and recorded.

### 6.3 Database (migration `0044_claims_disputes`)

- `listing_claims`, `listing_ownership_events` (hash-chained), `listing_reports`, `listing_restrictions`, `listing_appeals`. All append-only.
- `otp_challenges`: `id`, `purpose` (`claim`, `consent`), `phone_hash`, `code_hash`, `expires_at`, `attempts`, `consumed_at`. Code stored as a salted hash, never plain.

### 6.4 API changes

| Method | Path | Who |
|---|---|---|
| POST | `/api/trust/listings/{id}/claims` | signed-in account |
| POST | `/api/trust/claims/{id}/otp` and `/otp/verify` | claimant |
| POST | `/api/trust/claims/{id}/evidence` | claimant, private upload |
| POST | `/api/trust/listings/{id}/reports` | anyone (device key or account) |
| POST | `/api/trust/listings/{id}/appeals` | owner |
| POST | `/api/trust/staff/claims/{id}/decision` | staff, two-person rule for high-risk |
| POST | `/api/trust/staff/listings/{id}/restrict` | staff, reason required, 14-day auto-expiry |

### 6.5 Security implications

- OTP is the weakest step and is easy to abuse (SIM swap, a person who controls a number that is not the business's). The OTP proves control of the number, not the business. That is why high-risk claims need the second stage.
- SMS provider not yet chosen (decision D8). Message content must not reveal the business name to the wrong person.
- Staff decisions and restrictions are logged with reviewer identity. Two-person rule for removals.
- Evidence files (certificates, IDs, photos) are stored privately, never public, with access logged and retention set in D4.

### 6.6 Acceptance tests

1. Claim by OTP reaches `verified_phone` and never sets `business_status = verified` on its own.
2. Five wrong OTPs lock the claim for one hour; the sixth attempt is refused.
3. An OTP cannot be used after its expiry or after consumption.
4. A new claim on a listing with an active verified owner is refused and routed to dispute.
5. A removal request from a non-owner returns 403.
6. Three bad reviews and no reports do not restrict or archive a listing.
7. Two independent reports plus a staff decision restrict the listing and hide it from ranking; restriction expires at 14 days automatically.
8. The appeal reviewer is never the original decision-maker (database and service check).
9. Ownership event chain: tampering with any past row makes the verifier fail.
10. Restricted listing still shows its history and the "under review" label in English and Kiswahili.

## 7. Workstream 5: Kiswahili (fifth, but built in parallel)

Kiswahili is not a final step. Every workstream above writes its user-facing text in both English and Kiswahili at the time it is built.

- **Scope of text:** rider consent wording, consent revocation, OTP messages, claim and dispute screens, restriction and appeal notices, the three trust labels, and M-PESA reference instructions.
- **Review process:** a named native speaker reviews each string. Status per key: `draft`, `reviewed`, `approved`. Strings with `draft` status cannot be shown on legal or consent screens. English shown as fallback only where the key is marked non-legal.
- **Consent and legal text** is reviewed by a native speaker and by counsel.
- **Reviewer:** not yet named (decision D9).
- **Tests:** a build check fails if any consent, OTP, or dispute key lacks a `reviewed` or `approved` Kiswahili entry.

## 8. Backlog and sequencing

| Order | Item | Depends on |
|---|---|---|
| B0 | Fix date-dependent `calendar.test.jsx` (pin clock) | none |
| 1 | Rider consent (`0041`) | decisions D3, D4, D5 |
| 2a | Evidence model and staff matching (`0042`), reclassify `confirmed_token` | D6, D7 |
| 2b | Daraja C2B confirmation, only after shop authorisation and counsel view | D1, D2 |
| 3 | Trust status separation (`0043`) and public summary view | 2a |
| 4 | OTP, claims, reports, restrictions, appeals, audit chain (`0044`) | D8, D10 |
| 5 | Kiswahili review pipeline; applies to all of the above | D9 |

Exit criteria for M2: all acceptance tests above pass in CI, a security review of the consent, evidence, and claim paths is signed off, and the pilot shops have agreed the evidence rules in writing.

## 9. Out of scope for M2

- Brief processing, holding, or disbursing money in any form.
- Option B (status query with shop credentials) unless separately approved.
- Public ranking formulas that merge the three statuses.
- Automatic removal of any listing without a human decision.
- Purchased contact lists, fake followers, or incentives for reviews.

## 10. Decisions needed before development

| # | Decision | My recommendation |
|---|---|---|
| D1 | Will Brief apply for a Daraja production app now, or after the pilot? | After pilot. Start with manual statement checks. |
| D2 | Counsel's view: does receiving a paybill confirmation count as handling payment? | Get a written view before any Daraja work. |
| D3 | How is a rider contacted for consent: WhatsApp template, SMS, or in-app only? | WhatsApp link first, SMS fallback. |
| D4 | Retention periods for consent records, phone numbers, M-PESA references, claim evidence, and Kenya Data Protection Act basis | Counsel to set. Proposal: consent events 3 years after revocation; numbers deleted on revocation plus 30 days; references masked after 12 months. |
| D5 | Encrypt rider and claimant phone numbers at rest now? | Yes. |
| D6 | Reduce the weight of existing shop-issued till-code reviews? | Yes. Show them as "shop-issued code", not verified. Ranking change reviewed before release. |
| D7 | Two-person rule threshold for matching transactions and removals | Any matched amount above KES 10,000, and every removal. |
| D8 | SMS provider for OTP | Choose after a Kenya-focused comparison. Not chosen yet. |
| D9 | Named Kiswahili native-speaker reviewer | Owner to name a person. |
| D10 | Staff roles: who can match transactions, decide claims, restrict listings | Separate roles, no single person holds all three. |

## 11. Review checklist (what you are approving)

- [ ] Section 3: consent flag default off, rider-controlled, revocable, number never public.
- [ ] Section 4: no reliance on user-submitted references; evidence tiers renamed; Daraja path gated on counsel.
- [ ] Section 5: three statuses stored and shown separately.
- [ ] Section 6: OTP steps, alternative route, audit chain, appeals, temporary restrictions, no removal by dislike.
- [ ] Section 7: Kiswahili review built into every workstream.
- [ ] Section 10: decisions D1 to D10 answered.

Once you approve this document and answer D1 to D10, I'll start with B0 and then workstream 1, with migrations and tests exactly as listed above.
