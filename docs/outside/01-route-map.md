# Outside — information architecture and route map

## Primary navigation

| tab | route | what it is |
|---|---|---|
| **Home** | `/` | Personalised discovery feed: location bar, curated shelves, quiet-network fallback |
| **Explore** | `/explore` | One search across every content type, with distance, date and price filters |
| **Create** | `/create` | The single publishing entry point for all six content types |
| **Activity** | `/activity` | Grouped notifications, invitations, replies and waiting counts |
| **Profile** | `/me` | Identity, published content, saved items, settings |

`Create` is the one visually distinct tab (`action: true` in
`frontend/src/config/navigation.js`) — a filled pill in the middle of the
bottom bar, not a floating button.

## Where every v3 destination went

Nothing was deleted. Every route below still resolves in `App.jsx` and still
highlights exactly one tab; the area arrays in `config/navigation.js` decide
which. `src/test/navigation.test.jsx` pins this, including a test that no path
ever highlights two tabs.

| v3 destination | v4 home | rationale |
|---|---|---|
| `/browse` | **Explore** | It was already one results system; Explore adds posts, events, communities and distance |
| `/network`, `/nearby`, `/map`, `/markets`, `/news` | **Explore** | Views of the same results, unchanged |
| `/search/:tab` | **Explore** | One query across types instead of five scopes |
| `/feed` | **Explore** | `surface/feed` remains available as an API |
| `/events`, `/groups`, `/lists` | **Explore** | Discovery surfaces first; the "mine" tabs live inside each |
| `/work`, `/orders`, `/tasks`, `/locks`, `/tools` | **Activity** | Everything waiting on you or on someone else |
| `/chat` | **Activity** | Was its own "Inbox" tab |
| `/stock`, `/analytics`, `/pos`, `/passport`, `/growth`, `/enterprise`, `/governance`, `/ops` | **Profile** | The business workspace, unchanged. (`/portfolio` and `/studio` retired in v2.16 → redirect to `/me`; the showcase moved to the shop front. See `docs/briefs/selected-work.md`.) |
| `/brief`, `/profile`, `/movements`, `/stock/:id` | existing redirects | Untouched |

## New routes added

| route | component | notes |
|---|---|---|
| `/explore` | `pages/explore/ExplorePage.jsx` | Lazy |
| `/create` | `pages/create/CreatePage.jsx` | **Eager** — measured at 14.3 kB raw / 3.9 kB gzip in the main chunk; see the comment in `App.jsx` |
| `/activity` | `pages/activity/ActivityPage.jsx` | Lazy |

Search state lives in the URL (`?q=`, `?kind=`, `?when=`, `?price=`, `?radius=`),
so opening a result and pressing back restores the results rather than
restarting the search.

## New API surface

All under `/api/outside`, registered in `app/main.py:181`.

| method + path | purpose |
|---|---|
| `GET /shelves` | Shelf manifest — names, sources, radii and empty states as configuration |
| `GET /feed` | One ranked, location-aware, cursor-paged page |
| `GET /search` | Same contract with `q`, `category`, `has_price`, `when` |
| `POST /content` | **One** publishing endpoint for all six content types |
| `GET/PATCH/DELETE /content/{kind}/{id}` | Detail, edit/state change, removal |
| `POST /reactions`, `DELETE /reactions` | like / save / interest / attending, polymorphic |
| `GET /location`, `PUT /location` | Where you are looking, and why |
| `POST /reports` | Report or block |
| `GET /activity` | Grouped activity plus real waiting counts |

## Location resolution chain

One function, `resolve_location()` in `app/modules/outside/router.py`. Every
step is recorded in `source` so the UI can explain itself:

```
request  →  the caller passed a point (map tap, or ?lat&lng)
gps      →  saved preference, set from the device
manual   →  saved preference, typed by the person
vendor_profile  →  the business address the account already had
market_zone     →  the nearest active market zone
unset    →  no location; radius filtering is skipped, unlocated content still shows
```

`unset` is a supported outcome, not an error. `apply_radius()` in `feed.py`
only drops content with a *known* position outside the radius, so national and
online content survives a 3 km radius.

## Ranking

`app/modules/outside/ranking.py`, pure and unit-tested. Weights sum to 1.0:

| signal | weight |
|---|---|
| proximity | 0.34 |
| recency | 0.20 |
| timing (events) | 0.16 |
| interest | 0.12 |
| social (connections) | 0.10 |
| engagement | 0.08 |

Two rules are pinned by tests:

1. **Price is never a term.** `test_ranking_has_no_price_term` reads the module
   source and fails if `price_kes`, `entry_fee`, `budget_kes`, `unit_price` or
   `pay_kes` ever appears in it.
2. **Engagement is log-damped and capped** at 40 interactions, so popular
   content cannot drown useful local content.

Repeated commercial posting by one author inside 24 h is decayed (floor 0.4) —
it is demoted, never hidden.
