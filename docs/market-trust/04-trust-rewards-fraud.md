# 04. Reputation, rewards and fraud rules

**Status of every number in this file: proposal.** The blueprint says they must be tested against real data before anything is published. Nothing here is live.

## 1. Review scoring

### Reconstructed formula

The pasted blueprint lost the definitions under its formulas. The reconstruction below is an **assumption** to confirm with the author before implementation.

- `r_i`: the rating of review *i*, from 1 to 5.
- `w_i`: the evidence weight of review *i* (table below).
- `R_w = Σ w_i r_i / Σ w_i`: the evidence-weighted average rating.
- `n`: effective evidence count, the sum of the weights, `Σ w_i`.
- `C`: the category baseline, the average rating across the category in the same country.
- `m`: a confidence parameter. It is the number of reviews of "pull" toward the baseline.
- `S = (n R_w + m C) / (n + m)`: the confidence-adjusted score.

Worked example (assumed `m = 5`, `C = 3.5`):

| Review | Rating | Tier | Weight |
|---|---|---|---|
| A | 5 | confirmed token | 1.00 |
| B | 4 | unverified | 0.25 |
| C | 1 | validated receipt | 0.90 |

- `n = 2.15`
- `R_w = (5×1.00 + 4×0.25 + 1×0.90) / 2.15 = 6.90 / 2.15 ≈ 3.21`
- `S = (2.15 × 3.21 + 5 × 3.5) / (2.15 + 5) = (6.90 + 17.5) / 7.15 ≈ 3.41`

Three reviews barely move the score away from the baseline. That is the purpose of `m`.

### Evidence weights (starting values)

| Evidence tier | Weight | Who sets it |
|---|---|---|
| `confirmed_token` (a branch-issued token consumed by the reviewer) | 1.00 | System |
| `validated_receipt` (receipt passed validation) | 0.90 | Validation step |
| `corroborated` (transaction confirmed by a second, independent source) | 0.80 | System |
| `receipt_incomplete` (receipt uploaded but not fully validated) | 0.50 | System |
| `unverified` (no transaction link) | 0.25 | System |

The reviewer never sees or sets these.

### Public indicators (all shown, none hidden)

| Indicator | Meaning |
|---|---|
| Overall customer rating | Sentiment of all published reviews |
| Verified transaction rating | Ratings where the tier is confirmed, validated or corroborated |
| Unverified rating | Ratings with no transaction link |
| Review volume | How many reviews are counted |
| Recent trend | Last 90 days compared with the earlier period |
| Price accuracy | Share of observed prices that matched the advertised price (phase 3 onward) |
| Stock accuracy | Share of stock reports that matched a later check (phase 3 onward) |
| Branch confidence | Verification level of the branch |

### Rules that do not change

- No review count, no score. Show "Not enough reviews yet", never an invented neutral score.
- A business cannot pay to remove a review, raise its rating, buy a badge, or change the ranking. Subscriptions may pay for tools, never for reputation.
- An unusual review is flagged, not deleted. A removal is a moderation action with a reason and an appeal path.
- Reputation is calculated per **branch** and rolled up per business. One excellent branch never hides a weak one: the branch scores are always shown.
- Scores are reproducible. Each snapshot stores `input_hash` and `method_version`.

## 2. Contribution rewards

### Principles

- Paid for **accepted, useful** contributions only.
- The reward for a quick rating is the same for 1 star and 5 stars.
- Nobody is paid for a positive opinion.
- No double pay for one discovery. A new shop is paid once, to the first accepted submitter.
- Rewards are created at acceptance, never at submission.

### Proposed reward schedule (points, and the cash equivalent in the pilot)

Pilot conversion, proposed: **100 points = KSh 10**.

| Contribution | Points | Cash equivalent |
|---|---|---|
| Accepted quick rating | 20 | KSh 2 |
| Detailed review (accepted) | 50 | KSh 5 |
| Supporting evidence attached to a review | 30 | KSh 3 |
| New shop accepted | 100 | KSh 10 |
| Accepted price correction | 20 | KSh 2 |
| Accepted stock check | 20 | KSh 2 |
| Accepted physical verification | 200 | KSh 20 |

Cost check, from the blueprint's own illustration: 50,000 accepted contributions a month at an average KSh 3 is KSh 150,000 a month in rewards. That is the first number to test in the pilot budget.

### Budget controls

- A monthly budget per country and task type, held in `budget_key`.
- When a budget is used up, new tasks of that type stop being offered. Accepted work already done is still paid.
- Rewards are paid from a reserve, never from general operating money. The reserve is a separate ledger account.

### Withdrawal rules (proposed)

- Minimum: KSh 100.
- Currency: the country's own currency only. No cross-currency conversion.
- Destination: only a payout destination already saved to the account, and checked by the provider.
- Daily limit per contributor, to be set in the pilot.
- A withdrawal is held for manual review when the account is new, the amount is unusual, or a fraud case is open.

### Money rules (not optional)

- Balances are read from the double-entry ledger. No balance column is written.
- A withdrawal is idempotent. A duplicate provider callback changes nothing.
- A failed payout is reversed by a new ledger entry. The original entry is never edited.
- Reconciliation runs nightly and reports any mismatch between the ledger and the provider.

### Hard gate: legal review before any real money

Whether a reward balance that can be withdrawn is a payment service, electronic money or a regulated product **depends on the law in force at launch**. The blueprint itself says so. Until a written legal opinion for Kenya exists:

- All money features run in **mock payment mode**. This is the existing standing rule.
- Reward points may be shown. Cash withdrawals are off.
- No public statement may promise cash.

## 3. Fraud handling

### Six engines (as in the blueprint)

| Engine | Typical signals |
|---|---|
| A. Identity | Many accounts on one device or phone pattern, takeover signs, changed payout destination |
| B. Evidence | Duplicate file hash or perceptual hash, reused merchant reference, amount that does not match extracted text |
| C. Review manipulation | Burst of ratings for one branch, reviewer and business linked, copied comments, activity after a dispute |
| D. Contribution | Repeated discovery of existing shops, false location, repeated inaccurate prices, submissions in clusters |
| E. Financial | Repeated payout attempts, shared payout destinations, reward velocity spike, reversals |
| F. Business | Vendor reviewing itself, discounts offered for good reviews, competitor attacks, false claim evidence |

Device fingerprints are used only as a weak signal, stored as a hash, and never as proof on their own.

### Score and action (proposed thresholds)

| Score | Level | Action |
|---|---|---|
| 0–29 | Low | Accept when other validation passes |
| 30–59 | Medium | Ask for more evidence or delay the reward |
| 60–79 | High | Manual review; reward held |
| 80–100 | Critical | Block that one action pending review; appeal route open |

Thresholds are to be calibrated against labelled cases, false-positive rates and real losses.

### Principles

- A suspicious receipt is not proof that a person is fraudulent. Restrictions apply to **the specific activity first**. An account-wide restriction needs strong evidence of wider abuse and a second reviewer.
- A fraud analyst cannot delete an audit record.
- The subject sees the reason in plain words, and an appeal is always possible.
- An AI extraction is a suggestion. A person or a deterministic rule decides whether evidence is accepted.

### Separation of duties

- A moderator cannot decide their own appeal.
- The person who changes a payout destination cannot approve the withdrawal.
- A business cannot verify its own branch or submit evidence about itself as a contributor.
- A vendor cannot influence a public score.
- A country administrator cannot read another country's private evidence by default.

## 4. Public methodology page

Publish, in plain language, before the pilot opens:

1. What counts as a verified transaction.
2. How reviews are weighted, with the weights above.
3. How a business or branch gets its verification level.
4. How reviews are moderated, and how a business replies or disputes.
5. How contributions and rewards work, and that rewards never depend on the rating.
6. How the score is calculated, and that it can be reproduced from `method_version` and `input_hash`.

## 5. Things this file does not decide

- The numbers above. They are starting proposals.
- Whether cash rewards are lawful. See the hard gate.
- Any paid service. See `06`.
