# Wairo business discovery

## Product entry and scope

**Home → Discover**, `/#city` (also `/#discover`), now opens a mixed discovery feed rather than a second directory. Home remains the same compact, five-row surface. The existing supply-route board, shops, groups, errands and Wanderly remain reachable through the feed footer. “I have something to offer” opens the existing Selling flow; “I need something done” opens the existing Request composer.

The feed has one search, format filters, For you / Saved / Following views, newest sorting, twelve-card pages, native keyboard-accessible dialogs, and explicit tuning. The app's global search/location/follow controls are suppressed only while this mixed feed owns those controls; the menu and Wairo home link remain available. Fresh account deep links do not get intercepted by the unrelated group-onboarding checklist. Home's optional first-run checklist is preserved.

There is **no second catalog, task system, matching system or economy**. The only new stored collection is `businessFeedStates`: an account's private discovery preferences, bounded source references, and optional activity history. Existing personal-object bookmarks operate on the extracted object graph; these feed references point instead to canonical listings, scoped matches, work programs and editorial IDs. Nothing is cloned into that graph or relabelled as a financial event.

## Cards and access boundaries

| Card | Source | Access / destination |
| --- | --- | --- |
| Software | An active product listing whose text contains software keywords | Public, using exactly the product-review publication guard; opens the existing offer |
| Service / offer | Active public product/service listings | Active vendor, public active enterprise where applicable, and public active space; existing offer / purchase flow |
| Work campaign / task | Existing open Work Programs with remaining capacity and a future/current deadline | Signed-in account only; same network/workforce visibility as My work; opens `/#workforce/program/:id` |
| Matched brief | `matching.relevantRequests(actor)` | Only the matched business or specifically invited participant; opens that match in the existing capability workspace |
| Playbook | Four original guides in `businessPlaybooks.js` | Public, explicitly “Wairo editorial”, not vendor activity or customer results |

A Request's `public` flag means **a limited brief for matched businesses**, not general publication. No request description, internal budget, attachments, customer contacts or private specification is broadcast. Workforce memberships, invitations and worker evidence remain private. Anonymous or foreign-account shared URLs to those sources yield the same unavailable state as a missing card. Private cards do not offer public sharing, and the API refuses private share actions.

Work rates come from the program's frozen **first-step** fee, not the full campaign pool or an invented worker balance. Cards state that approval is required and the rate is not earnings or a payment guarantee. Eligibility and blockers are the existing factual checks. HOME work does not acquire a GPS requirement. A feed read calls the new **read-only** `workExecution.discoveryPrograms` seam, not `workerHome` (which sweeps expired work). Discovery never claims work, creates an order, changes a request, approves evidence or moves money.

Published customer review count and average are derived from `productReviews`, with hidden/withdrawn rows excluded. They link to the actual review room and **do not boost ranking**. No verified-provider badge, guaranteed payout, escrow/insurance promise, conversion count or success story is invented.

Tool categorization is labelled **keyword match**, not a certification or a provider-declared product subtype. Services about software remain service/offer cards. Only the provider's actual media is used; editorial graphics are CSS illustrations of steps, not stock images masquerading as products.

## Ranking v1

Deterministic additive relevance, with every applied term exposed in **Why this card?**:

| Signal | Maximum boost |
| --- | ---: |
| Provider you explicitly follow | +6 |
| Chosen focus matching card keywords / editorial topic | +5 |
| Chosen location matching the card's stated location | +3 |
| Published within 30 days, decreasing with age | +3 |
| Minimum listed KES spend fits your chosen budget | +2 |
| Editorial guide tagged for your chosen business stage | +2 |
| At least two currently visible saved cards of this format | +2 |
| Opened/shared format, **only with opt-in history** | +1 |

Ties use publication date and source key. The mixed ordering inserts a different format after two of the same when another format is available, before twelve-card pagination. Newest ignores relevance boosts and uses source dates; editorial guides have no fabricated publication timestamp.

Format, text search, Saved and Following are hard filters. **Focus, location, stage and budget are ranking preferences, not exclusions.** Unknown attributes do not earn a boost. Budget compares listing price × minimum order quantity, only for KES; USD offers are not compared as if they were shillings. Worker rewards are not purchase prices. Stage is used only for explicitly tagged editorial guidance, not inferred about a vendor or worker.

The rank is content relevance, **not a worker trust/reputation score**. There is no paid placement, automatic GPS, IP-derived city, hidden conversion inference or feedback-based alteration of capability eligibility.

## Persistence and control

- Anonymous visitors can tune the current visit; those controls are not stored as a server profile.
- Saves, hides, follows and remembered preferences require the existing Wairo session. Identity is never taken from a body/query string.
- Saved and followed source references are idempotent, bounded to 500 each and re-resolved against current visibility on every read. Unpublished/deleted/private sources disappear, including from Saved and shared links.
- Hide removes a card from the feed, not from Saved. Saved shows “Show again”; Tune feed can restore all hidden cards.
- Open/share history is **off by default**. When enabled, at most 100 distinct key/action entries are kept. Repeated opens do not accumulate ranking points. Turning it off deletes history. A recorded share means the user copied the link, not that another person opened it or converted.
- Controls allow clearing history, follows, hidden cards, or all discovery data (including saves) after confirmation. None deletes business records.
- Session changes clear personalized data/dialogs/drafts immediately; stale in-flight responses from the previous token are ignored. Focus revalidates visibility.
- All feed responses are `no-store` and vary by Authorization. Private opportunity metadata never enters share links, browser storage or the offline write queue.

Public share links: `/#city/all?card=listing%3A...` or `playbook%3A...`. A focused card is shown once, with context and a link back to the feed. Private/removed references produce a generic unavailable notice, not a private title.

## API

- `GET /api/discover/business` — optional session; filters `q`, `kind`, `tab`, `sort`, `page`, `card`; ephemeral ranking overrides `topic`, `location`, `stage`, `budget`.
- `PUT /api/discover/business/preferences` — strictly validated private controls.
- `POST /api/discover/business/actions` — source key, save/hide/follow with explicit boolean value; optional open/share events.
- `POST /api/discover/business/reset` — hidden/activity/following/all.

The existing `feed` feature switch gates all four. Disabled commerce, workforce, requests/supply/matching sources independently drop out with an explicit UI availability notice. Writes are process-locally limited to 120/minute/account with `Retry-After`. Multi-instance deployment still needs a shared abuse limiter and a shared data store; the JSON store is not a high-volume recommendation engine.

## Editorial and rollout

The four launch guides cover software evaluation, consent-based outreach, task briefing and honest reviews. They are useful content, not fabricated inventory. **No fake products, businesses, jobs, payments, ratings or success stories are inserted into the live store.** Publish real public offers and real work programs through their existing flows to add supply.

This iteration does not implement vendor imports, arbitrary vendor social posts, a universal public job board, paid boosting, automatic conversions, campaign credits, SEO landing-page generation or guaranteed outcomes. Those need explicit product and provider decisions, not placeholder promises.

## Verification

- `npm run test:discovery` — isolated domain + HTTP privacy, source access, matching, rate terms, ranking, persistence/restart, idempotency, feature switches and economic invariance.
- `bash run-suites.sh businessfeed cityfeed discoverlayout compacthome commerce workforcedesk firstrun` — component contracts and preserved supply/Home/execution navigation.
- `npm run test:discovery:ui` — production build and real-API desktop/mobile browser scenarios, including sign-in, saves/follows/hides, tuning persistence, logout isolation, sharing/revocation, work-program deep links and scoped matched briefs.
- `npm run test:typecheck`, `npm run build`, and existing workforce/matching/review/tracking regression suites.

Fixtures use only the disposable test store. The full historical suite is not claimed green: the legacy `appbelt` suite still expects the pre-collapse 20-item menu, and `room` rejects existing 10px classes from earlier work. Neither is fixed by restoring the previously removed UI.
