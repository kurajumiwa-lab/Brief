# Product Archaeology — Brief_ / "My Shop App"

**Date:** 2026-10-08
**Scope:** the whole product as it exists on `main` (FastAPI backend, React/Vite frontend, POS daemon).
**Purpose:** before changing anything, write down what the product *is*, what it *does well*, which mechanics are load-bearing, and which parts are presentation that can be replaced.
**Reference app for the modernization:** **Fiverr** — used for *presentation patterns and marketplace conventions only*, never for product mechanics.

---

## 0. One-paragraph summary

Brief_ is a **vendor-to-vendor (B2B) trade network** for informal and semi-formal commerce: market traders, kiosk owners, wholesalers, couriers, hotel suppliers. Every account is a business; there is no consumer side, no cart, no checkout. The unit of value is **stock that already exists on a shelf**, and the unit of work is a **movement** — one vendor sourcing from another, tracked through a short, honest state machine. Around that core sits a reputation engine, a chat/deal layer, group buying, logistics rental, events and a public-data market map.

---

## 1. Core product loop

```
                    ┌──────────────────────────────────────────┐
                    │  1. PUBLISH what is on your shelf        │
                    │     (manual · CSV · POS sync)            │
                    └───────────────────┬──────────────────────┘
                                        ▼
    ┌──────────────────────────────────────────────────────────────┐
    │  2. DISCOVER what the network has                            │
    │     network stock · compare alternatives · vendor reliability │
    └───────────────────┬──────────────────────────────────────────┘
                        ▼
    ┌──────────────────────────────────────────────────────────────┐
    │  3. NEGOTIATE or SOURCE                                      │
    │     POST /source  (instant request)                          │
    │     …or a deal room → structured proposal → counter → accept │
    └───────────────────┬──────────────────────────────────────────┘
                        ▼
    ┌──────────────────────────────────────────────────────────────┐
    │  4. MOVE                                                     │
    │     pending → confirmed → shipped → received  (or cancelled) │
    │     stock reserved on request, shelves debited on receipt    │
    └───────────────────┬──────────────────────────────────────────┘
                        ▼
    ┌──────────────────────────────────────────────────────────────┐
    │  5. SCORE                                                    │
    │     connection created · parasitism index + network score    │
    │     recomputed · notification fired                          │
    └───────────────────┬──────────────────────────────────────────┘
                        ▼
                 back to 2 — with a better counterparty graph
```

**The loop in one sentence:** *stock in → sourced → moved → scored → a better network next time.*

The scoring step is what makes it a loop rather than a transaction log. A received movement improves both sides' standing, which changes who appears in discovery, which produces the next movement. This is the mechanic that must survive untouched.

**Secondary loops that feed the primary one**

| loop | cadence | why it returns the user |
|---|---|---|
| **Daily Flash Locks** | daily, 15:00–20:00 EAT window | time-boxed; pooled demand hits an MOQ or dissolves — a real deadline |
| **Collective sourcing** | per campaign | `gathering → quota_met → negotiating → ordered → fulfilled`, visible progress bar |
| **Chat / deal rooms** | continuous | counterparty replies; deal proposals need an answer |
| **Notifications** | 30 s poll | every consequential action lands in the bell |
| **POS sync** | scheduled | the shelf updates itself; the vendor comes back to a changed board |
| **Squad / Hustle league** | daily call-ups | XP, tiers, divisions, streaks |
| **Analytics** | weekly-ish | price position vs. the network, net position per counterparty |

---

## 2. Primary user journey

**Persona A — the sourcing vendor (buyer side).** *"I need 60 bunches of sukuma by tomorrow."*

```
register → onboarding (handle, categories, role, market radar)
   → browse network stock  (search / category / compare alternatives)
   → read the vendor's reliability (fulfilment %, patron tier, quality badge)
   → SOURCE  (quantity, notes)   or   open a DEAL ROOM (negotiate terms)
   → movement pending → supplier confirms → ships → I mark received
   → my score and theirs update; we are now connected
   → next time, they rank higher in my discovery
```

**Persona B — the supplying vendor (seller side).** *"I have stock; who wants it?"*

```
register → onboarding → add stock (manual / CSV / POS) → mark visible to network
   → requests arrive in the bell → confirm → ship
   → fulfilment rate rises → better discovery placement → more requests
```

**Persona C — the patron / organiser.** Runs curated vendor lists, groups, events, vouches for provenance; promoted automatically by tier.

**Persona D — the courier.** Registers as a courier tool, receives shipment bookings, plans optimised routes, gets rated.

The product's real shape is **A and B in the same account** — the `both` role is the design intent, and the one-click role switcher is the expression of it.

---

## 3. Feature inventory

Legend: **CORE** = part of the primary loop · **SUPPORT** = strengthens the loop · **ADJACENT** = separate loop · **INFRA** = not user-facing product.

| # | feature | class | backend | frontend |
|---|---|---|---|---|
| 1 | Auth (JWT access+refresh, lockout, rate limits) | INFRA/CORE | `routes/auth.py` | `pages/auth/AuthPage` |
| 2 | Vendor identity (`@handle`, categories, fluid role) | CORE | `routes/vendors.py` | `pages/vendor/VendorProfile`, `RoleSwitcher` |
| 3 | Onboarding (shop page → market radar) | SUPPORT | `routes/onboarding.py` | `components/onboarding/OnboardingFlow` |
| 4 | **Stock Room** (own shelf, CRUD, visibility) | CORE | `routes/stock.py` | `pages/stock/StockRoom` |
| 5 | **Network stock browse** (search, category) | CORE | `routes/stock.py` | `StockRoom?tab=network` |
| 6 | **Compare alternatives** (same category, cheapest first) | CORE | `/stock/{id}/alternatives` | `StockCompareModal` |
| 7 | **Source request** → movement | CORE | `/stock/{id}/source` | `SourceDialog` |
| 8 | **Movement state machine** (confirm/ship/receive/cancel) | CORE | `/stock/movements/{id}/*` | `MovementRow` |
| 9 | Reservation holds (expire after N hours) | CORE | `services/stock_engine.py` | implicit |
| 10 | Quality & provenance ladder (4 states) | SUPPORT | `/stock/{id}/verify`, `/patron-verify` | `QualityBadge`, `StockVerifyDialog` |
| 11 | CSV bulk import | SUPPORT | `/stock/bulk-import` | `BulkImport` |
| 12 | **Deal rooms** (structured proposal / counter / accept) | CORE | `routes/chat.py` | `DealProposalCard` |
| 13 | Chat (group, list, deal, direct, niche) + WS | CORE | `routes/chat.py` | `pages/chat/ChatPage` |
| 14 | Voice notes (≤15 s, authorised fetch) | SUPPORT | `/chat/{room}/voice` | `VoiceNote` |
| 15 | Stock share in chat | SUPPORT | `routes/chat.py` | `StockShare` |
| 16 | **Parasitism engine / network score** | CORE | `services/parasitism_engine.py` | `ParasitismBadge`, Dashboard |
| 17 | Vendor discovery / recommendation (6 factors) | CORE | `/vendors/discover` | `Network` → Suggested |
| 18 | Connections graph | SUPPORT | `/vendors/graph` | Dashboard "strongest links" |
| 19 | Vendor performance (SRM-lite, fulfilment %) | SUPPORT | `/vendors/{h}/performance` | `ReliabilityChip` |
| 20 | **Patrons & Vendor Lists** (tiers, registration, approval) | ADJACENT | `routes/vendor_lists.py` | `pages/lists/VendorLists` |
| 21 | Vendor-list reviews (1–5, distribution, helpful) | SUPPORT | `routes/reviews.py` | `ReviewPanel` |
| 22 | **Vendor Groups** (6 types, roles, auto chat room) | ADJACENT | `routes/groups.py` | `pages/groups/Groups` |
| 23 | **Collective sourcing** (pledge → quota → order) | ADJACENT | `routes/collective.py` | `CollectivePanel` |
| 24 | **Daily Flash Locks** (zones, MOQ clusters, windows) | ADJACENT | `routes/market_locks.py` | `pages/locks/MarketLocks` |
| 25 | Vendor Tools (8 categories, listing + browse) | ADJACENT | `routes/tools.py` | `pages/tools/ToolsPage` |
| 26 | Bookings & availability calendar | ADJACENT | `routes/bookings.py` | `BookingPanel` |
| 27 | Couriers & shipments (tracking, rating) | ADJACENT | `routes/tools.py` | `ShipmentPanel` |
| 28 | Courier route optimisation (NN + 2-opt) | ADJACENT | `routes/route_planner.py` | `RoutePlanner` |
| 29 | Events (capacity, fee, check-in, analytics) | ADJACENT | `routes/events.py` | `pages/events/EventsPage` |
| 30 | Notifications (bell, 30 s poll, deep links) | CORE | `routes/notifications.py` | `NotificationBell` |
| 31 | POS Bridge (square/shopify pull, csv/manual push) | SUPPORT | `routes/pos_bridge.py` | `pages/pos/POSBridge` |
| 32 | **Trade analytics** (trend, counterparties, price position) | SUPPORT | `routes/analytics.py` | `pages/analytics/Analytics` |
| 33 | Marketplace map (viewport clusters, lazy detail) | SUPPORT | `routes/map.py` | `pages/map/MapPage` |
| 34 | Nearby / public places directory | SUPPORT | `routes/nearby.py`, `geo.py` | `NearbyPage`, `PlaceProfile` |
| 35 | Markets catalogue (25 real markets, join) | SUPPORT | `routes/markets.py` | `MarketsPage`, `MarketDetail` |
| 36 | News / surface feed | SUPPORT | `routes/news.py`, `surface.py` | `News`, `SurfaceFeed` |
| 37 | Search hub (tabs) | SUPPORT | `routes/surface.py` | `SearchHub` |
| 38 | Squad / Hustle league (XP, tiers, call-ups) | ADJACENT | `routes/squad.py` | `SquadPage` |
| 39 | Governance ("Our Network", proposals, ballots) | ADJACENT | `routes/governance.py` | `OurNetwork` |
| 40 | Payments / custody / chamas / halal finance | ADJACENT | `routes/payments.py`, `chamas.py`, `murabaha.py` | partial |
| 41 | Ops console + metrics | INFRA | `routes/ops.py`, `middleware/metrics.py` | `pages/ops/Ops` |
| 42 | Files / uploads (local or S3) | INFRA | `routes/files.py` | `FileUpload` |

---

## 4. Screen inventory (as-built)

| route | screen | role in the loop |
|---|---|---|
| `/auth` | register / login | entry |
| `/` | **HomeHub** — 10-tile shelf of doors | hub |
| `/nearby`, `/nearby/:group`, `/place/:id` | around-you directory | discovery |
| `/map` | Leaflet marketplace map | discovery |
| `/markets`, `/markets/:id` | market catalogue + detail | discovery |
| `/search`, `/search/:tab` | search hub | discovery |
| `/news`, `/news/:kind`, `/feed` | news / surfaces | engagement |
| `/network` | suppliers: connections · suggested · graph | **loop step 2** |
| `/stock` (tabs: mine · network · movements) | **Stock Room** | **loop steps 1, 2, 4** |
| `/chat` | rooms + deal rooms | **loop step 3** |
| `/brief` | Dashboard (vendor workspace) | overview |
| `/analytics` | trade analytics | reflection |
| `/lists` | vendor lists (browse/mine) | adjacent |
| `/groups` | groups + collective sourcing | adjacent |
| `/locks` | daily flash locks | adjacent |
| `/tools` | rentals, couriers, shipments, routes, bookings | adjacent |
| `/events` | events browse/mine/analytics | adjacent |
| `/tasks`, `/tasks/:track` | tasks portal → squad / brief | adjacent |
| `/governance` | Our Network | adjacent |
| `/pos` | POS Bridge | support |
| `/ops` | ops console | infra |
| `/@:handle` | vendor profile / shop front | **identity** |

**27 page components, 7,770 lines of page code, plus 6,352 lines of components.**

---

## 5. Navigation map (as-built)

```
Desktop sidebar (20 items in 2 groups)
├── Home · Around you · Search · Map · News · Suppliers · Stock · Rentals
│   Markets · Groups · Events · Surfaces · Tasks
└── "Brief · your workspace": Brief · Chat · Vendor Lists · Market Locks
    Analytics · POS Bridge · Our Network

Mobile bottom bar (4): Home · News · Stock · More (opens the full sidebar drawer)

Top bar: menu · live clock · movements shortcut (sourcing role only) · bell · avatar
```

**Diagnosis.** Twenty equal-weight destinations with no hierarchy; the mobile bar exposes 3 of them and hides 17 behind "More". The *core loop* (browse → source → movement → message) is spread across `/network`, `/stock?tab=network`, `/stock?tab=movements` and `/chat` with no direct path between them. The sidebar's own UI report (`docs/UI-UX-REPORT.md` §2.1, §2.2) already flags the naming collision (App / Brief / Squad / Tasks) and the undifferentiated tile wall.

---

## 6. Data / entity relationships

```
Vendor ──1:N── StockItem ──1:N── StockMovement ──N:1── Vendor (counterparty)
  │                 │                   │
  │                 │                   └── Shipment ──N:1── Courier(VendorTool)
  │                 │                                   └── RouteStop ─ CourierRoute
  │                 ├── quality_status, batch, origin, expiry, spec_sheet
  │                 └── POSConnection (source = pos_sync)
  │
  ├── VendorProfile (goods, interests, regions, bulk, credit)
  ├── VendorConnection (N:N, created by a received movement)
  ├── VendorPerformance (fulfilment rate, reliability, movements completed)
  ├── ParasitismScore (per vendor) + PairScore (per edge)
  ├── Patron (tier) ──1:N── VendorList ──N:N── VendorListMember
  │                                  └──1:N── ListReview
  ├── VendorGroup ──N:N── GroupMember
  │        └──1:N── CollectiveRequest ──1:N── CollectivePledge
  ├── ChatRoom (group|list|deal|direct|niche) ──1:N── Message
  │        └── Message.type ∈ {text, stock_share, deal_proposal, voice}
  ├── VendorTool ──1:N── Booking
  ├── Event ──1:N── EventRegistration (check-in)
  ├── Notification
  ├── MarketZone ─ ZoneSelection ─ LockWindow ─ Pick ─ Cluster ─ Quote
  └── Market / PublicPlace (open data, claimable)
```

**Invariants that the UI must never break**

1. `quantity_available = quantity_in_stock − quantity_reserved`. Never display a raw in-stock number as if it were sourceable.
2. A **movement is forward-only** except for `cancel`; status transitions are role-gated (supplier confirms/ships, buyer receives).
3. **Scores are earned, never entered.** No UI may let a vendor type a reputation number.
4. **Network stock never includes your own items.**
5. A price is always **the vendor's stated price with a timestamp** — never a computed "market price".
6. Zero renders as `—`, never as a padded or invented number.

---

## 7. Important states and edge cases

| surface | states that already exist and must survive |
|---|---|
| Stock item | out of stock · low (≤2× min order) · reserved portion · hidden from network · POS-live · expired · unverified → self-declared → patron-verified → lab-certified |
| Movement | pending (held) · confirmed · shipped · received · cancelled · **actionable-by-me** (the flag that drives the badge) · hold expired |
| Deal | proposed · countered · accepted · declined · superseded round |
| Vendor | sourcing · selling · both · dormant · verified · patron (4 tiers) · POS connected · new-to-network (no fulfilment data yet) |
| Collective | gathering · quota_met · negotiating · ordered · fulfilled · cancelled |
| Lock cluster | below MOQ · qualified (≥ ceil(MOQ×0.85)) · rolled once · dissolved |
| List/Group membership | pending · approved · rejected · capacity full · criteria unmet |
| Event | upcoming · full · checked-in · past |
| Shipment | picked_up · in_transit · out_for_delivery · delivered · failed · rated |
| Map | clustered (zoom ≤ threshold) · pinned (≤300) · empty viewport · stale tile config |
| Auth | token expired → silent refresh → hard logout · 5-strike lockout · rate limited (429) |
| Data honesty | "no data yet" · "not located yet" · "stale" · "data checked 3d ago" |

---

## 8. Features to preserve (unchanged mechanics)

These are load-bearing. The modernization may change *how they are reached and rendered*, never *what they do*.

1. **The movement state machine** and its role gating.
2. **Reservation-on-request** with expiring holds.
3. **The parasitism / network score formula** (40/30/20/10) and its recomputation triggers.
4. **Fluid role switching** (sourcing / selling / both / dormant) as a one-click act.
5. **Network stock excludes your own shelf.**
6. **Compare alternatives** (same category, cheapest first, with reliability).
7. **Structured deal proposals** with accept / counter / decline.
8. **The quality ladder** and patron vouching.
9. **Collective sourcing pledge → quota → order** progression.
10. **Flash Lock windows and MOQ cluster maths.**
11. **Notification fan-out on every consequential action**, with deep links.
12. **POS sync idempotency and the sync log.**
13. **The honesty rules** in §6 — these *are* the brand.

---

## 9. Features to modernize (same behaviour, new experience)

| # | what | why | new form |
|---|---|---|---|
| M1 | **Navigation** — 20 flat sidebar items, 3 mobile tabs | no hierarchy; the core loop is scattered | Fiverr-style marketplace header: logo · **scoped search** · Browse · Orders · Inbox · bell · avatar menu; category rail underneath; 5-tab mobile bar (Home · Browse · Orders · Inbox · Me) |
| M2 | **Network stock as a tab** inside Stock Room | the single most important discovery surface is buried two clicks deep behind a tab | promote to a first-class **`/browse`** destination with sticky filters, sort, result count, and a sharable URL |
| M3 | **Sourcing in a modal from a card** | the highest-intent action in the product has no page, no deep link, no detail, no trust content | a real **listing page `/listing/:id`** — gallery, provenance, vendor trust panel, sticky order panel with a quantity stepper and live total, alternatives, "message vendor" |
| M4 | **Movements inside a third tab** | orders are a destination in every marketplace | **`/orders`** with pipeline grouping, "needs your action" first, and the same state-machine actions |
| M5 | **Vendor profile** | reads as a settings page, not a shop front | seller-page layout: cover, level badge, trust stats, shelf grid, reviews, sticky contact card |
| M6 | **Home hub** — 10 equal tiles | a wall, not a shelf (already flagged in the UI report) | marketplace home: search hero → category rail (same 10 doors, now with counts) → "needs your action" → personalised shelves |
| M7 | **Dark-only glass theme, 10 px meta text** | 2021 aesthetic; below the reading floor for the actual audience | light-first token system with a real dark mode, 12 px meta floor, WCAG-AA contrast |
| M8 | **Borderless "lines are dead" surfaces** | separation relies on shadow alone; fails in daylight and for low-vision users | hairline borders + elevation, both token-driven |
| M9 | **Loading = one centred spinner** | every page flashes a blank frame | **skeletons** shaped like the content |
| M10 | **Onboarding** | good concept, dense execution | progressive 3-step with a visible progress rail and skip |
| M11 | **Role switcher buried in the sidebar footer** | it is the product's signature mechanic | promoted into the avatar menu + header, phrased as Fiverr's buyer/seller mode switch |
| M12 | **Trust signals scattered** (fulfilment %, patron crown, quality badge, parasitism index) | the data exists but never adds up to a judgement | one **TrustBar** component used on every card, listing and profile |

---

## 10. Features that appear obsolete / over-weighted

Nothing is deleted. These are **de-emphasised in navigation** while remaining fully reachable, because they are not in the primary loop:

| feature | finding | treatment |
|---|---|---|
| `/feed` "Surfaces" | overlaps `/news` almost entirely; two names for one idea | keep the route; remove from primary nav, reachable from News |
| `/squad` league | a separate game loop with its own vocabulary (XP, divisions, call-ups) that does not touch stock or movements | keep under `/tasks`; out of primary nav |
| `/ops` console | an internal tool shipped in the user sidebar | move behind the avatar menu, gated on an ops-capable account |
| Live clock in the top bar | decorative; occupies the most valuable pixel row in the app | replaced by the marketplace search |
| DSEG7 "seven-segment" digital font + glow | strong theme, but it costs a webfont, hurts legibility at small sizes, and reads as novelty rather than premium | retained as an opt-in `<DigitalNumber>` for *hero* figures only; default numerals become tabular Inter |
| `text-2xs` (10 px) as the default meta size | below the comfortable floor for the target reader | token redefined to 12 px (the UI report's own recommendation, §2.3) |
| Four product names (App / Brief / Squad / Tasks) | documented confusion | one product name in the chrome; "Brief" becomes the *workspace* section label only |

---

## 11. Opportunities for a better modern UX

1. **Make the listing page the centre of gravity.** Every marketplace that works has a canonical, linkable, shareable item page. Brief_ has the data (price, unit, MOQ, provenance, vendor reliability, alternatives) and no page to put it on.
2. **Collapse "source" and "negotiate" into one decision surface.** Today they are two separate affordances on a card; on a listing page they are the primary and secondary button of the same order panel.
3. **Lead with "what needs you".** Actionable movements, deal proposals awaiting reply, and closing collectives are the reason to open the app. They belong above the fold on home.
4. **Search deserves scope.** One field, one scope selector (Stock · Vendors · Markets · Tools) → the existing endpoints already back all four.
5. **Trust as a first-class visual object.** Fulfilment %, movements completed, patron tier, quality ladder and "new to the network" are already computed; rendering them as one consistent badge set is free credibility.
6. **Skeletons + optimistic feedback.** The state machine is fast; the UI should feel fast.
7. **Mobile-first order actions.** Confirm / ship / receive are thumb actions done in a market, often one-handed — they need 44 px targets and a sticky action bar, not 12 px ghost buttons.
8. **Accessibility is currently incidental.** Transparent borders, 10 px text, colour-only status, no skip link, no reduced-motion handling. All cheap to fix at the token layer.

---

## 12. Modern market positioning

> **What problem does it solve?** Traders who already buy from each other have no shared, trustworthy record of *who has what, at what price, right now, and whether they actually deliver.* Stock information lives in WhatsApp threads and memory.

> **Who is the modern target user?** A business owner with a phone, a shelf, and 5–50 trading relationships: market vendors, kiosks, small wholesalers, restaurant and hotel suppliers, and the couriers between them. They are already online; they are not already on a B2B platform.

> **Why choose it today?** Because it is the only place where a supplier's *fulfilment record* is computed from completed movements rather than claimed, and where a price is always attributed and timestamped. It is a trade network with receipts.

> **The "aha" moment.** The first time you compare alternatives for something you buy weekly and see a cheaper supplier with a *better* fulfilment rate — and source it in two taps.

> **Why the loop is compelling.** Every completed movement improves your standing, which improves your discovery, which brings the next movement. Reputation compounds and is visible.

**Positioning line:** *The trade network with receipts — source from vendors whose record you can see.*

---

## 13. Proposed new application structure

### 13.1 Information architecture

```
PRIMARY (the loop)                    SECONDARY (in the avatar / more menu)
┌──────────────────────────────┐      ┌────────────────────────────────┐
│ Home      /                  │      │ Vendor Lists   /lists          │
│ Browse    /browse            │      │ Groups         /groups         │
│   → Listing /listing/:id     │      │ Collectives    (in Groups)     │
│ Orders    /orders            │      │ Flash Locks    /locks          │
│ Inbox     /chat              │      │ Rentals        /tools          │
│ Shelf     /stock             │      │ Events         /events         │
│ Profile   /@handle           │      │ Markets        /markets        │
└──────────────────────────────┘      │ Around you     /nearby         │
                                      │ Map            /map            │
DISCOVERY RAIL (home + header)        │ News           /news           │
  Around you · Map · News ·           │ Tasks          /tasks          │
  Suppliers · Stock · Rentals ·       │ Analytics      /analytics      │
  Markets · Groups · Events · Tasks   │ POS Bridge     /pos            │
  (all 10 original doors preserved)   │ Our Network    /governance     │
                                      │ Ops            /ops            │
                                      └────────────────────────────────┘
```

Every existing route keeps working. Nothing is removed; the change is **weighting**.

### 13.2 Layer separation

```
┌─ Layer 5  polish: skeletons, empty/error states, motion, a11y, copy
├─ Layer 4  journeys: Home · Browse · Listing · Orders · Shop front · Inbox
├─ Layer 3  design system: tokens.css (light/dark CSS vars) → tailwind →
│           primitives (Button, Card, Badge, Field, Tabs, Skeleton, Rating,
│           TrustBar, Stepper, EmptyState, Toast)
├─ Layer 2  product logic: stores/* + lib/api.js   ← UNCHANGED
└─ Layer 1  mechanics: FastAPI routes + services   ← UNCHANGED
```

Layers 1 and 2 are already cleanly separated in this codebase (zustand stores and a single axios surface). **That is why the presentation layer can be replaced without touching a single business rule** — the modernization is additive at Layer 3–5.

### 13.3 Fiverr → Brief_ pattern map (presentation only)

| Fiverr pattern | Brief_ equivalent | existing mechanic reused |
|---|---|---|
| Scoped marketplace search in the header | search over stock / vendors / markets / tools | `stockAPI.network`, `vendorAPI.network`, surface search |
| Category rail under the header | the 10 home doors + stock categories | `stockAPI.categories` |
| Gig card grid | stock listing cards | `stockAPI.network` |
| Gig page (gallery, packages, seller card, FAQ, reviews) | **listing page** (provenance, order panel, vendor trust, alternatives) | `stockAPI.get`, `alternatives`, `source`, `openDeal` |
| "Continue" order flow | source request → movement | `stockAPI.source` |
| Custom offer in inbox | deal proposal in a deal room | `chatAPI` deal proposal |
| Orders dashboard | movements | `stockAPI.movements`, `advance` |
| Seller levels (New → Level 1/2 → Top Rated) | patron tiers + fulfilment bands | `vendor.is_patron`, `patron_tier`, `fulfillment_rate` |
| Buyer/Seller mode switch | fluid role switch | `vendorAPI.switchRole` |
| Seller profile page | shop front `/@handle` | `vendorAPI.byHandle` |
| Reviews with distribution | vendor-list reviews + performance | `reviewsAPI` |
| Saved / favourites | connections | `vendorAPI.connect` |

### 13.4 Design system in one screen

| token | light | dark | note |
|---|---|---|---|
| `surface-0` | `#FFFFFF` | `#0B0D10` | page |
| `surface-1` | `#F7F8F9` | `#13161B` | raised |
| `surface-2` | `#EFF1F3` | `#191D24` | sunken / hover |
| `surface-3` | `#E4E7EA` | `#222730` | strong |
| `ink-1…4` | `#0F1419` → `#6B7280` | `#F7F8FA` → `#767D8C` | 4-step text scale |
| `edge-1…3` | real hairlines, `#E4E7EA` → `#C9CFD6` | `#232830` → `#39414D` | borders are back |
| `brand-500` | `#16A46A` | same | trade green — go, confirm, source |
| `accent-500` | `#F59E0B` | same | the heritage amber: money, markets, stated prices |
| type | Inter var; 12 px meta floor; tabular numerals for all figures | | |
| radius | 8 / 12 / 16 / 24 | | |
| elevation | 3 steps, token-driven | | |
| motion | 120 / 180 / 240 ms, `cubic-bezier(.2,.8,.2,1)`, all disabled under `prefers-reduced-motion` | | |

### 13.5 Build order

1. **Tokens + tailwind** → the whole app re-skins at once (because every page already uses `surface-*`, `ink-*`, `edge-*`, `brand-*`).
2. **Primitives** → Button, Card, Badge, Field, Tabs, EmptyState, Skeleton, Avatar, Stat, Rating, TrustBar, Stepper.
3. **Chrome** → marketplace header, category rail, 5-tab mobile bar, avatar menu, command-k search.
4. **Journeys** → Home → Browse → Listing → Orders → Shop front.
5. **Polish** → skeletons everywhere, error boundary, a11y pass, reduced motion, copy.

### 13.6 Explicit change log (what changes, why, what it replaces, what is preserved)

| change | why | replaces | underlying behaviour |
|---|---|---|---|
| `/browse` becomes a destination | the core discovery surface was a tab | `/stock?tab=network` | **preserved** — same `stockAPI.network` call, same filters; the old URL redirects |
| `/listing/:id` is new | the highest-intent action had no page | the `SourceDialog` modal opened from a card | **preserved** — the modal still exists and is still used from cards; the page calls the identical `source` endpoint |
| `/orders` becomes a destination | orders are a marketplace primitive | `/stock?tab=movements` | **preserved** — same `MovementRow` actions and state machine; the old URL redirects |
| Header search replaces the live clock | the clock was decoration in prime real estate | top-bar clock | no behaviour lost |
| Light-first theme with dark mode | daylight legibility, modern market expectation | dark-only | all colour decisions are tokens; dark mode is one class |
| 10 px meta → 12 px | below the reading floor for the audience | `text-2xs` = 10 px | typography only |
| Borders return | separation by shadow alone fails in daylight and in high-contrast mode | `edge-*: transparent` | layout unchanged — widths were already reserved |
| Sidebar 20 items → 6 primary + grouped menu | no hierarchy | flat list | **every route preserved and reachable** |
| Digital/seven-segment numerals become opt-in | legibility and weight | app-wide `DigitalNumber` | component retained for hero figures |

---

## 14. What must be true when this is done

- [ ] Every pre-existing route still resolves (old URLs redirect, nothing 404s).
- [ ] The 77 existing frontend specs still pass — they encode the mechanics.
- [ ] No business rule, endpoint, store action or state machine was edited.
- [ ] The core loop is reachable in ≤2 taps from home on a phone.
- [ ] Every list has a loading skeleton, an empty state and an error state.
- [ ] Contrast ≥ 4.5:1 for body text in both themes; visible focus on every control.
- [ ] `prefers-reduced-motion` disables all non-essential animation.
