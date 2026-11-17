# 0069 — Live Corridor Price Index

Status: **shipped on `arena/a25a9f65-brief`, tested, not deployed.**
This is the current batch. The 2-Hop “Who Knows You” graph stays next.

---

## 1. What it does

Turns confirmed local transactions into a **45-day interquartile price range**
per `(corridor, town, category)` and exposes it in two places:

1. **`+ Create`** — a debounced price hint (`CorridorPriceHint`) under the
   details section: “Kisumu • Nyanza • Health & Nursing · KSh 450 – 650
   (18 local trades)”, with a one-tap **Use median** button.
2. **`Regions`** — a **Fair Corridor Price** pill on priced cards whose asking
   price is at or below `median × 1.05`.

The engine is allowed to answer “I don’t know.” Below five independent points
it writes no row, returns `{ available: false }`, renders no hint and no badge.

---

## 2. Schema

`corridor_price_indices` (`0069_corridor_price_index`):

| column | notes |
|---|---|
| `region_slug` | corridor slug (`nyanza`, `nairobi-metro`) |
| `town` | normalised town (`kisumu`) or `ALL` |
| `category_slug` | one shared vocabulary (below) |
| `sample_count` | ≥ 5 enforced by both code and a check constraint |
| `p25_kes`, `median_kes`, `p75_kes` | `NUMERIC(10,2)` from `percentile_cont` |
| `computed_at` | UTC |

`UNIQUE (region_slug, town, category_slug)` plus a lookup index.
The table is a derived snapshot: a refresh deletes and rebuilds it in one
transaction, so readers see the previous snapshot until the new one commits.

---

## 3. Eligible sources and exclusions

**Included (45-day window)**
- `TradeProof` rows with `status='confirmed'`, positive amount, seller known.
- `ActivityBooking` rows completed by both sides with an agreed price.
- `EventRegistration` rows with `booking_status='CONFIRMED'` and a paid amount.
- `Receipt` rows (`verified | partial`) not already represented by a trade
  proof, with a merchant name that maps to a category.

**Excluded**
- pending, disputed, unmatched, cancelled, zero-price and self-trades;
- pairs that only ever trade with each other (exclusive 1-to-1);
- more than one point per buyer/seller/day (trade), per organiser/participant/day
  (booking), or per receipt buyer/day (receipt);
- self-bookings, an organiser registering their own event, and a shop owner
  scanning their own till;
- points outside 45 days or above KES 10,000,000.

**Category vocabulary** (deterministic keyword mapping, shared by merchant names
and activity text): `groceries`, `health`, `repairs`, `events`, `transport`,
`construction`, `beauty`, `education`, `household`. An unmatched category
produces no point, not an “other” bucket.

**Location** uses the existing corridor map: `Kondele, Kisumu` → `(nyanza,
kondele)`; a corridor-only value produces an `ALL` point. Unknown places are
left out rather than guessed.

---

## 4. Refresh

- Hourly loop (`PRICE_INDEX_REFRESH_INTERVAL`, default 3600) in both
  `app.main` (single-container) and `app.worker` (multi-instance).
- Best-effort refresh after a trade confirmation, so a fresh trade is visible
  without waiting an hour. A failure there is logged and never fails the trade.
- `refresh_indices(db)` is the single entry point and the only writer.

---

## 5. API

`GET /api/corridors/{region_slug}/price-hint?category=...&town=...` — public GET.

- Town is tried first, then `ALL` for the corridor.
- 200 with `available: false` and a reason when the sample is too small or the
  category is unrecognised.
- 200 with `scope_label`, `sample_count`, `p25_kes`, `median_kes`, `p75_kes`,
  `fair_price_ceiling_kes`, `window_days` and `signal_note` when available.
- No seller identity, buyer identity or receipt text is ever returned.

**Privacy boundary:** `/api/corridors/` was added to the middleware’s
`PUBLIC_READ_PREFIXES` (GET only). The hint must work on a Create screen
before a slow connection finishes signing in; only aggregates leave the server.

---

## 6. UI

### Create
- `components/prices/CorridorPriceHint.jsx` — range, sample count, median
  button, live qualification line (green = qualifies, amber = above P75,
  neutral = within range), honest footnote.
- Debounced 300 ms on `(category, town)`; no request without a recognised
  corridor. Applying the median writes a plain string into `draft.price_kes`.

### Regions
- `RegionsGrid` renders the **Fair Corridor Price** pill under the price line
  with a title naming the scope and median.
- The badge is computed at read time in `build_feed` from the snapshot; it is
  not stored on the listing and disappears if the index is rebuilt without it.

---

## 7. Tests

- `backend/tests/test_price_index.py` — **4 passed**:
  - five confirmed trades → p25 450 / median 500 / P75 600, corridor fallback,
    ceiling 525, honest signal note;
  - four points stay silent; a fifth creates a town row; a neighbouring town
    falls back to `ALL`;
  - pending and >45-day trades ignored; an unlinked receipt counts; an
    exclusive pair never becomes a market;
  - a completed booking is a point; badge ceiling is `median × 1.05`; unknown
    category/place produce no badge.
- `backend/tests/test_migrations.py` — **3 passed** (fresh `alembic upgrade head`).
- Existing receipt/trade suites — **13 passed** with the on-confirmation refresh.
- `frontend/src/test/corridorPriceHint.test.jsx` — **6 passed** (silence,
  range, median button, qualification states, honesty copy, badge presence).
- Full backend suite with the new module: **985 passed, 1 failed, 1 skipped**.
  The failure is the same pre-existing `tests/test_smoke.py::test_full_loop`
  (events browse), reproduced on base `2da3c18`.
- Full frontend suite: **670 passed, 4 failed** — the same four pre-existing
  environment/mock failures (`outside.test` datetime string and three
  `pages.test` portfolio cases), all reproduced on base.
- `npm run build` — success.

---

## 8. Edge cases worth a second pair of eyes

1. **Small samples** — the constraint and code both refuse < 5. A stale row is
   deleted on the next refresh rather than left as a zombie benchmark.
2. **Concurrent refresh** — the whole snapshot is rebuilt in one transaction;
   `ON CONFLICT` covers two schedulers racing.
3. **Trade confirmation latency** — the refresh is best-effort and wrapped; a
   percentile failure cannot roll back a confirmed trade.
4. **Collusion** — exclusive 1-to-1 pairs are excluded across all history;
   pair-day dedupe blocks a pair from manufacturing five points in an hour.
5. **One shopper, many receipts** — receipt points are deduped per buyer/day.
6. **Category drift** — “hardware repair” classifies as `repairs`;
   unrecognised names never become `other`.
7. **Fallback honesty** — a Kisii hint backed by Nyanza-wide data says
   `town: ALL` and labels the scope as the corridor, not Kisii.
8. **Location text** — “Kondele, Kisumu” is a town-level point; an unknown
   place contributes nothing.
9. **Public endpoint** — GET only; no writes, no identities.
10. **Missing index** — the Create card is absent; no “typical price” filler.

### Known limitations
- No device/IP fingerprint exists in this codebase, so the spec’s “matching
  daily subnet hash” is implemented as pair-day dedupe. Inventing a subnet
  signal would be dishonest.
- Event bookings are captured by the hourly sweep; only trade confirmations
  trigger the immediate refresh.
- Receipt categories are inferred from the merchant name because receipts do
  not store line-item categories.
- There is no SQL `verified_corridor_price_points_45d` view. The same union is
  built in `collect_points()` so one Python location/category vocabulary serves
  both the index and the read-time badge; a view would duplicate that mapping in
  SQL and drift.

---

## 9. Deploy checklist

1. `alembic upgrade head` → `0069_corridor_price_index`.
2. Leave one scheduler owner active (in-process loop or worker) to avoid two
   refreshes per hour; they are safe but redundant.
3. First boot with an empty index: hints and badges stay hidden until five
   confirmed local points exist. That is expected, not a bug.
4. Confirm the public `/api/corridors/` prefix is not intercepted by an edge
   auth rule; the app middleware already permits GET.
5. No new environment variables are required. `PRICE_INDEX_REFRESH_INTERVAL`
   is optional.
