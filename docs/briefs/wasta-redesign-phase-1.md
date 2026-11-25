# The Wasta redesign — phase 1: discovery first

> The product review arrived under the heritage name. This repository's
> canonical name, and the name the brand tests enforce, is **Wasta**. Nothing
> here renames the product; the review's *findings* are what is being applied.

---

## 1. What the review asked for, and where it stands

The review is a whole-product redesign. It asks for:

| # | Ask | Phase | Where it lives |
|---|-----|-------|----------------|
| 1 | Editorial design system: forest / cream / coral tokens, type, spacing, cards, buttons, icons, touch targets, WCAG AA | **1 — done** | `src/styles/design-system.css`, `src/styles/tokens.css` |
| 2 | Discovery-first Home: prominent location and search, four understandable categories, map discovery, community activity, secondary rewards | **1 — done** | `src/components/home/HomeHero.jsx`, `DiscoveryBand.jsx`, `MapDiscovery.jsx`, `CommunityShelf.jsx`, `TodayView.jsx` |
| 3 | Five-item navigation refined to Home · Explore · Create · Inbox · Profile, with Create offering purpose-specific publishing | **1 — done** | `src/config/navigation.js`, `src/config/createIntents.js`, `src/components/create/CreateIntentSheet.jsx` |
| 4 | A distinct business workspace: performance, pending actions, enquiries, listings, records, verification — and no money the platform does not hold | **1 — done (first cut)** | `src/pages/workspace/WorkspacePage.jsx`, `src/components/workspace/WorkspaceView.jsx` |
| 5 | Meet Nearby: co-buy, delivery, meetup actions; approximate locations until a meeting is agreed; privacy, report and block controls; expiry; interest counts | **2 — next** | new `/meet` surface |
| 6 | A guided three-step receipt-rewards journey: scanning history, pending / approved / rejected, points history, voucher expiry, participating shops, eligibility rules | **2 — next** | `src/pages/town/ReceiptRewardsPage.jsx` |
| 7 | Improved search, public business pages, inbox, profile, map / regions, onboarding and role switching, empty / error / offline states, meaningful CTAs | **3** | across the app |
| 8 | Delivery in phases, judged on behaviour as well as visual quality | **1 — this document** | this file |

Phase 1 is deliberately *one coherent slice*: the foundation, the screen
people open first, the tab bar, the central action, and the business's own
room. Phases 2 and 3 are larger surfaces and are written up before they are
built, because the review's own instruction is not to attempt everything at
once.

---

## 2. What changed in phase 1, and why

### 2.1 The foundation — `src/styles/design-system.css`

Five rules, written down once so a new screen stops inventing its own:

1. **Three text levels** — `.ds-display`, `.ds-title`, `.ds-lede`, `.ds-meta`.
   A page picks a level, not a number.
2. **Cards separate by line first** — one radius, one padding, one hairline;
   elevation is the second signal, never the first.
3. **One primary action per view** — `.ds-cta` is the filled action;
   `.ds-cta-secondary` is the quiet sibling.
4. **Touch targets are 44px** — `.ds-tap`, `.ds-tap-icon`, `.ds-tap-row`.
5. **Focus is visible and never removed** — `.ds-focus`.

Every colour in the file is a token. The tokens were already measured
(`src/test/contrast.test.js`): white on `--brand-600` is 12.04:1, `--ink-4`
clears 4.5:1 on every light surface. No hex is introduced here.

### 2.2 Home — discovery first

The old Home opened on *who you are* (date, greeting, rank chip). That answers
a returning business's question and answers nothing for a person who came to
see what is for sale. The new order:

```
hero (where you are + search)
  four category doors
  the map, as a door
  nearby trade → live deals → dated rounds
  community activity
  identity → next step → your books → receipts
  rewards and referrals  ← deliberately last
```

* **The hero** (`HomeHero.jsx`) owns the place and the search. The place is a
  link to the region screen, and when no place is known it says *No area
  chosen* rather than naming a town nobody chose. The search is the app's own
  `GlobalSearch`, so it keeps its scope selector and its ⌘K shortcut.
* **The map** (`MapDiscovery.jsx`) is a *door*, not a canvas. A Leaflet map on
  the Home screen is a megabyte of tiles before the first pin, on the slow
  connections most of this product's people are on. Home already loads the
  feed, so the card counts the areas those real records name and opens the
  real map at `/map`.
* **Community activity** (`CommunityShelf.jsx`) is a distinct section: the
  records nobody can buy — a notice, a question, a request for a hand, a
  neighbourhood group. It is sliced out of the same feed read, so it costs no
  extra request. An empty neighbourhood ships no rail.
* **Rewards are last.** Receipt rewards, referrals, the scout board and the
  promotional plate all sit below the market. A marketplace that leads with
  points is a points app that happens to sell things.

Nothing was removed. The trade shelves, the deals, the dated rounds, the
identity strip, the next step, the counter and the receipt scanner are all
still on Home, in a different order.

### 2.3 Navigation — the labels people would use

`Regions` and `You` were working names, not words a person would say out
loud. They are now **Explore** and **Profile**. The *routes* did not move —
the tab is still `/regions` and `/you` — because a link in a WhatsApp thread
must keep working. Only the label changed, and the icon for Explore is now a
compass.

### 2.4 Create — six purposes instead of nine type names

The central tab opened a generic form whose first question was "which of these
nine internal content types is this?". Nobody has ever had that question. The
new sheet offers six purposes in plain words, each one a real publishing path
the server already understands:

| Purpose | Record | Anchor |
|---|---|---|
| Sell goods | Available offer | goods |
| Offer a service | Available offer | service |
| Post a rental | Available offer | rental |
| Publish an event | Event | — |
| Create a local request | Wanted request | — |
| Start a community meetup | Scheduled round | — |

The three trade purposes are *one* record with three anchors, because that is
how the browse side already classifies them (`PRIMARY_CATEGORY_TO_KIND` in
`backend/app/modules/outside/feed.py`). A purpose is a shareable address:
`/create?type=available&ledger=1&primary=rental`.

The older doors — the raw type pickers, the trade proof, the offer editor on
your page — are still there, under one disclosure, *Other ways to publish*.
Nothing was deleted.

### 2.5 The business workspace — `/workspace`

A business is not a consumer with a bigger shelf, so it gets its own room:

* **Recorded** — movements that settled and are on the record.
* **Outstanding** — movements agreed but not settled yet.
* **Receipt-backed** — trades a receipt supports, on either side.
* **People** — counterparties you have traded with.

None of them is a balance, an earning or a payout. Wasta holds no funds, so
the screen says so in one line and the numbers back it up: a reading the
server could not supply is shown as `—`, never as `0`. The tests assert the
absence of the words *balance*, *earnings*, *payout* and *withdraw* from the
whole screen.

---

## 3. How phase 1 is judged

The review asks for behaviour, not just pixels. The measures below are the
ones phase 1 moves, and phase 2 and 3 must not regress them.

| Measure | What phase 1 changes | How it is read |
|---|---|---|
| **Time to first useful action** | Home now opens on a search field and a place, not on a greeting | The hero is the first interactive thing on the page |
| **Search-to-contact** | The search is the largest control and routes to the one results system | `GlobalSearch` is used unchanged; the scope selector and ⌘K still work |
| **Listing completion** | Create opens on a purpose, and the anchor is set for you | Six purposes, each one click from the form |
| **Business-profile completion** | The workspace lists the open setup steps as *waiting on you* | `useSetupProgress` is the same reading the counter uses |
| **Enquiry response time** | The workspace links the trade confirmations that need a reply | One row, one action |
| **Repeat use** | Rewards and referrals stay on Home, one screen lower | Nothing was removed from Home |

---

## 4. Phase 2 — the next slice

**Meet Nearby.** A dedicated surface for co-buy, delivery and meetup actions,
built on the privacy the product already has:

* precise locations never published — an approximate area until the two people
  deliberately agree to meet;
* an explicit "agree to meet" step that unlocks the exact point, and an expiry
  on that agreement;
* interest counts that are counts of people, not of taps;
* report and block controls on every row;
* no location at all when the person has not chosen to share one.

**Receipt rewards, as a three-step journey.** Scan → status → points, with
the rules visible:

* an explicit scanning history, including the ones that were rejected and why;
* pending / approved / rejected stated on every receipt, with the rejection
  reason next to it;
* points history and voucher expiry dates;
* which shops take part, and what is eligible;
* the eligibility rules written where a person reads them, not behind a link.

---

## 5. Phase 3 — the remainder

* **Search**: one query, one scope, results that explain themselves, and a
  search-to-contact path that is one tap.
* **Public business pages**: the same page a buyer sees and a seller edits.
* **Inbox**: grouped by what a reply unlocks.
* **Profile**: identity, capability and role switching in one place.
* **Map and regions**: the region screen keeps its filters; the map stops
  being a wall of pins.
* **Onboarding**: choose a purpose, then a role, then a place.
* **States**: every list gets an empty, an error and an offline state that say
  what to do next.
* **CTAs**: one filled action per view, always the thing a person came to do.

---

## 6. What phase 1 deliberately did not do

* It did not rename the product. The review's "OGALLO" is a heritage name;
  the product is Wasta and the brand tests say so.
* It did not add a money balance, an earnings figure or a payout anywhere.
* It did not remove a feature to make the page look tidier. Every shelf that
  was on Home is still on Home.
* It did not embed a second map engine on Home.
* It did not put rewards, referrals or the promotional plate above the
  market.
