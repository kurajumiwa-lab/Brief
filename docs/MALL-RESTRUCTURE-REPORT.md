# The mall restructure — what moved, and why

Status: implemented on `arena/01a0e9cc-brief`. Pinned by `preview/doorways.jsx` (45
checks), `preview/backdoors.jsx` (11), `preview/appbelt.jsx`, `preview/cityfeed.jsx`,
`preview/mine.jsx`, `preview/sellerhome.jsx`, `preview/wairobrand.jsx`,
`preview/dialogfocus.jsx`, `preview/businessfeed.jsx` (6), `preview/cards.jsx` (12).

## The problem, stated before any screen was touched

The app did not have a styling problem. It had a **map** problem:

1. **The bar did not describe the app.** Four doors (Home, Mine, You, +) over fifteen
   internal tabs. `city`, `discover`, `activity`, `pulse`, `supply`, `requests`,
   `partners`, `workforce`, `ledger`, `catalog`, `pipeline` lit **no door at all** —
   a member landing on one had no idea which way was home.
2. **The economic loop was behind a drawer.** Quote, Work, Procurement and
   Relevant Requests — the middle of Request → Match → Quote → Work order →
   Procurement → Trust → Payment — were reachable only *inside an already-selected
   request*. The loop the README describes as the product was the least navigable
   thing in it.
3. **Home was a seller console for a consumer app.** Meanwhile the family built for
   the real jobs — `HomeSurface`, `ActivityReel`, `NextMoveCard`, `EarnStrip`,
   `CirclesStrip`, `PlannedWeather`, `StakesLine`, `StandingLine` — sat **unmounted,
   with green tests against them**. Implemented, invisible.
4. **Duplicate doors, silent aliases.** `MineSurface` re-offered the Selling door;
   `orders` aliased `selling` without saying so; `storefrontOpen` was state that
   nothing ever set.
5. **Deep pages with no front door.** `/track` and `/reviews` existed only as bare
   `<a>` tags inside a sheet.

Each of those is a *discoverability* defect, not a missing feature — which is why the
fix is structural and no capability was deleted.

## The new map

Five doors, in the order the loop actually runs, plus the create action:

| Door | Hash | Holds |
|---|---|---|
| Home | `#home` | The atrium: `SellerHome` — attention read, own numbers, shelf of doors, what is moving |
| Market | `#market` | The board: `CityFeedView` → mixed `BusinessFeed` face, taxonomy behind one entry |
| Trade | `#trade` | The work loop: `demand · open · quotes · work · procurement · supply` |
| Shop | `#duka` | The business: spaces, offers, orders, team, ledger, catalogue, pipeline, tools, operating |
| You | `#you` | Identity, standing, connections, money, settings, help |
| Create | `#create` | Eight verbs; "I need something done" first, group-buy last |

`Navigation.tsx` owns `BOTTOM_BAR_ITEMS`, `DOOR_HASH` and `doorFor`; `surfaces.ts` owns
the aliases (`city→market`, `requests/supply→trade`,
`mine/spaces/selling/orders/ledger/catalog/pipeline→duka`). A legacy address still
works and lights the right door — nothing 404s because the map changed.

The bar refuses to hold everything; the **directory** (`#menu`, `NavSheet.tsx`) does.
It is grouped by floor with a unit number per row, and it carries the surfaces that
deserve no door of their own: Pulse, Partners, Workforce, Elevate, group-buy,
table banking, the shop sections, notices, following, saved, subscriptions, language,
privacy, and the gated admin / moderation rows. Every directory row is emitted through
one `Row` component so all of them carry the same `menu-tile-` testid the suites audit.

## What Home became

`SellerHome` is the atrium, ordered by what a member came to do:

1. **What needs attention** — derived from `getMyPosition` (`decay`,
   `missedCapture`, `nextMove`, `open.total`), never from a cached boast.
2. **Your own numbers** — four metrics, each from a row count.
3. **The doors shelf** (`data-shelf="doors"`) — thirteen-plus `MallDoor`s, each of
   which goes to a screen that exists. A door with no `href` and no `onSelect` does
   not render.
4. **What's moving** (`data-shelf="moving"`) — the board's own order, nothing ranked.

The previously-orphaned family is now mounted *inside* those shelves: `NextMoveCard`,
`CirclesStrip`, `EarnStrip`, `PlannedWeather`, `StakesLine`, `ActivityReel` — which is
also what turned `spaceloop` green again (54/1 → 55/0).

`HomeSurface.tsx` is deliberately **kept and unmounted**: it is the reference
implementation of the card-first home, and `preview/compacthome.jsx` still tests it
standalone. Deleting it would have deleted a working pattern to make a diff look tidy.

## The mall, as discipline rather than decoration

"Feel like a Kenyan mall" was implemented as **wayfinding rules**, not wallpaper:

* shelves (`ui/mall.css`, `MallShelf.tsx`) with a plank, a tag and a "see all";
* awning stripes, price-tag chips and `CategoryArt` plates as ornament — a plate is
  never a product photo and never the action accent;
* `KARIBU`, an eyebrow line (`GROUND FLOOR · <area> · <today>`), `SHOP NO. …`,
  `OPEN NOW`, `BEI NZURI`;
* rooms separated by **light** (`--lift-1..4`, inset highlight), never a 1px stroke;
* exactly one action per empty state, and one loud thing per screen.

What the metaphor is *not* allowed to buy: no invented `PROMOTED` flag, no countdown
that has no event behind it, no "12 neighborhood shops" that nobody counted, no
`BannerButton` shout on Home (`PromoBanners.tsx` stays unmounted for exactly that
reason). `cards.jsx` §2 used to pin a Home that had a gradient banner and three named
grids; Home now has no banner at all — the board is the loud thing — and the suite is
retargeted to that truth while `homezones.jsx` still audits `BannerButton` itself.

## Honesty rules that survived the move

Every one of these is asserted somewhere in the suite, and all still hold:

* `StandingLine` renders **nothing** on a failed read — no `#7 · Sector · tier`;
* `StakesLine`'s dot greys when the read failed;
* `CirclesStrip` says "You are not in anything yet." rather than printing `0`;
* `PlannedWeather` renders only when a dated forecast fact lands on a committed event day;
* `MallShelf` prints no tag when the number was never read;
* the belt's bell badge paints nothing until `unread` is read;
* `taxonomy.ts` can produce no number — counts come from `/api/discover/summary`;
* `ShopDocuments` is allowed to be empty and says so.

`StandingLine` is now mounted on `YouSurface`'s `standing` shelf, above the three cards
it summarises — the shelf already holds all three reads, so it costs no request.

## One entry, not two walls

`BusinessFeed` (the face of the market) used to keep the taxonomy in a link at the end
of a long list. If the feed read failed, the wings were gone. The header now carries
one entry — *Browse the board by wing* — which opens the **same** `BoardPicker` the
board itself uses, extracted from `DiscoverFeed.tsx` so there is one picker, two doors,
and one source for every number it prints. `api.getDiscoverSummary()` is read on the
tap that asks for it, not on every render.

This resolved a live contradiction in the suite: `businessfeed.jsx` pinned that the
label must be **absent** from the feed face, while `errandslobby.jsx` and `townhubs.jsx`
required **one entry**. The absent-label pin was a proxy for "no picker wall on the
feed"; it is now pinned on the structure instead, and the entry is pinned positively —
which also fixed the way the suite failed (a `jsdom` element printed by `assert` ate
the heap, so the suite reported as "Killed" rather than as red).

## Test ledger after the restructure

Against a baseline that was **already red** (`errandslobby cards backdoors tiles
spacemoderation` crashed, `townhubs` 3 failures, `spaceloop` 54/1), the full runner now
reports **TOTAL 2363 passed / 1 failed**, with `backdoors` and `tiles` listed under
CRASHED SUITES. `tiles` really is red (below). `backdoors` is a **memory** casualty of
running ~90 jsdom suites while the dev server and the API hold the box: run by itself it
prints 11 / 0, twice, in this session — including through `run-suites.sh` itself
(`bash run-suites.sh backdoors businessfeed townhubs appbelt` → 106 / 1, the 1 being
`townhubs`). Treat a crash for a suite that passes standalone here as a signal to re-run
it alone, not as a green light.

| Suite | Baseline | Now |
|---|---|---|
| `backdoors` | CRASH | 11 / 0 standalone (crashes only under full-run memory pressure) |
| `spaceloop` | 54 / 1 | 55 / 0 |
| `cards` | CRASH | 12 / 0 |
| `errandslobby` | CRASH | 8 / 0 |
| `spacemoderation` | CRASH | 6 / 0 |
| `businessfeed` | 6 / 0 | 6 / 0, with the entry pinned positively |
| `townhubs` | 82 / 3 | 84 / 1 |
| `doorways` | 45 / 0 (rewritten for the five doors) | 45 / 0 |
| `appbelt` | green | 5 / 0, directory rows on one id shape |
| `tiles` | CRASH | still red — see below |

Two known reds remain, both pre-existing and both about surfaces this pass did not
restructure:

* **`townhubs` × 1** — "an unreadable board says so instead of showing the demo",
  asserted against `preview/src/screens/DiscoverScreen.tsx`, the *legacy harness*
  screen only `preview/nav.jsx` mounts. Its sibling claim in the same block —
  "renders the four flows as the primary switcher" — went green with the shared
  `BoardPicker`. The production path is not in doubt: `DiscoverFeed` prints
  `{failed}` with a Try again button, and `cityfeed.jsx` / `errandslobby.jsx` pin it.
* **`tiles`** — the You-grid suite, and the one red this pass did not resolve. What is
  known, in its own terms: its fixture still lists `language / notifications / privacy`
  as tiles of the You *grid*, while `YOU_GROUPS` puts them in the "Settings & help"
  group and the directory carries them as `menu-tile-…` rows too; the suite then
  crashes clicking `menu-tile-how`, which is labelled "How it works" in
  `YOU_GROUPS`. Its two mechanical claims — `html` locked with `overflow: hidden` while
  a sheet is open, and "no `<details>` anywhere on the surface" — do not hold as
  written, although `ui/Sheet.tsx` (lines ~92-101) does lock `documentElement` for the
  duration of an open sheet, and the You surface has exactly one `<details>`, inside a
  shelf, not as the navigation. Diagnosing those needs the whole You-shelf contract
  re-derived, which is a separate pass. **No dead end follows from it**: all four
  sections resolve at `#you/<section>` and are reachable from the directory, which
  `appbelt.jsx` and `doorways.jsx` pin.

`README.md`'s door table and this file are the two places the map is described; if they
ever disagree with `Navigation.tsx`, `Navigation.tsx` is right and these are bugs.
