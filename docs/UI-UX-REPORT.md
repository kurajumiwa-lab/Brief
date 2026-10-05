# My Shop App — UI & UX Report

Date: 2026-10-04 · Scope: the live app (home shelf, News, Markets, Tasks/Squad/Brief,
Stock, Suppliers, Rentals, Groups, Events, onboarding, auth).

## 1. What the app is doing well

**Honesty is visible in the UI, and that is the differentiator.**
- Zero renders as `—`, never as a padded number.
- "No data yet", "not located yet", "stale" badges state absence instead of hiding it.
- Every row carries its own timestamp ("re-stated 2h ago", "data checked 3d ago").
- A price is labelled as the vendor's stated unit or wholesale price — never a
  computed "market price".
For a market where people have been burned by fake activity and fake prices,
this reads as trust. Keep it absolute — one invented number undoes the whole
system.

**Consistent visual system.** One dark-glass surface language, one gold accent,
digital numerals for money/counts, one card radius, one badge language. Every
surface (News, Markets, Tasks, Stock) feels like the same product because the
tokens are shared. The "important number first" layout (big digital price left,
one line of support text, tap for detail) is the single most effective pattern
in the app.

**Progressive disclosure is working.** News cards lead with the decision info
(price / route / date / window) and hide min-order, quality, timing, and
requirements behind a tap. That is the right density for a scanning trader.

**Real actions everywhere.** Connect / claim / accept / leave / register are all
live verbs with immediate feedback (toast + state change). There is no dead UI
that pretends to work — which was a failure mode the app previously had and has
removed.

**Navigation is thumb-shaped.** Mobile: 3 doors + 1 overflow (Home / News / Stock
/ More). Desktop: sidebar with grouped sections. The overflow drawer carries the
long list, so the primary gesture surface stays small.

**Onboarding ties identity to geography.** The two-step first run (your shop page
→ walk your market radar) maps the MySpace "your profile is your face" idea to
the Pokémon-GO "the world around you is the content" idea. It is the strongest
concept in the app.

## 2. Friction points, ranked by impact

### 2.1 Four overlapping names for the work area (top priority)
My Shop App (product) · Brief (workspace) · Squad (league) · Tasks (portal).
A new user has to learn which word means "my work" and "my league". The Tasks
portal helps, but the words still differ between Home (Tasks), the sidebar
(Tasks → portal, then "Squad" and "Brief" doors inside), and the pages.
**Fix:** lock the hierarchy and state it once — "Tasks is the door. Squad is the
league. Brief is your workspace." A one-line caption under the Tasks header
does it. Do not add a fifth name.

### 2.2 The home shelf is now 8 tiles
It started at 4 (the intended MVP) and grew: News, Suppliers, Stock, Rentals,
Groups, Events, Markets, Tasks. Eight equal-weight tiles is a wall, not a shelf
— nothing is signposted. 
**Fix:** tier the shelf. 4 large primary tiles (contextual: the trader's core
loop — e.g. Tasks, Suppliers, Stock, News) + 4 small secondary chips (Markets,
Rentals, Groups, Events). A trader's hand should always know where the 4 core
doors are.

### 2.3 Text below 12px hurts the target reader
`text-2xs` is 10px. It is used for meta lines everywhere (sources, distances,
"checked 3d ago"). The audience is working traders, many 40+, often in bright
market light on a 5–6" screen. 10px is below a comfortable reading floor.
**Fix:** raise the meta floor to 12px (`text-2xs` → 12px) and reserve 10px for
true micro-labels only (uppercase tags, "KES" units). One token change, app-wide
gain.

### 2.4 "Scan" is a list, not a map
Markets and Nearby are distance-sorted lists. The word "scan your surroundings"
implies space; a list with "4.2 km" numbers is a step removed from that.
**Fix (medium effort):** a map view for Markets using OpenStreetMap tiles
(Leaflet + free tiles — no API key, matches the ODbL data already in use).
Show the 25 markets as dots, the user's pin, and the selected 1..N highlighted.
This is the single biggest "wow" available cheaply because the data already exists.

### 2.5 No persistent "home market"
Every scan starts from a radius around the caller. There is no saved
"my market" (e.g. "Gikomba, 10 km") that the home shelf, news, and markets
default to. 
**Fix:** one setting on My Page — pick a home market + radius. Home's "N new
today" and the Markets scan then default to it. This also makes the home
personal without inventing content.

### 2.6 English-only
The stated audience (mama mbogas, kibanda, market traders) is largely
Swahili-first. English-only is the largest adoption gap in the whole app —
bigger than any visual change.
**Fix (phase it):** start with a Swahili toggle for the fixed chrome (nav
labels, buttons, empty states — a small, finite string set) before attempting
dynamic content. The string set is small enough to translate in a day.

### 2.7 Notification surface is thin
The "N today" badge on News is the only ambient loop. There is no in-app alert
for: your call-up was accepted, your match is proof-pending, your market opened
a flash lock. These events exist as rows (contracts, locks) but do not ping.
**Fix:** wire the existing notification bell to these five states. The rows and
the bell already exist; it is a join, not a new system.

## 3. Per-surface notes

- **News** — the five templates (price / route / date / community / time-window)
  are a clear upgrade: each kind now leads with the number it acts on. Keep the
  filter chips; they double as counts. Watch card length as data grows — cap
  the detail block at ~6 rows.
- **Markets** — scan + multi-select + Get data is a good loop; the "18 found"
  result with distances works. Add the map (2.4) and the home-market default
  (2.5) and this becomes the app's hero surface.
- **Tasks portal** — correct consolidation: active match, open call-ups (accept
  in place), recent wins, two doors. Keep it a portal — do not duplicate the
  full match controls here; "Continue in Squad" is the right pattern.
- **Squad** — the league is deep (divisions, patrons, squad splits) and the
  depth is justified because it is earned. Risk: it is the most complex screen;
  watch that a first-time worker can find "accept a call-up" without reading
  the league first. The Call-ups tab should stay the default landing tab.
- **Stock / Suppliers** — distance-first, real stock counts, "not listed yet"
  states are honest. Supplier cards could lead with the single number a trader
  acts on (the price or the stock count) the way News now does.
- **Onboarding** — good concept, two real risks: it is dismissed permanently
  (localStorage) so a new *market* is never re-onboarded (tie dismissal to
  location, not device), and it swallows API errors silently (show a retry line,
  not a blank overlay).
- **Auth** — the dark split panel with the "your page / your market" framing is
  the right promise. The registration form is long; consider trimming to
  (name, handle, phone, location) and deferring categories to onboarding.

## 4. Prioritized roadmap (effort vs impact)

| # | Change | Effort | Impact |
|---|--------|--------|--------|
| 1 | Meta text floor 10px → 12px (one token) | tiny | high (readability for the audience) |
| 2 | Name hierarchy caption on Tasks/Squad/Brief | tiny | high (orientation) |
| 3 | Home shelf tiering (4 large + 4 small) | small | high (scannability) |
| 4 | Notification bell → 5 work states | small | high (the loop pings back) |
| 5 | Home-market setting + defaults | small | medium-high (personal home) |
| 6 | Map view for Markets (Leaflet + OSM tiles) | medium | high (the "wow", data exists) |
| 7 | Swahili chrome toggle | medium | high (adoption) |
| 8 | Supplier cards: single acting number first | small | medium (consistency) |
| 9 | Onboarding dismissal tied to location + visible retry | tiny | medium (correctness) |

## 5. The one-sentence version

The app now looks and behaves like one honest, data-first product; the next
levers are not features but **readability (12px floor), orientation (one name
hierarchy, tiered shelf), and pull (the bell pinging the five work states)** —
with a map view and a Swahili toggle as the two bigger bets.
