# Visual direction: vibrant commerce

**Chosen:** vibrant commerce · clean and spacious · fresh green + orange · entire app.

This supersedes the standing "don't add colours, refine what exists" instruction.
That rule existed to stop decoration being added to a muted interface. The review
found the interface itself was the problem: "muted, atmospheric and artificially
generated rather than like a real, active product people use every day." The fix
is not more decoration — it is a corrected base, which is what this is.

## What changed, and where

Almost all of it is in **`frontend/src/styles/tokens.css`**. Every colour in the
product already resolved through an RGB triplet there, so the whole app re-skinned
without touching 400+ component files. That is the payoff of the token layer and
the reason this took one file plus targeted clean-up rather than a rewrite.

| | before | after |
|---|---|---|
| Brand 600 (primary fill) | `#103C35` near-black teal | `#087F5B` emerald |
| Brand 500 (working) | `#1F7A66` | `#12A879` |
| Page canvas | `#F8F9FA` cool grey | `#F7F8F5` warm paper |
| Ink 1 | `#182522` | `#122B24`, darker |
| Accent 400 | amber `#FBBC24` | orange `#FF8A3D` |
| Hero / counter slab | 3-stop dark gradient | solid `brand-600` |
| Photo backdrops | `#171021` plum-black | `ink-1` warm dark |
| Category tones | plum purple `#2A1F3D→#4B3568` | greens and oranges |
| Smallest text | 10px (142 uses), 11px (82 uses) | 12px floor |
| Card radius | mixed up to 24px | 12px and 16px only |

### The three named faults, answered

1. **"Too much grey."** The canvas was cool grey and `ink-1` was a middling
   `#182522`. Canvas is now warm paper, which is what makes a white card read as
   *placed* rather than floating, and ink is darker. Every ink step still clears
   4.5:1 on every light surface — asserted, not assumed.
2. **"Too many dark gradient panels."** The Home hero and the counter slab were
   three-stop gradients from `brand-800` through `brand-900` to `ink-900`, plus a
   blurred orb. Gradients on near-black are exactly what reads as glassmorphism.
   Both are now solid `brand-600`, one radius, no orb. Eleven hardcoded
   `#171021` photo backdrops moved to the `ink-1` token.
3. **"Weak visual hierarchy."** Partly the 10px/11px text (224 arbitrary sizes
   below the declared 12px floor) and partly the gradations of near-identical
   green. Both are gone; hierarchy is now carried by type size and one action
   colour.

### Orange is a second voice, never a third action colour

Orange covers referral, rewards and scan actions. Green remains the only fill of
a primary button. Because one token cannot be both a *fill under white text* and
*readable text on a dark card*, orange has two values and callers must use
`accent-700` for orange text. A contrast test asserts both.

### Copy

| was | now |
|---|---|
| The town network | Explore your town |
| Referral index | Referrals |
| Claim local work | Find work |
| Merchant dashboard | For shop owners |
| Live street | Meet nearby |

## What is enforced by tests, not convention

- **`src/test/contrast.test.js`** — reads the real values out of `tokens.css`.
  60 assertions: every ink on every surface in both themes, white on every brand
  fill, the dark-card reduced-opacity pairs, orange as fill *and* as text, and a
  scan that fails if any file reintroduces text below 12px.
- **`src/test/brand.test.js`** — the retired-name scan, unchanged.

Two of those assertions caught real defects during this work and are worth
recording: `accent-600` as *text* on a dark card was 3.55:1, and the avatar
component carried `text-[7px]` and `text-[8px]` classes below the floor.

## Verified

| | |
|---|---|
| Frontend tests | 95 files / 691 pass |
| Production build | 639 kB main bundle (was 654.78) |
| Contrast | 60 assertions pass |
| ESLint | 26 errors — the same pre-existing backlog, none added |

**Not visually inspected.** The sandbox could not download a headless browser, so
this change is verified by tests, a build, and the compiled CSS carrying the new
tokens — not by a screenshot. The first person to open the site is the first to
see it. That is a real limitation of this delivery and should be checked.

## What is deliberately unchanged

- **WhatsApp green** (`#25D366`, `#128C4A`) — it is WhatsApp's brand, not ours.
- **The discovery/editorial palette** (`mk-*`: cream, plum ink, tomato) — a
  deliberately separate shopfront voice, documented in `tokens.css`.
- **Dark mode** — remains a true peer theme, re-derived from the new ramp, and is
  covered by the same contrast assertions.
- **The five-item bottom navigation and five-level standing.**
