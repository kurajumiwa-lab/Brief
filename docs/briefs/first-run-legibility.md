# First-run legibility: one save, one door, one counter

Status: built and tested. Frontend only — no migration, no backend change, no
new route. Branch `arena/8035f104-brief`, PR #129.

## What was actually wrong

Four reports arrived as phone screenshots. Three were not missing features.

| Report | Real cause |
|---|---|
| "There is no save button when I add photos." | There was one. `AddGalleryModal` sat at `z-40`, the same layer as `MobileTabBar`, so the button rendered *underneath* the tab bar. |
| "I cannot find where to add services or a price." | The only screen that sets a price is `/desk`, and it was behind `VITE_DESK_ENABLED=true` — off by default. In production the screen did not exist. |
| "Which page? Where do I edit it?" | Honest but scattered: the page editor, photo sheet, capabilities and records lived on four different screens, and the copy named the mechanism ("Discovery preview") rather than the consequence. |
| "Home office is a white page." | Not reproducible in this revision: `/office` always draws a heading, and a render error is caught by `Shell`'s `ErrorBoundary`. It is either a stalled request drawn as one grey word, or a stale bundle. Both are now impossible to mistake for a broken app. |

## The five changes

1. **One save, always on screen.** `/you/page` keeps its single save, but moves
   it into a fixed bar (`data-testid="page-save-bar"`) that also says *Unsaved
   changes* / *All changes saved*. The bar is above the tab bar
   (`bottom-[calc(env(safe-area-inset-bottom)+3.5rem)]`, `z-40` with the tab bar
   below it) and every other sheet is `z-50`. The discovery toggle saves
   immediately and moves the baseline with it, so an instant save never leaves
   the bar nagging.

2. **One door to the offer editor.** Create now has a "Something you sell"
   section with three links — `/desk?new=service|goods|tool`. `/desk` reads the
   parameter, opens the form on that kind, and cleans the URL. The choice is
   held in state, not read back off the address bar: a value that vanishes from
   the URL must not vanish from the form. The desk itself is now **opt-out**
   (`VITE_DESK_ENABLED !== "false"`) because a capability that central must not
   depend on a flag nobody flips.

3. **One address for photos.** `/p/<handle>?add=photos` opens the photo sheet on
   arrival. `/you` links to it from "What I do", and the page's own "Add or edit
   work" now points there instead of at the page editor, which never had a work
   editor.

4. **"Who can see this" is answered in words first.** The old "Discovery
   preview" card showed a mechanism. The new card states three facts — anyone
   with the link; findable in Regions or not; discovery can be switched off
   without taking the page down — *then* offers the switch, *then* shows the
   card it produces.

5. **The counter on Home.** `CounterShelf` is on the real home screen
   (`TodayView`), between the next-step card and the receipt card: a dark slab
   with four lit positions (page, what you offer, receipts, every record) and a
   manifest underneath. It says, in its own footer, that Brief holds no money
   and lends none. It reuses the setup reading Home already made — no second
   request — and shows *N open* or *All in order*.

## Tests that pin the behaviour

New: `counterShelf`, `homeCounter`, `pageEditorSaveBar`, `deskDoors`,
`portfolioPhotoDoor`, `createSellDoor`, `officeNeverBlank`. Changed on purpose:
`deskFlag` and `frontDoorsFlag` now assert the desk is **on** by default, with
the reason in the test.

Full frontend: 106 files, 778 tests, `vite build` green, eslint clean on every
file this branch touches.

## Not done, and why

- **No migration.** Nothing here needed one.
- **HomeHub is not Home.** `/` renders `TodayPage` → `TodayView`. `HomeHub` is
  tested but not routed; the counter was put in `TodayView` for that reason. If
  `HomeHub` is ever restored, it already renders the counter too.
- **The desk flag flip is a judgement call, not a bug fix.** It changes what
  production shows. The alternative — leaving it off and documenting a build
  variable — is what produced the report.
