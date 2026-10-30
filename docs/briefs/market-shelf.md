# The Market Shelf — business plan and developer specification

> **Status:** shipped in `30b1bdd` (PR #65). Backend `app/services/market_activity.py`,
> `routes/markets.py`; frontend `components/markets/*`, `pages/markets/*`, Home hub.
> **No database migration.** The shelf is a query, not a table.
> **Tests:** 17 backend (`tests/test_market_activity.py`), 17 frontend
> (`src/test/marketShelf.test.jsx`). Full suites: backend **466 passed**, frontend **337 passed**.
>
> This document is deliberately two documents in one file. **Part 1** is for the
> person who runs the business and does not need to read code. **Part 2** is for
> the person who maintains it and does not need to read a strategy memo.

---

# PART 1 — For the business manager

## 1. What was wrong

Markets existed in the product as a **directory of empty rooms**. Three failures,
all of them visible to a trader on the first screen:

| What the screen said | What it actually meant |
|---|---|
| "0 registered vendors" on every card | We were ranking markets by a number that starts at zero and stays there unless somebody registers — so the busiest physical market in Kisumu could sit below a dead one. |
| A **Scan** button, then a radius menu starting at **150 km** | We asked the user to work out that we had nothing to show them, and then offered a region when they meant a matatu ride. |
| "Register here" with no reason | We asked a trader to sign up and get nothing back, in a market that had nothing on it. |

The underlying mistake was treating a market as **a place to register**. A market
is a **relationship between a physical market and the vendors who actually sell
in it**. Registration is a form. Trading is the business.

## 2. What a market is now

**A market is a shelf that belongs to the vendors trading in it, assembled from
their own shops.** Nothing is uploaded to the market. A trader publishes a
product **once**, on their own shelf, and it appears:

- on their own shop,
- on the shelf of every market they trade in,
- in category search,
- in their groups.

**One product, one price, one place to edit it.** If a trader leaves a market,
their products leave with them — not because we delete anything, but because
they were never stored there.

**Membership and visibility stay separate.** Trading in Kibuye does not mean
every product you own is shown in Kibuye. `visible_to_network` still decides
that per product, exactly as before. We did not collapse two different promises
into one checkbox.

**Markets are not Groups and not Vendor Lists.** Groups are people organising
together. Vendor Lists are a directory you keep. A Market is a physical place
with a shelf. Keeping these three apart is what stops each one from becoming a
worse copy of the others.

## 3. The five changes, and what each is worth

| # | Change | What it is worth |
|---|---|---|
| 1 | **Rank by real activity** | A market with 100 sign-ups and an empty shelf sits below a market where twenty traders have stock today. The ranking now answers "where can I buy something this afternoon", which is the only question a buyer has. |
| 2 | **25 km by default (was 150)** | The default is now a walk, a matatu or a boda ride. 150 km is a region, and nobody shops in a region. |
| 3 | **No Scan button** | The shelf loads with the page. We no longer ask the user to prove they want to see something before we show it. |
| 4 | **Cards show activity, categories, listings** | The card says "8 traders selling · 34 listings · fresh produce, grains" instead of a count of forms filled in years ago. |
| 5 | **Join/Claim states its reason** | "Join this market" says *"puts your shelf on this market's shelf, in front of buyers standing here."* An unclaimed market says **Claim** and says why: *"joining makes you the first trader here."* |

## 4. The rule that keeps this from becoming a graveyard

> **Never let the Market Shelf become a graveyard of empty markets.**

An empty market is not shown as a row of zeroes. It is shown as **an
invitation**, written by the server so every screen phrases it identically:

- *"No trader has claimed Kibuye yet. If you trade here, be the first — your
  shelf is the market's shelf from the day you join."*
- If traders have registered but published nothing: *"…has traders registered but
  nothing on its shelf yet. Publish your stock here and you will be the first
  thing buyers see."*

The frontend cannot invent its own friendly sentence for a dead market, and it
cannot promote an empty market as an active one — `empty` and `invitation` come
from the same response as the numbers.

**And the shelf never lies to the vendor either.** A trader who has just
published two items would otherwise open the market, see an empty shelf (we hide
your own stock so you are not sold your own goods) and conclude the publish
failed. The response therefore counts your own items separately and the screen
says: *"Your 2 items are on this market's shelf. You are not shown your own
stock, so nobody else's has landed yet."*

## 5. How a market fills itself

There is no seeding work, no CSV of vendors, no "market manager" role:

1. A trader already has a Brief shelf.
2. They open the market near them — it is already on Home, loaded, at 25 km.
3. They press **Join this market**.
4. Their published products appear on that market's shelf immediately. No second
   upload, no approval queue, no duplicate listing to maintain.
5. A buyer standing in that market opens the market page and sees real stock,
   four doors (Goods, People, Services, Equipment) and the trading vendors' names.

## 6. What this deliberately does **not** do

- **It does not create demand.** It makes supply visible. A market with no
  buyers is still a market with no buyers; this change removes our own
  self-inflicted reason for that (nobody could see what was there).
- **It does not copy catalogues.** There is no market-level price to diverge
  from the vendor's price, because there is no market-level price.
- **It does not require membership to browse.** Membership is what puts *your*
  shelf on the market. Buying, browsing and comparing need nothing.
- **It does not pay anyone.** No custody, no escrow, no payout logic is touched.
- **It does not touch Groups, Vendor Lists, Market Locks or Market Runs.** They
  keep working exactly as they did.

## 7. How we will know it worked

Measured per market, not per app:

| Metric | Target shape |
|---|---|
| Markets with ≥ 1 active vendor | should rise every month; this is the only growth number that matters at the start |
| **Active vendors ÷ registered vendors** | the honest density of a market. Under ~15% means we are collecting sign-ups, not trade |
| Listings per active vendor | ≥ 3 suggests the shelf is a real shop, not a token listing |
| Market page → Join conversion | tells us whether the stated reason is persuasive |
| Markets opened from Home per session | tells us whether 25 km and auto-load beat the old Scan button |

Read the first two together. A market with 300 registrations and 4 active traders
is worse than a market with 20 and 12, and the ranking now says so out loud.

## 8. Risks and how they are contained

| Risk | Containment |
|---|---|
| Empty markets embarrass the product | The invitation sentence replaces zeroes on cards and shelves; the card never claims activity that is not in the database. |
| A vendor joins 40 markets to farm reach | The shelf is a join, not a copy: joining 40 markets gains a vendor nothing a buyer can see beyond their own stock. Watch active÷registered per market. |
| Two screens disagree about how busy a market is | Ranking, counts and invitation copy all come from one server module. Home, Markets and the market page cannot drift. |
| A dense market drowns a small one | Ranking is activity first, distance second; the radius control lets a user narrow or widen without a map. |
| Vendors expect a market listing to be a marketing placement | Copy on the Join button says exactly what joining does to their shelf. No placement is promised. |

---

# PART 2 — For the developer

## 1. File map

| Path | Role |
|---|---|
| `backend/app/services/market_activity.py` (new) | The whole model: bulk activity aggregation, category rollup, invitation copy, ranking, one-market payload, the shelf query. |
| `backend/app/routes/markets.py` | Adds `GET /around`, `GET /{id}/activity`, `GET /{id}/shelf`. Existing routes unchanged. **Bug fix:** `await db.delete(...)` in leave. |
| `backend/app/routes/squad.py` | **Bug fix:** `await db.delete(m)` + `await db.flush()` before recounting. |
| `frontend/src/lib/api.js` | `marketsAPI.around / activity / shelf`. |
| `frontend/src/components/markets/MarketActivityCard.jsx` (new) | Activity-led card; `data-testid="market-activity-card"`, `data-empty`. |
| `frontend/src/components/markets/MarketsAround.jsx` (new) | Auto-loading Home shelf; rings `[25, 100, 300]`; `testid="markets-around"`. |
| `frontend/src/components/markets/MarketShelf.jsx` (new) | Four-kind shelf; rows carry the vendor; empty → invitation. |
| `frontend/src/pages/markets/MarketDetail.jsx` | Rewritten: stats → four doors → shelf → Join/Claim + reason. |
| `frontend/src/pages/markets/MarketsPage.jsx` | NearMe rebuilt: no Scan, radii `[25, 50, 150, 500]` default 25. |
| `frontend/src/pages/home/HomeHub.jsx` | `<MarketsAround limit={3} />` above the setup checklist. |
| `backend/tests/test_market_activity.py` (new) | 17 tests. |
| `frontend/src/test/marketShelf.test.jsx` (new) | 17 tests. |

## 2. Architecture: the shelf is a view

```
market_members (vendor_id, zone_id)
      │
      ├── stock_items      (visible_to_network, quantity_available > 0)
      └── tool_listings    (is_available, category ∈ SERVICE | EQUIPMENT)
```

Three SQL aggregates per request — never one per market:

1. `count(market_members)` grouped by zone → `registered`
2. `market_members ⋈ stock_items` grouped by (zone, vendor) → active / selling / listings / recent / last-activity
3. `market_members ⋈ tool_listings` grouped by zone, split by taxonomy → `services`, `equipment`

`activity_by_zone()` returns `{zone_id: {...}}` and rows are merged into whatever
the caller is already returning, so a 60-market list costs 3 queries, not 180.

**No migration.** Nothing is denormalised, so nothing can go stale. A vendor
leaving the market removes a `market_members` row and their stock disappears
from that shelf on the next request.

**Taxonomy reuse:** services = `transport, courier, popup_shop, hotel_sourcing,
packaging`; equipment = `equipment, warehouse, cold_storage`. No new categories.

## 3. API contracts

### `GET /api/markets/around`

| Param | Type | Default |
|---|---|---|
| `lat`, `lng` | float, optional | vendor profile location |
| `radius_km` | 0.5–500 | **25** |
| `limit` | 1–50 | 12 |
| `include_empty` | bool | false |

```jsonc
{
  "origin": {"lat": -0.09, "lng": 34.77},
  "radius_km": 25.0,
  "markets": [{
    "id", "name", "city", "country",
    "distance_km": 0.9,          // null when unlocated — never 0
    "located": true,
    "registered": 3, "active_vendors": 2, "selling_vendors": 2,
    "listings": 14, "recent_vendors": 2,
    "services": 1, "equipment": 0,
    "last_activity_at": "2026-10-30T09:12:00",
    "categories": [{"category": "fresh produce", "listings": 9}],
    "empty": false,
    "invitation": null            // a sentence when empty=true
  }],
  "active_count": 1, "inviting_count": 0,
  "wider": [ /* nearest markets outside the radius, same row shape */ ],
  "unlocated": [ /* markets with no coordinates, offered separately */ ],
  "note": null                   // describes the ring, not the next one
}
```

Fallback rule: if nothing inside the radius is **trading** and `include_empty`
is false, the nearest inside markets are returned anyway — labelled empty, with
their invitation. An empty screen is never the answer.

`note` is computed **after** `wider` exists, so it never says "the nearest
markets are below" when `markets` is empty and the nearest are in `wider`.

### `GET /api/markets/{id}/activity`

Same row shape plus:

```jsonc
"explore": [
  {"key": "goods",     "label": "Goods",     "blurb": "Products vendors sell",  "available": true,  "count": 14},
  {"key": "people",    "label": "People",    "blurb": "Find local vendors",     "available": true,  "count": 2},
  {"key": "services",  "label": "Services",  "blurb": "Find service providers", "available": true,  "count": 1},
  {"key": "equipment", "label": "Equipment", "blurb": "Find tools and equipment","available": false, "count": 0}
],
"i_am_member": false,
"empty": false,
"invitation": null,
"welcome": "…"        // patron welcome copy, unchanged
```

A door with `available: false` must render disabled and say **"nothing yet"** —
never open an empty list.

### `GET /api/markets/{id}/shelf?kind=&q=&limit=`

`kind ∈ {goods, people, services, equipment}`, `limit` 1–60 (default 24).

```jsonc
{ "kind": "goods", "market": {"id": "...", "name": "Kibuye"},
  "own": 2,                  // how many of the VIEWER's items are on this shelf (goods only)
  "count": 14,
  "items": [{
    "kind": "goods", "id", "title", "category",
    "price": 180, "price_unit": "crate", "quantity": 40,
    "image": null, "to": "/listing/<stock_id>",
    "by": "Achieng Groceries", "vendor_handle": "achieng",
    "updated_at": "2026-10-30T09:12:00"
  }] }
```

Rules enforced server-side, each with a test:

- `visible_to_network` and `quantity_available > 0` for goods.
- The viewer's own goods are **excluded from `items`** (never sold your own
  stock) and **counted in `own`** (so a vendor can confirm the publish landed).
- `people` rows are member vendors, busiest shelf first, with `note` either
  "N items on their shelf" or "registered, nothing published yet".
- Leaving the market removes the rows from this shelf — asserted by a raw
  `SELECT count(*)` on `market_members`, not by the UI.

## 4. Ranking

```python
inside.sort(key=lambda m: (m["empty"] and not include_empty,   # trading first
                           -active_vendors, -listings,          # busiest first
                           distance_km or 1e9))                 # then nearest
```

`registered` is never in the sort key. It is returned, labelled quietly under the
headline, and never promoted to the headline by any component.

## 5. Frontend contracts

- **`MarketsAround`** calls `marketsAPI.around({radius_km, limit})` on mount. No
  button. Rings `[25, 100, 300]`, one widen button, and it returns `null` (no
  hole in the page) when there is no market anywhere.
- **`MarketActivityCard`** renders activity headline, quiet `registered` line,
  categories, and the four doors with counts. `data-empty` marks invitations.
- **`MarketShelf`** owns the four-kind tab control; empty state uses the server's
  `invitation` unless `own > 0`, in which case it explains the hidden own items.
- **`MarketDetail`** order is fixed: hero → `market-stats` → four doors → shelf →
  Join/Claim + reason. Buttons read **"Join this market"** / **"Claim this
  market"** (empty), never "Register here".

Any test file that mocks `@/lib/api` must include `marketsAPI.around / activity /
shelf`; a missing export makes `MarketsAround` swallow a `TypeError` into its
error state and quietly render nothing.

## 6. The bug worth remembering

`AsyncSession.delete()` is a **coroutine**. `db.delete(obj)` without `await` does
not raise, does not delete, and leaves `session.deleted` empty — the row stays
and the UI looks correct.

- `routes/markets.py`, leave: `await db.delete(member)`
- `routes/squad.py`, leave: `await db.delete(m)` **then** `await db.flush()`
  before counting the remaining members.
- Regression test: `test_leaving_actually_removes_the_row_not_just_the_button`
  counts rows from a raw session. Never assert on `session.deleted` or
  `member in session` — both look healthy while the DELETE never runs.

## 7. Running the work

```bash
cd backend  && pytest -q tests/test_market_activity.py      # 17 passed
cd backend  && pytest -q                                    # 466 passed
cd frontend && npx vitest run                               # 337 passed
cd frontend && npx eslint src/components/markets src/pages/markets
cd frontend && npx vite build
```

Test intent, not just coverage:

| Backend | Pins |
|---|---|
| `test_a_busy_market_outranks_a_registered_but_empty_one` | the ranking rule |
| `test_registered_is_reported_but_never_the_headline` | the label rule |
| `test_leaving_actually_removes_the_row_not_just_the_button` | the `await delete` bug |
| `test_membership_does_not_force_visibility` | membership ≠ visibility |
| `test_the_market_shelf_never_shows_you_your_own_stock` + `…_told_you_have_items` | own-stock hiding and `own` |
| `test_an_empty_market_says_so_in_one_sentence_instead_of_zeroes` | invitation copy |
| `test_each_door_reports_whether_anything_is_behind_it` | doors |
| `test_the_default_radius_is_a_walk_not_a_region` | 25 km default |
| `test_the_note_never_claims_the_nearest_markets_are_below_when_they_are_not` | envelope honesty |

| Frontend | Pins |
|---|---|
| "leads with traders selling now, not with registrations" | headline |
| "loads by itself at a walking radius" / "widens only when the reader asks" | no scan, 25 km |
| "renders nothing at all when there are no markets anywhere" | no empty hole on Home |
| "does not promise a shelf that further-out markets do not have" | truthful widen copy |
| "only offers a door with something behind it" | disabled door |
| "says what joining does for the vendor, not just 'Register'" | reason on Join |
| "tells a vendor their own goods landed, even though it hides them" | `own` |

## 8. Next steps, in order of leverage

1. **Seed supply, not markets.** The 25 catalogued markets are empty on a fresh
   database. The first real deployment should onboard vendors who already sell in
   one or two markets, so the shelf has something to show on day one.
2. **Market-level promotion is unexploited.** Nothing yet lets a patron announce
   a market day or a price at the gate. The `welcome` field exists; a dated
   "happening at this market" row is the natural next addition.
3. **`wider` is a suggestion, not a journey.** Widening steps the radius. A
   future version can offer "Kibuye is 43 km away — 12 traders there" with a
   single tap that switches the map context.
4. **Instrument active÷registered.** One number per market, exposed to the
   operator, decides whether the invitation copy is working.
