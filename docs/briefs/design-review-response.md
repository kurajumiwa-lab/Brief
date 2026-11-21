# Design review response: what was real, what was not

A design review scored the product 7.8/10 and asked for a complete
visual-design-system pass before more features. This is what came of it.

The most useful thing the review did was name a defect that had shipped three
times: **text on dark cards that cannot be read.** That is now a test.

## The measured problem

Nothing in the codebase measured contrast, so the palette was a matter of
opinion. Reading the real tokens out of `styles/tokens.css` and computing WCAG
ratios found:

| Pair | Ratio | Verdict |
|---|---|---|
| `ink-4` on card (light) | **3.89:1** | fails AA — and it carries 1,355 labels |
| white on `brand-600` (dark) | **3.15:1** | fails — this is *every primary Button* in dark mode |
| white on `brand-500` (dark) | **2.31:1** | fails — filled pills in Create, Nearby, NoticeBoard |
| `brand-100` on `brand-700` (dark) | **3.09:1** | fails — the Home next-step card body text |
| CounterShelf supporting text | 3.74–4.26:1 | fails — 8 of its 13 text elements |

The review's headline example was the Home "next step" card, and it was right.
The cause was subtler than "dark text on dark green": the card used
`bg-brand-700`, and `brand-700` **flips to a mid-teal in dark mode**, so the
light-green supporting text on it lost its contrast. It is now `bg-brand-800`
with white at measured opacity — 7.06:1 and 5.92:1, in both themes.

## What changed

1. **`ink-4` #74857F → #5F716A.** Clears 4.5:1 on every light surface it is
   used on (card 5.18, page 4.91, surface-2 4.59, brand-50 4.69). "Metadata
   only" cannot mean "may be unreadable" — a person still has to read it, and
   400 of those uses sit at 11px.

2. **The dark brand ramp now carries white.** `brand-600` was `#25A386`, where
   white was 3.15:1; it is `#1A7C65` (5.10:1), with `brand-700`/`800` stepped
   down behind it. Every primary button and filled pill inherits the fix.

3. **Purple is gone from content.** The referral banner was a hardcoded
   `#963F70` magenta gradient; it is now one green family. The avatar palette
   was eight unrelated hues (orchid, indigo, rose, orange, blue); it is eight
   greens verified at ≥4.5:1 with white in *both* themes. MePage's workspace
   headings and sparkle were `orchid-600/700` — lilac on cream — and are now
   brand.

4. **The counter shelf is a list, not a grid.** The review called it "visually
   heavy": a 2×2 of dark tiles inside a dark slab is three stacked weights of
   green. It is now four divided rows — a manifest, which is what a counter is —
   and every text element clears AA.

5. **The Inbox is split by question.** "Is anybody waiting on me?" and "what is
   happening near me?" are different questions; interleaving them made one long
   feed. There are now three modes (Everything / Waiting on you / Your
   activity), Everything stays the default so nothing is hidden, and each mode
   has an empty state that says what it means rather than showing a blank.

6. **The three text levels are declared** in `tailwind.config.js`, as a pairing
   (primary → ink-1 + title; secondary → ink-2/3 + xs/sm; muted → ink-4 +
   micro/2xs) rather than as a colour list, because the defect is a *mismatch*
   between level and role.

## What the test does

`src/test/contrast.test.js` reads the real token file and asserts 55 pairs: all
four inks on all four light surfaces, white on every brand fill in both themes,
white at three opacities on the dark cards, the counter slab's worst case, and
that the avatar palette contains no hue outside the green family.

Verified it fails on the old value before trusting it — restoring `#74857F`
produces four failures naming the exact ratio.

## What I did not change, and why

- **The five-level standing, the bottom navigation, the information
  architecture.** The review told me to preserve these. I did.
- **Spacing.** The review asked to "standardize spacing". There is already a
  token scale (`--space-1..8`, `--shelf-gap`, `--section-gap`) and a documented
  page rhythm; the inconsistency, where it exists, is screens not using it. That
  is a sweep of its own, not something to half-do here.
- **The marketplace merchandising palette (`mk-*`).** Cream and terracotta are
  deliberately scoped to discovery. The review recommended exactly this split —
  green is the brand, orange is marketplace activity — so it stays, and the tab
  bar still turns terracotta inside Regions because that *is* the marketplace
  identity, not a second one.
- **Dark mode has no visible toggle** except in the account menu, so much of
  this was latent. It is fixed anyway: it is reachable, and a pairing that fails
  in one theme is a defect waiting for a user.
