# Local Activity Ledger & Community Network — Technical Audit & Architecture Plan

> **Provenance & Scope.** Pre-implementation audit and technical specification written against `Brief` (`2ecfaca`, post-PR #52 `Outside` v4) on branch `arena/429fdbac-brief`.
>
> **Selected scope:**
> 1. **Core 5 V1 Capabilities (§§8–10):** Non-business participation, 4 posting types (`Available`, `Wanted`, `Scheduled`, `Opportunity`) with category-inferred fields, Neighbourhood Discovery, Preference-based Notifications, Saved Repeat Relationships, and the **Local Activity Ledger** with non-custodial Bookings & Reusable Records.
> 2. **Phase 2 Extensions (§10):** Home Storefront Controls, Agricultural Group Sourcing, Area Rounds for Travelling Artisans, Community Learning, and Age-Appropriate Supervised Youth Opportunities.
> 3. **Surface Evolution (`evolve_primary`):** Evolve `/auth`, `/create`, `/explore`, `/activity`, and `/me` around non-vendor participation and the 4 posting types while preserving backward-compatible routes, APIs, and existing data.

---

## 1. Design Principles & Non-Negotiable Guardrails

1. **Participation without becoming a business (§9):** A household, neighbour, farmer, artisan, teacher, or young person can join and post in four fields without inventing a shop name or opening a formal vendor storefront. A full business workspace remains available as an opt-in upgrade, never a gate.
2. **Every activity has a lifecycle, not just a feed card (§8):** Publishing is step 1 of 6 (`Published → Relevant people notified → Responses received → Booking agreed → Work completed → Reusable record`). Posts do not vanish into an unstructured stream.
3. **Four human posting types with inferred details (§9):** Users choose **`Available`**, **`Wanted`**, **`Scheduled`**, or **`Opportunity`**. A deterministic, explainable template matcher infers the category archetype (e.g., fence repair, Napier grass / fodder, cobbler visit, supervised holiday learning) and asks **only** for the 2–4 extra fields that activity needs.
4. **Non-custodial bookings by construction (§10.5):** Parties agree on scope, schedule, price (optional), fulfilment mode, and agreed changes. Settlements happen directly between parties (`direct_mpesa`, `direct_cash`, `in_kind`, `cost_share`, `free`) — the ledger **never** takes custody of customer funds.
5. **Household privacy & freedom of choice (§8, §10.4):** Public listings show approximate area/estate coordinates only; exact homestead/gate directions stay private and unlock *only* to confirmed booking participants for the agreed window. Saved relationships make re-booking effortless while always surfacing *"Compare alternatives nearby"* beside *"Book again"*.
6. **Honest records & real utility metrics (§0 of repo strategy, §10):** No opaque composite reputation grades (only verifiable completed counts, mutual feedback with sample sizes, and verified standing claims). Early success is measured by **successful matches, requests fulfilled, repeat bookings, useful notifications acted upon, and active local providers** — never time spent in the app.

---

## 2. Technical Audit of the Existing Codebase (`2ecfaca`)

Every claim below was verified directly against the current repository (`backend/app/**` at Alembic head `0021_outside_content`, and `frontend/src/**`).

### 2.1 Capability-by-Capability Gap Matrix

| Brief Capability | What Exists Today in Repo | Exact Gaps Against Brief | Disposition |
|---|---|---|---|
| **Non-business accounts (§9)** | `vendors` (`app/models/vendor.py`) is the single principal table across 45+ FKs & JWTs. `Shell.jsx` removed forced shop onboarding in PR #52; `VendorProfile.jsx` removed public trade value. | `routes/auth.py` still states *"All users must be vendors"* and requires `business_name`. `AuthPage.jsx` says *"Vendor accounts only · Register your business"*. `MePage.jsx` opens with *"Your business workspace · Stock items · Add stock"*. No household privacy defaults. | **Extend additively:** Keep `vendors` as principal table (0 broken FKs); add `account_kind` (`person \| household \| artisan \| institution \| business`), `hide_exact_location`, and adaptive `/auth` + `/me` UIs. |
| **4 Posting Types + Category Inference (§9, §10.1)** | `outside/publish.py` (`POST /api/outside/content`) + `CreatePage.jsx` (`createStore.js`) support unified publishing with localStorage drafts and optional `price_kes`. | Exposes **6 legacy types** (`post, event, listing, community, collection, opportunity`) fanning into separate tables with no shared ledger. `category` is a plain text input with **zero** category inference or per-category dynamic fields. | **Evolve primary + keep compat:** Make `available, wanted, scheduled, opportunity` primary in `/create` & `local_activities`; add deterministic category/template inference; keep legacy 6 `content_type` values working on `POST /api/outside/content`. |
| **Local Activity Ledger & Non-Custodial Bookings (§8, §10.5)** | Fragmented across 4 partial flows: (1) `business_requests` + `request_offers` (`trade/models.py`) stops at `offer_accepted` with no appointment slot, scope-change log, two-party completion, or feedback; (2) `tool_bookings` (`models/bookings.py`) only books `warehouse \| popup_shop \| hotel_sourcing`; (3) `stock_movements` + `order_transactions` uses inventory locks & PSP custody; (4) `hustle_job_calls` (`models/hustle.py`) is gamified XP/Gold gig work. | **Core missing primitive:** No unified lifecycle linking `published → notified → responses/quotes → non-custodial booking agreed → two-party completion & agreed changes → mutual feedback → private reusable record` across repairs, cobbler visits, fodder, learning, or tasks. | **Build new module `app/modules/ledger/`:** Canonical `local_activities`, `activity_responses`, `activity_bookings` (strictly non-custodial), `activity_feedback`, and `activity_ledger_events`. |
| **Neighbourhood Discovery (§10.2)** | `outside/feed.py`, `outside/ranking.py` (6-signal non-price ranker, Haversine distance), `resolve_location` (GPS → manual → profile → market zone → unset), `ExplorePage.jsx`, `LocationBar.jsx`. | `/explore` filters by 9 legacy content kinds instead of the 4 posting types; lacks structured **area/scope** (`neighbourhood`, `estate`, `ward`, `town`), **category**, **schedule window**, and **permission/eligibility** filters (e.g., youth-eligible, neighbours-only, travelling rounds). | **Extend `outside/feed.py` + `ExplorePage.jsx` + `shelves.py`:** Add `local_activities` adapter into unified feed/search with posting-type, area, time-window, category, and permission filters. |
| **Preference Notifications (§8, §10.3)** | `models/notification.py`, `ActivityPage.jsx` (`GET /api/outside/activity`), and `request_watches` (`trade/models.py`, restricted to commercial `RequestType` + `min_budget_kes`). | `02-implementation-summary.md` notes: *"No notification preferences UI."* Cannot watch `Available` produce/fodder, `Scheduled` artisan rounds, or category + area + day-of-week preferences. No `acted_upon_at` tracking. | **Build `activity_watches` + UI on `/activity`:** Match published/updated activities against area, radius, posting type, category, schedule day, and saved contacts; track `acted_upon_at`. |
| **Profiles & Repeat Relationships (§10.4)** | `vendor_connections` (`mutual \| supplier \| buyer`), `vendor_lists` (public directories), `orders/repeat.py` (repeats `StockMovement` SKUs only). | No private household/user saved-provider directory (`artisan, supplier, household, institution, service_provider, collection_point`) with private notes, 1-tap *"Book / Request again"* from a past activity record, paired with *"Compare alternatives nearby"*. | **Build `saved_relationships` + Repeat Activity flow:** Save from any profile or completed booking; re-book in 2 taps or compare open local alternatives. |
| **Phase 2A: Home Storefront Controls (§10)** | `StockItem.visible_to_network` (`models/stock.py`) + `StorefrontPage.jsx` (`modules/catalog/` — oriented toward B2B SaaS/service tiers & trials). | No lightweight **Homestead / Home Shelf** controls for neighbours offering surplus produce, eggs, seedlings, or a collection point (open/paused toggle, pickup window hours, audience restriction, gate-address privacy). | **Add `home_storefront_config` on `vendors` + Home Shelf card on `/me` & `/create?type=available`.** |
| **Phase 2B: Agricultural Group Sourcing (§10)** | `collective_sourcing` + `collective_pledges` (`models/collective.py`) and `market_runs` (`modules/runs/models.py` with `Float` quantities & `participant_type: family \| shop`). | `collective_sourcing` requires creating a `vendor_groups` row first and uses `Integer` quantities. Farmers pooling cattle fodder, seeds, or fertilizer need standalone neighbourhood group orders with `Float` quantities (tonnes/bales/kg), hub/homestead drop-off, and non-custodial cost split. | **Integrate `group_sourcing` template in `local_activities` + `activity_responses` (`response_type='group_pledge'`)** with live pool progress bar & threshold auto-notification. |
| **Phase 2C: Travelling Artisan Area Rounds (§10)** | `routes/route_planner.py` (delivery truck routing) and `market_runs` (designated buyer going to wholesale market). | No **Travelling Artisan Round** where a cobbler, fundi, mobile vet, or sharpener announces *"In Muthaiga this Thursday, 9am–4pm, 8 stops"* and households book private sequential stops. | **Integrate `travelling_round` template on `Scheduled` activities** + ordered stop slots (`stop_sequence`, `slot_window`) on `activity_bookings` with private gate directions per stop. |
| **Phase 2D: Community Learning (§10)** | `events` (`models/events.py`) supports generic workshops/webinars with `max_vendors` and `EventRegistration`. | Lacks structured learning fields (skill/topic, age suitability, host background, materials needed, supervised venue privacy) and completion/attendance ledger records. | **Integrate `community_learning` template on `Scheduled`/`Opportunity` activities** with enrolment & attendance confirmation on the ledger. |
| **Phase 2E: Supervised Youth Opportunities (§10)** | `hustle_job_calls` (`models/hustle.py`) — adult casual labour with OTP & gamified Gold/XP; explicitly deferred in `kenya-opportunity-network-strategy.md` due to gig-labour guardrails. | Zero age-band rules, zero prohibited-hazard guardrails, zero named adult supervisor requirement, and zero guardian/institution consent workflow. | **Enforce strict server-side `youth_safety` rules on `supervised_youth_task` activities:** permitted light/learning categories only, daytime/holiday schedule check, mandatory adult supervisor, and `guardian_consent_status` gate before booking confirmation. |

### 2.2 Existing Test Contracts Identified in Audit

Before touching code, two frontend test files pin the v4 6-type `/create` surface and must be deliberately evolved alongside backward-compatible aliases:
- `frontend/src/test/navigation.test.jsx:39` — asserts `CREATE_TYPES` equals the 6 v4 types (`collection, community, event, listing, opportunity, post`).
- `frontend/src/test/outside.test.jsx:206, 224` — asserts `CREATE_TYPES` and `data-testid="create-type-*"` on `/create`.
- **Compatibility strategy:** Introduce `POSTING_TYPES` (`available, wanted, scheduled, opportunity`) as the primary 2×2 grid on `/create`, map legacy `?type=event` → `scheduled`, `?type=listing` → `available`, `?type=post` → `available` (with Community & Collection kept as secondary doors), keep `POST /api/outside/content` accepting all 6 legacy `content_type` values **plus** the 4 new `posting_type` values so all 274 backend tests stay green without modification, and update the two frontend specs to test the new 4-type primary contract + legacy deep-link compatibility.

---

## 3. Exact Database Schema Plan (Alembic `0022_local_activity_ledger`)

All changes are **purely additive** (`down_revision = "0021_outside_content"`). No existing table or column is dropped, renamed, or tightened in a way that breaks existing rows.

### 3.1 Additive Columns on Existing Tables

```sql
-- 1. vendors: support non-business participants & home storefront privacy
ALTER TABLE vendors
  ADD COLUMN account_kind VARCHAR(24) NOT NULL DEFAULT 'business'
    CONSTRAINT ck_vendors_account_kind
    CHECK (account_kind IN ('person', 'household', 'artisan', 'institution', 'business')),
  ADD COLUMN hide_exact_location BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN home_storefront_config JSONB NOT NULL DEFAULT '{}'::jsonb;
-- home_storefront_config shape:
-- {
--   "enabled": false,
--   "title": "Homestead surplus shelf",
--   "visiting_hours": "Sat 9:00–13:00",
--   "audience": "neighbours" | "saved_contacts" | "by_appointment",
--   "share_directions_only_when_booked": true,
--   "pickup_notes": "Near Kiamunyi stage"
-- }

-- 2. notifications: measure "useful notifications acted upon" (§10)
ALTER TABLE notifications
  ADD COLUMN acted_upon_at TIMESTAMP WITHOUT TIME ZONE NULL;
```
*(Note: Existing seeded/test accounts default to `account_kind = 'business'` so legacy B2B flows behave identically; new signups via `/auth` default to `'person'` or `'household'` unless `'business'` is chosen.)*

### 3.2 New Tables in `backend/app/modules/ledger/models.py`

#### Table 1: `local_activities` (The Canonical Activity & Posting Record)
| Column | Type | Constraints / Notes |
|---|---|---|
| `id` | `UUID` | PK |
| `organizer_vendor_id` | `UUID` | FK → `vendors.id ON DELETE CASCADE`, indexed |
| `posting_type` | `VARCHAR(20)` | `NOT NULL`, `CHECK IN ('available', 'wanted', 'scheduled', 'opportunity')`, indexed |
| `inferred_template` | `VARCHAR(40)` | `NOT NULL DEFAULT 'general'`, `CHECK IN ('repair_artisan', 'agricultural_produce_fodder', 'tool_lending', 'collection_point', 'travelling_round', 'community_learning', 'supervised_youth_task', 'group_sourcing', 'general')`, indexed |
| `category` | `VARCHAR(100)` | Nullable, indexed (e.g., `fencing`, `cobbler`, `fodder`, `tutoring`, `garden`) |
| `title` | `VARCHAR(220)` | `NOT NULL` |
| `body` | `TEXT` | `NOT NULL`, `CHECK (char_length(body) >= 8)` |
| `media` | `JSONB` | `NOT NULL DEFAULT '[]'` |
| `tags` | `JSONB` | `NOT NULL DEFAULT '[]'` |
| `area_name` | `VARCHAR(240)` | Nullable, indexed (e.g., `"Kisii"`, `"Muthaiga"`, `"Kondele, Kisumu"`) |
| `location_scope` | `VARCHAR(24)` | `NOT NULL DEFAULT 'neighbourhood'`, `CHECK IN ('homestead_private', 'estate', 'neighbourhood', 'ward', 'town', 'county')` |
| `geo_lat`, `geo_lng` | `FLOAT` | Nullable, composite index `(geo_lat, geo_lng)` (jittered/rounded publicly when `geo_precision != 'exact'`) |
| `geo_precision` | `VARCHAR(24)` | `NOT NULL DEFAULT 'approximate'`, `CHECK IN ('approximate', 'exact_for_confirmed', 'exact', 'none')` |
| `private_directions` | `TEXT` | Nullable — **redacted at API serialization** unless viewer is organizer or has an active `agreed`/`in_progress` booking |
| `starts_at`, `ends_at` | `TIMESTAMP` | Nullable (`NOT NULL` on `starts_at` when `posting_type = 'scheduled'`), indexed |
| `schedule_label` | `VARCHAR(160)` | Nullable (human window, e.g., `"Saturday morning"`, `"Thu 9am–4pm"`) |
| `capacity` | `INTEGER` | Nullable (`NULL` = 1 or open; `>1` for area rounds, classes, group orders) |
| `spots_confirmed` | `INTEGER` | `NOT NULL DEFAULT 0` |
| `visibility` | `VARCHAR(24)` | `NOT NULL DEFAULT 'public'`, `CHECK IN ('public', 'community', 'saved_contacts', 'private')` |
| `permission_rules` | `JSONB` | `NOT NULL DEFAULT '{}'` — `eligible_account_kinds`, `community_id`, `requires_approval`, plus mandatory youth-safety block (`is_youth_opportunity`, `age_band`, `supervisor_name`, `supervisor_role`, `guardian_consent_required`) |
| `template_fields` | `JSONB` | `NOT NULL DEFAULT '{}'` — category-specific structured fields (see §4.1 below) |
| `price_kes` | `INTEGER` | Nullable (optional; `NULL` = quote invited / free / non-commercial) |
| `price_basis` | `VARCHAR(24)` | `NOT NULL DEFAULT 'quote_requested'`, `CHECK IN ('quote_requested', 'fixed', 'per_unit', 'cost_share', 'free')` |
| `lifecycle_status` | `VARCHAR(28)` | `NOT NULL DEFAULT 'published'`, `CHECK IN ('published', 'notified', 'responses_received', 'booking_agreed', 'in_progress', 'completed', 'cancelled', 'expired')`, indexed |
| `notified_count` | `INTEGER` | `NOT NULL DEFAULT 0` (real count of matched local watchers notified) |
| `response_count` | `INTEGER` | `NOT NULL DEFAULT 0` |
| `reused_from_activity_id` | `UUID` | Nullable FK → `local_activities.id ON DELETE SET NULL` (tracks repeat activity lineage) |
| `created_at`, `updated_at` | `TIMESTAMP` | `NOT NULL`, indexed `(lifecycle_status, created_at)` |

#### Table 2: `activity_responses` (Quotes, Supply Offers, Round Stops, Group Pledges, Enrolments)
| Column | Type | Constraints / Notes |
|---|---|---|
| `id` | `UUID` | PK |
| `activity_id` | `UUID` | FK → `local_activities.id ON DELETE CASCADE`, indexed |
| `responder_vendor_id` | `UUID` | FK → `vendors.id ON DELETE CASCADE`, indexed; `UNIQUE (activity_id, responder_vendor_id)` |
| `response_type` | `VARCHAR(28)` | `NOT NULL DEFAULT 'quote'`, `CHECK IN ('quote', 'supply_offer', 'round_stop_request', 'group_pledge', 'learning_enrolment', 'youth_application')` |
| `quoted_price_kes` | `INTEGER` | Nullable (`CHECK >= 0`) |
| `quantity` | `FLOAT` | Nullable (`CHECK > 0` — used for Napier grass bales, fodder kg, tools, group-order pledges) |
| `unit` | `VARCHAR(40)` | Nullable (`bales`, `kg`, `metres`, `hours`, `bags`, `slots`) |
| `availability_window` | `VARCHAR(160)` | Nullable (e.g., `"Saturday 8am–1pm"`) |
| `proposed_completion_time` | `VARCHAR(160)` | Nullable (e.g., `"Same day, ~4 hours"`) |
| `relevant_experience` | `TEXT` | Nullable (artisan/tutor experience summary) |
| `note` | `TEXT` | `NOT NULL` (scope notes, stop request note, or pledge details) |
| `private_stop_directions` | `TEXT` | Nullable — for a household requesting a stop on a travelling cobbler's round; visible **only** to that household and the round organizer! |
| `guardian_consent_status` | `VARCHAR(24)` | `NOT NULL DEFAULT 'not_required'`, `CHECK IN ('not_required', 'pending', 'confirmed', 'revoked')` |
| `guardian_name_and_phone` | `VARCHAR(200)` | Nullable — private to organizer & applicant |
| `status` | `VARCHAR(20)` | `NOT NULL DEFAULT 'submitted'`, `CHECK IN ('submitted', 'shortlisted', 'accepted', 'declined', 'withdrawn')`, indexed |
| `created_at`, `updated_at` | `TIMESTAMP` | `NOT NULL` |

#### Table 3: `activity_bookings` (Non-Custodial Agreements, Area-Round Stops & Completion Records)
| Column | Type | Constraints / Notes |
|---|---|---|
| `id` | `UUID` | PK |
| `activity_id` | `UUID` | FK → `local_activities.id ON DELETE CASCADE`, indexed |
| `response_id` | `UUID` | Nullable FK → `activity_responses.id ON DELETE SET NULL` |
| `organizer_vendor_id` | `UUID` | FK → `vendors.id ON DELETE CASCADE`, indexed |
| `participant_vendor_id` | `UUID` | FK → `vendors.id ON DELETE CASCADE`, indexed |
| `agreed_scope` | `TEXT` | `NOT NULL` (snapshot of agreed work, item quantity, learning slot, or round stop) |
| `agreed_quantity` | `FLOAT` | Nullable |
| `agreed_unit` | `VARCHAR(40)` | Nullable |
| `agreed_price_kes` | `INTEGER` | Nullable (`NULL` = non-monetary / free) |
| `settlement_method` | `VARCHAR(24)` | `NOT NULL DEFAULT 'direct_mpesa'`, `CHECK IN ('direct_mpesa', 'direct_cash', 'in_kind', 'cost_share', 'free')` — **never platform-custodied** |
| `scheduled_start`, `scheduled_end` | `TIMESTAMP` | Nullable, indexed |
| `slot_label` | `VARCHAR(120)` | Nullable (e.g., `"Stop #3 · 11:00–11:45am"`) |
| `stop_sequence` | `INTEGER` | Nullable (orders stops along a travelling artisan's area round) |
| `share_private_directions` | `BOOLEAN` | `NOT NULL DEFAULT false` (explicit consent toggle unlocking `private_directions` while booking is active) |
| `agreed_changes` | `JSONB` | `NOT NULL DEFAULT '[]'` — append-only list of `{"at", "by_vendor_id", "summary", "revised_price_kes", "acknowledged_by_other"}` (§8 step 5) |
| `status` | `VARCHAR(28)` | `NOT NULL DEFAULT 'agreed'`, `CHECK IN ('agreed', 'in_progress', 'organizer_completed', 'participant_completed', 'completed', 'cancelled')`, indexed |
| `organizer_confirmed_at` | `TIMESTAMP` | Nullable |
| `participant_confirmed_at` | `TIMESTAMP` | Nullable |
| `completed_at` | `TIMESTAMP` | Nullable, indexed (set when both parties confirm, or single-party confirm on non-bilateral attendance after window) |
| `source_booking_id` | `UUID` | Nullable FK → `activity_bookings.id ON DELETE SET NULL` (links repeat bookings for §10 metrics & history) |
| `created_at`, `updated_at` | `TIMESTAMP` | `NOT NULL` |

#### Table 4: `activity_feedback` (Mutual Post-Completion Record — No Opaque Scores)
| Column | Type | Constraints / Notes |
|---|---|---|
| `id` | `UUID` | PK |
| `booking_id` | `UUID` | FK → `activity_bookings.id ON DELETE CASCADE`, indexed |
| `author_vendor_id` | `UUID` | FK → `vendors.id ON DELETE CASCADE`, `UNIQUE (booking_id, author_vendor_id)` |
| `target_vendor_id` | `UUID` | FK → `vendors.id ON DELETE CASCADE`, indexed |
| `outcome` | `VARCHAR(28)` | `NOT NULL`, `CHECK IN ('completed_as_agreed', 'completed_with_changes', 'issue_reported')` |
| `would_repeat` | `BOOLEAN` | `NOT NULL DEFAULT true` |
| `tags` | `JSONB` | `NOT NULL DEFAULT '[]'` (e.g., `["arrived_on_time", "clear_quote", "quality_work"]`) |
| `note` | `TEXT` | Nullable |
| `created_at` | `TIMESTAMP` | `NOT NULL` |

#### Table 5: `activity_ledger_events` (Append-Only Lifecycle Audit Trail)
- `id` (`BIGSERIAL` PK), `activity_id` (FK), `booking_id` (nullable FK), `actor_vendor_id` (nullable FK), `event_type` (`published | watchers_notified | response_received | booking_agreed | scope_change_recorded | party_confirmed_completion | activity_completed | feedback_left | rebooked`), `summary` (`VARCHAR(280)`), `payload` (`JSONB`, redacted of private notes/addresses), `created_at` (`TIMESTAMP`).

#### Table 6: `activity_watches` (Preference-Based Neighbourhood Notification Rules)
- `id` (`UUID` PK), `vendor_id` (FK → `vendors.id`, indexed), `label` (`VARCHAR(140)`), `posting_types` (`JSONB` — e.g. `["wanted", "opportunity"]`), `categories` (`JSONB` — e.g. `["fencing", "carpentry"]`), `keywords` (`VARCHAR(200)`), `area_name` (`VARCHAR(200)`), `geo_lat` (`FLOAT`), `geo_lng` (`FLOAT`), `radius_km` (`FLOAT DEFAULT 10.0`), `days_of_week` (`JSONB` — e.g. `["sat", "sun"]`), `only_youth_eligible` (`BOOLEAN DEFAULT false`), `is_active` (`BOOLEAN DEFAULT true`), `last_triggered_at` (`TIMESTAMP`), `created_at` (`TIMESTAMP`).

#### Table 7: `saved_relationships` (Trusted Local Contacts & Repeat Relationships)
- `id` (`UUID` PK), `owner_vendor_id` (FK → `vendors.id`, indexed), `target_vendor_id` (FK → `vendors.id`, indexed), `UNIQUE (owner_vendor_id, target_vendor_id)`, `relationship_kind` (`VARCHAR(28)` — `artisan | supplier | household | institution | service_provider | collection_point`), `label` (`VARCHAR(120)` — e.g. `"Regular Muthaiga cobbler"`), `categories` (`JSONB`), `private_note` (`TEXT` — strictly owner-private), `notify_when_active` (`BOOLEAN DEFAULT true` — alerts owner whenever this provider posts an `Available` shelf item or `Scheduled` area round!), `last_booking_id` (`UUID` nullable FK), `created_at`, `updated_at`.

---

## 4. Category Inference, Phase 2 Templates & Backend API Plan

### 4.1 Deterministic Category Inference (`app/modules/ledger/inference.py`)

Per repo rule §0 (*no opaque black-box actions*), category inference is fast, deterministic, explainable, and editable by the user:
- Exposed at `GET /api/ledger/infer?posting_type=...&text=...` and mirrored in `frontend/src/lib/activityTemplates.js` for zero-latency UI updates while typing.
- Maps `(posting_type, text, category)` onto one of **9 activity templates**, returning **only** the extra fields required:

| Template Key | Example Trigger Phrases | Posting Types | Extra Fields Surfaced (Progressive Disclosure) |
|---|---|---|---|
| `repair_artisan` | *"fence repair"*, *"cobbler"*, *"plumber"*, *"fundi"*, *"welding"* | `wanted`, `available` | `scope_measure` (*"Approx. 20 metres"*), `preferred_day` (*"Saturday"*), `materials_supplied_by` (`poster \| provider \| quote_both`), `quotes_invited` (`true`) |
| `agricultural_produce_fodder` | *"Napier grass"*, *"fodder"*, *"hay"*, *"avocados"*, *"eggs"*, *"seedlings"* | `available`, `wanted` | `quantity`, `unit` (`bales \| kg \| sacks \| crates`), `pickup_or_delivery` (`homestead_pickup \| collection_point \| local_delivery`), `available_window` |
| `tool_lending` | *"lend"*, *"rent tool"*, *"wheelbarrow"*, *"chaff cutter"*, *"ladder"* | `available`, `wanted` | `condition_note`, `borrow_duration_max`, `deposit_or_terms` (non-custodial note), `return_by` |
| `collection_point` | *"collection point"*, *"drop-off"*, *"pick-up hub"* | `available`, `scheduled` | `operating_window`, `storage_type` (`dry \| shaded \| cold_box`), `max_parcels_or_bags`, `audience` |
| `travelling_round` *(Phase 2)* | *"area round"*, *"visiting Muthaiga"*, *"cobbler round"*, *"mobile sharpener"* | `scheduled` | `starts_at`, `ends_at`, `route_areas` (*"Muthaiga North → Old Muthaiga"*), `capacity` (max stops, e.g. `8`), `service_menu` (*"Shoe stitching, sole repair, zip fix"*) |
| `group_sourcing` *(Phase 2)* | *"bulk order"*, *"group order"*, *"pool cattle fodder"*, *"joint fertilizer"* | `opportunity`, `wanted`, `available` | `target_quantity` (`Float`), `unit` (`bales \| bags \| tonnes`), `estimated_unit_price_kes`, `pledge_deadline`, `dropoff_hub_area` |
| `community_learning` *(Phase 2)* | *"holiday learning"*, *"tutoring"*, *"garden workshop"*, *"training"* | `scheduled`, `opportunity` | `starts_at`, `capacity`, `skill_or_subject`, `age_suitability`, `host_credentials`, `materials_to_bring` |
| `supervised_youth_task` *(Phase 2)* | *"teenager"*, *"youth"*, *"holiday task"*, *"student apprentice"* | `opportunity`, `scheduled` | **Mandatory safety block:** `age_band` (`13_15_holiday_learning \| 16_17_supervised`), `permitted_domain` (`garden_help \| tutoring_peer \| community_event \| craft_learning \| digital_help`), `supervisor_name`, `supervisor_role`, `daytime_hours_only` (`true`), `guardian_consent_required` (`true`) |
| `general` | Everything else | All 4 | Only shared essentials (`title`, `body`, `area_name`, optional `starts_at`, optional `price_kes`) |

### 4.2 Backend Endpoints (`app/modules/ledger/router.py` mounted at `/api/ledger`)

1. **Templates & Inference**
   - `GET /api/ledger/templates` — Returns the 4 posting types, 9 template schemas, and youth-safety rules.
   - `GET /api/ledger/infer` — Returns inferred `posting_type`, `inferred_template`, `category`, `reason`, and `extra_fields`.
2. **Publishing, Discovery & Detail**
   - `POST /api/ledger/activities` — Creates a `local_activities` row, appends `published` ledger event, runs watcher & saved-contact matcher in the same transaction (`notified` stage if ≥1 recipient matched), and returns the normalized activity. *(Also wired into `POST /api/outside/content` when `posting_type` or `content_type` is one of `available | wanted | scheduled | opportunity`!)*
   - `GET /api/ledger/activities` — Neighbourhood discovery query supporting `posting_type`, `category`, `template`, `area`, `lat/lng/radius_km`, `location_scope`, `when` (`today | saturday | weekend | week`), `youth_eligible`, `from_saved_contacts`, `cursor`.
   - `GET /api/ledger/activities/{id}` — Full activity detail + **6-step lifecycle progress** + responses (redacted appropriately: full quotes visible to organizer & the responder who wrote it; aggregate response count visible publicly) + bookings + alternatives query link.
   - `PATCH /api/ledger/activities/{id}` — Update details, pause/cancel, or close responses.
3. **Responses, Group Pledges & Area-Round Stop Requests**
   - `POST /api/ledger/activities/{id}/responses` — Submit a quote, supply offer, round-stop request, group-order pledge, or youth/learning application (enforces youth guardian-consent fields when applicable). Transitions activity to `responses_received`.
   - `PATCH /api/ledger/responses/{response_id}` — Responder updates/withdraws, or guardian consent is confirmed (`guardian_consent_status = 'confirmed'`).
4. **Non-Custodial Bookings, Scope Changes, Two-Party Completion & Feedback**
   - `POST /api/ledger/activities/{id}/bookings` — Organizer accepts a response (or confirms a stop/pledge/enrolment), recording `agreed_scope`, `agreed_price_kes`, `settlement_method` (non-custodial), `scheduled_start/end`, `stop_sequence` (for rounds), and `share_private_directions`. Transitions activity to `booking_agreed`.
   - `POST /api/ledger/bookings/{booking_id}/changes` — Either party proposes/records an agreed change to scope, time, or price (`agreed_changes` JSONB + ledger event).
   - `POST /api/ledger/bookings/{booking_id}/confirm-completion` — Two-party completion handshake: records `organizer_confirmed_at` or `participant_confirmed_at`; once both confirm, sets `status = 'completed'`, revokes temporary `private_directions` access (`reusable_record` privacy rule!), and updates `local_activities.lifecycle_status = 'completed'`.
   - `POST /api/ledger/bookings/{booking_id}/feedback` — Leaves factual mutual feedback (`completed_as_agreed | completed_with_changes | issue_reported`, `would_repeat`, `tags`, `note`).
   - `POST /api/ledger/bookings/{booking_id}/repeat` — Re-books or drafts a new pre-filled activity/invitation with a trusted provider in one call (`source_booking_id` set), without locking out other providers.
5. **Watches, Saved Relationships, Home Storefront & Community Health Metrics**
   - `GET / POST / DELETE /api/ledger/watches` — Manage local notification preferences.
   - `POST /api/ledger/notifications/{id}/acted` — Marks `acted_upon_at` when a user opens/responds from a notification.
   - `GET / POST / PATCH / DELETE /api/ledger/relationships` — Manage saved trusted artisans, suppliers, households, institutions, and collection points + `GET /api/ledger/relationships/{id}/alternatives` (*"Compare alternatives nearby"* in the same category/area).
   - `GET / PUT /api/ledger/home-storefront` — Manage a household/person's lightweight Home Storefront Controls (`enabled`, `visiting_hours`, `audience`, `share_directions_only_when_booked`).
   - `GET /api/ledger/metrics/summary` — Real community utility metrics (§10): `successful_matches`, `requests_fulfilled`, `repeat_bookings`, `notifications_acted_upon`, `active_local_providers_30d`.

### 4.3 Auth & Outside Feed Integration (`app/routes/auth.py` & `app/modules/outside/feed.py`)

- **`POST /api/auth/register` (`routes/auth.py`):**
  - Accepts optional `account_kind` (`'person' | 'household' | 'artisan' | 'institution' | 'business'`, default `'person'` when `display_name` is sent, `'business'` when legacy `business_name` alone is sent) and `display_name` (populating `business_name = display_name or business_name`).
  - Sets `hide_exact_location = (account_kind != 'business')` by default.
  - Updates the 401 message from `"All users must be vendors."` to `"Sign in required."` (verified no backend test greps that exact 401 detail string — let's re-verify in Slice 1 before changing).
- **`outside/feed.py` & `outside/shelves.py`:**
  - Adds `_from_local_activities()` source adapter so every `local_activities` item appears natively in `GET /api/outside/feed` and `GET /api/outside/search` with its `posting_type` badge, lifecycle pill, distance, and non-price ranking score!
  - Updates `DEFAULT_SHELVES` in `shelves.py` to foreground neighbourhood life: *Happening & Scheduled Nearby*, *Available From Neighbours & Homesteads*, *Wanted & Local Repairs*, *Travelling Artisan Rounds & Group Orders*, and *Learning & Supervised Opportunities*.

---

## 5. Exact Frontend UI & Route Evolution Plan (`evolve_primary`)

Primary navigation stays the clean 5-tab bar (`Home · Explore · Create · Activity · Profile`), with zero broken v2/v3/v4 routes:

1. **`/auth` (`pages/auth/AuthPage.jsx`) — Join Without Becoming a Business**
   - Left hero reframed around **everyday local life & community utility** (Kisii homesteads, Muthaiga estates, local artisans, neighbours): *1. Post what's available, wanted, scheduled, or open → 2. Agree scope & time privately → 3. Build reusable local relationships*.
   - Signup form asks for **Your name (or household / workshop name)**, **@handle**, **Email**, **Password**, plus a clean pill selector for **How you're joining**: `Person / Neighbour` · `Household / Homestead` · `Local Artisan / Provider` · `School / Institution` · `Registered Business`.
   - *"Set up a full business profile"* sits inside an optional collapsible drawer, never required.

2. **`/create` (`pages/create/CreatePage.jsx` + `stores/createStore.js`) — The 4 Simple Posting Types + Smart Category Fields**
   - **2×2 Primary Selector Grid** matching §9 verbatim:
     - `PackagePlus` **Available** — *"I have something to supply, share, sell, or make available."*
     - `Search` **Wanted** — *"I need a product, a person, a service, or a resource."*
     - `CalendarCheck` **Scheduled** — *"I have an activity, appointment, visit, or event at a certain time."*
     - `HandHelping` **Opportunity** — *"There is work, a learning opportunity, or a way to participate."*
   - **Live Category Inference Banner:** As the user types *"Fence repair needed on Saturday. Approx 20m"* or *"Surplus Napier grass 15 bales"* or *"Cobbler visiting Muthaiga Thursday"*, a subtle explainable chip appears (*"Detected: Repair & Artisan — showing scope & quote fields · Change"*) and reveals **only** the 2–4 extra fields for that template!
   - **Quick Phase-2 Presets** under each type (e.g., *Offer surplus / Home shelf*, *Lend a tool*, *Travelling artisan round*, *Agricultural group order*, *Community learning*, *Supervised youth task*).
   - **Household Privacy Strip:** Default *"Approximate neighbourhood only — share gate/house directions only after you confirm a booking."*
   - Secondary footer link preserves one-tap creation of **Communities** and **Collections**, and legacy `?type=event|listing|post|community|collection|opportunity` query params continue to work seamlessly.

3. **`/activities/:id` (`pages/activity/ActivityLedgerDetailPage.jsx`) — The 6-Step Local Activity Ledger View**
   - Visual **6-stage lifecycle tracker** matching the §8 Fence Repair box:
     `1. Published` → `2. Relevant people notified (N)` → `3. Responses received (N)` → `4. Booking agreed` → `5. Work completed` → `6. Reusable record`.
   - **Context-adapted action panel:**
     - **For responders/neighbours:** Submit quote (price optional, availability, experience, completion time), pledge quantity into an agricultural group order (with live progress bar toward target!), request a sequential stop on a travelling cobbler's round, or apply with supervisor/guardian details on a youth opportunity.
     - **For the poster/household:** Side-by-side response comparison, 1-click **Agree & Confirm Booking** (non-custodial settlement selector + optional toggle to share private directions), **Record Agreed Change**, **Confirm Completion & Leave Feedback**, and **Save to Trusted Contacts**.

4. **`/explore` (`pages/explore/ExplorePage.jsx`) — Neighbourhood Discovery**
   - Top filter bar switches to **`All · Available · Wanted · Scheduled · Opportunity`**, paired with **Area / Scope** (`LocationBar` + `3 km Neighbourhood | 15 km Town | Wide`), **Category chips** (`Repairs & Artisans`, `Produce & Fodder`, `Tools`, `Area Rounds`, `Group Sourcing`, `Learning`, `Youth-Eligible`), and **Time window** (`Today`, `This Saturday / Weekend`, `This Week`).

5. **`/activity` (`pages/activity/ActivityPage.jsx`) — Active Lifecycle & Notification Preferences**
   - Adds **Active Bookings & Agreements** strip at the top (items awaiting quote review, appointment confirmation, or two-party completion) + a **Local Notification Preferences ("What to tell me about")** drawer/tab where users add/toggle `activity_watches` in plain language + marks notifications `acted_upon` on click.

6. **`/me` (`pages/me/MePage.jsx`) — Personal, Household & Provider Hub**
   - Adapts hero header to `account_kind` (*Household profile*, *Local artisan*, *Person*, *Institution*, or *Business workspace* — no forced *"Add stock"* banner for a household!).
   - Adds three first-class community sections:
     1. **Trusted People & Places (`Saved Relationships`):** Filterable by *Artisans · Suppliers · Homes · Institutions · Collection Points*, each card offering **"Book / Ask again"** right beside **"Compare alternatives nearby"**.
     2. **Reusable Activity Records:** Private ledger of completed repairs, rounds, group orders, and sessions — household details private, repeatable in two taps.
     3. **Home Storefront Controls:** Toggle homestead/home shelf open or paused, set pickup/visiting hours, and enforce gate-direction privacy.
   - Retains the full **Business & Organization Tools** section (*Stock, Storefront Catalogue, Passport, Market Locks & Runs, Enterprise, POS, Governance*) cleanly organized underneath so zero existing B2B power is lost.

---

## 6. Sequenced Implementation Plan & Verification Gate

When approved to build, we will execute in **6 clean vertical slices**, keeping tests green at every step:

| Slice | Deliverable | Key Files | Verification |
|---|---|---|---|
| **Slice 1** | Migration `0022_local_activity_ledger` + `app/modules/ledger/` models, inference engine, youth-safety rules, and privacy serializer | `alembic/versions/0022_*.py`, `app/modules/ledger/{models,inference,privacy}.py`, `app/models/vendor.py` | `alembic upgrade head` & `downgrade -1` + unit tests for all 9 templates, privacy redaction, and youth guardrails |
| **Slice 2** | Full `/api/ledger/*` router (6-stage lifecycle, non-custodial bookings, agreed changes, 2-party completion, feedback, watches, saved relationships, home storefront, community metrics) + `outside/feed.py` & `routes/auth.py` updates | `app/modules/ledger/{service,router}.py`, `app/routes/auth.py`, `app/modules/outside/{publish,feed,shelves}.py` | New `backend/tests/test_activity_ledger.py` covering fence repair lifecycle, cobbler area round, Kisii fodder group order, youth safety, privacy redaction, and non-custodial invariant + all 274 existing pytest tests passing |
| **Slice 3** | Non-business `/auth` signup + 4-type `/create` with live category inference & Phase-2 templates | `pages/auth/AuthPage.jsx`, `pages/create/CreatePage.jsx`, `stores/createStore.js`, `lib/activityTemplates.js`, `config/navigation.js` | Vitest specs for non-vendor registration, 4 posting types, dynamic field inference, draft persistence, and legacy `?type=` deep links |
| **Slice 4** | `/activities/:id` 6-Step Ledger Detail UI (quotes, round stops, group pledges, non-custodial booking, agreed changes, 2-party completion, feedback) | `pages/activity/ActivityLedgerDetailPage.jsx`, `App.jsx`, `lib/api.js` | End-to-end component tests for full 6-stage lifecycle & privacy gates |
| **Slice 5** | Neighbourhood Discovery (`/explore` + `HomeHub` shelves), Watch Preferences (`/activity`), and `/me` (Saved Relationships + *"Compare alternatives"*, Reusable Records, Home Storefront Controls) | `pages/explore/ExplorePage.jsx`, `pages/activity/ActivityPage.jsx`, `pages/me/MePage.jsx` | Full Vitest suite + `npm run build` + `eslint` check |
| **Slice 6** | Seed realistic Kenya community demo data (Kisii fencing/fodder/holiday learning + Muthaiga cobbler round + Kisumu neighbours) & start live preview | `backend/seed_demo.py`, live uvicorn + Vite preview bound to `0.0.0.0` | Live API & browser verification across all user journeys |

---

## 7. Implementation Addendum (2026-10-23)

All six slices above were implemented on `arena/429fdbac-brief`. This section
records what shipped, the verification evidence, and the deliberate trade-offs
taken where the brief met the existing architecture.

### 7.1 What shipped

- **Identity (Slice 1):** Additive migration `0022_local_activity_ledger`
  (`down_revision = "0021_outside_content"`) adds `vendors.account_kind`
  (`person | household | artisan | institution | business`, existing rows
  default `business`), `vendors.hide_exact_location` (default `true`),
  `vendors.home_storefront_config` (JSONB), and `notifications.acted_upon_at`.
  `POST /api/auth/register` accepts `display_name` + `account_kind` and defaults
  new non-business signups to `person`; the legacy `business_name`-only payload
  still registers as `business`. `/auth` now defaults to a person joining as
  “Person”, with household/artisan/institution/business as equal choices and
  exact-location privacy on by default.
- **Ledger core (Slice 2):** New module `backend/app/modules/ledger/` with
  seven tables (`local_activities`, `activity_responses`, `activity_bookings`,
  `activity_feedback`, `activity_ledger_events`, `activity_watches`,
  `saved_relationships`), deterministic inference in `inference.py`
  (9 templates), household privacy in `privacy.py` (approximate public
  coordinates; exact directions only for the organizer or an active confirmed
  booking participant; stop directions redacted per-household and after
  completion), and the full `/api/ledger/*` lifecycle in `service.py` /
  `router.py`: publish → watcher notification → responses/quotes/pledges/stop
  requests → **strictly non-custodial** booking agreement
  (`direct_mpesa | direct_cash | in_kind | cost_share | free`; any custodial
  settlement value is rejected with 422) → agreed-change log → two-party
  completion → factual feedback → private reusable record with 1-tap repeat
  that re-locks directions. Youth guardrails are server-enforced: eligible
  age band + permitted domain whitelist + named adult supervisor + daytime
  hours (06:00–19:00) + hazard-pattern rejection, and a booking cannot be
  agreed until `guardian_consent_status = "confirmed"`.
- **Publishing & discovery (Slices 3–5):** `/create` makes
  `Available · Wanted · Scheduled · Opportunity` the primary grid (with live
  deterministic inference, progressive template fields, fractional quantities
  such as 2.5 tonnes / 12.5 bales, and a locked private-directions field) while
  keeping all six classic types and `?type=` deep links working;
  `POST /api/outside/content` accepts the four `posting_type` values into the
  ledger alongside the legacy contract. The Outside feed gained a
  `local_activities` source (kinds `available/wanted/scheduled/opportunity`)
  and new shelves; `/explore` filters by the four types; `/activities/:id`
  renders the 6-stage ledger, quotes, group-pool progress, travelling-round
  stops, guardian consent, non-custodial booking, completion, feedback,
  repeat, and local alternatives; `/activity` adds watch preferences and
  acted-upon tracking; `/me` adds outcome metrics (matches, fulfilled,
  repeats, notifications acted upon, active providers — never time-in-app),
  reusable records, saved relationships always paired with “Compare local
  alternatives”, and Home Storefront controls.
- **Phase 2 (Slice 6):** Home Storefront audience rules
  (`saved_contacts` items return 403 to non-saved viewers), fractional
  agricultural group sourcing with live pledged progress, travelling-artisan
  rounds with ordered private stops, community learning, and supervised youth
  opportunities — all on the same ledger, not separate state machines.
  `backend/seed_ledger_demo.py` seeds idempotent Kisii (fence lifecycle,
  6.25/10 t fodder pool, supervised youth), Muthaiga (cobbler round, stops
  1–2), and Kisumu (learning, home shelf) scenarios through the public API.

### 7.2 Verification evidence

- Backend: `pytest -q` → **280 passed** (274 pre-existing + 6 new ledger
  end-to-end tests in `backend/tests/test_activity_ledger.py`, covering
  authorization, privacy gates before/during/after booking, lifecycle
  transitions, the non-custodial 422, fractional pledges, stop-direction
  redaction, youth hazard/supervisor/hour/consent gates, home-shelf audience,
  and metrics shape).
- Migrations: `alembic upgrade head` from an empty database (including
  `0022`), plus a scratch-database `downgrade -1` → `upgrade head` cycle,
  both clean; `tests/test_migrations.py` guards enum/head agreement.
- Frontend: `npm test` → **214 passed** (206 pre-existing + 8 new in
  `frontend/src/test/activityLedger.test.jsx`); `npm run build` succeeds;
  ESLint is clean on every file touched by this work (the repo-wide lint run
  still reports pre-existing errors in untouched files such as
  `NoticeBoard.jsx`).
- Live preview: API on `:8000` (migrated from zero through `0022`) and Vite
  on `:3000`, seeded with `seed_ledger_demo.py`; the Kisii fence record,
  Muthaiga round, youth booking, fodder pool, and saved-contacts home shelf
  were verified over HTTP, including the home shelf returning 404/403 to a
  non-saved viewer.

### 7.3 Deliberate trade-offs

1. **`vendors` stays the principal table; `business_name` stays the storage
   column.** Renaming it would break 45+ foreign keys, JWT subjects, and
   serialized contracts for zero user benefit. The API now exposes
   `display_name` as an alias and `account_kind` as the real participation
   kind; new signups may send only `display_name`.
2. **The auth gate still requires authentication for `/api`.** What changed
   is who may hold an account and what the gate says: the 401 copy and
   `X-Brief-Network` header now read “Sign in to continue” / `members`
   (one smoke assertion updated accordingly). No route became public that
   was not public before.
3. **Feed cards never carry exact household coordinates.** The Outside feed
   adapter always serializes approximate coordinates; exact directions are
   only available from the ledger detail endpoint while a booking is active.
   List views therefore err on the side of privacy, and the detail screen is
   the single place directions can unlock.
4. **Group sourcing and artisan rounds reuse the ledger response/booking
   rows** (`group_pledge` quantities as `Float`, `stop_sequence` on bookings)
   instead of extending `collective_sourcing` / `market_runs`. Those B2B
   flows keep working untouched; the neighbourhood flows share one lifecycle,
   one privacy model, and one metrics definition with everything else.
