# Merit: a record, not a credit product

**Status:** built (`alembic/versions/0083_merit.py`, `app/modules/merit/`).
**Question it answers:** how does verified behaviour become a currency without the
platform becoming a loan app or holding anyone's capital?

---

## 1. The answer in one paragraph

A business's behaviour is counted, published, and exported **in the business's own
hands**. Brief computes a Trust Score from six capped evidence families, shows it on
the public page with the reasons spelled out, and lets the business download a
Pattern Report of its own history to take wherever it likes — a bank, a SACCO, a
supplier. Brief does not score creditworthiness, does not opine on repayment, does
not carry the document to a lender, and holds no money at any point. The value the
platform adds is *verification and presentation*, not capital. That is the whole
trick: the scarcity is evidence, and evidence is something we can produce without
becoming a financial institution.

---

## 2. What scores, and what never can

Six families, hard-capped, summing to 100. The caps are the design:

| Family | Max | Counted from |
|---|---|---|
| Delivered what was promised | 30 | `stock_movements` received vs cancelled, as supplier |
| Checked by a person | 25 | verified `business_claims`, human-verified branches |
| Kept its receipts | 15 | distinct **days** with a verified `receipts` row |
| Helped the town's price list | 10 | accepted `market_observations` in 90 days |
| Vouched for by people with a record | 10 | endorsements, weighted by endorser tier |
| Brought someone along | 10 | mentee milestones actually reached |

Three rules fall out of that table, and each is pinned by a test:

- **Nothing is for sale.** No fee, plan, subscription or payment is an input. The
  test asserts this against the *source* of `app/modules/merit/rules.py`, so a
  `plan_tier` field cannot be added quietly.
- **Nothing can be spiked.** The largest family is 30 of 100. Blue Chip needs 50
  points **and** evidence in at least two families, so 400 deliveries and nothing
  else is Verified, never Blue Chip.
- **Counting is log-damped.** The tenth delivery matters less than the second. Age
  and volume can never simply outrun quality.

A supplier's fulfilment is a *smoothed* ratio, not a raw one: two perfect
deliveries is not a 100% record (`fulfilment_ratio(2, 0) ≈ 0.67`).

## 3. Decay, streaks, and the difference between them

**Decay** applies to the visible score, halving every 90 quiet days, floored at
40% of the earned score. The floor is the point: going quiet is not misconduct, so
the card says "97 earned, 62% showing after 120 quiet days — **nothing was lost**",
and the underlying record is never touched. A returning business is back to the
score it earned.

**A streak is not points.** Consecutive active weeks unlock small perks ("active
this month") but add nothing to the score, because "opened the app" is the easiest
thing in the world to fake. A test asserts that a five-week streak and a zero-week
streak produce identical scores.

## 4. Tiers and what they actually unlock

Names, not valuations:

- **Seed** (< 20) — a page and offers.
- **Verified** (≥ 20) — a small, capped discovery nudge (see §5), the verified
  mark, and the Pattern Report.
- **Blue Chip** (≥ 50 **and** ≥ 2 families) — concierge introductions, and the
  right to mentor.

Every listed perk **costs Brief nothing to give and takes nothing from anyone
else**. That is the test a perk must pass to be on the list. Not on the list, on
purpose: cash, credit, prizes, draws, or any discount Brief funds. A test asserts
the perk strings contain none of those words.

## 5. Discovery position: at most five per cent

`ranking.py` gains one seventh term, `W_TRUST = 0.05`, fed from stored daily
snapshots, zero below the first tier, undefined-as-zero for anyone with no record
(never a penalty). It is measured against the summed weights so adding it does not
inflate every score, and `ranking.py` still never reads a price — both are pinned
by tests.

The ceiling is deliberately unimpressive. A record can nudge a shelf; it cannot
own one. A larger number would invite exactly one future: selling it.

## 6. Mentorship: real uplift, hard-capped

A Blue Chip business may take on up to two newcomers. Three milestones pay the
mentor (a slice of a family cap, max four awards) and grant the mentee a capped
uplift of **8 points total** — below the 20-point first tier, so mentoring can help
a newcomer toward Verified but can never carry them to Blue Chip on someone else's
record. A mentee cannot buy this and a mentor cannot mint it for a friend: the
milestones are typed events, and both ceilings are enforced in `rules.py` and
tested.

## 7. The Pattern Report — the exit from lending

`GET /api/merit/report` returns a JSON document: the subject's facts (orders
delivered, documents checked, days with receipts, last activity), the score with
its full breakdown and input hash, plain-sentence notes, and a disclaimer that
appears in the document itself:

> This report is a record of completed activity on Brief. It is not a credit
> score, not a guarantee of repayment, and not an endorsement by Brief of any
> borrowing. Brief holds no funds and lends none. The reader makes its own
> decision under its own licence.

The business downloads it and decides who sees it. Brief speaks to no lender, signs
nothing, and takes no introducer fee. Whatever a bank does next, it does under its
own licence with its own capital — which is what keeps this platform out of
credit regulation entirely.

## 8. The three things the brief asked for, and where they landed

| Asked for | Built as |
|---|---|
| A live "stock ticker" on the public page | `TrustTicker` — score, tier, top three reasons, 30-day trend, decay stated |
| Non-cash "steak": visibility, concierge, bank pass-through | `discovery_weight` (≤5%), `concierge()`, `pattern_report()` |
| "Take little from each to gift the best" | **Not built as a levy.** See §9 |

## 9. What was deliberately left out, and why

- **The micro-fee / attention-tax pool.** A flat toll on leads already exists in
  `app/modules/leads/` (5 KES fair contribution, 1 KES scout bounty), and
  `town.config.charging_enabled()` is off while `FREE_FOR_NOW` is on. Building a
  *second* levy now would be a fee nobody pays funding a prize nobody receives.
  More importantly, routing a levy into perks for the top tier is the failure mode
  the brief itself warns about: it quietly converts "best record" into "best
  funded", and it makes the score worth gaming. The perks above cost nothing to
  grant, so there is nothing to fund. If a pool is ever wanted, it should be
  funded by a named, visible sponsor — never by a tax on the bottom of the ladder.
- **Any payout, wallet, balance or credit line.** Never. The schema has no column
  that could hold one, and `pattern_report()` says so in words.
- **An operator-adjustable score.** There is no admin route that sets a score, and
  the weights are module constants. If a business disputes its record, the answer
  is "here is the hash and the rules version; recompute it" — not a manual nudge.

## 10. Open gates for counsel

1. **What the score may be called.** "Trust Score" is fine; "credit score" would
   not be. The disclaimer must survive any renaming.
2. **Whether the Pattern Report is a "credit information" product under the Data
   Protection Act 2019** once a third party relies on it. It is the subject's own
   data, exported at their request, which is the strongest position available —
   but the answer belongs to a lawyer, not to this file.
3. **Endorsement liability.** An endorsement is a named business's statement. If
   one is defamatory or inducement, the endorser owns it, not Brief — that needs to
   be in the terms before the feature is switched on publicly.
4. **Concierge and the Competition Act.** Introductions must not be sold and must
   not be conditional on buying anything. The code only offers them at a tier.
