# Town commerce — Kenyan launch assessment

**Status:** pre-launch assessment, not legal advice. A Kenyan advocate and, where
relevant, a licensed payment provider should review the final merchant terms
before the Kisumu/Kisii pilot opens.

The design removes the largest regulatory exposure: **the platform never holds
customer or merchant payout funds**. Referral bounties and scout wages are paid
directly between the parties; the platform records a fee but does not collect or
settle the payout.

One exception must be named honestly: a merchant **does** pay the platform for a
prepaid reward budget, and that cash sits with the platform until it is spent or
expires. It is restricted promotional credit, not a withdrawable wallet, but it
is still customer money on the balance sheet. The e-money and trust-account
analysis below therefore applies to this balance, not to bounties or wages.

## 1. Payments

| Question | Position in this build | Before launch |
|---|---|---|
| Does the platform hold funds? | Not payout funds. It does receive merchant prepaid reward budgets; bounties and scout wages are direct M-Pesa payments. | Keep payouts direct. Treat the prepaid balance as restricted promotional credit and get the e-money/trust-account position reviewed. |
| Who collects merchant credit? | A licensed PSP or the platform's published paybill/till, referenced by `payment_reference`. An operator confirms it. | Name the licensed provider and the paybill in the merchant terms. Do not route to an ordinary operating account held outside the disclosed arrangement. |
| Is prepaid credit e-money? | It is a one-purpose promotional credit, not redeemable for cash and not transferable. | Confirm the structure with counsel; if it looks like stored value, use a licensed e-money issuer. |
| Scout fees | The merchant pays the scout directly and owes the platform a separately invoiced percentage. | Invoice the fee; do not net it from the scout's payout without written consent. |
| Disbursements | None by the platform. | Never enable a platform-initiated payout without a PSP agreement and CBK licensing analysis. |

Relevant framework: the Central Bank of Kenya's national payments framework,
National Payments Strategy, and the licensing requirements for payment service
providers. The exact classification depends on the contract, not the label.

## 2. Consumer protection

The Consumer Protection Act, 2012 and the Competition Authority's consumer
guidance require clear, accurate and not-misleading terms.

- **Expiry is disclosed before purchase.** Prepaid credit has a validity period
  (`credit_expiry_days`) and the dashboard shows `expires_at`. Expired credit is
  moved to `expired_kes`, never counted as revenue.
- **Rewards are not cash.** The UI says "points", never "cash", and shows the
  calculated amount separately from the funded amount. A shop with no credit
  produces a record, not a promise.
- **Sponsored results are labelled.** At most three sponsored referral results
  appear, each carrying `Sponsored`; the API returns the disclosure text and the
  organic ordering rule. Verification is never for sale.
- **Bounties are conditional.** A referral conversion stays `pending` until an
  operator verifies the qualifying action. The app does not say "earn KES X" as
  if the bounty were guaranteed.
- **Complaints and disputes.** Every commercial surface has a `DisputeCase`
  domain: receipt, referral, task or redemption. A person can open one from the
  app; an operator resolves it with a written reason.
- **Cooling-off / refunds.** Merchant credit is promotional, not a deposit. The
  merchant terms must say whether unused, unexpired credit is refundable and how
  a mistaken purchase is reversed. Do not silently keep a double payment.

## 3. Data protection (Kenya DPA, 2019)

Receipts contain a person's shopping history; a photograph can contain a name,
phone number or card fragment. The build applies data minimisation:

- A photo is stored **only with explicit consent** (`photo_consent`). Without
  consent the image is read and discarded; the OCR text can still support the
  reward because it is not a photograph of a person.
- The raw QR payload is retained only for dispute handling and is never returned
  by the API.
- Merchant analytics never return a customer identity. Item-level and regional
  price bands are behind premium and privacy floors (`INSIGHT_MIN_RECEIPTS`,
  `INSIGHT_MIN_MERCHANTS`).
- The public referral index exposes the provider, the referral code/link and the
  bounty — not the referrer's phone number, receipt history or trust evidence.
- Audit events are append-only and store a short, typed payload, not raw SMS or
  screenshots.
- Retention: decide and document a period for receipt photos and OCR text.
  Delete the photo first; keep the anonymised line items only if needed for the
  merchant's own analytics.
- Data-subject requests: an account holder can export their receipts/vouchers;
  erasure must preserve financial/audit records that the law requires, and the
  privacy notice must say so.

Before launch: privacy notice, lawful basis (consent for photos, contract for
the account), ODPC registration assessment, data-processing agreement with the
storage/OCR provider, and a breach-response runbook.

## 4. Competition and sponsored ranking

The Competition Act, 2010 prohibits misleading conduct and anti-competitive
agreements. The index is intentionally not a pure auction:

- Sponsored slots are capped at three, always labelled, and ranked separately.
- The organic order is published in the API response and the UI: verified first,
  then highest bounty, then newest.
- A listing's `verification_status` is decided by an operator and cannot be
  bought. A sponsor bid does not change it.
- Bids are capped by `TOWN_MAX_SPONSOR_OF_BOUNTY_PCT`; a merchant cannot buy
  unlimited attention.
- The platform does not set a provider's referral terms, only displays them.
  Do not impose resale price maintenance on merchants.

## 5. Betting and ride-hailing categories

Betting listings are off by default (`TOWN_BETTING_CATEGORY_ENABLED=False`);
the category is hidden from the public index and creation is refused until the
operator turns it on. Before doing so:

- Check Betting Control and Licensing Board advertising rules; do not target
  minors and do not present gambling as a way to earn a living.
- Add an age gate or a category-level policy if the provider requires one.
- Ride-hailing and coach listings should link to the provider's own terms; the
  index is an introduction, not a transport contract.

## 6. Tax and records

- Merchant credit purchases and platform fees are externally settled; record the
  reference and the operator confirmation. The fee ledger is `PlatformFeeEntry`.
- Only `paid` fees are recognized revenue. `accrued` and `invoiced` are not.
- Keep the append-only credit and points ledgers for the statutory retention
  period. Do not edit a ledger row; reverse it with a new entry.
- eTIMS/VAT treatment of the platform fee and of merchant-funded discounts needs
  a Kenyan tax adviser. The receipt's own tax is the merchant's, not the
  platform's.

## 7. Launch gates

- [ ] Merchant terms: credit expiry, no cash value, fee percentage, dispute route.
- [ ] Privacy notice: photo consent, retention, analytics anonymisation, rights.
- [ ] PSP/paybill instructions: pay the platform, record the reference, operator
      confirms; no platform custody.
- [ ] Operator rota for credit confirmations, listing verification, conversion
      review and disputes.
- [ ] Sponsored-placement disclosure reviewed by counsel.
- [ ] Betting category policy and age gate (if enabled).
- [ ] Incident response: who freezes a merchant account, who reverses a credit,
      who notifies the ODPC.
