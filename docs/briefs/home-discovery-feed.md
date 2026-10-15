# Home as a discovery feed (v3.1)

> **The marketplace leads with the market.** Home used to open on the vendor's
> own shelf: their published listings first, other people's stock below. That is
> backwards for a network whose whole value is what *other* businesses have.
> v3.1 restructures `/` into a visual-first feed of real records drawn from the
> modules that already own them — goods, services, people, equipment, work,
> events, communities, markets — with the vendor's own shop folded shut at the
> bottom and one tap from the screen where shop management actually lives.
>
> Nothing was removed from the product. Nothing new was invented: every shelf
> reads an endpoint that already existed, every card opens the record it showed,
> and the feed has no category list of its own.

---

## 1. The order of the feed, and why

| # | Surface | Why it sits there |
|---|---|---|
| 1 | **Discovery shortcuts** (6 chips) | A compact way out of Home into screens that already exist, placed above the fold so a vendor with a specific errand never scrolls past inventory they did not come for. |
| 2 | **Discovery shelves** — Fresh on the network · Services for your business · People to work with · Equipment and rentals | The product, up front: real records from other vendors, availability first. |
| 3 | **Invite banner** | One promotional moment, placed where a browsing vendor is most likely to act on it, and nowhere else. |
| 4 | **More shelves** — Opportunities around you · Events and market days · Groups and vendor lists · Markets in the network | Widens the net past goods: work, diary, community, places. |
| 5 | **Outstanding work, in one line** | A trade waiting on a decision is a door (`/orders?needs=me`), not a dashboard panel. |
| 6 | **My Shop — collapsed** | The vendor's own listings are one tap away and never in the way. |
| 7 | **Trust line** | Two claims that are true: your shelf never appears above; prices and availability are the vendor's own. |

Everything the old Home showed is still reachable: its category rail became the
shortcuts (links into Browse's own views, not a second taxonomy), its "Needs your
action" rows became the one line into Work, "Recent trade activity" was already
Work's job, and the vendor's listing cards moved into My Shop.

## 2. The shelves, and where each one comes from

| shelf | source of truth | card → its record |
|---|---|---|
| Fresh on the network | `GET /stock/network-stock` (visible-to-network, in-stock, other vendors) | `/listing/{id}` |
| Services for your business | `GET /catalog` (the storefront catalogue) | `/storefront?offer={key}` |
| People to work with | `GET /vendors/discover` (network scoring); falls back to connected vendors when discovery has nobody new | `/@{handle}` |
| Equipment and rentals | `GET /tools/browse?include_mine=false` (available only) | `/tools?listing={id}` |
| Opportunities around you | `GET /requests?scope=open` + `GET /squad/job-calls`, interleaved | `/browse` · `/tasks/squad` |
| Events and market days | `GET /events/browse` | `/events` |
| Groups and vendor lists | `GET /groups/browse` + `GET /vendor-lists/browse` | `/groups` · `/lists` |
| Markets in the network | `GET /markets` | `/markets/{id}` |

Every shelf carries a **See all** door into the module's own screen
(`/browse?type=goods`, `/network`, `/storefront`, `/browse?type=equipment`,
`/browse`, `/events`, `/groups`, `/markets`). Registration to a shelf is data,
not code: `config/homeShelves.js` is the only file that knows which module a
shelf shows, and `components/home/cards/index.jsx` maps a card kind to a
renderer. Adding a shelf means adding a row there.

The three directory endpoints the shelves preview (`/groups/browse`,
`/vendor-lists/browse`, `/markets`) gained **optional** `skip` / `limit`
parameters — a carousel asks for a dozen rows; the directory screens omit the
parameter and behave exactly as before.

## 3. One carousel, and it is the existing one

`ui/Shelf` was already the product's horizontal rail (the dashboard uses it).
It is now also the home feed's carousel, through a thin
`components/home/HorizontalCarousel` that fixes the card width and label. What
was added to `Shelf` itself is the part that was missing anywhere:

* **a swipe is not a tap** — a gesture that moves more than `SWIPE_SLOP` px
  suppresses the click it produces (`SUPPRESS_MS` later the rail is tappable
  again), so dragging a shelf can never open the card under the thumb;
* arrow buttons that are always present on the feed (`arrows="always"`) and
  keyboard focus on the rail;
* `aria-roledescription="carousel"` on the list, so the rail is announced.

Every card is the same slot width and the same 4:3 media box (`CardShell`), so
shelves line up down the feed and nothing shifts as records land.

## 4. Your own inventory never appears

Three layers, deliberately:

1. `GET /stock/network-stock` already excludes the caller's shelf server-side;
   `/tools/browse` is asked with `include_mine=false`.
2. `config/homeShelves.js` filters each record's `owner` — by vendor id **or**
   by handle — before the shelf sees it (`publicShelfItems`).
3. My Shop is the only surface on Home that shows your records, collapsed.

The feed's own copy says so in the footer, and `homeFeed.test.jsx` serves the
vendor's own stock from the API on purpose to prove the client filter holds.

## 5. Loading, empty and error states

`stores/homeFeedStore.js` keeps **one small state machine per shelf**:
`idle → loading → ready | error`.

* each shelf loads on its own clock, so the fastest module paints first and one
  broken module can never take the feed down — the failed shelf says
  `“… didn't load”` with a retry, and the rest of the marketplace carries on;
* a shelf that answers within `STALE_MS` (5 min) is not fetched again when the
  vendor returns to Home, and concurrent loads of the same shelf collapse into
  one request;
* **an empty shelf is hidden.** There is no placeholder product anywhere in the
  feature — an empty carousel is a dead end and a padded one would be a lie;
* when every module answered and none has anything, the feed says so once
  ("The network is quiet right now") and offers to check again or post a
  request.

## 6. Performance

* every shelf asks for an explicit small `limit` (8–12); no shelf pulls a table;
* skeletons use the real card slot and media ratio, so there is no layout shift;
* images are the record's own, rendered lazily (`loading="lazy"`,
  `decoding="async"`) with a keyed illustration fallback when a vendor declared
  none;
* the feed is cached in the store, so navigating away and back does not re-hit
  eight endpoints.

## 7. The invite banner

Fiverr puts invite-a-friend in the middle of its feed, and that placement works:
a vendor already in a browsing frame of mind. This one is ours, not a copy —
the plum from the design sketch (#963F70) deepened into the orchid and
trade-green tokens, the network's own words ("Invite friends. Grow together." /
"Bring more businesses into Ogallo and expand your trading network"), and one
button that calls **the sharing flow the app already uses** (device share sheet,
clipboard fallback, honest message when neither works — `lib/share.js`).

**No reward is stated, because there is none.** There is no referral programme,
no credits, no commission and no tracking link in this build; inventing one in a
banner would be a promise the product cannot keep. `homeFeed.test.jsx` asserts
the banner's copy contains no money and no reward language at all.

## 8. My Shop, folded

`components/home/CollapsedMyShop.jsx` is the vendor's own shelf at the bottom of
the feed:

* collapsed by default — no listing cards on first load, just the heading,
  "Manage your published listings.", the live counts and **Manage shop** →
  `/stock`;
* counts come from the same store the Stock Room uses and are only stated when
  they are real (`published`, on the shelf, not visible to buyers);
* expanding reveals a compact summary: up to four published rows (each opening
  `/stock?search={name}` for editing), **Add stock** (`/stock?new=1`),
  **Preview shop** (`/@{handle}`), **Share shop** (the same share flow) and
  **Full shop management** (`/stock`).

Nothing about stock management, editing, visibility, previewing or sharing
changed — only where it sits on Home.

## 9. Tests

`src/test/homeFeed.test.jsx` (22 specs) covers the acceptance criteria directly:

* every shelf drawn from a real module, every card linking to its record;
* own stock excluded even when the API hands it over (plus a unit test of
  `isOwnRecord` / `publicShelfItems`);
* an empty module hides its shelf instead of padding it;
* one module failing leaves the rest standing, and retry re-asks only that shelf;
* skeletons while loading, quiet-network copy when nothing exists anywhere;
* carousel behaviour: horizontal list, labelled, tap opens, swipe does not;
* My Shop collapsed → expand → edit / preview / share → collapse, and a single
  shelf read;
* the invite banner's placement, its share call, its clipboard fallback, and the
  absence of any invented reward.

`homeSurfaces.test.jsx` covers the hub itself (search-first opening, shortcut
destinations, the hero search landing on Browse results), and `pages.test.jsx`
covers Home against the app shell.

## 10. What was reused

`ui/Shelf`, `ui/SectionHeader`, `ui/Skeleton*`, `Badge`, `Button`, `Avatar`,
`EmptyState`, `TrustSignals` (`FulfilmentChip`), `StockThumb`, `SourceDialog`,
`GlobalSearch`, `SetupChecklist`, `config/navigation.js`, `lib/api.js`,
`lib/formatters.js`, `stores/stockStore.js` — plus every endpoint listed in §2.
No new dependency, no new backend model, no new endpoint.
