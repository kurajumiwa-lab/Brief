# Phase 7 status and PR map

Owner review (2026-11) asked for one record that maps mandate items to GitHub PRs. This is it.
Update it in the same PR that changes a state. Last updated on branch `arena/8b6aabc6-brief`, based on `main` at `abf3f79`. Not yet merged.

## PR map

| Mandate item | Mandate number | GitHub PR | Branch | State |
|---|---|---|---|---|
| Credentials off by default; plan doc (phases 0 to 6) | PR 100 | #100 | arena/81ab57de-brief | merged |
| Rebrand only | PR 101 | #101 | rebrand/home-office-phase7 | closed, superseded by #104 |
| Rebrand, drawable logo, Book Service link, Work copy | PR 101 | #102 | arena/81ab57de-brief | open, superseded by #104, not closed |
| Rating gate and data-based discovery | PR 102 | #103 | arena/d5093408-brief | merged (`d9f0c19`) |
| Rebrand, Book Service link, Work copy, rating team block | PR 101 and 102 | #104 | arena/bb0cf6b5-brief | merged (`a36d693`) |
| Partner teams (`office_partners`, Fluid Teams backend) | PR 103 | #105 | arena/f85ab880-brief | merged (`abf3f79`) |
| Maturity gates (data-density check) | PR 104 | not started | - | - |

The mandate's numbers do not match GitHub's. Use this table, not the mandate, for any PR reference.

## Flags in `main`

All three default to off. Nothing new is live.

- `POST_TRADE_RATING_GATE_ENABLED = False`
- `DATA_DISCOVERY_RANKING_ENABLED = False`
- `FLUID_TEAMS_ENABLED = False`

## Migrations

- `0049_post_trade_ratings`: in `main`, not yet run on staging or production.
- `0050_office_partners`: in `main`, not yet run on staging or production.
- `0051_trade_finalisations`: on this branch. Adds the closed-window record for unrated trades.
- `0052_office_notices`: on this branch. Adds the home office noticeboard.

## What is in `main`

**Rebrand (#104):** "Home Office" name, SVG logo on the boot splash, house favicon, "Book Service"
button on the professional card, Work copy mapping.

**Rating gate (#103, #104):**
- A client rates a supplier 1 to 5 stars after a completed trade. A supplier records "failed" or
  "fraud" about the client only, never stars.
- One rating per party per trade. Ratings cannot be edited or deleted through the API.
- Self-rating blocked: a business cannot rate its own booking.
- Shared contact blocked: nobody rates a trade with a business that shares their contact number.
- Team blocked: nobody rates a trade with a member of an office they belong to, or with a member of
  an active partner office (#105).
- Sample floor: a supplier's rating moves rank only after 3 ratings from different clients
  (`scoring.MIN_RATINGS_FOR_RANK`). Below that, the count shows and the average is withheld.
- Repeat clients: a client counts once per supplier in the 90-day window, using their latest rating.
- Rating window: 14 days from completion. After that, no rating can be added. A trade that passed
  the window unrated is recorded as final (`trade_finalisations`). Nothing else changes: its status,
  its completed count and its rank stay as they were. The job is `ratings_housekeeping` in the ops
  workflows. It does nothing while `POST_TRADE_RATING_GATE_ENABLED` is off, and nothing schedules
  it automatically yet.
- Walk-in bookings (no client account) cannot be rated. They count as completed, but add no exposure.
- Privacy line on the rating prompt (Kenya Data Protection Act 2019).

**Fluid Teams backend (#105):**
- `office_partners` table. One row per pair of offices, status `invited`, `active`, `declined`,
  `removed`.
- Routes under `/api/office/partners`, 404 while the flag is off: invite, answer, end, list.
- Only an active owner of an office can invite, answer or end a link. An office cannot partner with
  itself. A pair of offices has at most one link.
- Partner-team panel on the Office page (frontend), shown only when `VITE_FLUID_TEAMS_ENABLED=true`.
  An owner invites by typing the other office's ID. The other owner accepts or declines.

**Team features (Fluid Teams, flagged):**
- Noticeboard (`/api/office/notices`, frontend panel on the Office page): members read; owners and
  editors post, edit and delete; authors may edit their own posts on the server.
- Work event coordination: already in place (office calendar and events).

## Decided and removed

- **`UserLink` anti-gaming block:** dropped by owner decision. The team and shared-contact blocks
  cover the same risk. There is no `UserLink` model.
- **Stranded trades:** the ranking-only policy was replaced by the 14-day window above, by owner
  decision.

## Not built

- **Work hours booking and management** (`home_office_workers`): the owner named it, but no spec
  for what it books or manages. Existing pieces: office hours as text, and work assignments.
- **Marketing strategies and opportunities** (`home_office_workers`): no spec.
- **Nearby:** only front doors are reordered. `/api/nearby` keeps its "not ranked" behaviour.
- **Scheduling the rating-window job:** the job exists as an ops workflow. Something must run it
  daily. Not set up here.

## Not verified yet

- **Logo on a device:** not checked. The logo was rendered to PNG and looked correct, but no device
  or browser was used to view the splash.
- **Book Service walkthrough:** not run end to end on a real account.
- **Nurse walkthrough:** not run. Service profiles and front doors are off by default.
- **Partner backend, noticeboard, and rating window:** no tests were written or run, at the owner's
  request. Syntax compiles ran on the backend. The frontend build passed.

## Open items

- **Legal review (Kenya Data Protection Act 2019):** not started. Covers consent and notice, purpose,
  retention limits, and access and correction rights. Needs to happen before any flag is turned on.
  Your earlier order put legal review before Fluid Teams. #105 was built ahead of it.
- **Retention:** no retention period is set, and no purge job exists. The prompt does not claim one.
  Noticeboard posts are kept until deleted.
- **Access and correction:** no request path is built. The prompt says nothing about it.
- **Privacy notice wording:** the prompt's notice is a minimum. Final wording goes to legal review.
- **Maturity gates (PR 104 in the mandate):** not started. It is a pricing decision. It waits for
  legal review and needs owner approval of the list of "data-rich" regions.
- **Language:** "harvest", "data as currency", and "take" are not used in any user-facing copy.
