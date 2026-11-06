# 05. Acceptance tests

A feature is done when every test in its section passes, not when its screen renders. These tests are the blueprint's Section 16 turned into named checks. Each one should exist as an automated test before the feature is called complete.

## Business registry

| ID | Test | Expected |
|---|---|---|
| BR-1 | Create a business that matches an existing one by normalised name and phone | Existing record suggested; new record not created without a human choice |
| BR-2 | Add two branches to one business | Both exist, each with its own coordinates and verification level |
| BR-3 | Nearby search with a 1 km radius | Only branches inside the radius; order by distance |
| BR-4 | Change a branch's coordinates | Verification level resets to pending for location |
| BR-5 | Owner verifies own branch | 403 |
| BR-6 | Unclaimed business edits | 403 |

## Product catalogue and pricing

| ID | Test | Expected |
|---|---|---|
| PC-1 | Two variants of one product (500 ml and 1 L) | Both shown; price per litre compared, not raw prices |
| PC-2 | Compare items with different units (ml vs kg) | Comparison refused with a plain reason |
| PC-3 | A new price for a listing | Previous price still retrievable with its date |
| PC-4 | Same contributor sends identical price twice in 24 h | 409 on the second |
| PC-5 | Observation dated in the future | 422 |
| PC-6 | Two accepted prices on one day that differ | Both shown, `disagreement = true` |
| PC-7 | Price older than its freshness window | `fresh = false`; never labelled current |
| PC-8 | Attempt to update an existing price observation | Blocked by the database (append-only trigger) |
| PC-9 | Stock report older than 24 h | Shown as "last seen", not current |

## Reviews and reputation

| ID | Test | Expected |
|---|---|---|
| RV-1 | Quick rating of 1 star and of 5 stars, both unverified | Same contribution reward |
| RV-2 | Verified and unverified reviews of one branch | Two separate public indicators, not one blended figure |
| RV-3 | Score recalculated from the same inputs | Identical result and `input_hash` |
| RV-4 | Branch with zero reviews | Scores null; message "Not enough reviews yet" |
| RV-5 | Reviewer edits their review | New version created; old version kept, not visible as current |
| RV-6 | Business replies to its own review twice | Second reply 409 |
| RV-7 | Business reviews its own branch | 403 |
| RV-8 | Reviewer sends `evidence_weight: 1.0` in the request body | Field ignored; server weight used |
| RV-9 | Reviewer tries a second current review of the same branch | 409 with plain reason |
| RV-10 | One excellent branch and one weak branch of one business | Both branch scores visible; business total does not hide the weak one |
| RV-11 | Review removed by moderation | Row kept with `status = removed`; not returned publicly |

## Receipts and transactions

| ID | Test | Expected |
|---|---|---|
| TX-1 | Receipt uploaded | `status = submitted`; not counted as a confirmed transaction |
| TX-2 | Same merchant reference uploaded twice | Second rejected (unique constraint) |
| TX-3 | Same file hash uploaded by a second person | Duplicate flagged for review |
| TX-4 | Transaction token used twice | Second use rejected |
| TX-5 | Expired token | Rejected |
| TX-6 | Two simultaneous uses of one token | Exactly one succeeds (atomic update) |

## Contributions and rewards

| ID | Test | Expected |
|---|---|---|
| CR-1 | Submission before acceptance | No ledger entry exists |
| CR-2 | Submission accepted | Exactly one reward ledger journal, balanced |
| CR-3 | Accept the same submission twice | Second has no effect (idempotent) |
| CR-4 | New shop submitted by two people | Only the first accepted submitter is paid |
| CR-5 | Task budget exhausted | No new tasks of that type offered; accepted work still paid |
| CR-6 | Rewards disabled (default) | Tasks visible, no reward shown, no ledger entry on acceptance |

## Wallet and payouts

| ID | Test | Expected |
|---|---|---|
| WL-1 | Wallet balance | Equals the sum of the ledger; no balance column written |
| WL-2 | Journal that does not balance | Rejected in the same transaction |
| WL-3 | Client attempts to set a balance | No endpoint exists; request ignored |
| WL-4 | Withdrawal with the same `Idempotency-Key` twice | One withdrawal |
| WL-5 | Same key, different body | 409 |
| WL-6 | Duplicate provider callback | No second ledger entry |
| WL-7 | Failed payout | Reversal entry added; original untouched |
| WL-8 | First approver approves own withdrawal | 403 |
| WL-9 | Withdrawal in mock mode | 503 with "Payouts are not switched on yet." |
| WL-10 | Nightly reconciliation finds a mismatch | Recorded and visible to finance staff |
| WL-11 | Withdrawal below KSh 100 | 422 |

## Permissions and privacy

| ID | Test | Expected |
|---|---|---|
| PV-1 | Public request for evidence | Not returned; no storage key or URL |
| PV-2 | Signed evidence URL after 10 minutes | Expired |
| PV-3 | Business reads another business's private evidence | 403 |
| PV-4 | Moderator decides own appeal | 403 |
| PV-5 | Logs for a failed request | Contain no phone number, token or payout destination |
| PV-6 | Country administrator reads another country's evidence | 403 |

## Fraud

| ID | Test | Expected |
|---|---|---|
| FR-1 | Burst of ratings for one branch from new accounts | Fraud signal raised; reviews flagged, not deleted |
| FR-2 | Score 30–59 on a submission | Evidence requested; reward delayed |
| FR-3 | Score 80+ on a withdrawal | That withdrawal blocked; account otherwise unaffected |
| FR-4 | Fraud case resolved | Every action has a reason and an audit row |
| FR-5 | Audit row deletion attempt | Blocked by the database |
| FR-6 | Appeal filed | Decided by a different reviewer |

## Regionalisation

| ID | Test | Expected |
|---|---|---|
| RG-1 | Kenya business with KES prices | Shown in KES |
| RG-2 | Reward rule for another country with no rule set | No reward; no default used |
| RG-3 | Kenyan contributor sees a Ugandan branch | Visible only if the directory is open to that country |

## Regression

| ID | Test | Expected |
|---|---|---|
| RG-R1 | Existing full backend test suite | Passes unchanged |
| RG-R2 | Existing frontend test suite | Passes unchanged |
| RG-R3 | Existing vendor lists, directory reviews and offers | Unchanged behaviour |
| RG-R4 | Plans (Readiness, Network, Institution) | Unchanged; no customer moved |
| RG-R5 | Mock payment mode | Still on |

## Non-functional targets (validate under load, not claims)

- 99.5% monthly availability in the pilot.
- P95 response under 500 ms for ordinary database requests.
- No double credit of a reward; no double settlement of a payout. Both are tested in CR-3 and WL-4/WL-6, and must also be checked with concurrent requests.
- Backups daily, and a restore test before the pilot.
