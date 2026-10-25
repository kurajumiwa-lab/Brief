# Design tokens — mapping the build notes' palette onto the live system

Status: **documented, not applied.** Nothing in this change re-skins the product.
The brief's §7 palette is a direction for a future visual pass; applying it is a
deliberate, separate change with its own contrast and dark-theme verification.
Writing the mapping down now is what stops that future change from turning into a
hunt through 300 components.

## Why not just paste the hex values in

The product is already token-driven. `frontend/tailwind.config.js` resolves every
colour to an `rgb(var(--…))` variable declared in `src/styles/tokens.css`, and
`.dark` is a peer theme rather than a pile of overrides. The ramps were chosen
and contrast-checked (comments in `tokens.css` carry the measured ratios, e.g.
`--ink-1: 23 30 26; /* 14.9:1 on surface-1 */`).

Hand-editing hex values into components — or overwriting the ramps in place —
would break that contrast work and the dark theme in one commit. So the correct
sequencing is: change values in `tokens.css`, verify the ratios, and let the
components follow.

## The mapping

| Brief token | Hex | Role in the brief | Lives today as | Note |
|---|---|---|---|---|
| **Forest** | `#163A32` | Primary brand, navigation, trust surfaces | `brand-700` / `brand-800` (currently `20 88 60` / darker) | The brief's green is deeper and bluer. Moving `brand-600` toward `#163A32` darkens every primary button — check `white on brand-600` ≥ 4.5:1 before accepting. |
| **Paper** | `#F5F0E6` | Warm backgrounds, editorial surfaces | `surface-0` / `surface-1` (currently near-neutral `251 251 249`) | This is the single biggest perceptual change: it makes the product warm rather than white. Apply to light theme only; dark theme keeps `surface-0: 12 15 13`. |
| **Brass** | `#C6A15B` | Restrained accents, highlights | `accent-*` ramp (currently amber, darkened to `217 119 6` for 4.5:1) | Brass on white does **not** reach 4.5:1 at body size. Use it for fills, rules and large numerals; keep the darkened amber for text. |
| **Ink** | `#25313A` | Body text, dense business data | `ink-1` / `ink-2` (currently `23 30 26`, green-tinted) | Cooler than the current ink. Body text is the least risky change and the one vendors notice most, in a good way. |
| **Sage** | `#E7EEE8` | Positive states, secondary panels | `ok-soft`, `surface-2` | Maps cleanly onto the existing `ok-soft`. |
| **Clay** | `#B84A3A` | Warnings, destructive actions | `danger` (`#B84A3A` is close to the existing red) | The product deliberately has exactly one red so it always means the same thing. Keep that rule: clay is `danger`, not a second "warning" hue. |

## Rules that survive any re-skin

These are behavioural, and a palette change must not break them:

1. **Status is never carried by colour alone.** Every badge and state chip also
   carries a word (`Paid`, `Awaiting provider`, `Failed`).
2. **One red, one meaning.** Destructive and error share `danger`. A second warm
   hue for "warning" would dilute it; use `warn` tokens, not a hue.
3. **Operational data uses the sans stack.** `JetBrains Mono` is for references,
   receipts and IDs — never for a price a vendor has to read quickly.
4. **Motion never delays a state change.** Inventory and payment state appear
   immediately; transitions are for hover and press only.
5. **Explicit timestamps beat ornament.** Any computed figure says when it was
   computed (this is why the Morning Brief and Receipts pages both print one).

## What to verify before merging a re-skin

- [ ] Contrast: body text ≥ 4.5:1, large text ≥ 3:1, focus ring ≥ 3:1 against
      both `surface-0` and `surface-2`, in light **and** dark.
- [ ] Forced-colours / high-contrast mode still shows every state.
- [ ] `grep -rn 'bg-\[#' frontend/src | wc -l` does not increase. It is **65
      today** — the Ops console uses a hand-tuned dark panel — so this is about
      not adding more, not about zero.
- [ ] Screenshot the Morning Brief, Receipts, checkout and `/legal` in both
      themes before and after.
