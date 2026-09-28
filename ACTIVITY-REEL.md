# Activity Reel — Latest activity, as a stream with one interaction grammar

**Branch:** `arena/01a0e5ae-brief` (from `main` @ `e37d88e`)

## The problem, in one line

`Home → Latest activity` was five grey rows with a chevron each. Rows are a
*reading* shape — they say "here is a record". What is actually happening
around you is a *stream*, and the panel was also cutting the events off the end
(the board emits every offer first, so with five or more offers the Saturday
event could never be reached).

## What landed

| File | What it is |
|---|---|
| `preview/src/ui/gestures/grammar.ts` | The vocabulary. Pure functions: what a finger meant. No DOM, no React. |
| `preview/src/ui/gestures/useGestureSurface.ts` | The vocabulary wired to a pointer: wobble, second fingers, cancels, holds, the click a drag leaves behind. |
| `preview/src/features/home/ActivityReel.tsx` | The reel: deck, story meter, edge taps, peek, detail, actions, notices. |
| `preview/src/ui/activityReel.css` | The physics: deck offsets, depth, the deal-away exit, reduced motion. |
| `server/src/domain/discoverSummary.js` | Every feed row and the featured card now carry `objectId` (read from the row, never minted). |
| `preview/activityreel.jsx` | 13 checks: the grammar's numbers, every gesture, and every honesty rule below. |
| `preview/compacthome.jsx`, `preview/tiles.jsx` | Updated to the new shape, keeping their original intent. |

## The grammar

One vocabulary, borrowed from what every phone already taught the user. It is
not a new language and it is not a lookalike of any one app — it is the
familiar *physics*, given a purpose here.

| Gesture | Intent | What the user learns | Also reachable by |
|---|---|---|---|
| ← → | `browse` | "I'm moving through the set." | edge controls, ← → keys |
| ↑ | `open-detail` | "There is more here." | **Details** button, ↑ key |
| ↓ | `close-detail` (in the detail) / `dismiss` (in the set) | "Back", or "I've dealt with this." | **Close**, **Not for me**, ↓ / Esc |
| tap | `act` | "I can inspect this." | the same Details button |
| 2× tap | `quick` | "Act on this one, now." | the card's own quick-action button, and the same button in the detail |
| hold | peek | "I can look without leaving." | the detail (the peek reveals nothing it doesn't) |

The numbers are thresholds on a fingertip, pinned by the suite:

    tapSlopPx 10 · holdMs 320 · doubleTapMs 280 · browseCommitPx 52
    depthCommitPx 56 · dismissCommitPx 96 · axisBias 1.15 · flickVelocity 0.45 px/ms

**The double tap does not defer the single tap.** Two taps on one spot run the
card's single honest quick action (Save, or Message the seller where a seller
published a number) — but the first tap has *already* done its job the moment
it happened, so nothing waits 280 ms to find out whether a second tap is
coming. Selection stays instant; the second tap says "no, the thing itself",
puts the panel the first tap opened back down, and runs the action. The suite
pins all the ways this must *not* fire: two taps 600 ms apart, two taps in
different places, a swipe between two taps, and a card with no quick action
writing nothing at all.

`axisBias` is the one that matters most in practice: a diagonal drag belongs to
neither axis until one clearly wins, so browsing and scrolling never race each
other for the same 28 pixels. A flick commits with less distance than a slow
drag; a 20 px nudge commits to nothing and snaps back.

### Every gesture has a labelled twin

A gesture nobody can find is not a feature, it is a secret. So the words are on
the card itself, in the phrases people already use for these moves — *Swipe ↑
for details · Swipe ← → to browse*, and *Double-tap to save* on the cards that
actually have a quick action — under a legend that names the whole vocabulary:
**← → browse · ↑ details · 2× quick action · hold peek · ↓ deal with it**. Every
one of them is also a real control: Previous / Next activity, Details, Save, Not
for me, Close. Nothing in the reel is reachable *only* by a swipe, and the
position is announced (`1 of 5`, `aria-live="polite"`).

## The rules that keep it from becoming a toy

1. **The rows are the board's rows.** No counts, no crowd, no "trending". Each
   detail repeats the board's own reason and attributes it: *"On the board
   because: newest live listing."*
2. **Which five, and why.** The board's order (offers newest-first, then events
   soonest-first) is kept, but the selection is stated: the **two soonest events
   stay in view** and offers fill the rest, bounded at five. That is a choice
   about what to show, not a ranking of what matters — and it is what stops a
   party from being permanently out of frame.
3. **An action is offered only where it can land.** "Save" and "Not for me" are
   keyed by an object id, so the server now sends `objectId` per row (a
   listing's own, or an event's campaign object; `null` when there is none) and
   a row with no object gets **no button at all** rather than a 404 wearing a
   button's clothes (against the live server, saving a listing id answers
   `404 {"error":"object not found"}`). The same rule governs reaching a seller: a contact must be a
   number the seller wrote ("WhatsApp" as a method name is not a number, and is
   not dressed up as one — the card says so instead).
4. **What is remembered is described in the words it deserves.** A save and a
   "not for me" are server rows: they survive a reload, and the reel filters
   against them on load. "Seen" and a hide with nothing to record it against are
   *this device's* memory — and the notice says exactly that, rather than
   implying a preference the app cannot keep.
5. **A write that failed is never shown as one that worked.** A failed save
   reports the server's own words and does not flip the icon; if
   `not_interested` cannot be recorded, it is taken back out of the server-side
   set and kept (and named) as a device-only hide.

One thing is deliberately absent:

- **No app-wide rollout yet.** The grammar is a shared module so the vocabulary
  can spread; the reel is the first surface that speaks it. Other surfaces
  adopt it as they are reworked, rather than being rewritten blind.

## How this was verified

    npm run test:typecheck                      # tsc, clean
    npm run build:client                        # vite build, clean
    bash run-suites.sh activityreel compacthome # 18 passed / 0 failed
    cd server && node test/discoverSummary.mjs  # PASS 10

`discoverSummary.mjs` now ends with two checks aimed straight at this feature:
one that every row's `objectId` either resolves to a real object or is `null`
(never a listing id wearing an object id's name), and an HTTP round trip that
registers a viewer, saves the id an event card shows, reads `/api/me` back,
records and undoes a `not_interested`, and confirms a listing id is refused
with `object not found`.

Then a live pass with the real client against a real server — the whole point
being the part a stub cannot tell you. With `BRIEF_DEV_AUTH=1` on a throwaway
copy of the store, the reel was mounted over the live board and driven with
real pointer gestures and labelled controls: `Next activity` to walk to an
event; **a double tap on the card** (`POST /api/me/saved/<obj>` → 200, the row
appears in `/api/me`, the card says "Saved", the panel the first tap opened is
back down); the same double tap again (`DELETE` → 200, the row is gone);
`Details` → `Not for me` (`POST /api/me/relevance` → `not_interested` on the
object, the card leaves the set) → `Undo` (`DELETE` → gone from the server's
own state); and a double tap on an offer with no object, which wrote **nothing**
rather than 404ing behind the user's back. 16 checks, 0 failures. This is also
how two things were caught before they shipped: the events being cut off the
end of Home, and the seller's "WhatsApp" contact being shown as though there
were a number behind it.

`preview/activityreel.jsx` pins, among others:

- the grammar's thresholds and the axis bias, including the diagonal that must
  do nothing;
- browse by swipe, by edge control and by keyboard agreeing on the same index;
- up/down as depth, with a hold that peeks and does **not** also count as a tap;
- a press that starts on a control never becoming a card gesture;
- dismiss writing exactly one `not_interested` row against the object the row
  carries, with Undo taking it back out of the server too;
- a row with no object offering no Save button, and no phone number invented;
- a failed save reported as failed, and a device-only hide called a device-only
  hide;
- the double tap: one action from two taps on one spot, and **no** action from
  two taps apart, two taps in different places, a swipe in between, or a card
  that has nothing to do.

### Pre-existing failures (unchanged by this work, verified against the baseline)

Running the full preview runner on a clean checkout of `main` @ `e37d88e`
reproduces all of these identically:

- suites that crash hard on an unrelated assertion:
  `errandslobby`, `spacestorefront`, `room`, `appbelt`, `cards`, `backdoors`,
  `spacemoderation` — and `tiles`, whose **You** section is stale (that surface
  is now a disclosure list, not a sheet grid) and crashes before reaching its
  Home section;
- `spaceloop`: 2 failures (`compact home names the network`, `space creation
  stays reachable`);
- `dukabook` needs `preview/dist` to exist first (`npm run build:client`).

This change does not add to that list, and the Home section of `tiles` passes
(verified by running the suite with its stale You section removed).
