# Home as a premium trade platform (v3.2)

> **The market is the hero; your business is a band, not a dashboard.** v3.1
> already put real records in front of the vendor and folded their own shop
> away. What it had not yet done was *rank* what it showed: the first screenful
> spent two cards on a badge rail and four numbers about the vendor, and then
> every module below it announced itself at the same size, in the same card, in
> the same way. This pass fixes the hierarchy, the layout constraints and the
> empty-data states — and changes nothing about where the data comes from.
>
> No endpoint was added. No feature was removed. No card lost a door.

---

## 1. The order of the screen, and what each row is for

| # | Surface | Why it sits there |
|---|---|---|
| 1 | **Market hero** — identity, one headline, one search card | The only place Home raises its voice. Who is trading, and the one field that finds anything on the network. |
| 2 | **Market strip** — the six doors | A labelled row of links into screens that already exist, above the fold, compact enough not to compete with the shelves. |
| 3 | **Discovery shelves** — Fresh on the network · Services · People · Equipment and rentals | The product: real records from other vendors, availability first. |
| 4 | **One line of outstanding work** | A trade waiting on a decision is a door (`/orders?needs=me`), not a panel. |
| 5 | **Your business** — the pulse row, then My Shop folded shut | Understand performance *after* you have seen the market, and beside the shelf it describes. |
| 6 | **Invite banner** | The one promotional moment, where a browsing vendor is most likely to act on it. |
| 7 | **More shelves** — Opportunities · Events · Groups and lists · Markets | Widens the net past goods: work, diary, community, places. |
| 8 | **Trust line** | Two claims that are true: your shelf never appears above; prices and availability are the vendor's own. |

Verified against the product's own read order: discover trade → understand the
business → explore the network → manage operations.

## 2. Layout: the constraints that were broken, and the fix

**My Shop was the clearest failure.** One flex row held the mark, the heading,
the counts *and* two buttons. On a 390px phone the text column was left about a
dozen characters wide, so `2 published · 3 on your shelf · 1 not visible to
buyers` broke into four lines while the two buttons held their full width — the
symptom that started this brief.

The card is now a two-row grid: identity and counts own the width they need, the
actions sit on their own row. From `sm` up the same two blocks sit on one line,
actions to the right. It is **one** action set either way — a duplicated row is
not just redundant markup, it hands a screen reader the same button twice.

The other constraints, tightened:

* **Shelf headers** were `items-end justify-between`, so a two-line description
  sank the title and the `See all` link to the *bottom* of the block (the title
  floated, the link drifted down). Title and link now share a baseline row, the
  description hangs beneath the title, and a hairline closes the header — the
  eye reads section → records → section instead of one column of bold text.
* **The compass/cube/people icons** on the mode badge and category lines were
  emoji from `VENDOR_ROLES` being rendered as tofu. The hero states the mode in
  words and a dot; the person card prints the role label.
* **The hero cluster** was three stacked chips (network badge, mode badge,
  "Welcome back") between the photograph and the headline. It is now one block of
  facts: name + verification mark, the place the business trades from, and the
  mode word opposite. The handle left the hero — it is the account's identity and
  it is already on the profile, the account menu and the shop front.

## 3. The hero: search, location and product discovery as one interaction

The old banner was a search field with a chip rail stuck underneath it, loose on
a photograph, and a fine scrim that let the produce compete with the type.

* **One white card** holds the field and the suggestion row: field, scope, submit,
  then `Try: tomatoes · sukuma wiki · cooking oil · kitenge · rice`, then
  `Browse everything`. The card is the surface; the field's own border, fill and
  focus ring stand down inside it (`.home-search-field`) and the card carries the
  focus ring instead, so focus is visible on the whole interaction.
* **The photograph stays**, under a single directional scrim that is 95% opaque
  at the left where the type sits and 52% at the right where the produce is —
  the image is the product, the type is readable in daylight.
* **Identity is the vendor's own row**, so the hero paints before any request
  returns and never shows a skeleton.
* **The mode is one status word** with a live dot, not a badge rail.

Every hero link resolves into the existing Browse query
(`/browse?type=goods&search=…`); the search keeps its five scopes.

## 4. Cards: purposeful, not decorative

| change | why |
|---|---|
| Media ratio 4:3 → **16:10**, slot `10rem` → `11.5rem` (mobile) | A fifth more text per card, three cards still peek across the phone rail, and the same slot at every breakpoint so shelves stay level. |
| **`CardPoster`** — icon + label at the size of the slot | Most records in this network are not photographed. A 22px icon floating in an empty tinted box read as "missing image"; the same slot now carries the module's mark over the one word that says what you are looking at. Nothing is faked — the mark and the word come from the record. |
| **Person card** — market-green monogram panel | Its media box held one 56px avatar in the corner with two thirds blank. The slot is now the vendor's identity at full width: monogram, role label, verification, and a `Patron` mark where it applies. |
| **Markets** — the city on the mark, not the country repeated three times in the body | The body already says `Kisumu · Kenya`. |
| **Groups** — a one-line description where the record has one, and the group's own type on the poster | A group card was a title and two numbers. |
| **Events** — `Free entry` only when the organizer stated `0`; `Entry not stated` otherwise, and the same for the venue | The old card printed "Free entry" for a `null` fee, which is a promise the organizer never made. |
| **Services** — compact ranges (`KSh 15–45k once`) | A card is not an invoice; the offer's own page prints the full amounts. |
| **People** — `Fit 61` with a tooltip that explains the discovery score | It used to be a bare `★ 61`, which reads as a rating the vendor earned. It is the network's own ranking, and it now says so. |

## 5. Empty data, designed

* **The quiet network** is a panel, not a sentence: what is true
  ("Nothing has been published yet today"), what it means ("Being early is fine
  — what you ask for now is what the next vendor answers"), a `Check again`
  button, and three doors that genuinely help: post a request (opens the
  composer), browse the standing catalogue, find the businesses already
  registered. The old two-word buttons are gone.
* **My Shop before its numbers land** says `Reading your shelf…` instead of
  silently showing nothing.
* **Every card falls back to a stated absence**, never a zero: `Venue not
  stated`, `Location not stated`, `New to the network`, `Ask for a price`,
  `Entry not stated`. The pulse row shows `—` for a figure that has not
  loaded or does not exist, with the reason underneath.

## 6. Visual system

* **`--market-1` / `--market-2`**: the deep-green market surface, declared once
  in `tokens.css` and used by the hero and the identity posters (`.market-forest`).
  The dark theme deepens the same surface rather than inverting it, so one token
  file still re-skins the product.
* **`SectionHeader`**: 16px titles, description under the title, link on the
  title's baseline, hairline rule closing the block. It is the only shelf header
  in the product, so the change lands everywhere the pattern appears.
* **`StatStrip`** (`components/home/StatStrip.jsx`): a metric *group* — hairline
  separated cells, figure-led, each with the note that says where the number came
  from, and each optionally a link whose accessible name is label + figure + note.
  It replaces the boxed stat tiles and is reusable anywhere the product needs a
  compact read.
* **Mobile rails bleed** to the screen edge (`-mx-4 px-4` below `sm`), with a
  one-sided fade on phones only — a fade at the left edge where the rail meets
  the screen would look like a rendering fault.

## 7. Honesty rules carried over, unchanged

* The vendor's own records still never reach a public shelf
  (`publicShelfItems`); the footer still says so.
* Prices, availability, capacities, fees and ratings are the records' own words.
  Nothing is estimated, nothing is rounded up to something cheerful, and a figure
  that has not loaded stays `—`.
* The invite banner still promises no reward, because there is no referral
  programme in this build.
* An empty shelf still hides itself rather than padding the feed.

## 8. Tests

`src/test/homeFeed.test.jsx` (22) still protects the shelf contract, the
own-inventory exclusion, failure isolation, the carousel's swipe guard, the shop
summary and the invite banner — it passes unchanged.

`src/test/pages.test.jsx` was updated where a surface moved by design:

* the checklist's two specs now assert that setup *disappears cleanly* once the
  vendor is trading (the live read it used to hand off to is no longer
  onboarding's job), and
* a third spec covers the home pulse directly: listings from the loaded shelf,
  open trades from the movements, connections only once the endpoint answers,
  `—` where no rate exists, and no invented vocabulary anywhere in the row.

157 specs pass, `npm run build` succeeds, and `eslint` reports no errors.

## 9. Files

**New** — `components/home/HomeHero.jsx` · `components/home/BusinessPulse.jsx` ·
`components/home/StatStrip.jsx`

**Changed** — `pages/home/HomeHub.jsx` · `components/home/{HomeFeed,
CollapsedMyShop, CuratedShelf, DiscoveryShortcuts, ShelfSkeleton}.jsx` ·
`components/home/cards/{CardShell, PersonCard, MarketCard, CommunityCard,
EventCard, OpportunityCard, ServiceCard}.jsx` ·
`components/onboarding/SetupChecklist.jsx` · `components/ui/SectionHeader.jsx` ·
`config/homeShelves.js` · `styles/tokens.css` · `index.css`

## 10. Considered, and deliberately not done

* **A horizontal "near you" rail of mapped places.** Home is already eight
  shelves long; Nearby stays one tap away in the strip, and the shelf that would
  have duplicated it did not earn its vertical space.
* **A "Shortlist" or saved-items feature.** It would need a store, an endpoint
  and a story about who can see what — a product decision, not a styling one.
  The brief's point was to stop giving every idea its own card.
* **Pulling the network counters from `GET /vendors/stats`** to put a "N,NNN
  businesses" figure in the hero. It is one more request on the critical path and
  a number that grows stale between visits; the hero's promise is search and
  location, not scale.
