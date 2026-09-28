# Wairo order tracking

## Entry points

- **`/track`**: independent public page, no account shell or brand intro. Reach it through the menu’s **Track an order** link.
- **`/track?order=ord_…`**: prefilled reference, never an email or access token in the URL. **Track order** links on buyer/seller order cards open it. A signed-in order party can open its tracking directly.
- Marketplace checkout has collapsed **Delivery & guest tracking** fields. Buyers can also set a tracking email/address/instructions from the tracking page **before dispatch**. An order created with an account email snapshots its proof; changing the account email does not silently transfer that order’s tracking access.
- A buyer with no email can still track while signed in. An older dispatched order without a configured email cannot be looked up anonymously. No order-number-only fallback.

## One source of truth

The projection is `server/src/domain/orderTracking.js`, reading existing `orders` and `spaceDispatches`. There is no tracking-order table, new balance, wallet, payment event or parallel delivery economy.

- The existing dispatch creator no longer sets an order to `fulfilled`. Dispatch, confirmed receipt, order fulfilment and payment remain different facts. Even legacy `fulfilled` orders with in-transit dispatches show **In transit**, not Delivered.
- Dispatches must belong to the order’s seller and, where stamped, the same space. Listing dispatch receiver/contact details requires the space owner. Split shipments are all validated linked dispatch rows, **not** the order’s last `dispatchId` pointer.
- Stage pickup: staged → in transit → ready at stage → collected. Door delivery: staged → in transit → out for delivery → delivered. Sellers may skip intermediate updates; the tracker does not backfill scan times or mark missing milestones complete. Backward transitions, cross-mode statuses and reopening terminal dispatches are refused.
- New status/location updates append timestamped history. Legacy rows disclose only the current recorded status/time plus the dispatch record; there is no invented historical scan feed. Arbitrary internal order/dispatch notes are not published.
- Order content name, quantity and first listing image are snapshotted. A parcel icon covers missing images. Per-shipment quantities are optional and bounded by the order quantity; when missing, the UI explicitly identifies full-order quantities rather than claiming every parcel contains the whole order.
- Carrier waybills are optional. Generated Wairo dispatch references are labelled as such, not represented as carrier-issued tracking numbers.

## Seller workflow

Under a space’s Cargo Dispatches, expand **Order tracking & delivery details** when dispatching:
1. Link the order number; choose stage pickup or door delivery.
2. Optionally record a real waybill, estimated arrival and item quantity.
3. Repeat for split shipments. Known assigned quantities cannot exceed the order quantity.
4. **Record tracking update** appends a real status/location and optionally revises the arrival estimate. These are seller-reported, not authenticated carrier scans or live GPS.
5. **Tracking & delivery requests** opens the same order page with seller-only acknowledgment/decline controls.

## Preferences and help

Neighbor, hold, delivery-preference, missing-package, wrong-item and support messages persist on the existing order as `trackingRequests`, scoped to an order/dispatch. They are **requests to the seller**, not accepted carrier instructions, notifications sent to a carrier, platform support tickets, refunds or formal disputes. The page states where they go. Seller acknowledgment is not carrier confirmation. Formal disputes remain in the existing Orders workflow.

Requests have client-generated retry keys, a per-order cap, server validation and terminal-shipment restrictions. Support remains available after delivery. Only the seller can acknowledge/decline. The tracking page displays saved responses on its next refresh.

## Updates and honest limitations

- Polls every 30 seconds while visible/online; manual refresh and pause supported. Network errors retain the last successful result **with an explicit stale-data warning**. Older in-flight reads cannot replace a newer mutation or restore a signed-out order.
- Browser alerts are opt-in and show generic status-change messages while the page is open and auto-refresh is enabled. Browser permission/support failures are explained. This is **not background Web Push**.
- SMS/email delivery notifications have visible disabled switches: no notification provider or delivery sender is connected. We do not collect fake opt-ins or claim messages were sent.
- No live carrier API, GPS map, route prediction or invented delivery window. Recorded locations and optional seller estimates are displayed with their provenance. Browser-local times include the zone in detailed timestamps.

## Public access and privacy

Public POST endpoints, exempted narrowly from the session gate:
- `/api/public/order-tracking/lookup` — exact order reference + normalized tracking email.
- `/api/public/order-tracking/read` — scoped signed token.
- `/api/public/order-tracking/requests` — scoped token + validated request.

The public projection excludes buyer/vendor-owner IDs, receiver names/phones, raw notes, prices, transaction details, account email and credential material. It does include customer delivery address/instructions and requests once the lookup matches; treat the order number plus email as a tracking credential pair and share them only with intended recipients. Legacy short references remain supported; new commerce order references use 128 random bits. Email proofs use a server-keyed HMAC. The durable signing key is in the existing `appSecrets` collection.

Tokens expire after 30 minutes, authorize only one order’s tracking projection/requests, and are invalidated when its email proof changes. They cannot edit customer details, acknowledge requests or access ordinary order APIs. Client tokens/email inputs remain in memory only (not storage, URL, analytics or offline queues). Responses are `no-store`; service workers bypass both API prefixes. The page clears on session changes and expiry, even with polling paused, and sets noindex/no-referrer metadata.

Process-local abuse limits: lookup 20/10 minutes per IP; reads 100/10 minutes per verified order, plus a 1,000/10-minute IP edge limit; requests 15/10 minutes per order plus a 100/IP edge limit. Responses include `Retry-After`. Key count is bounded and expired buckets pruned. The server does not trust arbitrary forwarded IP headers. **Production operators should configure a trusted proxy / shared edge rate limiter for their actual topology**, especially for multiple instances or many clients behind a shared proxy; process-local counters are not a distributed anti-abuse system.

Existing commerce feature-disable gates apply to tracking. Ordinary order APIs and account-detail editing remain session/party gated.

## Verification

- `npm run test:tracking` — isolated domain + real HTTP tests (including privacy, ownership, split shipments, persistence, signed token expiry, rate limiting and ledger invariants).
- `npm run test:tracking:ui` — production bundle, real disposable API, Playwright desktop/mobile. No production seed records, mock economic events or live-store resets.
- `npm run test:typecheck` and `npm run build`.

In sandboxes using the packaged Chromium fallback: set `BRIEF_TEST_CHROMIUM=/tmp/chromium` and the extracted library directory in `LD_LIBRARY_PATH` before running Playwright.
