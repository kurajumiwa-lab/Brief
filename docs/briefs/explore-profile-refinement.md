# Explore & Profile — refinement, not rebuild

> **Status:** shipped on `arena/f1b48f67-brief` (PR #65).
> **Scope:** presentation, hierarchy and space. No route changed, no filter was
> removed, no backend endpoint was touched.
> **Direction taken:** hybrid visual style · grouped drawer · compact identity
> panel · mobile-first — the four recommended options.

---

## 1. What the screen was spending its first screen on

Measured on a 390 × 844 phone, above the first result:

| Explore, before | Height (approx.) | Explore, after | Height |
|---|---|---|---|
| Eyebrow + `What's around you` + description | ~90 px | `Explore` + place pill, one row | ~32 px |
| Location card (label row + radius row) | ~120 px | radius, one line | ~24 px |
| Search field | 40 px | Search field | 40 px |
| 13 kind chips, wrapping | ~120 px | 5 type chips, one row | ~28 px |
| Time + price chips | ~72 px | Category tiles, 2 rows, colour-coded | ~134 px |
| — | — | More filters (collapsed, counts what is on) | ~34 px |
| — | — | One market preview | ~130 px |
| **~442 px of chrome** | | **~292 px of controls + 130 px of content** | |

The functionality is identical. What changed is that ~150 px of it stopped
being visible by default, and the space it freed now shows a real market and a
colour-coded category selector instead of a third row of identical pills.

The old location card is not deleted: pressing the place pill opens the same
`LocationBar` with GPS, typed area, layer and sharing intact.

## 2. Category colour as a language, not decoration

`frontend/src/config/categoryTints.js` is the single source. It is imported by
the Explore selector, by every result card (`ContentCard` → `CategoryPill`), and
is available to the market doors.

| Category | Wash | Ink | Used by feed kind |
|---|---|---|---|
| Goods | `#E8F2EC` | `#276A49` | `listing`, `available` |
| People | `#EAEAF8` | `#5953A5` | `person` |
| Services | `#E6F1F7` | `#36738E` | `service` |
| Equipment | `#F5EEE2` | `#95703B` | — (no feed kind; used by markets/tools) |
| Events | `#F4EAF0` | `#99516F` | `event` |
| Communities | `#E9EFF0` | `#526D70` | `community` |
| Collections | `#EFEFE7` | `#63654B` | `collection` |
| Rentals | `#EDEDF4` | `#5D6180` | `rental` |
| Wanted / Scheduled / Opportunity / Post | amber / mauve / rust / neutral | | the four posting types |

Rules the code enforces:

- **A pastel wash with an ink of the same family.** Never a saturated block.
- **Colour is never the only signal.** Selected tiles carry `aria-pressed` plus
  an inset ring in the category's own ink.
- **No carousel.** Seven tiles in a wrapping grid; a category hidden behind a
  swipe is a category missing from the product.
- **Equipment has no filter tile** because the discovery feed has no
  `equipment` kind — a tile would either duplicate Rentals or return nothing.
  Its hue still exists and is used where equipment is real (a market's
  Equipment door, the tools screens).

## 3. Filters: demoted, never deleted

| Was | Is | Why |
|---|---|---|
| 13 chips in one wrapping row | 5 **type** chips (Everything, Available, Wanted, Scheduled, Opportunities, Posts) | what a person is doing is a secondary axis |
| — | 7 **category** tiles, coloured | what a thing is, is the primary axis |
| Time row + Price row, always visible | one **More filters** disclosure, badge with the count and the active values in the summary | keeps every option, spends no space until asked |
| "Clear filters" (only when filters set) | **Clear**, in the category header, same condition | one action, one place |

`data-testid` contract preserved: every kind still has exactly one control with
`explore-kind-<kind>` (seven on tiles, five on chips), so the existing URL /
back-button spec in `outside.test.jsx` passes unchanged.

## 4. The profile page

The dark-green block went from a hero to a **dashboard header**: identity,
three numbers, one primary action.

| Before | After |
|---|---|
| ~360 px: avatar, editable name, two badges, two full-width action cards with icon + title + body | ~220 px: avatar, name, one line of mode, settings; three numbers as a single `<dl>` row; **Add stock** as the only primary action, with **Local activity** as a quiet second |
| Two equal-weight actions ("Post a local activity" / "Add stock") | One primary (mint) + one secondary (white 10%) |
| Trading mode repeated in a badge and again in the hint | Said once |
| Four gradient/radial layers | One, subtle, top-right |
| Deep green as the background for *everything* | Deep green for identity and the primary action's container only |

Everything below is untouched in behaviour and now numbered (`01 / Workspace`
quick actions, then the existing grouped workspace sections), so the page reads
as a short document rather than a wall of equal cards.

## 5. The drawer

Regrouped into **Community & network · Workspace tools · Administration**.

Deliberate omission: **the five primary destinations are not repeated.** On a
phone they are the tab bar directly under the drawer; on desktop they are in the
header. A second copy would be duplication sold as addition. The drawer stays a
list of destinations — no counters, no cards, no calls to action.

The shop-front link resolves from the session (`/@<handle>`), not a placeholder.

## 6. Tests

| File | Pins |
|---|---|
`src/test/exploreCompact.test.jsx` (10) | pill not card · full location controls one press away · radius on one line · grid not carousel · four distinct hues · **the hue follows the result** · type row · More filters counts · Clear resets everything · categories → markets → results in document order |
`src/test/pages.test.jsx` (+6) | identity panel is one panel · mode said once · three counts in one `<dl>` · Add stock primary and first · Local activity second · drawer grouped, five tabs not repeated, shop front resolves to the handle |
`src/test/navigation.test.jsx` (rewritten 1) | the drawer is grouped in that order, nothing in it is a primary destination, nothing in it is Home |
`src/test/outside.test.jsx` (rewritten 1) | the no-price filter still exists, one press away, and the collapsed control counts it |

Full suites after the change: **frontend 353 passed**, **backend 466 passed**,
`vite build` ✓, `eslint` clean on every touched file.

## 7. Not done, on purpose

- **No new filter system.** Both rows write the same `?kind=`; there is one
  dimension, presented in two groupings.
- **No fabricated activity** on the market preview — it reuses the market
  shelf's own invitation copy for empty markets.
- **No unrelated screens touched.** The pre-existing `eslint` errors in
  `noticeboard/` and two Home cards are untouched debt, not this change.
- **Mobile-browser pass still blocked** in this sandbox (no browser binary), so
  the layout is verified by tests and build, not by a phone screenshot.
