# Generalized engine blueprint — shipped slices

This branch extends the shipped event wedge rather than adding a second
marketplace. It uses the existing FastAPI/SQLAlchemy vendor identity; there is
no `auth.users` table and no client-side RLS. Every ownership check is in the
service layer against `vendors.id`.

## 1. Second-hand passes (resale)

**Problem.** A confirmed attendee cannot use the pass. The platform must not
become the ticket broker.

**Rule.** One confirmed registration, one resale row (DB unique constraint on
`event_pass_resales.registration_id`). Relisting is capped at the original entry
fee. The buyer pays the seller directly by M-Pesa, MTN, cash or an SMS hash.
Both sides confirm the handover; only the second confirmation performs the swap.

**Atomic handover.** In one transaction:

- the registration moves to the buyer;
- `event_registrations.pass_rotation` increments;
- the seller's old code stops matching (the code is an HMAC of registration id +
  rotation);
- the registration stays `CONFIRMED`, so occupancy is unchanged;
- both vendors' `resale_trades` increment.

The original M-Pesa reference is hidden from the new holder.

API: `GET /api/event-desk/resale/eligible`, `GET /api/event-desk/resale/board`,
`GET /api/event-desk/resale/mine`, `POST /api/event-desk/resale/list`,
`POST /api/event-desk/resale/{id}/claim|release|cancel|handover`.

## 2. Year-round rhythm

**Pulse windows** (Africa/Nairobi):

| Window | When | Categories |
|---|---|---|
| Payday | 25th 00:00 → 3rd 23:59 | food, decor, supplies, services |
| Mid-Month Clearance | 14th → 16th | stock, household, produce |
| Weekend Pulse | Fri 12:00 → Sun 18:00 | events, food, entertainment, repairs |

The window changes the feed skin (Warm Terracotta `#E65100`) and ordering, never
a price. `GET /api/pulse` returns the active and next window.

**Flash drops.** At most 60 minutes and at most 1,000 units. A claim inserts a
unique `(drop_id, vendor_id)` row first, then a conditional `UPDATE` decrements
only a live, in-window, non-empty drop. Two taps cannot create a third unit.
`POST /api/pulse/flash-drops/{id}/claim` returns `Claimed — next drop is below`.

**Group rounds.** The 1–4 / 5–14 / 15–20 ladder is derived from the live pledge
total (`round.tiers`, `current_tier`, `units_to_next_tier`) so the progress bar
and the unlocked price cannot disagree.

## 3. Lead ledger

**LeadEvent** is immutable and server-derived:

- beneficiary (`vendor_id`) comes from the target (`event`, `vendor`, `stock`,
  `activity`), never from the request body;
- fingerprint is `HMAC(SECRET_KEY, lead:buyer:target_kind:target_id)`;
- unique `(target_kind, target_id, fingerprint_hash)` makes repeat taps
  idempotent, with `INSERT … ON CONFLICT DO NOTHING` for race safety;
- `fee_kes = 5` is the business's monthly fair contribution;
- `bounty_kes = 1` is paid by the business directly to the scout;
- `?ref=` is resolved from an active `ReferralLink`; self-referral and buyer
  referral are refused.

API: `POST /api/leads/record`, `GET /api/leads/mine`,
`GET /api/leads/statement?month=YYYY-MM`, `GET /api/leads/scouted`.
The Me page panel shows verified handshakes, unique people, contribution and
scout bounties. Nothing is a wallet.

## 4. Three-zone privacy

`office_saved_items.privacy` is one of:

| Zone | Who reads it |
|---|---|
| `vault_private` (default) | only the person who saved it |
| `family_shared` | active office members |
| `public_showcase` | anyone; owner-only to feature |

The public endpoint returns only `public_showcase` rows and never the private
note. Family members cannot read another member's vault, edit it, or feature
their own item publicly. The API defaults to the vault; the save sheet shows
Keep in My Vault / Share with Home Office / Feature on My Page.

API: `GET|POST /api/office/offices/{id}/saved`,
`PATCH|DELETE /api/office/offices/{id}/saved/{item_id}`,
`GET /api/office/public/offices/{id}/saved`.

## Standing rules preserved

- No platform custody of money.
- No goods delivery or logistics.
- Sponsored visibility must be labelled and capped (not added in these slices).
- No social-platform scraping.
- Guard copy says “business” or “event desk”, never the internal vendor word.

## Still open

- Spotted-sale amber scout border and short expiry (existing `spotted_deals`
  module can carry the visual state; the border is not wired here).
- Adaptive WebP q65 w400 payloads, offscreen deferral, 30-day CTR pill
  reordering and zero-dead-end radius expansion.
- Automated creator pitch / demand-gap detection for niche events.
