# Outside — implementation summary

Branch `arena/064f3268-brief`, base `b247e53`. Everything below was run in this
session against this checkout.

## Verification

| check | command | result |
|---|---|---|
| backend tests | `./.venv/bin/python -m pytest -q` | **274 passed, 0 failed** (1:58) |
| frontend tests | `npx vitest run` | **206 passed, 0 failed** (20 files) |
| production build | `npm run build` | **✓ built in 7.10s**, no errors |
| lint | `npx eslint src` | **31 problems (21 errors, 10 warnings)** — byte-identical to the pre-change baseline; none of the 21 errors is in a file this work touched |
| migration | `alembic upgrade head` from an empty database | applies `0001 → 0021`; `0021_outside_content` is the single head |
| live API | uvicorn on :8000 against a real Postgres | exercised by hand, see below |

**Baseline, for comparison:** backend was 229 passed / 0 failed; frontend was
172 passed / 1 failed. The one frontend failure (`enterprise.test.jsx:83`) was
**not** a stable baseline — I first reported it as pre-existing and fixed, but
it passes in isolation and passed in the final full run. It is order-dependent
flakiness in that spec, unrelated to this work, and it is still unresolved.

Net new tests: **45 backend** (`tests/test_outside.py`) and **34 frontend**
(`src/test/outside.test.jsx` plus the rewritten navigation map).

### What the live API proved

Run against uvicorn on :8000 with migration 0021 applied from zero:

```
POST /api/outside/content  (house party, no price)      → 201  price_required: false
POST /api/outside/content  (request for company)        → 201  price_required: false
POST /api/outside/content  (event, no starts_at)        → 422  missing: ["starts_at"]
GET  /api/outside/location (nothing set)                → 200  source: market_zone, label: Gikomba
PUT  /api/outside/location (typed, no GPS)              → 200  source: manual, share_location: false
GET  /api/outside/feed     (5 km radius)                → 200
      0.6874  post     Near         dist=0.4   reasons=['0.4 km away']
      0.5660  listing  Free pallets dist=None  price=5000
      0.5660  listing  Free pallets dist=None  price=None     ← identical score
      0.5660  post     Walking company
```

That last pair is acceptance criterion 6 and the ranking rule proven on the
live service: two otherwise identical listings, one priced at KSh 5,000 and one
with no price, score **exactly the same**. The 27 km post was correctly
filtered by the radius; the unlocated posts were correctly kept.

## What changed

### Backend — new module `app/modules/outside/` (2,725 lines + 165-line migration)

| file | role |
|---|---|
| `models.py` | Four additive tables: `outside_posts`, `outside_reactions`, `outside_discovery_prefs`, `outside_content_reports` |
| `ranking.py` | Pure, unit-tested scorer. Six weighted signals. **No price term** |
| `feed.py` | Source adapters over eight existing tables → one normalised contract, cursor paging, dedupe |
| `publish.py` | One publishing path, six content types, per-type required fields |
| `shelves.py` | Shelf manifest as configuration |
| `router.py` | 13 endpoints under `/api/outside` |

Registered in `app/main.py:181` and `app/models/__init__.py:48`.

**Nothing existing was copied or shadowed.** Events stay in `events`, listings
in `stock_items`, communities in `vendor_groups`, collections in `vendor_lists`,
opportunities in `business_requests`. `feed.py` reads them at request time.
There is no sync job and no second database.

**No existing column was altered, renamed or dropped.** Migration 0021 is a pure
addition and `downgrade -1` removes exactly what it created.

### Frontend

| change | files |
|---|---|
| Navigation → Home · Explore · Create · Activity · Profile | `config/navigation.js`, `components/layout/MobileTabBar.jsx`, `App.jsx` |
| Unified creation | `pages/create/CreatePage.jsx`, `stores/createStore.js` |
| Explore | `pages/explore/ExplorePage.jsx` |
| Activity | `pages/activity/ActivityPage.jsx` |
| One card for every kind | `components/outside/ContentCard.jsx` |
| Location control | `components/outside/LocationBar.jsx`, `stores/outsideStore.js` |
| Design tokens | `styles/tokens.css`, `tailwind.config.js` |
| Onboarding no longer interrupts | `components/layout/Shell.jsx`, `components/home/LocationPrompt.jsx` |
| Trade value off public identity | `pages/vendor/VendorProfile.jsx`, `pages/analytics/Analytics.jsx` |
| API client | `lib/api.js` |

13 files modified (+473 / −168), 15 new source files.

## Acceptance criteria

| # | criterion | status |
|---|---|---|
| 1 | Presents Outside as location-aware social discovery, not primarily a marketplace | ✅ nav, home feed, Explore all lead with discovery; trade is one content type |
| 2 | Primary navigation clear and consistent across screen sizes | ✅ 5 tabs, mobile bottom bar, desktop areas; pinned by `navigation.test.jsx` |
| 3 | Single creation entry point for all six types | ✅ `/create`, one endpoint, `test_every_content_type_publishes_without_a_price` |
| 4 | Shelf-specific onboarding removed or consolidated | ✅ forced modal removed from Shell; one dismissible location card |
| 5 | Shelves are reusable browsing surfaces | ✅ `shelves.py` manifest; `CuratedShelf` unchanged and still renders them |
| 6 | Non-commercial publishing needs no price | ✅ proven per type and on the live API |
| 7 | Local discovery with geographic relevance and manual location | ✅ `resolve_location` chain, radius filter, typed fallback |
| 8 | Events support privacy, participation, coordination | ✅ public/community/private, `attending` writes a real registration, capacity respected, cancel retires rather than deletes |
| 9 | Cards, spacing, typography, colours, icons follow a design system | ✅ one card component, token scale, semantic colours, one icon family (lucide) |
| 10 | Search across content types with meaningful filters | ✅ `/explore` + `GET /search` with kind / when / price / radius |
| 11 | Existing auth and functionality keep working | ✅ 229 pre-existing backend tests still pass; every v3 URL resolves |
| 12 | Data intact or migrated through a verified plan | ✅ additive migration, verified from zero, no backfill needed |
| 13 | Authorization, privacy, moderation, error handling tested | ✅ private-post, 403, block, self-report, 422 and 404 paths all covered |
| 14 | Builds and principal journeys pass regression | ✅ build clean, 274 + 206 tests green |

## Outstanding limitations

* **Post audiences are coarse.** `visibility: community` resolves to "author
  only" — there is no post-to-community membership model yet. `_authorised_row()`
  states this rather than silently widening access.
* **No notification preferences UI.** `GET /activity` returns a `preferences`
  block with an empty `muted_groups` so the control needs no API change later.
* **Unread chat counts stay client-side.** `chat_room_participants` has no
  read-state column, so `/activity` reports rooms and rooms-active-today rather
  than inventing an unread figure the schema cannot support.
* **Search re-ranks per page.** The cursor is `(created_at, id)` applied before
  ranking: no duplicates across pages, but a page boundary is not a strict
  global rank cut.
* **`enterprise.test.jsx` is flaky** in full-suite runs (passes alone). Pre-existing.
* **Deferred by design:** event payments/ticketing, group messaging (existing
  `/api/chat` is the boundary), and any change to the trade loop, market locks,
  enterprise or POS modules.

## Manual setup

None beyond the existing instructions. The new table is created by the
`alembic upgrade head` that `entrypoint.sh` already runs. No new environment
variable, no new dependency, no new service.

For local development without Docker, `backend/run_dev.py` starts a bundled
PostgreSQL and the API on :8000 — a convenience script, not part of the product.

## Deliverables

* [`00-technical-audit.md`](00-technical-audit.md) — the pre-implementation audit
* [`01-route-map.md`](01-route-map.md) — information architecture, route map, API surface, ranking
* [`03-deprecations.md`](03-deprecations.md) — what was deprecated, what was preserved, and why
