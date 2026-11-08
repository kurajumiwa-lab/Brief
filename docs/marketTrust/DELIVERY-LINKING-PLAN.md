# MarketTrust: linking deliveries (plan, not built)

Status: options 1 and 2 built (pick-up at the shop, and a rider the buyer already knows).
Option 3 (partner app links) is not built.

Decisions taken for the build (the user approved options 1 and 2; the rest use these defaults,
which the user can change):
- Shops choose only from options Brief offers. No free-text partner apps.
- Brief does not verify rider numbers. The page says so.
- The delivery line shows on the public shop page, not only after a purchase.

## Goal

Let a shop show how its goods reach the buyer, using riders that already exist in each town.
In places like Kisii and Western, boda riders are the normal way to deliver, and the buyer often
knows a rider. Brief should connect the two. It should not build its own delivery network.

## What the market already offers (checked 2026-11)

| Option | What it does | Fit for us |
|---|---|---|
| BodaGo (Google Play) | Lists verified local boda riders by county and area. Buyer calls or WhatsApps the rider and agrees the price directly. Says it has no commission. Live in Nakuru, Nairobi, Mombasa, Kisumu, Nyeri. | Strong fit for the "rider the customer knows" model. Kisii and Western not listed yet. |
| Sendy | Boda and courier marketplace, present in Kisumu since 2020, with an API for merchants. Takes a commission. Riders are tracked in-app. | Usable in Kisumu. Adds a commission and an intermediary, so it is a partner link, not a built-in. |
| TumaBoda | Dispatch API, webhooks, OTP at handover, and cash or pay-on-delivery collection. | Strong for shops with money to collect. Handles cash, so it is out of scope for us now. |
| Pickup Mtaani | Collection-point network, pay-on-delivery through a pochi wallet. | Holds seller money. We must not depend on it for payment. |

Sources: BodaGo listing on Google Play; Business Daily and Nation coverage of Sendy in Kisumu (2020);
TumaBoda website (API, OTP, cash collection); Pickup Mtaani website (collection points, pochi).

## Proposed design: three delivery choices per shop, no payments

1. **Pick up at the shop** (default). Nothing to connect.
2. **A rider the buyer knows.** The shop lists its area and a WhatsApp or phone link for the
   rider it uses. The buyer agrees the rider fee with the rider directly. Brief never sees the money.
3. **Partner delivery.** The shop links to one partner app (for example BodaGo or Sendy) in the
   town where that app works. Brief stores only the link and the town. The partner handles
   price and payment.

Brief's own role: show the choice on the shop page and on the verification page, and tie the
delivery to a verified purchase when the buyer leaves a review. Brief adds no fees, takes no
commission, and holds no funds.

## What changes in the product (if approved)

- Shop setting: delivery options and service areas (county and constituency), with an optional rider
  WhatsApp number. The shop can change them at any time.
- Shop page: a plain line such as "Delivered by a rider from this shop in Kisii town. Agree the fee with the rider."
- Partner links: stored as URLs, shown only if the shop chooses them, and reviewed by Brief staff before they appear.
- Audit: each change to a delivery option is written to an append-only log, the same as verification decisions.

## Risks and rules to keep

- **No money:** Brief must not collect, hold, or quote delivery fees. The rider fee is agreed off-platform.
- **Rider safety and fraud:** a rider number is not verified by Brief unless staff check it. The page must say so.
- **Reviews:** a delivery review is still tied to a till code from a real purchase. Delivery does not change that rule.
- **Language:** the delivery copy should use plain Kenyan Swahili, consistent with the earlier split (no Sheng in rules).
- **Scope check:** the existing `logistics` module (group orders and routes) is separate. Do not merge the two without a decision.

## Decisions (answered)

1. Option 2 first, option 3 later. Answered: options 1 and 2 approved.
2. Partner apps: only from a list Brief offers (default, not yet built).
3. Rider numbers: not checked by Brief; the page says so (default).
4. Delivery line: shown on the public shop page (default).

Built: migration `0039_branch_delivery`, `PUT /api/trust/branches/{id}/delivery` (owner only),
the owner's form on the shop screen, the buyer's line on the shop page, and audit entries
(`delivery_updated`, before and after). Backend tests: `tests/test_v39_delivery.py`.
