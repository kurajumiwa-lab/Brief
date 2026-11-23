# Visual direction: the complete redesign brief

**Status:** applied to the token layer and to Home, the tab bar and the category
strip. Committed on `arena/f89a8063-brief`.

This supersedes both earlier directions. The sequence matters, because the branch
contains all three:

| | palette | canvas | action |
|---|---|---|---|
| v2.18 (before this branch) | forest teal `#103C35` | cool grey `#F8F9FA` | teal |
| v3.0 (direction D, earlier commit) | emerald `#087F5B` | warm paper `#F7F8F5` | green, orange second voice |
| **v3.1 (this brief)** | **deep teal `#123D35`** | **warm ivory `#F7F5F0`** | **coral `#F06443`** |

Only the last one is live. The intermediate commit stands in history; nothing in
the code refers to emerald any more.

## Where the brief could not be followed literally

The brief's section 8 asks for WCAG AA. Three of its hexes cannot meet that in
the role the brief assigns them, so each has a derived value for that role and
keeps the literal hex everywhere else. This is asserted in
`src/test/contrast.test.js`, not just noted here:

| brief value | ratio | role | what the code uses |
|---|---|---|---|
| coral `#F06443` + white text | **3.18:1** | action fill | `accent-600` (darkened coral, 5.10:1) |
| amber `#E9AE55` + white text | **1.97:1** | surface / highlight only | `amber-400` as a background; never a fill under white |
| slate `#737B77` body on ivory | **3.99:1** | body text | `ink-3`/`ink-4` (5.6:1 / 4.9:1) |
| rentals blue `#477DAA` + white | **4.39:1** | label text | `cat-rentals-text` on `cat-rentals-soft` |

Teal `#123D35` (12.04:1), charcoal `#202522` (14.29:1), goods terracotta
(4.69:1), services forest (5.50:1) and events purple (4.87:1) all pass as
specified and are used exactly as given.

The literal coral is still used — as `accent-400`, for tinted panels, large
decoration and icon fills, where it is not behind small white text.

## What was rebuilt, not just recoloured

**Home (`TodayView`).** The discovery band is new: four category doors with the
brief's own colours, a location line, and a "Browse all" affordance — placed
*before* the identity strip, because a marketplace opens on what is for sale.
The counter's heading and eyebrow now read "Your business today" / "For shop
owners", keeping merchant tools visually separate from discovery as the brief
asks. The hero and counter slab are flat teal (the review's complaint about
gradients), and Live Street keeps the one gradient the brief explicitly grants it,
plus a live activity dot.

**Category strip.** Uses `cat-*` tokens so Goods, Services, Rentals and Events
are distinguishable by colour and icon rather than by reading the label.

**Bottom navigation.** Unchanged in structure — five destinations, fixed, safe
area respected — with Create now a coral ringed circle, which is what the brief
means by "prominent central Create button". Its docstring claimed Create was not
a tab; that had been false since Create returned to `PRIMARY_NAV`, and it is
corrected.

**Tokens.** `amber-*` and `cat-*` (with `-soft` and `-text` per category) are new.
The 8px spacing scale is added as `g1`–`g8` alongside the existing 4px scale
rather than replacing it, because 1,000+ existing usages depend on the old one.
The brief's type ramp is named `text-page` / `text-section` / `text-card-title` /
`text-body-lg` / `text-button`.

## What is NOT done from the brief

Stated plainly rather than left to be discovered:

1. **Photography.** The brief asks for authentic African commerce imagery
   throughout. That needs real images — licensed photographs or the owner's own.
   No placeholder stock was added, because generic stock is the exact thing the
   brief says to avoid. Where images are missing the existing category-coloured
   fallbacks apply, which is also what the brief prescribes.
2. **Steps 4, 6, 7, 8 and 10 of the Home journey** — promotional banner, nearby
   goods/services/rentals with photos, featured deals, events, receipt rewards
   dashboard — are not composed into Home yet. Home has discovery, business
   tools, receipts, Live Street, dated rounds and the inbox line. Adding the
   marketplace carousels requires product imagery (point 1) to look like
   anything, so they are sequenced behind it.
3. **Search bar and header restructure.** The header exists; it has not been
   rebuilt to the brief's compact logo + search + bell + profile arrangement.
4. **Not visually inspected.** The sandbox cannot download a headless browser.
   Everything here is verified by tests, a build and the compiled CSS.

## Verified

| | |
|---|---|
| Frontend tests | 95 files / 703 pass |
| Contrast | 72 assertions pass |
| Production build | 639 kB main bundle |
| ESLint | 26 errors — the pre-existing backlog, none added |
| Built CSS carries | `--brand-600: 18 61 53`, `--accent-400: 240 100 67`, `--surface-0: 247 245 240`, `--cat-goods: 185 87 53` |
