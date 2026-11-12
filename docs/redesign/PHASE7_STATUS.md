# Phase 7 status and PR map

Owner review (2026-11) asked for one record that maps mandate items to GitHub PRs. This is it.
Update it in the same PR that changes a state. Last checked against `main` at `abf3f79`.

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
- Stranded trades: policy is ranking only. An unrated trade never blocks anything and never lowers a
  profile's completed count. No auto-finalise is built.
- Walk-in bookings (no client account) cannot be rated. They count as completed, but add no exposure.
- Privacy line on the rating prompt (Kenya Data Protection Act 2019).

**Fluid Teams backend (#105):**
- `office_partners` table. One row per pair of offices, status `invited`, `active`, `declined`,
  `removed`.
- Routes under `/api/office/partners`, 404 while the flag is off: invite, answer, end, list.
- Only an active owner of an office can invite, answer or end a link. An office cannot partner with
  itself. A pair of offices has at most one link.

## Not built

- **Stranded-trade auto-finalise after 14 days:** not built. The recorded policy is ranking only.
  Needs an owner decision before any change.
- **`UserLink` anti-gaming block:** not built. There is no `UserLink` model in the repo.
- **`home_office_workers`:** no spec in the repo. The existing invite flow (accounts and single-use
  links) covers adding people to a home office.
- **Partner-team screens:** backend only. No frontend yet.
- **Nearby:** only front doors are reordered. `/api/nearby` keeps its "not ranked" behaviour.

## Not verified yet

- **Logo on a device:** not checked. The logo was rendered to PNG and looked correct, but no device
  or browser was used to view the splash.
- **Book Service walkthrough:** not run end to end on a real account.
- **Nurse walkthrough:** not run. Service profiles and front doors are off by default.
- **Partner backend:** no tests were written or run for #105, at the owner's request. Only a syntax
  compile ran.

## Open items

- **Legal review (Kenya Data Protection Act 2019):** not started. Covers consent and notice, purpose,
  retention limits, and access and correction rights. Needs to happen before any flag is turned on.
  Your earlier order put legal review before Fluid Teams. #105 was built ahead of it.
- **Retention:** no retention period is set, and no purge job exists. The prompt does not claim one.
- **Access and correction:** no request path is built. The prompt says nothing about it.
- **Privacy notice wording:** the prompt's notice is a minimum. Final wording goes to legal review.
- **Maturity gates (PR 104 in the mandate):** not started. It is a pricing decision. It waits for
  legal review and needs owner approval of the list of "data-rich" regions.
- **Language:** "harvest", "data as currency", and "take" are not used in any user-facing copy.
