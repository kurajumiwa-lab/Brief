# Wairo review room

## Pages and entry points

- **`/reviews`** — anonymous, searchable product directory with category filter and pagination. Only active listings of active public businesses/spaces appear. Empty means empty; no review demo records are inserted into live data.
- **`/reviews/:listingId`** — complete product review page. Marketplace product details and order cards link here; the app menu links to the directory. “View product” uses Wairo’s existing `#offer/:id` flow.
- **`/reviews/:listingId?review=:reviewId#review-:reviewId`** — shareable review permalink, scoped to its product, with a full review context even if the review is not on the current page.
- **`/reviews/moderation`** — authenticated `moderate` capability only. Available from the moderator’s menu/product page. No business owner, worker registration or ordinary account automatically gains this authority.

Public review routes bypass the private shell and launch splash. The sign-in modal reuses Wairo’s existing sessions and registration; it is not another identity system. Session changes unmount personalized forms/moderation media; the moderation queue also rechecks access on window focus. No review draft, order reference, password or media blob is placed into local storage or the offline queue by the review feature.

## What is implemented

- Product image/name, authoritative current listing price, breadcrumbs and product link.
- Derived average, total, interactive 1–5-star distribution, recommendation percentage **with respondent denominator**, and optional per-category averages/counts.
- Composable rating, verified purchase, photo/video, last-90-days, reviewer-stated size/color and theme filters; debounced review text search.
- Recent / helpful / highest / lowest / with-images sorting; ten reviews per page; page numbers and jump-to-page. Filters are in a sticky, mobile-accessible toolbar and preserved in the URL.
- Counted review themes, deduplicated per review; customer-written pros/cons grouped by exact normalized phrase. **These are labelled counted themes, not AI-generated.** No AI provider is connected; there is no fabricated summary, sentiment claim or artificial mention count. Themes use neutral aspect labels because keyword matching does not infer sentiment or negation.
- Customer photos and short MP4/WebM videos, paginated gallery (24 per gallery page), accessible native-dialog lightbox, real video controls and review context links. No stock/AI images masquerade as customer uploads.
- Two featured reviews ranked by actual positive helpful votes (only when such votes exist), full body, vote counts and official seller replies.
- Individual cards: author display-name snapshot or Anonymous, initials avatar (not an invented portrait), rating/date/title/body, read-more, optional media/variants, verified badge, incentive disclosure, yes/no helpful votes, report/share, and author withdrawal.
- Seller-only, timestamped replies. “Verified seller” means the authenticated current owner of this listing’s vendor wrote the response; it is not a platform endorsement.
- Review composer: keyboard-operable stars, title, server-enforced 50–5,000-character body, optional category scores, pros/cons, up to six uploads, recommendation, anonymity/incentive disclosure and explicit publication consent.
- Related products are public same-type listings ranked by overlapping reviewers and actual ratings. “Customers also reviewed” appears **only** when a shared reviewer really exists; otherwise the label is “More in this category.”
- Expandable community, helpfulness, media and incentive guidelines. Incentives are disclosed, not rewarded by Wairo.

## Trust, purchase verification and the ledger boundary

`productReviews`, `productReviewVotes`, and `productReviewReports` are opinion/moderation records. No stored rating counters, balances, earnings, trust scores, rewards or payment events are introduced. Aggregates are computed from **published** rows; hidden/withdrawn reviews do not contribute.

A verified purchase requires:
1. The selected existing order belongs to the authenticated reviewer.
2. Its listing matches the reviewed product.
3. The order’s authoritative linked `ledgerTransactions` row is settled.

Login, an order number supplied in a body, an unpaid order, or a fulfilment flag alone do not qualify. A badge confirms a paid purchase, not delivery or review accuracy. Review visibility and purchase proof are separate; payment disputes do not suppress negative opinions. Eligibility and displayed verification are recomputed from source records, not accepted from a client flag. The private context API only returns that actor’s eligible order references/date/quantity, never public purchase details.

Wairo currently has no authoritative size/color purchase snapshot. These optional review fields and their filters are explicitly **reviewer-stated**, never labelled verified variants. Category ratings are optional and omit unrated categories instead of treating missing answers as zero.

One active review per account/product. Retry keys prevent duplicate submissions. A withdrawn review can be replaced, but an author cannot evade a moderation removal by withdrawing and re-posting. Sellers cannot review their own products; neither the author nor the product’s seller can vote on that review. Votes are one mutable ballot per account/review (yes/no/remove), not client-maintained counters.

## Media and moderation

The dedicated review uploader extends the existing upload/store mechanism without enabling video in ordinary image or private-evidence uploads:

- Raster photos plus MP4/WebM containers recognized by file signatures, not filenames/client MIME claims. No SVG/HTML or arbitrary video URLs.
- Existing configured upload limit, **8 MB/file by default**, up to six attachments; no transcoding or background video processing. Browser codec support can vary, and display failures are surfaced.
- Files use the existing **local disk** storage. The composer explicitly says bytes may not survive redeployment. This does not promise durable cloud storage.
- New review upload IDs have 128 random bits. A review can attach only its author’s `review_media` files; private operational evidence and other users’ assets are rejected.
- Unpublished/unattached assets are private. Anonymous byte access requires a published review referencing the upload **and** a currently public product. Hiding/withdrawing a review or privatizing the product revokes anonymous byte access. Review media responses are no-store; video serving supports range requests.
- The owner and authorized moderators may fetch protected media with an Authorization header, never a token in the URL. The moderation UI loads private blobs only when its media section is opened and revokes object URLs on close/unmount/session change.
- Unattached uploads are not automatically deleted on composer cancellation; the same deduplicated upload may be attached elsewhere. Storage quotas/retention and durable object storage remain deployment concerns.

Reports are durable, deduplicated per reporter/review, and do not automatically remove content. The moderator queue prioritizes open reports and shows at most 100 at once. A moderator can hide/restore/dismiss with a recorded reason and an existing audit-log entry. Author-withdrawn content cannot be restored. The seller has no removal privilege. Reporting is not a payment dispute or refund.

Public projections omit author IDs, order IDs, email/contact details, upload owner/original filename, reporter identities and payment details. Draft, private/unlisted-space and private/inactive-enterprise products are rejected consistently in public catalog/detail/gallery/media paths. Replies and moderation are server-authorized on every write.

## API / abuse limits

Public GETs: `/api/public/product-reviews`, `/:listingId`, `/:listingId/media`.

Authenticated: `/api/product-reviews/:listingId/context`, `/:listingId/submit`, `/:reviewId/vote`, `/:reviewId/response`, `/:reviewId/report`, DELETE `/:reviewId`, `/media`, `/moderation`, and `/:reviewId/moderate`.

Commerce feature-disable gates apply to all review endpoints; review uploads additionally require the media feature. Requests are same-origin through the app’s existing API proxy. Responses are no-store because review visibility and personalized vote flags can change.

Bounded process-local limits per authenticated actor per 10 minutes: 10 submissions, 100 vote actions, 30 seller responses, 15 reports, 30 uploads. `Retry-After` accompanies rate refusals. Deploy a shared gateway/rate limiter for multi-instance production; these counters are not a distributed abuse-prevention system.

## Tests

- `npm run test:reviews` — isolated real HTTP/domain checks covering publication privacy, purchase proof, aggregates, filters, pagination, vote uniqueness, reporting, media ownership/byte access/ranges, moderation and ledger invariants.
- `bash run-suites.sh productreviews` — rendered component contracts, badge distinctions, disclosure, expansion, voting restrictions and fractional stars.
- `npm run test:reviews:ui` — build plus real-API Playwright desktop/mobile flows, including file upload, actual WebM playback, customer/seller sign-in, helpfulness, pagination and moderator media access.
- `npm run test:typecheck` and `npm run build`.

Browser tests use the disposable `scripts/request-test-server.mjs` store, synthetic review text, a tiny PNG and the explicitly labelled, procedurally recorded `tests/fixtures/review-clip.webm`. The test-only moderator handles are scoped to that server. No test reviews, settled-payment fixtures or reviewer permissions are inserted into the live preview store.
