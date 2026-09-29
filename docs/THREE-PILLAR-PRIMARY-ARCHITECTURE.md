# Three Pillars as the Primary Architecture

Status: **architecture decision record** (local, unmerged). Written 2026-09-29.
Owner direction in this session: the three feature pillars below stop being
"one more feature set" and become the **primary architecture** of Brief's
commerce side, with every screen fitted to a phone first.

This document does four things and nothing else:

1. Names the three pillars and the discovery layer that fronts them.
2. Maps every pillar onto the Brief primitives that already exist, and names
   what is genuinely new.
3. Specifies the data model, API surface, USSD menus, money path and edge cases
   per pillar.
4. States the **mobile UI fit contract** every screen in every pillar obeys.

The interactive, mobile-fitted screen gallery for this document lives in the
repo at `/pillars` (`preview/src/features/pillars/`). It is a concept preview:
no orders, batches, payments or payouts are live, exactly like `/cloudbites`.

---

## 1. The decision

Brief already runs the economic loop: **request → match → quote → work order →
repeat procurement → trust → payment**, all derived from real rows. The three
pillars do not replace that loop. They are the three places the loop is *put to
work* at scale:

| Pillar | Name in the product | What it is | The loop it runs |
|---|---|---|---|
| **P1** | **Supply** | Cross-border supply chain: Ugandan vendors and farmers onboarded, verified, consolidated at a border post, cleared under the EAC Simplified Trade Regime, delivered into Kenyan hubs, paid in UGX. | vendor → consignment → batch → border → hub → last mile → payout |
| **P2** | **Shop** | Ordering for the people who actually buy small and often: dukas on app **and** USSD, institutions with credit and POs, families on one shared basket. | pool → order → pay → deliver → reorder |
| **P3** | **Gather** | Events, pop-ups and markets, plus the Market Scout network that keeps the index of who-sells-what-where alive. | blueprint → invite → apply → approve → stall → scout verification |

In front of all three sits one discovery surface, the **Trade Map**: what exists
where, who has it, who needs it, what it costs, how it moves. It is the home
screen of the commerce side, and it is useful even when no transaction happens —
which is the whole point, because an index creates reasons to return that a
catalogue never does.

**Why this is the primary architecture.** The previous framing treated Brief as
a marketplace that needed more features. The corrected framing: the marketplace
went quiet because there were not enough reasons to come back, discover each
other, compare and transact. The three pillars are those reasons, in the order a
person actually needs them: *find it* (Trade Map), *get it* (Supply), *buy it*
(Shop), *meet it* (Gather).

---

## 2. Where the pillars live in the existing shell

Brief's navigation is **five doors and one action**: Home, Market, Trade, Shop,
You, plus Create. The pillars do not add doors. They become the primary content
of the doors that already exist, which is why this is a re-architecture and not
a re-navigation.

| Door | Hash | Pillar content that becomes primary |
|---|---|---|
| **Home** | `#home` | **Trade Map**: region clusters with live availability, "what changed since you last visit", trending routes, *Find it for me* entry. |
| **Market** | `#market` | P3 events feed, stall applications, event blueprints; the mixed board (offers, shops, groups, errands, bulk lots) stays. |
| **Trade** | `#trade/<section>` | P1 supply chain: `demand · open · quotes · work · procurement · supply` — with **supply** now carrying the vendor, consignment, batch, shipment and payout sections. |
| **Shop** | `#duka/<section>` | P2: duka ordering, pooled price, institutional accounts, family basket, credit, delivery tracking. |
| **You** | `#you/<section>` | P3 scout work: territory, today's opportunities, verification adds, earnings (derived), the USSD/channel settings. |

Legacy addresses keep working and light the door that now owns them. Nothing
404s because the architecture changed.

### 2.1 Door-by-door entry points that must exist

```
#home                     Trade Map (default region = member's own county)
#home/map/:regionId       region detail: what's available, supplier counts, recency
#trade/supply             my supply profile + capabilities (existing surface, extended)
#trade/supply/vendors     P1 vendor directory (UG + KE), verification ladder
#trade/supply/batches     consolidation batches by border post (field-agent desk)
#trade/supply/shipments   shipment tracking (existing orderTracking projection)
#duka                     duka home: reorder, pooled alerts, USSD pairing
#duka/pool/:productId     Pool & Save: join a demand pool, watch the tier drop
#duka/institution         institutional dashboard (requisitions, approvals, credit)
#duka/basket/:basketId    family basket (shared link)
#market/events            vendor event feed + filters
#market/events/:eventId   event detail + stall application
#market/events/:eventId/desk   organiser application desk
#you/scout                Market Scout: territory, opportunities, earnings
```

---

## 3. Reuse vs build

The rule for this architecture: **a pillar never gets a second copy of a thing
Brief already derives honestly.** Everything below is either reused as-is,
extended, or new.

### 3.1 Reused unchanged

| Existing primitive | Pillar use |
|---|---|
| `domain/requests.js` | Structured demand: quantity, unit, category, budget, deadline, specs. A duka order and an institutional requisition are both demand rows. |
| `domain/matching.js`, `matchRanking.js` | "Find sources" and "Find buyers" — every match explains itself in words. |
| `domain/quotes.js`, `quoteValidation.js` | Integer minor units, BigInt-exact totals. A quote is the only way a price enters an order. |
| `domain/workOrders.js`, `workExecution.js` | Two-party fulfilment state machine. A consignment's journey is a work order. |
| `domain/procurement.js` | Repeat patterns → "reorder" is one tap, for dukas and institutions alike. |
| `domain/participantTrust.js` | Derived, explainable trust. No star ratings anywhere. |
| `domain/ledger.js` | `ledgerTransactions` remains the single source of economic truth. No wallet, no balance column, no per-pillar economy. |
| `domain/priceSignals.js` | The honest aggregate behind comparison: min / average / max of **active listings**, stated as a snapshot, never a fabricated trend. |
| `domain/orderTracking.js` | Shipment and delivery tracking as a projection over orders + dispatches. |
| `domain/events.js` | Events hub. Keeps its hard scoping: no featured events, no social proof, sorting by `startsAt` ascending, seats as the only printable number. |
| `domain/vendor.js` | Vendor as a first-class actor (Object → Vendor → Listing → Order → Fulfilment → Transaction). |
| `domain/fieldAgent.js` | The Market Scout precedent: flat fee per approved outcome, first-touch-wins, depth one, nothing stored as a balance. |
| `domain/workforce.js` | Territories, onboarding checklist derived from rows, human activation, independent-worker terms. |
| `domain/supply.js`, `supplyVerification.js` | Enterprises and capabilities with **scoped** verification records — never an aggregate "fully verified" badge. |
| `domain/huduma/*` | The chat state machine (WhatsApp interactive router) that a USSD session mirrors. |

### 3.2 Extended

| Primitive | Extension |
|---|---|
| `domain/supplyVerification.js` | Add the verification ladder states `discovered → contacted → verified → active → trusted`, and the staleness clock that demotes a listing nobody has confirmed. |
| `domain/groupbuy.js` | Generalise the funding stepper into **demand pooling**: contributions are replaced by order lines, the target is a wholesale tier, and the pool publishes its fill level and next price break. |
| `domain/events.js` | Add stall applications and the organiser desk **without** adding a second event table or a featured slot. Stall counts are seats, printed the same way. |
| `domain/fieldAgent.js` | Add scout mission types (verify listing, refresh availability, confirm staleness) paid as approved outcomes on the existing flat-fee law. |
| `domain/priceSignals.js` | Add a per-region, per-capability cut so the Trade Map can show "Kisii avocado: 14 active listings, KES 61–66" without inventing history. |
| `domain/orderTracking.js` | Add the border-crossing legs (`at_border`, `cleared`) and the border-delay notification. |

### 3.3 New (and why it cannot be a reuse)

| New module | Why new |
|---|---|
| `domain/crossBorder.js` | EAC Simplified Trade Regime logic: the US$2,000 consignment ceiling, SCOO drafting, sub-consignment splitting, full-declaration escalation, UGX→USD conversion at the daily rate with a stated buffer. Nothing in Brief models a customs threshold today. |
| `domain/consolidation.js` | Border-point batches: open → locked → in_transit → cleared → received, with the batch value ceiling enforced on every write. |
| `domain/fx.js` | One rate source, one buffer, one printed rate per settlement. Rate honesty is a money-honesty problem, not a formatting problem. |
| `domain/institutions.js` | Institutional accounts: registration evidence, requisition → approval → PO → POD → invoice → credit terms. Distinct from a person or a shop. |
| `domain/credit.js` | **Terms, not lending.** Payment-terms eligibility derived from real repayment rows; limits and auto-suspension. Brief does not lend, score credit for third parties, or offer BNPL. |
| `domain/stalls.js` | Stall applications, waitlists, refunds and QR stall passes against existing events. |
| `domain/scout.js` | Market Scout missions, territories and derived earnings — thin, because `workforce` + `fieldAgent` already carry the hard parts. |
| `domain/spotlight.js` | The comparison layer (internal codename **Phantom**). Derives opportunities from real rows; never random, never humiliating, never a stored score. |
| `domain/courierNetwork.js` | A directory of **licensed** courier operators and their routes, with the platform as orchestration layer, never as carrier. |

---

## 4. Data model additions

All collections are additive rows in the existing file-backed store
(`server/src/store.js`), migrated the way every earlier feature was: additive,
idempotent, no rewrite of a live primary.

### 4.1 P1 — Supply

**`vendors`** (extends the existing vendor actor with cross-border fields)

```
vendor_id            uuid
business_name        string
vendor_type          manufacturer | farmer | cooperative | processor
country              UG | KE            (TZ, RW later — same schema)
district             string            Mbale, Jinja, Busia, Kisii, Nakuru …
gps                  { lat, lng } | null
contact_phone        string            OTP-verified
contact_whatsapp     string | null
categories           []farm_produce | grains | dairy | manufactured | household
products_summary     text
capacity_monthly     string            free text, never parsed as a promise
moq                  json               per product
payout               { kind: mobile_money | bank, ref, currency }
verification_status  pending | verified | rejected | suspended
verification_tier    basic | silver | gold
badge_expiry         date | null
created_at           timestamp
```

**`consignments`** — one vendor's goods inside one batch

```
consignment_id       uuid
vendor_id            uuid
batch_id             uuid | null
product, quantity, unit
unit_price_ugx       integer (minor units)
declared_value_usd   decimal           computed at the daily rate
str_eligible         boolean            value ≤ 2000
scoo_ref             string | null
status               offered | loaded | cleared | returned | rejected
```

**`consolidation_batches`**

```
batch_id             uuid
border_point         busia | malaba     (later: Malaba, Katuna, Namanga)
status               open | locked | in_transit | cleared | received
vendor_ids           []uuid
total_declared_usd   decimal            enforced ≤ 2000 per consignment
departure, arrival   timestamps
vehicle_reg          string
driver_phone         string
cutoff_at            timestamp
```

**`shipments`** — the movement row the buyer actually tracks

```
shipment_id          uuid
batch_id             uuid
legs                 []{ from, to, status, at }
status               preparing | in_transit | at_border | cleared | delivered
manifest             json
eta, actual_arrival  timestamps
delay_reason         string | null
```

**`fx_rates`** — appended, never edited

```
at                   timestamp
pair                 UGX_USD | UGX_KES
rate                 decimal
buffer_pct           1.5
source               string             named provider or "manual"
```

### 4.2 P2 — Shop

**`institutions`**

```
institution_id       uuid
name                 string
type                 school | hospital | hotel | restaurant | caterer | government
gps                  { lat, lng }
contact_person       string
procurement_phone    string
registration_evidence  json            kind + reference, never the document itself
credit_limit_kes     integer
payment_terms_days   integer           default 30
status               pending | verified | suspended
```

**`requisitions`** → **`purchase_orders`** → **`invoices`**

```
requisition_id, institution_id, lines[], requested_by, approved_by, status
po_id, requisition_id, lines[], total_minor, terms_days, status
invoice_id, po_id, total_minor, due_at, paid_at | null
```

**`demand_pools`** (the generalised group-buy stepper)

```
pool_id              uuid
product_id           uuid
vendor_id            uuid
lines                []{ order_id, duka_id, quantity }
total_quantity       integer
tiers                []{ at_quantity, unit_price_minor }
current_unit_price   integer            derived from tiers, never stored twice
cutoff_at            timestamp
status               collecting | confirmed | fulfilled | cancelled
```

**`family_baskets`**

```
basket_id            uuid
owner_id             uuid
share_token          string            single-use, revocable
lines                []{ product_id, vendor_id, quantity }
window               { from, to }
perishable_mix       boolean           drives the split-delivery suggestion
```

**`credit_accounts`** — terms only

```
account_id           uuid
holder_kind          duka | institution
limit_minor          integer
terms_days           integer
overdue_days         integer            derived from real invoice rows
```

### 4.3 P3 — Gather

**`stall_applications`**

```
application_id       uuid
event_id             uuid
vendor_id            uuid
offer_summary        text
requirements         []power | water | space
status               pending | approved | rejected | waitlisted
fee_minor            integer
payment_ref          string | null
stall_pass           string | null      QR payload
```

**`scout_missions`**

```
mission_id           uuid
scout_id             uuid
territory            string
type                 verify_listing | refresh_availability | confirm_demand | invite_vendor
target_ref           string
status               open | submitted | approved | rejected
evidence             json
fee_minor            integer            flat, per approved outcome
```

**`courier_operators`**

```
operator_id          uuid
name                 string
licence_class        national | international | courier_hailing
licence_ref          string
routes               []{ from, to }
service_areas        []string
contact              string
status               active | suspended
```

**`spotlight_events`** — *derived, never stored as a score*

```
Opportunities are computed on read from listings, orders, pools, events and
routes. Nothing here is a stored "you should know" row: the only stored facts
are (a) that a notification was sent, and (b) that the member dismissed that
class of notification. Both are facts about delivery, not about the market.
```

---

## 5. API surface

New route files, all following the existing route laws: identity is resolved
server-side from the session (never a body-supplied `ownerId`), money is
server-authoritative, and an unconfigured rail fails closed with a reason.

### 5.1 P1 — Supply

```
POST   /api/supply/vendors                     apply (status: pending)
GET    /api/supply/vendors?country=&district=  directory with verification ladder
POST   /api/supply/vendors/:id/verification    submit scoped verification evidence
POST   /api/supply/consignments                offer goods into a batch
GET    /api/supply/batches?border_point=       batch desk list
POST   /api/supply/batches                     open a batch (cutoff)
POST   /api/supply/batches/:id/lock            lock + assign vehicle/driver
POST   /api/supply/batches/:id/scoo            draft + print SCOO
POST   /api/supply/batches/:id/dispatch        status → in_transit, notify buyers
POST   /api/supply/shipments/:id/legs          append a leg (border, cleared, hub)
GET    /api/public/order-tracking/:ref         unchanged public tracking surface
GET    /api/supply/fx?pair=UGX_KES             latest appended rate + buffer
POST   /api/supply/vendors/:id/payout          request payout (manual, finance-confirmed)
```

STR rules enforced server-side, not in the client:

- `declared_value_usd ≤ 2000` per consignment → draft SCOO.
- Above the ceiling → the write is refused with `str_ceiling_exceeded` and the
  caller must either split into sub-consignments or escalate to a partner
  customs agent for full declaration. The server never silently splits money.
- A batch whose total crosses the ceiling is refused at `lock`, not at `dispatch`.

### 5.2 P2 — Shop

```
POST   /api/duka/pools                         open a pool (vendor + product + tiers)
POST   /api/duka/pools/:id/join                add an order line; price re-derives
GET    /api/duka/pools/:id                     fill level, current price, next break
POST   /api/duka/pools/:id/close               cutoff → bulk order to the vendor
POST   /api/institutions                        onboard with registration evidence
POST   /api/institutions/:id/requisitions      create a requisition
POST   /api/institutions/:id/requisitions/:r/approve
POST   /api/institutions/:id/requisitions/:r/po  generate the PO
POST   /api/family-baskets                     create; returns share token
POST   /api/family-baskets/:token/lines        add via shared link (token-scoped)
POST   /api/family-baskets/:id/checkout        M-Pesa STK push; split-delivery advice
GET    /api/duka/credit/:accountId             terms, limit, derived overdue days
```

Payment rails, unchanged in law: collection through the configured connector
(STK push / C2B), escrow until delivery is confirmed, disbursement manual and
finance-confirmed. **UGX payouts to MTN/Airtel remain a blocked workstream** —
no automated B2C is implemented, and adding credentials does not implement it.

### 5.3 P3 — Gather

```
GET    /api/events?category=&county=&from=     vendor event feed (existing hub)
POST   /api/events/:id/stall-applications      apply + pay the stall fee
GET    /api/events/:id/applications            organiser desk (scoped to the organiser)
POST   /api/events/:id/applications/:a/decide  approve | reject | waitlist (+ reason)
POST   /api/events/:id/blueprint               recommended categories/vendors/routes
GET    /api/scout/today?territory=             missions + demand signals for a scout
POST   /api/scout/missions/:id/submit          evidence (photo, quote, confirmation)
GET    /api/couriers?from=&to=                 licensed operators on a route
POST   /api/couriers/:id/referral              orchestrate a booking (referral, not carriage)
```

### 5.4 USSD parity

Every P2 action has a USSD equivalent, because a duka owner with a feature phone
is a first-class user, not a degraded one. The menu tree is in §7.

```
USSD sessions are server-side state machines (huduma/session.js pattern):
  * a session times out at ~120s of inactivity; mid-order state is saved as a
    draft the member resumes from "My Orders"
  * the session never reads an amount from the keypad; totals come from rows
  * "Pay on delivery" is first-time buyers only, capped, and recorded as a
    credit fact, not a free pass
```

---

## 6. Money, honestly

The pillars add three money shapes. All three obey the standing law: one ledger,
no wallet, derived figures, no fabricated success.

| Shape | Flow | Rail |
|---|---|---|
| **Duka order** | Buyer pays KES → escrow → delivery confirmed → vendor settled | STK push / C2B; disbursement finance-confirmed |
| **Cross-border consignment** | Vendor lists UGX → platform converts with the appended daily rate + stated buffer → buyer sees and pays KES → escrow → on delivery the agreed rate converts back → vendor paid UGX | Same rails; **automated UGX B2C blocked** |
| **Stall fee / event ticketing** | Vendor pays the stall fee → held until the event runs → refunded automatically on cancellation | Same rails; fee is the organiser's, the platform's cut is a derived obligation |

Three rules that are not negotiable in this architecture:

1. **A rate is an appended fact.** `fx_rates` rows are never edited. A settlement
   prints the exact row it used. If UGX/KES moves more than 3% between order and
   dispatch, a price-adjustment flag is raised for buyer approval — never applied
   silently.
2. **Credit is terms, not lending.** A `credit_account` records a limit and real
   invoice rows. Overdue > 15 days blocks ordering. There is no interest, no
   BNPL, no score sold to anyone.
3. **Couriers are referred, never employed.** The platform books a licensed
   operator and earns a referral or transaction margin where commercially
   appropriate. It never owns the truck, never employs the driver, and never
   claims a delivery it did not orchestrate.

---

## 7. USSD menu logic

Shortcode: `*XXX#`. Session timeout 120s. English/Swahili/Luganda strings.

```
Welcome to Brief.
1. Order Stock          2. Check Prices        3. My Orders
4. Request Delivery     5. Help
```

**1. Order Stock**

```
Select category:
1. Farm Produce  2. Grains & Flour  3. Dairy
4. Household     5. Manufactured Goods
→ Select product (shows pooled price, not a stored one):
   1. Maize Flour 2kg - KES 120 (pool 340kg)
   2. Beans 1kg - KES 95
   3. Rice 5kg - KES 450
→ Enter quantity:
   Enter quantity for Maize Flour 2kg
   (Pooled price now: KES 120 · drops at 500kg)
→ Confirm:
   Confirm: 20 x Maize Flour 2kg
   Total: KES 2,400
   1. Confirm  2. Change quantity  3. Cancel
→ Pay:
   Pay KES 2,400 via M-Pesa?
   1. Yes - enter PIN on your phone
   2. Pay on delivery (first order only)
→ Done:
   Order #DKA-4821 confirmed.
   Delivery: tomorrow 10:00-14:00.
   SMS receipt sent.
```

**2. Check Prices** — reads the derived price signal for the member's county:
`Farm Produce: 14 listings · KES 61-66 · updated 3h ago`. No history, no trend,
no "market forecast".

**3. My Orders** — draft resume, in-flight, delivered, reorder.

**4. Request Delivery** — registered couriers on the route, ETA, cost; referral
booking.

**5. Help** — one screen, three lines, a phone number that a human answers.

Edge cases the menu must survive: session timeout mid-order (draft saved),
insufficient M-Pesa balance (retry or pay-on-delivery for first-timers only),
product out of stock ("Notify me when available?"), and a pool that fails its
minimum ("Pool did not fill. No charge. Order cancelled.").

---

## 8. The comparison layer (Phantom / Spotlight)

Phantom is the reason the marketplace stops being quiet. It is a **persistent
comparison layer**, not a chatbot and not a pop-up, and it obeys four laws:

1. **Never random.** An opportunity is derived from real rows: price difference,
   distance, supplier reliability, availability, product similarity, delivery
   cost, recency, and the member's own stated preference. If the score does not
   clear a meaningful threshold, nothing is sent. Notification fatigue is a
   product failure, not a user failure.
2. **Never humiliating.** "Your current listing is above the comparable market
   range" with the evidence shown — never "you are overpriced". Competitive
   pressure, not antagonism.
3. **Never a stored score.** It is recomputed on read, like every other number
   in Brief.
4. **Never a claim about the future.** It says what listings exist now, at what
   price, from whom, and how far away. It does not forecast.

What it does, per role:

| Role | Example |
|---|---|
| Buyer | "You requested 100kg at KES 70. A comparable supplier 12km away is at KES 63. Potential saving: KES 700." |
| Supplier | "3 suppliers near Kisii are listing comparable avocado at KES 61–66." |
| Repeat buyer | "The fish you bought last week is 8% cheaper from Kilifi; delivery adds KES 20/kg." |
| Event vendor | "Two vendors selling similar products have joined your event." |
| Index hygiene | "Is this still available?" to a listing nobody has confirmed in 60 days. |

Reactivating dormant users runs on the same engine: the message is *"3 new
suppliers were added in your area"*, never *"we miss you"*.

---

## 9. Verification, and why the index stays alive

A listing is not true because it was typed. The ladder:

```
DISCOVERED   someone submitted it
CONTACTED    the supplier confirmed it
VERIFIED     business/product evidence checked (scoped, never a global badge)
ACTIVE       availability confirmed recently
TRUSTED      transaction history exists
```

Staleness is enforced, not hoped for: a listing with no confirmation inside its
category's freshness window is demoted, and multiple "the supplier doesn't have
this" reports demote it faster. Scouts are paid to refresh, which is why the
ladder is cheap to maintain: verification is somebody's paid afternoon, not a
moderator's backlog.

---

## 10. Mobile UI fit contract

Every screen in every pillar is fitted to a phone first. The gallery at
`/pillars` is the reference implementation; these are the rules it follows.

### 10.1 Global rules

| Rule | Value | Why |
|---|---|---|
| Baseline viewport | 360 × 800 dp, safe-area insets honoured | the phone most members actually own |
| Type | 15px body minimum, 12px meta only, 16px inputs | iOS zooms a focused input below 16px |
| Touch targets | ≥ 44 × 44 dp, ≥ 8 dp between targets | thumb accuracy, mis-tap recovery |
| Primary actions | bottom-anchored, inside the thumb arc | reachability on a 6.1" screen |
| Navigation | one bottom bar, five doors, one action | the shell's existing contract |
| Secondary flows | bottom sheets, never full-screen jumps | context is preserved, back is obvious |
| Scrolling | vertical only, one column, no horizontal carousels for content | a sideways-scrolling catalogue is unreadable on a phone |
| Tables | reflowed into stacked rows with a label column | the spec's product/available/price table becomes three rows per product |
| Long processes | stepper with a visible save point | onboarding, requisition approval, stall application |
| Live status | a dot + a recency line, always | "available now" is a claim; "updated 3 hours ago" is a fact |
| Failure | stated, with the next action | an empty search returns alternatives, never "No results." |
| Offline | the last read stays readable; writes queue | signal is intermittent on the routes that matter |

### 10.2 Per-screen fit

| Screen | Mobile fit decision |
|---|---|
| Trade Map home | Map fills the top 55%; clusters are ≥ 48 dp tap targets; a bottom sheet carries the region's availability; "3 changes" is one card, not a feed. |
| Region detail | Product rows stack: name + supplier count, then status dot + recency, then "Request current quote" when no reliable price exists. |
| Find it for me | A three-field sheet (where / what / how much) over the keyboard; results arrive as source cards with courier options folded underneath each. |
| Vendor onboarding | Six steps, one per screen, progress bar pinned under the app bar, a field agent can complete any step on the vendor's behalf; every step is resumable. |
| Consolidation desk | Batch list first; consignment entry is one thumb-scroll form; the US$2,000 ceiling warning is a blocking sheet, not a toast. |
| Shipment tracking | Vertical timeline with the current leg expanded; "Call driver" is a 44 dp button in the app bar; ETA and delay reason are always both visible. |
| Pool & Save | Progress bar + current price + next break in one card; "Join pool" is the bottom action; the price drop is shown as money, not as a percentage alone. |
| Duka home | "Reorder last order" is the single largest target on the screen; categories are a 2-column grid; pooled alerts sit above the fold. |
| Checkout | Cart → delivery slot → M-Pesa sheet. The STK prompt is a sheet with a "waiting for PIN" state that never lies about success. |
| USSD | Rendered as the real thing: 180-column plain text, CON/END prefixes, no styling, no images. Parity, not a parody. |
| Institutional dashboard | Cards, not spreadsheets: open requisitions, pending approvals, credit used/limit, next due date; approval is a two-tap action with a reason field on reject. |
| Family basket | Category tabs; the shared-link invite is a copyable token; a perishable mix shows the split-delivery suggestion before checkout, not after. |
| Vendor event feed | Filter chips scroll horizontally (filters only, never content); event cards carry stalls remaining as the only number. |
| Stall application | Three fields, one photo picker, one payment sheet, then a QR stall pass that works offline. |
| Organiser desk | Swipe-free: Approve / Waitlist / Reject buttons with a required reason on reject; refunds auto-initiated on rejection or cancellation. |
| Scout today | Territory header, mission list, demand signal card, derived earnings with the arithmetic printed beside the number. |
| Event blueprint | The result is a scrollable blueprint: recommended categories, potential vendors, sourcing areas, nearby logistics — each a section, never a wall of text. |

---

## 11. Edge cases, consolidated

| # | Case | Handling |
|---|---|---|
| 1 | Consignment above US$2,000 | Refused at write; split or escalate to full declaration. |
| 2 | UGX/KES moves > 3% before dispatch | Price-adjustment flag; buyer approves explicitly. |
| 3 | Border delay > 24h | Auto-notify buyers with the revised ETA and reason. |
| 4 | Consignment rejected at the border | Vendor notified; goods returned to the consolidation point; the ledger row states the outcome. |
| 5 | Pool never reaches its minimum | Cancelled, everyone notified, no charge. |
| 6 | Vendor cannot fulfil a filled pool | Partial fulfilment; refund or waitlist per line. |
| 7 | USSD session times out mid-order | Draft saved; resumed from "My Orders". |
| 8 | Insufficient M-Pesa balance | Retry, or pay-on-delivery for first-time buyers only. |
| 9 | Credit limit exceeded | Order blocked until payment or a limit decision; the reason is shown. |
| 10 | Approval timeout on a requisition | Escalate to the backup approver; the escalation is a fact, not a silent auto-approve. |
| 11 | Partial institutional delivery | Invoice adjusted, backorder created, both visible. |
| 12 | Perishable + non-perishable in one basket | Split-delivery suggested before checkout. |
| 13 | Event cancelled | Every applicant notified; stall fees refunded automatically. |
| 14 | Stall oversubscribed | Waitlist with position; no favouritism, no featured stall. |
| 15 | Vehicle breakdown | Backup vehicle reassigned; buyers notified with the new ETA. |
| 16 | Goods damaged in transit | Driver photo evidence; claim process; vendor and buyer both notified. |
| 17 | Duplicate vendor phone | Blocked and flagged for manual review. |
| 18 | Border-town vendor | Both countries' documents accepted. |
| 19 | Listing stale 60 days | Spotlight asks "still available?"; silence demotes it. |
| 20 | Unconfigured payment rail | `503` with a reason. Never a fake success. |

---

## 12. Implementation order and gates

Local, unmerged, and in this order — because each step is independently useful
and independently revertible:

1. **Trade Map home + region detail + Find it for me** (discovery layer; P1+P2 front door).
2. **Demand pooling** (generalise the group-buy stepper) + Pool & Save screen.
3. **Duka ordering parity**: app + USSD session machine + checkout.
4. **Vendor onboarding + verification ladder + scouting missions** (the index gets built).
5. **Cross-border**: consignments, batches, STR ceiling, SCOO drafting, shipment legs.
6. **Institutions + credit terms + family baskets.**
7. **Events**: stall applications, organiser desk, blueprint.
8. **Spotlight/Phantom** on top of everything above, once there are real rows to compare.

Gates that stay closed regardless of order: automated payouts (UGX B2C and Buni
disbursement), live M-Pesa charges in tests, credit scoring, BNPL, insurance,
crypto, star ratings, featured events, and any number that is stored where it
could have been derived.

---

## 13. What this document does not claim

No vendor has been onboarded, no batch has crossed a border, no pool has filled,
no stall has been sold, no payout has moved, and no comparison has been computed
from live rows. `/pillars` is a concept gallery with illustrative figures and a
disabled checkout; the numbers in it are fixtures, not market data. The EAC
Simplified Trade Regime thresholds and the licensed-courier categories named
here are regulatory context for the design, not a legal opinion, and any live
cross-border operation needs its own customs and licensing review.
