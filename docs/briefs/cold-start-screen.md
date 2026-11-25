# The cold-start screen: a mark that means what it says

Status: built and tested. Frontend only — no migration, no backend change, no
new route. Branch `arena/a4c40dde-brief`.

## What was actually wrong

The old screen was a timer wearing the costume of a progress report.

| Behaviour | What it did | Why it was wrong |
|---|---|---|
| Length | Always 5,000 ms | The application is sometimes ready in 200 ms and sometimes in 4 s. A fixed five seconds holds a working app hostage for four of them, and a slow one hostage for one. |
| Percentage | `elapsed / 5000` | It measured the clock. It climbed smoothly whether the session was resolved or the server was down, so it was a number that looked like progress and was not. |
| Copy | Two fixed sentences; the last two seconds said "Logging in to the network" | It claimed a sign-in that may never have happened, and it had nothing to say for the first three seconds. |
| Mark | `public/logo.svg` | The house with the desk inside it. It is the wrong drawing for this screen: it is a place, not a gesture, and it does not carry the product's initial. |
| Background | `bg-surface-0` | The same ivory as every page, so the screen did not read as a screen. It read as a blank page that happened to have a logo on it. |
| The page behind | A fixed overlay | It hid the application but did not stop the keyboard walking into it. A tab press could land on a control nobody could see. |

## The rules it now answers to

1. **It says what the application knows.** The application reports the
   milestone it has reached and the screen writes the sentence for it. It
   never writes a milestone the application has not reached, and it never
   invents one. A signed-out visitor is not told about a network.
2. **It leaves when the application is ready.** Not on a timer. There is a
   floor of 1,200 ms so that a warm start cannot flash, and a slow
   application is waited for however long it takes.
3. **It never shows 100% before the work is done.** A caller that can
   measure its own progress passes it in; the number is held at 99 until the
   application reports readiness. A caller that cannot measure gets a bar
   that moves instead of counting, and that bar carries no value at all.
4. **It settles.** The last line is held for 700 ms, and the lift away is a
   260 ms fade, so the screen never snaps.

## What it looks like

A sheet of deep forest. On it, an ivory badge carrying the **W** — a
monogram drawn as a network: two strokes of forest green woven under two
strokes of forest, with ivory knots at the joints and one node that breathes
at the apex. The badge is framed in gold. Below it, the wordmark, the promise,
and a line about the manner rather than the market.

Under the badge sits the **curated shelf**: five gold volumes of different
widths on a gold rule. One volume per milestone, and a volume lights when
the application reports that milestone. The shelf fills because the work did
— the metaphor and the measure are the same object.

| Token | Value | On | Ratio | Used for |
|---|---|---|---|---|
| `--wasta-forest` | `#0D2B24` | ivory | 14.12:1 | the monogram, the nodes |
| `--wasta-forest` | `#0D2B24` | canvas | — | the canvas itself |
| `--wasta-green` | `#2D6A5B` | ivory | 5.90:1 | the woven second stroke |
| `--wasta-gold` | `#C59B5F` | forest | 5.93:1 | the frame, the shelf, the bar, the number |
| `--wasta-gold-soft` | `#E2C598` | forest | 9.13:1 | the far end of the bar |
| `--wasta-ivory` | `#F8F7F4` | forest | 14.12:1 | every word |
| ivory at 62% | — | forest | 6.26:1 | the promise under the wordmark |
| ivory at 55% | — | forest | 5.24:1 | the quietest line |
| `--wasta-muted` | `#6B726E` | ivory | 4.60:1 | the hairline inside the badge |

Gold is deliberately kept **off** the badge: gold on ivory is 2.38:1, so the
gold stays on the canvas, where it has contrast. The loader's palette is its
own and does not follow the product's theme — a loading screen that
re-skins with the app is a flicker.

## The five changes

1. **The readiness signal is real.** The screen takes `ready` and
   `milestone` from the application. `App.jsx` reports `shelf` while the
   shell opens, `network` while a session is in flight, `curate` once the
   profile is known, and `prepare` when the session has settled. The old
   five-second timer is gone.

2. **The bar cannot lie.** Determinate only when the application supplies a
   measurement; otherwise it is indeterminate and omits `aria-valuenow`, as
   the ARIA authoring practices require. 100% is reachable only at readiness.

3. **The mark is its own.** An inline SVG with a W drawn as a network,
   animated with the Web Animations API so that a replay can rewind the same
   nodes instead of building a second mark. The draw-on is skipped entirely
   under `prefers-reduced-motion`, and the resting state of the stroke is the
   finished stroke, so the mark is never half-drawn.

4. **The page behind is inert.** While the screen is up, the routes are
   marked `inert`: no pointer, no tab order, nothing for a screen reader to
   walk into. The screen takes the focus itself and gives it back when it
   goes. The one focusable control wears a gold ring, because the product's
   green ring does not read on the forest.

5. **It can be replayed.** The replay rewinds the mark, puts the copy back,
   and walks the milestones the application actually reported, in order, at
   the same pace as the first time. The same nodes are reused, the pending
   exit is cancelled, and a completion belonging to a superseded run cannot
   land in the next one. The control is shown in development builds only.

6. **The document wears the screen's colour.** The screen is forest and the
   page behind it is ivory, so `index.html` paints the document forest
   before the bundle is parsed and the screen takes that paint away at the
   handover. The browser's own chrome — the strip across the top of a phone
   — is asked to match the screen while it is up, and is given its colour
   back afterwards.

## What was deliberately not done

- **No fake progress.** The screen does not estimate a percentage from the
  clock, and it does not count milestones and call the result a percentage.
  The volumes on the shelf show how many milestones are done; the bar says
  what it knows.
- **No second copy of the screen.** The mark is drawn by the screen itself,
  once. There is no static splash in `index.html` to keep in step with it —
  only the paint, which is one colour and no drawing.
- **No new route.** The loader belongs to the application, not to a page
  that pretends to be one.

## How it is checked

`src/test/bootSplash.test.jsx` holds twenty-two tests: that it waits for a
slow application, that it leaves when the application is ready, that it
settles before it lifts, that 100% never appears early, that an
unmeasurable bar carries no value, that there is exactly one polite live
region, that a replay leaves one mark and one live region behind and
inherits no stale callback, that the document is painted in the screen's
colour and released at the handover, and that the loader's own palette
clears AA on the surfaces it is actually used on. `src/test/contrast.test.js`
still governs the product's tokens; the loader answers to the same 12 px
floor and to its own measured ratios.
