# Merchant claims without a review queue — what is actually provable

**Status:** proposal. Not wired into the API or UI.

The current claim path is `unclaimed → pending → verified`, with an operator
calling `POST /receipts/ops/merchants/{id}/verify`. The goal is to remove that
queue without creating a shop-takeover path.

## The short version

The three proposed signals do not prove ownership:

| Proposed proof | What it actually proves | Why it cannot auto-verify |
| --- | --- | --- |
| A fresh eTIMS receipt from the shop's PIN | Somebody was at the shop, or has a copy of a receipt | Any customer can request a receipt; a QR payload can also be fabricated because we do not validate KRA's signature |
| Two consecutive invoice numbers | Somebody obtained two receipts | A customer can split a purchase, and invoice numbers are visible on paper |
| A pasted M-Pesa confirmation SMS | Somebody typed or screenshotted a message | SMS text is not a transaction lookup; sender IDs and screenshots are trivial to fake |
| Two Level 3+ neighbours | Social capital exists in the area | A ring can coordinate; “never traded with each other” is a graph check, not a proof of independence |

Calling these “cryptographic proof-of-possession” would be inaccurate. The
server currently records receipts as **evidence the paper carried**, not as a
KRA-verified fact. That boundary stays.

## Why shop takeover is not cosmetic

A verified merchant can:

- publish merchant-funded offers in the shop's name;
- redeem voucher codes;
- act as the seller on receipt-backed `TradeProof` rows, which credit standing
  to both sides.

A fake owner could therefore publish false offers, redeem vouchers, or inflate
standing through trade proofs. A capped “provisional” shop is acceptable only
if it cannot do the last two.

## What can be automated safely

### 1. A challenge sale, not a random receipt

For an eTIMS shop, issue a random amount at claim time:

```
challenge.amount_kes ∈ [1, 99]
challenge.expires_at = now + 10 minutes
```

The claimant must submit a receipt from that shop's PIN whose **total equals the
challenge amount** and whose `issued_at` is within the window. This requires
access to the shop's POS to ring a sale, which is stronger than “scan any
receipt”. It is still not proof if the client can fabricate the QR payload.

Therefore:

- with only the current client-declared QR parser: this is **presence
  evidence**, never `verified`;
- with a server-side fetch of the receipt's KRA/DigiTax verification URL that
  returns the same PIN, invoice and total: it is **tax-authority-served
  evidence**, and can support auto-approval;
- two consecutive invoices are not a substitute for either.

A server-side KRA fetch needs its own timeout, host allowlist, response parser,
and failure mode. It should fail closed. It is a separate integration, not a
regex change to the claim endpoint.

### 2. M-Pesa: parse it, never trust it

A pasted SMS can be stored as a **risk signal**:

```
kind: mpesa_sms
parse: transaction_code, amount, counterparty, till/paybill, timestamp
reject if: transaction_code already used, timestamp > 15 minutes,
           name does not match the shop record, amount != 1
```

It must never move a claim to `verified` on its own. The only ways to make an
M-Pesa payment verifiable are:

1. Daraja `Transaction Status` with credentials for the receiving shortcode
   (free API, but requires merchant-owned credentials and a real integration); or
2. reconciliation against the shop's statement / till export (manual or parser,
   still not cryptographic).

If neither is available, the SMS is a note, not a proof.

### 3. Peer vouching: a signal with a cost

Automate it, but keep it as one input:

- voucher is Level 3+;
- has at least 2 receipts at this merchant;
- voucher is in the same region;
- vouchers have never traded with each other;
- neither voucher is the claimant or an account created in the same 24 hours;
- account age ≥ 30 days.

Two vouches can move a claim to `probationary`, never to `verified`. If the shop
is later suspended for fake vouchers, both vouchers lose the standing they
gained from the vouch. That penalty is only credible if the vouch is recorded
as a relationship, not a boolean.

## Recommended state machine

```
unclaimed
   │ claim
   ▼
pending  ── automated evidence ──►  probationary
   │                                   │
   │ high-trust proof                  │ 3 distinct paying customers,
   │ or operator approval              │ 14 days, no dispute, no contest
   ▼                                   ▼
verified  ◄────────────────────────  verified
   │
   │ real-owner contest / fraud
   ▼
suspended
```

`probationary` is the only honest “no queue” state:

| Capability | pending | probationary | verified |
| --- | --- | --- | --- |
| Shop card visible | yes | yes | yes |
| Redeem voucher codes | no | **yes, capped** | yes |
| Publish offers | no | **max 1 active, ≤ 5 vouchers/week** | yes |
| Confirm trade proofs | no | **no** | yes |
| Badge | “Claim under review” | “Probationary owner” | “Verified owner” |

The cap is deliberate: a fraudster can still cause reputational noise, but
cannot farm standing or issue an unbounded offer book. A real shop gets useful
redemption access immediately.

### Promotion rules

`probationary → verified` only when one of these is true:

1. a high-trust proof succeeds: server-fetched KRA receipt, merchant-owned
   Daraja transaction lookup, control of the shop's website/DNS, or operator
   approval;
2. after 14 days **and** 3 distinct customers (not the claimant, not the
   vouchers) redeemed vouchers at the shop **and** no open dispute **and** no
   contest from another claimant.

The second route is a trust decision, not proof-of-possession. Keep the badge
language honest: “Verified by trading history”, not “KRA-verified”.

### Contest and suspension

Anybody can open a contest with the same evidence bar. A contest:

- freezes new offers;
- leaves already-issued vouchers redeemable until expiry;
- notifies the current owner;
- returns the shop to `pending` if the contest includes a fresh challenge sale
  that the current owner cannot answer within 48 hours.

This gives the real owner a zero-cost recovery path without an operator queue.

## What would be built

1. Migration `0060_merchant_claim_evidence`:
   - `claim_path` (`receipt_challenge`, `mpesa_sms`, `peer_vouch`, `operator`)
   - `claim_confidence` (0–100, computed server-side)
   - `claim_evidence` JSONB (hashed where appropriate, never raw SMS)
   - `probation_until`
   - `contest_deadline`
2. `POST /receipts/merchants/{pin}/claim/challenge` — issue one amount/TTL,
   reject reuse.
3. `POST /receipts/merchants/{pin}/claim/evidence` — submit a receipt or SMS,
   score it, never accept a client score.
4. `POST /receipts/merchants/{pin}/claim/vouch` — one Level 3+ signature.
5. State guards in the offer, redeem and trade-proof routes. Probationary
   merchants cannot call trade-proof confirmation.
6. Tests for replay, wrong total, wrong PIN, stale timestamp, duplicate SMS
   code, colluding vouchers, cap enforcement, contest freeze, and promotion.

## What not to build

- No “scan any receipt within 10 minutes → verified”.
- No auto-verified badge from a pasted SMS.
- No claim that an eTIMS QR was verified by KRA unless the server actually
  fetched and checked it.
- No unlimited offer book for an unproven owner.

The queue can shrink to exceptions. It cannot honestly disappear while the
only ownership evidence is a public PIN, a paper receipt, and a text message.
