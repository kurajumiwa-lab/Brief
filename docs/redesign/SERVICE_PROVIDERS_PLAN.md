# Service providers: gap analysis and phased plan

Status: **Owner decisions D1 to D5 recorded below. Phase 0 implemented behind `VITE_SERVICE_PROFILES_ENABLED`. Phases 1 and later not started.** Branch `arena/5a64c270-brief`, based on `main` at `e9e19b7`.

## 0. Owner decisions (recorded)

- **D1:** backfill `booking_services`: `delivery_clinic = true`, `delivery_home = false`, `delivery_remote = false`, `price_unit = NULL`. New columns nullable.
- **D2:** approved. A provider with 0 goods but at least one published `booking_service` and active `availability_rules` appears on Nearby and front doors. Implementation is Phase 3, not yet started.
- **D3:** a self-declared licence shows as "Self-declared Licence". Only an operator verification through `/api/ops/*` shows "Verified Credential". Verification stays separate from visibility. Still to confirm: the legal review noted in section 4.
- **D4:** domains framed as work and services: Healthcare & Care, Trades & Technical, Personal Care & Beauty, Logistics & Delivery, Market & Retail Support. Banner copy changes are approved in principle. Exact wording is still to be reviewed.
- **D5:** "Vendor World" stays the public name. A user's space is called their workspace or home office inside it.

Phase 0 (copy only, flagged) as built: the offering form labels a service "Service name" and its unit placeholder reads "visit, hour, shift". The Desk empty-state link reads "Add goods to your stock". Flag off keeps the old wording.

Problem: the app was built for goods and labour shifts. A registered nurse, electrician, tutor, or barber fits neither. The request asks for service modes, operating hours, pre-service presence, licence or credential support, and flexible units (per visit, per hour, per shift, quote).

## 1. What already exists (reuse, do not duplicate)

| Need | Existing piece | Where |
|---|---|---|
| Service offering with a duration and a KES price | `BookableService` (`booking_services`): name, duration, buffer, `price_kes`, `price_mode` (fixed / negotiable / ask_me), `service_radius_km`, archive | `backend/app/modules/schedule/models.py` |
| Weekly operating hours | `AvailabilityRule` (`availability_rules`): weekday, start and end minute | same file |
| Booking | `Appointment`, slots, `POST /api/schedule/appointments`, status changes | `backend/app/modules/schedule/router.py` |
| Service offerings in Desk | Phase 3 offerings read `booking_services` as the "service" kind | `backend/app/modules/offerings/service.py` |
| Service vs goods vs tool | Offering kinds `goods`, `service`, `tool` | same file, `PRICE_ATTR` |
| Free-text price unit | `price_unit` on goods and tool offerings. Not on services. | `offerings/service.py` |
| "Visible without stock" | Front doors are built from offering summaries. A profile with no offerings is not listed. | `backend/app/routes/nearby.py` |
| Business registration | `vendors.business_registration` (String 100). Not verified. | `backend/app/models/vendor.py` |
| Verification kept separate | Rule: verification never sets public visibility or approves compliance claims. | `backend/app/models/vendor.py` (comments) |
| Categories | Taxonomy groups used by Nearby (`taxonomy.match_vendor`) | `backend/app/services/taxonomy.py` |
| Activity choice on signup | Onboarding "What do you do?" activity keys (Phase 1) | `backend/app/routes/onboarding.py` |

**Conclusion:** the blueprint's proposed `working_hours` table duplicates `availability_rules`. Its `ALTER TABLE stock_items` targets the goods model, not the offering model. Do neither.

## 2. Gaps, mapped to the request

| # | Request | Gap | Fix (additive) |
|---|---|---|---|
| G1 | Service delivery mode (clinic, home visit, remote) | No field on `booking_services` | Add delivery flags to `booking_services` |
| G2 | Operating hours | Exists as `availability_rules`. Only edit UI for services is missing (check) | Reuse; add a weekly hours editor to the service form |
| G3 | Unit pricing (per visit, hour, shift, quote) | `booking_services` has no unit. `price_mode` covers only fixed, negotiable, ask_me | Add `price_unit` to `booking_services`; keep `price_mode` |
| G4 | Pre-service presence (listed before any order) | Front doors need an offering. A service profile with services and hours should count. | Product decision (see D2) |
| G5 | Credentials (council registration, certificates) | No field. `business_registration` is not a licence and is not verified. | Additive fields with a status; admin verification (see D3) |
| G6 | Professional profile card | Partial on Vendor profile | Build from real data only (see P5) |
| G7 | Service domains (Healthcare, Logistics, Repairs, Personal care) | Taxonomy exists; labels are warehouse and shift oriented | Map to taxonomy groups; names need owner approval (see D4) |
| G8 | Copy ("cartons", "stock room", "crate packing") shown to service providers | Known. Phase 11 renamed "vendor" only. | Service-aware copy in the Desk form (see P0) |

## 3. Phased plan

Each phase is a separate PR. Each phase has a flag. Migrations are additive only, with no table deletions and no changed API contracts.

**P0. Service-aware copy (no schema)**
- In the Desk offering form and the stock-related screens, show "Availability / capacity" and "visits / shifts / hours" when the kind is `service`.
- Scope: copy only. The current form stays the same for goods and tools.
- Flag: `VITE_SERVICE_PROFILES_ENABLED`.

**P1. Delivery mode and price unit on services (additive migration)**
- `booking_services`: add `delivery_clinic` (bool), `delivery_home` (bool), `delivery_remote` (bool), `price_unit` (varchar 30, nullable). Defaults keep existing rows unchanged.
- Backfill: existing rows get `delivery_clinic = true`, `price_unit = NULL`. This is a data decision to confirm (see D1).
- API: the existing `/api/schedule/services` create and patch accept the new fields as optional. Existing clients keep working.
- Offerings summary shows the mode and unit when present.

**P2. Service hours in the service form**
- Reuse `availability_rules` (`GET|PUT /api/schedule/availability`). Add a 7-day editor to the service setup flow. No new table.
- The hours shown on a profile come from these rules.

**P3. Service profile without stock (product decision first)**
- Only after D2 is answered. Front doors and Nearby would count a vendor who has at least one active service with hours and a delivery mode.
- Changes the front-door contract. Needs owner approval.

**P4. Credentials (needs D3 first)**
- Additive table or columns for: registration body, registration number, document reference, status (`self_declared` | `pending_review` | `verified` | `rejected`), reviewer, reviewed_at.
- Public display shows "verified" only when the status is `verified`, set by an admin. Self-declared numbers show as "self-declared".
- Verification stays separate from visibility. A verified credential does not make a profile public, and a public profile does not imply verification.
- No upload of documents until storage and retention are approved.

**P5. Professional profile card**
- Built from real data: services, hours, delivery modes, registration status, and completed appointments (count only from `Appointment` rows with a completed status).
- No placeholder numbers. A profile with no completed appointments shows none.

**P6. Service domains and copy**
- Map domains to existing taxonomy groups. Rename "Verified Marketplace Shifts" only after the owner approves the copy.
- "Verified" in any label refers to the credential status in P4, not to the shift engine.

## 4. Owner decisions needed before the phases start

- **D1.** Backfill: should existing `booking_services` rows default to clinic delivery, or be left blank until the owner sets them?
- **D2.** Should a provider with services and hours be listed on Nearby and front doors with no goods or tools? This changes an existing contract.
- **D3.** Who verifies registration numbers, and against which registers? Is a verified badge allowed to appear publicly? This touches identity and professional-licence obligations, so it needs legal review.
- **D4.** Domain names and the "Verified Gigs & Services" label are brand and copy decisions.
- **D5.** Confirm that "Vendor World" stays as the brand (open since Phase 11).

## 5. Rules that apply to every phase

- Reuse `booking_services`, `availability_rules`, `appointments`, and the offering summary. No parallel service, hours, or booking tables.
- Additive migrations only. No destructive changes. Existing routes and deep links stay.
- Authorisation on every write in the backend.
- No invented data in any example, seed, or UI. Example numbers in the blueprint are not used.
- Tests: the owner's standing instruction is to run existing suites and builds. New tests are for the owner to approve per phase.

## 6. Recommended first step

P0 and D1 to D4. P0 is copy-only and fixes the immediate "cartons" experience with no schema risk. The owner decisions decide whether P1 can start.
