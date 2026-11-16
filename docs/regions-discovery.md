# Regions: the visual discovery grid

Regions is the browsing surface, not a second Home. It shows the shape of a
corridor in cards and lets a person narrow by intent and by what the network can
actually prove about the person behind a page. Home still answers "what is
happening for me now"; Regions answers "what exists around here".

## One card anatomy

`frontend/src/components/regions/RegionsGrid.jsx` renders the same card on
`/regions/<slug>` and in the region-aware Discover results.

| Part | Rule |
| --- | --- |
| Media | `aspect-[4/3]`. A real photo when the feed has one; otherwise the same category gradient and line icon as Home (`frontend/src/lib/categoryArt.js`). |
| Top-left pill | `Offer`, `Wanted`, `Round`, `Event`, `Service`, `Rental`, `Opportunity`, `Post` or `Community`. |
| Top-right pill | `Lvl N`, derived on the client by `frontend/src/lib/standing.js` from the feed's `owner` facts. Forest green at Level 3+. |
| Title | Two lines maximum. |
| Place and price | `Town • KSh 500`, or `Open` when the server has no price. Never a placeholder amount. |
| Footer A | A capacity bar and `4/10 joined`, only when `meta.capacity` is real. |
| Footer B | `/p/<handle>` and `N trades`, or `No trades yet`, when there is no capacity. |

The grid is two columns on a phone and three from `lg`. It is deliberately
uniform: the eye should compare cards, not re-learn a layout per content type.

Test ids: `regions-grid`, `region-card-art` (with `data-fallback`),
`region-card-level`, `region-card-momentum`, and the existing
`content-card-<kind>`.

## Standing without invention

The feed adapter (`backend/app/modules/outside/feed.py::_owner`) emits only
facts the server holds:

```json
{
  "id": "…",
  "handle": "milimani",
  "name": "Milimani Cereals",
  "physical_location": "Kisumu central",
  "business_description": "Wholesale cereals",
  "movements_completed": 3,
  "confirmed_trade_proofs": 0,
  "is_verified": false,
  "contact_exposed": true,
  "page_live": true
}
```

`contact_exposed` is a boolean. The phone number is never sent to the feed.
`page_live` requires a handle and a business name. The client maps these into
the same `rankFor` ladder used by the profile:

- Level 1: a live page;
- Level 2: a contact route can be used;
- Level 3: at least one completed movement, or a trade confirmed by both sides;
- Levels 4–5: **not claimed on a feed card today**, because the feed does not
  carry the fulfilment sample or an institution confirmation.

`Vendor.is_verified` is not treated as an institution or licence confirmation.
It records that our team checked the business; mapping it to Level 5 would claim
a check the card cannot prove.

## Intent and trust filters

The chosen corridor sits directly under the heading, before the search and the
filters: its name, what it is known for, and one door to its own page. The
picker in the heading reaches every region; the card makes the current scope
impossible to miss.

On the region-aware Discover screen the posting-type row becomes four intent
chips: `All`, `Offers`, `Wanted`, `Rounds & Events`. They map to the API's kind
names in `REGION_INTENTS` and travel in the URL (`?intent=offers`) so Back and
sharing restore the same view.

The `Lvl 3+ only` toggle (`?trust=3`) sits beside the 3/15/50 km radius control.
It filters the cards already loaded by the same `rankFor` ladder. It does not
invent levels and does not ask the API for a rank it cannot compute. When the
filter hides every loaded card, the screen says so and offers two honest exits:
load more results, or show every page. The radius is unchanged.

`Clear` resets the category, intent, standing, time and price filters together.

## Sharing

The public profile and invite pages still answer crawlers before the SPA
catch-all. `vercel.json` now sends `/p/*` and `/invite/*` to the backend only for
social crawler user-agents (WhatsApp, Facebook, Twitter, Telegram, LinkedIn,
Slack, Discord, Pinterest). A human still reaches the Vite app. `/og/*` is
already proxied to the backend for everyone.

Verification, once a deployment URL exists:

```sh
curl -A "WhatsApp/2.23.20.0" -sI https://<host>/p/<handle>
curl -A "WhatsApp/2.23.20.0" -s https://<host>/p/<handle> | grep 'og:'
curl -sI https://<host>/og/p/<handle>.jpg
```

On Railway, FastAPI owns the path and the route order already puts
`public_pages_routes` before `spa()`. On Vercel, check that the bot rewrite wins
over the frontend catch-all. The standalone HTML fallback in
`backend/app/routes/public_pages.py` is a crawler-safe document, not the full
React app; do not route ordinary browsers to it.

## Tests

```sh
cd frontend
npx vitest run src/test/regionsGrid.test.jsx src/test/regionsDiscover.test.jsx \
  src/test/exploreCompact.test.jsx src/test/outside.test.jsx
npx eslint src/components/regions/RegionsGrid.jsx src/lib/categoryArt.js \
  src/lib/standing.js src/pages/explore/ExplorePage.jsx
```

The backend owner payload is covered by `backend/tests/test_outside.py`.
