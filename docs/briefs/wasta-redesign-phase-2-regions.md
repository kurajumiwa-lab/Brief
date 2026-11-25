# Wasta redesign — Phase 2: the Regions shelf

**Status:** implemented on `arena/dd4bb94f-brief`
**Follows:** `wasta-redesign-phase-1.md` (merged as `75d9582`)

---

## 1. What the review found

The Regions screen (`/regions`, and the `/discover` alias) was reviewed against
four supplied screenshots and the WASTA design review. It found:

| Finding | What it meant in the product |
|---|---|
| **Repeated search and filter surfaces** | The header search, the sticky page search, a chip row under it, a category strip further down, a category select in the toolbar, a sort select and a filters door — seven places to change one result set, none of them saying how much was on screen. |
| **An under-informative "Around You" card** | The spotlight fell back to a large card that said "Around you", named no region, and offered nothing. The screen is called Regions; the region appeared in one small line under a folding knob. |
| **Inconsistent category cards** | A row of tall picture tiles with a different gradient on each, a photographic background borrowed from whatever item happened to match, and a horizontal scroll that hid half of them on a phone. |
| **"We couldn't load what's around you"** | A functional fault, not a visual one. Every possible cause — offline, timed out, signed out, a broken deployment — printed the same sentence, offered no retry, and the rest of the screen went blank with it. |

The brief also carries standing constraints from phase 1 that this phase does
not relax: the app is **Wasta**, existing functionality is preserved rather
than removed, and **no product, listing, count, distance or activity is ever
invented** when the database has nothing to say.

---

## 2. What changed

### 2.1 One search

* The page owns **one** search field, and it is sticky under the app header.
* The app header's own search field is **hidden on the discovery routes**
  (`/regions`, `/discover`). It routed the same words to the same screen, so
  keeping both on screen meant two boxes answering one question.
* The chip row under the search ("Try: Events · Goods · Services …") is
  **gone**. It said exactly what the category grid says, one screen earlier.

### 2.2 One category grid

`components/discover/CategoryNav.jsx` replaces the picture-tile strip.

* One card shape for every category — same padding, radius, icon plate and
  label position. Only the selected card's ring changes.
* A **wrapping grid**, not a carousel: every category is visible without a
  swipe.
* **Truthful counts.** A card shows how many of the *loaded* records are its
  kind, and shows nothing at all when the results have not loaded. A quiet
  region never reads as an empty one.
* Saved is a card too, but a **route** (`/discover/favorites`), never a filter,
  and it is last — it is a place, not a kind of thing.

### 2.3 One control deck

`components/discover/ResultDeck.jsx` replaces the toolbar.

* The **count comes first** and is always honest: "12 results loaded · in
  Nyanza · more to load", "No results in Nyanza", "Results couldn't load — try
  again". It is never presented as the size of the region.
* **One filters door** that counts what is on and opens every remaining filter
  — intent, time, price, standing — in one panel. The Level 3+ standing filter
  moved *into* that panel rather than sitting in a second row.
* **Sort** orders the page already fetched. Items without a price stay at the
  end of a price sort rather than being treated as free.
* **LIST / MAP**: the map is a second view of the same search. It travels with
  the search text and the region name, and the map screen offers the way back.

### 2.4 A regional spotlight that is worth reading

`components/regions/RegionSpotlight.jsx` replaces the promotional poster.

* It names the **region, its hub and its country**, and what the region is
  known for.
* It shows four counts — **listings, businesses, offers, kinds** — taken from
  the records the screen actually holds, each labelled with its provenance
  ("From the 20 results loaded for Nyanza").
* A count that is not known is a **dash, never a zero**:
  * loading → "Live counts appear once the results below load."
  * failed → "Live counts are unavailable — the results did not load."
  * loaded and empty → "No active records came back for Nyanza."
* One clear regional action: **Open Nyanza**, and **Post in Kisumu** (which
  now actually prefills the place in Create).

### 2.5 A region that is a real scope

Regions had hub coordinates but never used them: picking "Coast" relabelled
whatever the feed was already showing.

* Every region now carries its hub's `lat`/`lng` in `config/regions.js`.
* A region that was **chosen** (in the URL or remembered on the device)
  becomes the point the feed is centred on, with a 50 km radius, and the
  screen says so: *"Centred on Kisumu · within 50 km of Kisumu"*.
* A region that was merely **inferred** from where the person already is does
  **not** move the search — that would move the search away from them.
* **"Use my location"** puts the search back on the person, and says what
  happened when the permission is refused.

### 2.6 The nearby list, fixed

This is the functional half of the work.

* **The failure is classified.** The outside store no longer prints one
  sentence for every cause. It uses the product's existing `describeFailure()`
  and keeps the kind, headline, description, the server's own words (kept
  behind a "Technical note" disclosure, never as a headline) and whether a
  retry could plausibly help.
* **Retry is real.** "Try again" re-issues the same request with the same
  scope; a failed *next page* keeps the rows already on screen and stops
  paging rather than blanking the list.
* **Loading is a state.** Skeletons for the first page, a quiet line for the
  next one.
* **Location permission is handled, not hidden.** GPS is requested only when
  the person asks for it. A refusal is not an error: the region scope keeps
  working and the bar says the permission was declined. A device that cannot
  share a location says so and offers the typed area. No area at all is also
  not an error — the feed runs without a radius and says that is what is
  happening.
* **The rest of the screen survives a failure.** The region card, the category
  grid and the scope bar stay on screen while the list is down.

### 2.7 Smaller things

* **"Items on sale"** has a compact empty state with two doors: *Sell an item*
  and *Spot a sale*.
* **Create** now honours `?place=` and `?region=`, so "Publish in Kisumu" on
  a region's page actually prefills the place. (It did not before.)
* The **Map** screen accepts the region shelf's search and region, says
  plainly that it is the network's map rather than a region's, and offers
  "Back to the list".
* The header's mobile search toggle is hidden on the discovery routes, for
  the same reason the desktop one is.

---

## 3. Files

| Path | Why it exists |
|---|---|
| `frontend/src/pages/explore/ExplorePage.jsx` | The region-aware screen: masthead, one search, region card, scope bar, category grid, deck, results. |
| `frontend/src/components/regions/RegionSpotlight.jsx` | The regional card — identity, four truthful counts, one clear action. |
| `frontend/src/components/regions/ScopeBar.jsx` | Where the results are looking from, and the location-permission flow. |
| `frontend/src/components/discover/CategoryNav.jsx` | The one category grid. |
| `frontend/src/components/discover/ResultDeck.jsx` | The one control deck: count, filters, sort, list/map. |
| `frontend/src/components/discover/SortOptions.jsx` | The sort vocabulary, in one place. |
| `frontend/src/lib/regionMetrics.js` | Counts that are true, or nothing at all. |
| `frontend/src/stores/outsideStore.js` | Classified failures, a real retry, and `requestGps()`. |
| `frontend/src/config/regions.js` | Hub coordinates and the regional scope radius. |
| `frontend/src/components/layout/AppHeader.jsx` | One search on the discovery routes. |
| `frontend/src/pages/map/MapPage.jsx` | Accepts the shelf's search; offers the way back. |
| `frontend/src/pages/create/CreatePage.jsx` | Honours `?place=` / `?region=`. |
| `frontend/src/test/regionsRedesign.test.jsx` | The new contracts, including every failure state. |

Removed: `MarketplaceHero.jsx`, `SpotlightRail.jsx`, `ShopToolbar.jsx`,
`DiscoverCategoryStrip.jsx` — all four were replaced wholesale.

---

## 4. Truth rules this phase holds to

1. A count is a count of records **we hold**, and says so.
2. **Unknown is never zero.** A failed request never produces "0 listings".
3. A chosen region is a **real scope** with a stated centre and radius.
4. A refusal, a missing area and an offline network are **states, not errors**.
5. The server's own words are **support material**, never a headline.
6. Nothing on this screen is **paid placement**, and nothing is called
   verified unless the standing ladder actually reached Level 3.

---

## 5. Verification

* `npx vitest run` — **798 tests across 103 files, all passing** (17 of them
  new in `regionsRedesign.test.jsx`, plus adjustments to
  `regionsDiscover`, `discoverMerch` and `regionsGrid`).
* `npx eslint` on every changed file — clean (the three `MapPage` warnings are
  pre-existing).
* `npx vite build` — successful; the 670 kB main-chunk warning is pre-existing.

---

## 6. Still to come

* **Phase 3** — Meet Nearby's privacy/expiry/report/block model, the guided
  receipt-rewards journey, improved business pages, inbox, profile, map and
  regions refinements, onboarding, and resilient empty/error/offline states
  across the rest of the app.
* The `/regions/:slug` page still filters the network **by name text** on the
  client. Now that regions carry coordinates, that page can be moved onto the
  same real scope the shelf uses — a small, separate change.
