# Phase 7 status and PR map

Owner review (2026-11) asked for one record that maps mandate items to GitHub PRs. This is it.
Update it in the same PR that changes a state.

## PR map

| Mandate item | Mandate number | GitHub PR | Branch | State |
|---|---|---|---|---|
| Credentials off by default; plan doc (phases 0 to 6) | PR 100 | #100 | arena/81ab57de-brief | merged (`1ab727f`) |
| Rebrand only | PR 101 | #101 | rebrand/home-office-phase7 | closed, superseded by #102 |
| Rebrand, drawable logo, Book Service link, Work copy | PR 101 | #102 | arena/81ab57de-brief | open, not merged |
| Rating gate and data-based discovery | PR 102 | #103 | arena/d5093408-brief | open, not merged |
| Partner teams (`office_partners`, Fluid Teams) | PR 103 | not started | - | - |
| Maturity gates (data-density check) | PR 104 | not started | - | - |

The mandate's numbers do not match GitHub's. Use this table, not the mandate, for any PR reference.

## What each open PR contains

**#102 (rebrand):**
- "Home Office" name in title, og:title, brand config, POS copy, and pricing-tier copy.
- `frontend/public/logo.svg`: flat SVG drawn from the uploaded logo, shown on the boot splash.
- `favicon.svg` replaced with the house mark.
- "Book Service" button on the professional card, linking to `/book/:vendorId?service=<id>`.
- Tasks, Ops and discovery copy mapped from shift and call-up wording.

**#103 (ratings):** see the PR body. Decisions below.

## Not verified yet

- **Logo on a device:** not checked. This environment has no device or browser to view the splash on. Needs a manual check.
- **Book Service walkthrough:** not run end to end on a real account. Needs a manual check after the flags are set.
- **Nurse walkthrough:** still a pilot, not a sign-off. Service profiles and front doors are off by default, so the nurse is not visible until those flags are on.

## Rating rules (PR #103)

- **Who may rate what:** a client rates a supplier 1 to 5 stars after a completed trade. A supplier records "failed" or "fraud" about the client only, never stars.
- **One rating per party per trade.** Ratings cannot be edited or deleted through the API.
- **Self-rating blocked:** a business cannot rate its own booking.
- **Shared contact blocked:** nobody rates a trade with a business that shares their contact number. This is the one signal used to catch two accounts run by one person.
- **Team membership:** a rating is blocked when the rater and the other party are both active members of the same active office (owner included). Partner teams (`office_partners`, Fluid Teams) are not built yet and will extend this check.
- **Sample floor:** a supplier's rating moves rank only after 3 ratings from different clients (`scoring.MIN_RATINGS_FOR_RANK`). Below that, the count shows and the average is withheld. Three is a starting value, to revisit with real data.
- **Repeat clients:** a client counts once per supplier in the 90-day window, using their latest rating. Repeat bookings cannot stack the average.
- **Stranded trades (policy chosen): ranking only.** An unrated trade never blocks anything and never lowers a profile's completed count. A rating only adds exposure. The professional card counts every completed booking.
- **Walk-in bookings** (no client account) cannot be rated. They count as completed, but they never add exposure.
- **Gate flag:** `POST_TRADE_RATING_GATE_ENABLED` turns on collection and the prompt. It is off by default.
- **Ranking flag:** `DATA_DISCOVERY_RANKING_ENABLED` turns on ranking by data. It is off by default, and stays off until legal review.

## Open items

- **Nearby is partial.** The mandate named Nearby. Only front doors are reordered. `/api/nearby` keeps its "not ranked" behaviour. Recorded as open, not done.
- **Legal review (credentials, ratings, privacy):** not started. Covers consent and notice, purpose, retention limits, and access and correction rights under the Kenya Data Protection Act 2019.
- **Retention:** no retention period is set, and no purge job exists. The prompt does not claim one.
- **Access and correction:** no request path is built. The prompt says nothing about it.
- **Privacy notice wording:** the prompt's notice is a minimum. Final wording goes to legal review.
- **Maturity gates (PR 104):** not started. It is a pricing decision. It waits for legal review and needs owner approval of the list of "data-rich" regions.
- **Language:** "harvest", "data as currency", and "take" are not used in any user-facing copy of this work.
