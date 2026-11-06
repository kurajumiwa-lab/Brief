# MarketTrust: specification for the existing Brief app

> **Status:** specification only. No feature code, no migrations, no deploys.
> **Date:** 2026-11-06
> **Branch:** `arena/6925df0e-brief`
> **Source:** the MarketTrust architecture blueprint supplied in chat on 2026-11-06.

## What this is

The blueprint describes a public trust-and-price directory for physical shops. You said it is a **harness**, not a new build. So this folder does one job: it maps the blueprint onto what Brief already has, and writes down what must be decided before any building starts.

Brief is adapted, not replaced. Existing customers, plans and live features are untouched.

## The documents

| File | What it answers |
|---|---|
| [01-gap-analysis.md](01-gap-analysis.md) | For each of the blueprint's eight modules: what Brief already has, what to reuse, what is missing. |
| [02-data-model.md](02-data-model.md) | The new tables, their fields, types, constraints and indexes. Existing tables that are reused and not changed. |
| [03-api-contracts.md](03-api-contracts.md) | Proposed endpoints, sample payloads, and error codes. Written against the current `/api/...` prefix. |
| [04-trust-rewards-fraud.md](04-trust-rewards-fraud.md) | Review scoring, evidence weights, reward economics and the fraud handling policy. Each item is marked as a proposal. |
| [05-acceptance-tests.md](05-acceptance-tests.md) | The test list a feature must pass before it counts as done. |
| [06-decisions-and-conflicts.md](06-decisions-and-conflicts.md) | Conflicts with rules already set for this project, and the decisions still open. |

## Five principles (kept from the blueprint)

1. Physical businesses are the foundation of the directory.
2. Every product, price and stock fact has a source and a timestamp.
3. Anyone can review; verified transactions carry more weight.
4. People are paid for accepted, useful contributions, never for positive opinions.
5. Trust is earned through evidence. It is not bought through subscriptions or fees.

## Headline findings

- **Brief already has about half the foundation.** Businesses (`vendors`), business claims (`business_claims`), verified-seller status, market price observations from screenshots (`market_observations`), append-only ledger patterns, dual approval, a payment provider abstraction with a mock mode, and public discovery pages.
- **Four things are missing entirely:** business branches, a canonical product catalogue with variants, business-level reviews, and contribution tasks with rewards.
- **Three things need a decision before code:** whether cash rewards may exist at all (legal review), whether any paid service is allowed under the free-for-now rule, and whether the country tenancy model is worth its cost for Kenya-only launch.

## What is not yet verified

- The blueprint's statements about EAC payment interoperability, CBK licensing and Kenya's data protection rules were **not checked** in this work. They are marked as requiring legal review.
- The reputation formula in the paste lost its variable definitions. Section 04 reconstructs them and labels the reconstruction as an assumption.
