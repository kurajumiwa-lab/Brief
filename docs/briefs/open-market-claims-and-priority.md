# The Open Market — partnership priority, free hiring, and getting paid for the gap

> **Status:** specification only. **No code and no migration in this change.** Every
> mechanism below is mapped to modules that already exist, so the build is assembly
> rather than a second product. Written 2026-11-21 against `main` at `fc5ebf0`.
>
> **Decision already taken for this document:** the money story is **claims, not
> custody.** Nobody's shilling sits with us. We record what someone promised, who
> says it was paid, and what is still owed — payable only on a named trigger. This is
> the posture `referrals/models.py` already documents ("there is no wallet, no balance
> and no payout instruction on any row") and the one `docs/TOWN_COMMERCE_LEGAL.md`
> says keeps us out of e-money licensing. Nothing here needs a PSP until someone
> deliberately reopens that decision.
>
> **Labelling.** **[Built]** = read from this repo. **[Plan]** = this document's
> design, not yet code. **[Assumption]** = a belief to test, never stated as fact.
> **[Must]** = a rule that is not negotiable because breaking it breaks the product
> or the law.

---

## 0. What you asked for, and what this document does with it

You described seven things. They are not one feature, and two of them have a
legal fork in them that has to be decided before a line of code is written. Here is
each one, in your words, and what happens to it.

| # | What you said | This document | Ready to build? |
|---|---|---|---|
| 1 | "We only seek a percentage set by the seller with a suggested percentage; a higher contribution will be prioritised" | §2 — seller-set terms, split into **our fee** and **the buyer's cutback**, with a published ramp and a labelled partner band | Yes, P0 |
| 2 | "Jobs and interview broadcast free to a company or individual representing a company by sheer employment in it" | §3 — **free for direct employers**, paid by intermediaries; the hire is what triggers money | Yes, P1 |
| 3 | "This money is only taken when you first take a salary this week… accumulate the number and no one gets paid until our client has been hired" | §3.4 — the accrual ledger: rows sit `accrued`, nothing settles, until a verified hire | Yes, P1 |
| 4 | "Whistle blowers… total number of hires from his broadcast gets him a winner in the market" | §3.5 — broadcaster share and a **verified-hires** leaderboard | Yes, P1 |
| 5 | "A person who reveals this data should be paid… advertise the savings you'll achieve by just moving to the next shop" (the Kisii wholesalers) | §4 — paid price observations on top of the existing intake module, and a savings figure with a sample count | Yes, P0 (labels) → P2 (rewards) |
| 6 | "Let anyone advertise even if he is not the owner… since we can't rely on a business to kill itself" | §5 — the third-party claim, with a right of reply | Yes, P0 |
| 7 | "The receipt should help… fill in some data, a whole day's work, 200 shilling a day but can be lowered to the percentage you contributed" | §6 — the receipt game as a **task reward**, not wages, with a budget envelope | Yes, P2 |
| 8 | "In your different shelves offer a category of templates to stimulate choice" | §7 — template packs, from data we already have | Yes, P0 |
| 9 | "Private office: portfolio of your wealth of information… family whiteboard for sticky notes" | §8 — small extension of `office`, not a new module | Yes, P3 |

### The two forks

**Fork A — where ranking money is allowed to touch ranking.** You want a higher
contribution to be prioritised. `backend/app/modules/outside/ranking.py` opens with a
rule that says the opposite: "**Price is never a ranking term.** Nothing in this file
reads a price, a fee, a budget or `is_commercial` as a boost." `docs/TOWN_COMMERCE_LEGAL.md`
§4 adds that sponsored slots are capped at three, always labelled, and **ranked
separately**. If a seller's payment moves a card up the organic feed, the app becomes
the thing you say you are fighting: a business buying the truth. §2 resolves this
without losing you the money — you get the priority, but the thing being prioritised is
**what the buyer saves**, not what we earn.

**Fork B — who pays for a job.** Your words can be read as "the applicant pays a little
when they start earning." **[Must] We will not do that, in any form.** Charging a person
for help finding work is (a) the exact signature of the recruitment scam every Kenyan
public body warns about, and (b) regulated — the Labour Institutions Act requires
registration to "carry out business as an employment agency or charge any fees for
procurement of employment" (s.55(2)), with a KSh 125,000 application fee for a local
agency and an offence for trading without it. A job board that takes money from the
person who needs the job would hand our critics the entire argument in one screenshot.
§3 keeps your economics intact and moves the payer to the employer, which is also how
every legitimate Kenyan agency already charges.

---

## 1. The thesis, stated so it can be attacked

> **We are not a marketplace that takes a cut. We are the place where a town's prices
> stop being a secret, and we charge the businesses that benefit from being seen.**

Three consequences, and every design rule below follows from them:

1. **The buyer's saving is the product.** A screen that says "walk 40 metres, save KSh
   168 on the same bale" is worth more than any ad. If we sell ranking, we have nothing.
2. **Petty commerce in Kenya is not short of suppliers; it is short of price
   information.** The wholesalers beside the supermarket in Kisii are not hiding — they
   are simply not indexed. Whoever indexes them first owns the town's buying habits.
3. **We cannot rely on a business to expose itself**, which is exactly why the network
   must let customers, employees-in-their-private-capacity, and rival shops publish,
   with their names attached and the business's right of reply preserved (§5).

---

## 2. Partnership priority: the seller sets the number

### 2.1 One number becomes two, on purpose

**[Plan]** A seller sets **two** percentages on each offer, with a suggested value
pre-filled:

| Field | Who receives it | Used in ranking? | Where it lives |
|---|---|---|---|
| `platform_fee_pct` | us | **Never. [Must]** | per-offer term; billed like `PlatformFeeEntry` |
| `buyer_cutback_pct` | the buyer, as a discount on the price shown | **Yes**, inside the partner band only | per-offer term |

This is the whole trick, and it is honest: **"our best cutback" becomes "the buyer's
best cutback."** Your sentence — *we lubricate by prioritising our best cutback* — stays
literally true, except the person who benefits is the one deciding where to shop. We
earn the flat fee; the buyer earns the discount; the seller buys position with money
that reaches the customer. Nobody can accuse us of selling the ranking, because the
ranking input is a price the customer keeps.

### 2.2 Suggested percentages

Suggested values, so a seller is choosing rather than guessing. Pre-filled, editable,
with a one-line reason shown next to each.

| Line of business | Typical ticket | Gross margin | Suggested `buyer_cutback_pct` | Suggested `platform_fee_pct` |
|---|---|---|---|---|
| Fresh produce wholesale | KSh 2,500 / bag | 8–12% | **1.0%** | 0.5% |
| Dry goods wholesale (the Kisii case) | KSh 2,100 / bale | 6–10% | **1.5%** | 0.5% |
| Shop retail | KSh 350 | 20–35% | **4.0%** | 1.0% |
| Services (one job) | KSh 8,000 | 40–60% | **6.0%** | 2.0% |
| Equipment & rentals | KSh 3,500 / day | 50%+ | **8.0%** | 2.0% |
| Hardware & building | KSh 5,000 / order | 15–25% | **2.5%** | 1.0% |
| Agrovet & inputs | KSh 1,200 | 12–20% | **2.0%** | 1.0% |

**[Must] Ceilings, not just suggestions.** `buyer_cutback_pct` ≤ 10% and
`platform_fee_pct` ≤ 3%, combined ≤ 12% of the ticket, enforced server-side and refused
with a plain sentence at the point of typing. `fees/rules.py` already caps at
`MAX_BPS = 2000`; this is a tighter, product-level cap. A seller who will give back 30%
is either not making money or not telling the truth about the price, and either one
breaks the screen.

### 2.3 The ramp: an open space today, a lubricated market later

Your instinct — *at low count it's an open space, with increasing competition we
lubricate* — is right, and it needs to be a published number rather than a private
policy, because the day someone's cheaper offer is buried is the day the app dies.

**[Plan]** `partner_boost_weight(density)` where density is the count of live offers in
the same town and category:

| Live offers in the town + category | Weight of `buyer_cutback_pct` in the band order | What it means |
|---|---|---|
| 0–19 | **0** | Open space. Order is relevance, distance, recency, price. Cutback is shown as a badge, never a boost. |
| 20–99 | **0.10** | A nudge between otherwise equal offers. |
| 100+ | **0.25** | Real competition. Still a nudge, never an override. |

**[Must] The override rule, published in the UI:** *a partner offer can never appear
above a verified offer that is cheaper for the same item.* Concretely — the comparison
runs on the customer's price after the cutback. If shop B is KSh 40 cheaper and gives
back nothing, shop B is above shop A even if shop A pays us three times more. This is
the sentence that makes everything else sellable, and it is a unit test, not a promise.

### 2.4 The band, and its limits

**[Must]** Partner offers are drawn in one labelled strip at the top of a shelf: at most
**three**, the words "**Partner — KSh 168 back**" on the card, and the same three-cap
discipline `docs/TOWN_COMMERCE_LEGAL.md` §4 already commits to. The organic list below
it never changes order because of money.

### 2.5 Early-stage reality

[Assumption] In the first three months almost every seller will sit at `0%` cutback, and
that is fine: the boost weight is zero, so nothing is distorted, and the card still
carries the price. The screen works with zero partners. **A shelf that only works when
someone is paying is a shelf that is empty on day one**, and this design cannot have
that failure.

---

## 3. Free hiring, and who is allowed to be charged

### 3.1 The rule

**[Plan]** A job broadcast is **free** when the poster is the employer that will hire
into that role:

- free: a business posting for its own vacancy; a person posting for the business they
  work in, with the business named;
- paid: an agency, aggregator, recruiter or "consultant" posting on behalf of an unnamed
  employer.

The distinction is not moral, it is structural: direct employers are supply we want and
should never tax; intermediaries are reselling our attention, and they already charge
their own clients.

**[Must] Free means free forever for direct employers** — not free-then-charged. A fee
introduced later on something we called free is the fastest way to lose the trust the
rest of this document depends on.

### 3.2 Who never pays

**The applicant pays nothing. Not on application, not on shortlisting, not on interview,
not on offer, not out of their first salary. [Must]**

Enforced structurally, the way `referrals` does it: **there is no column anywhere in the
hiring schema that can hold a payment from an applicant.** No fee field, no wallet, no
balance. If a future feature needs one, it will have to change the schema, which is the
point — it makes the mistake visible in a diff.

The UI states it on every broadcast: *"Free to apply. We never charge the person looking
for work."* A broadcast that somehow asks for money is reportable in one tap and is
removed.

### 3.3 What we charge, and the math you asked for

You said the price should follow "the math for said salary and number of applicants but
cheap per buy." Two candidate prices:

| Model | Formula | Example: 200 applicants, KSh 40,000/month role | Who pays |
|---|---|---|---|
| **Per hire (recommended)** | `0.115 × monthly_salary` ≈ half a week's pay | **KSh 4,600**, once, only on a confirmed hire | employer |
| Per shortlisted applicant | `KSh 20 × shortlisted`, capped at one hire fee | KSh 4,000 for 200 shortlisted | employer |

**Per hire wins** because it needs no applicant to spend anything and it prices the
outcome the employer actually wants. For context, a Kenyan agency typically bills around
a month's salary (KSh 40,000 here); KSh 4,600 is roughly an eighth of that, which is what
"cheap per buy" should mean. The rate is a runtime setting, not a constant — the
`commerce_settings` mechanism in `app/modules/town/config.py` was built for exactly this.

**[Must] The fee is never netted out of anyone's salary.** The employer pays it after the
hire is confirmed, on their own reference, the way `TaskPaymentConfirmation` records a
direct payment today. Deducting it from the hiree's pay would make the hiree the payer
through the back door, and that is the thing we refuse.

### 3.4 The accrual ledger: accumulate the number, pay nobody yet

Your sentence — *this money is only taken when you first take a salary this week, just
accumulate the number and no one gets paid until our client has been hired even if it's a
different business* — is a claim ledger, and we already have the shape:

**[Plan]** `hiring_claims`, append-only:

```
claim        id, broadcast_id, earner_vendor_id, kind(hiring_fee|broadcaster_share),
             amount_kes, status(accrued|payable|settled|void), trigger_kind, trigger_id
```

- A row is written `accrued` the moment a broadcast qualifies for a claim.
- **Nothing moves.** No wallet, no balance, no "pending earnings" that a user can cash.
  The label on screen is "**Accrued — payable when the hire is confirmed**", because
  that is true and a balance is not.
- A row becomes `payable` **only** on a verified hire event: employer confirmation *plus*
  one independent signal (a signed-offer upload, a start-date check-in by the hiree, or
  the employer's second hire in the same role, whichever the policy allows). One
  confirmation is never enough — the whole point of your design is that nobody gets paid
  on a hope.
- `settled` is written when the payer records the M-Pesa reference. It is evidence of a
  direct payment, never a platform transfer.
- If the hire falls through within the void window, the row goes `void` with a reason.
  Never silently deleted.

**"Even if it's a different business"** — the earning event is a hire *anywhere*, not
only the broadcaster's own posting. A broadcaster who brings a person into the network
earns when that person is hired by someone else, provided attribution is intact (§3.6).
That is the design you described and it is also the strongest growth loop in this
document: it pays people for introductions, not for traffic.

### 3.5 The broadcaster, and the leaderboard

**[Plan]** Whoever broadcasts a job — an individual, a shop, a boda stage that shares it
— is the `earner`. Split of the hire fee:

- broadcaster: **40%**
- platform: **60%**

A broadcaster with 9 verified hires out of 40 broadcasts is a real asset and the screen
should say so plainly: **"9 people hired through this broadcast."** Counts of named
events, never a score — the rule in `services/discovery.py` and the `TrustSignals`
component already apply.

**[Must] No payment for a broadcast that produced no hire.** Views, taps and applications
are free to report as counts but never convert to money. Otherwise the incentive is spam,
and a market flooded with unmatchable job posts is worse than no job board.

### 3.6 Attribution, without a fingerprint file

Attribution has to survive forwarding to WhatsApp — which is where Kenyan hiring actually
happens. **[Plan]** Every broadcast carries a `?via=` code. The applicant's first
touch on that code is the attribution; the code travels in the application. If a person
arrives through two broadcasters, the **first** touch wins, and the reason is shown to the
loser rather than hidden. No device fingerprinting, no contact-list upload, no tracking
pixels — those are a data-protection problem (§10) and they don't survive WhatsApp
anyway.

---

## 4. Price intelligence: paying the person who closes the gap

### 4.1 The Kisii example, handled honestly

You told a story: two wholesalers next to the supermarket in Kisii, and how much a shop
could save by knowing both prices. **This document does not assert which shops those are,
what they charge, or that any saving is real.** [Assumption] What it asserts is that the
*pattern* is universal and cheap to prove: in most Kenyan towns the same bale, crate or
carton is sold within a few hundred metres at two prices, and nobody compares them.

The product is one sentence: **"The same bale is KSh 2,100 at one shop and KSh 1,932 forty
metres away."** With a date, a sample count, and where each number came from.

### 4.2 It is already half built

| Need | Exists | Gap |
|---|---|---|
| A shop that has no account | `MarketPresence` with a `~virtual_id` that can never authenticate, linked to a real vendor on claim | none |
| A price, from a photo of a shelf or a printed wholesale list | `MarketIntakeBatch` + `MarketObservation` (product, price, unit, confidence, wholesale flag, status `suggested`/`confirmed`/`rejected`) | none |
| A benchmark per corridor, town and category | `CorridorPriceIndex` (p25/median/p75, `sample_count >= 5` enforced by constraint) | a savings view |
| Paying the person who collected it | `CorridorTask` + `TaskPaymentConfirmation` (direct payment, reference recorded) | linking a task to a batch |

So the build is: a **savings query** and a **reward rule**, not a new subsystem.

### 4.3 The savings figure

**[Plan]** `GET /api/intake/savings?product=&town=` returns, per confirmed observation
group:

```
{
  "product": "Sugar 50kg bale",
  "town": "Kisii",
  "cheapest": {"presence": "~wholesaler-a-4f2a", "price_kes": 1932, "distance_m": 40},
  "typical":  {"median_kes": 2100, "sample_count": 7},
  "saving_kes": 168,
  "saving_pct": 8.0,
  "observed_on": "2026-11-18",
  "confidence": "confirmed"
}
```

**[Must] Four rules on the figure:**

1. **A saving below 5 samples is not published.** The `sample_count >= 5` constraint on
   `CorridorPriceIndex` already encodes this belief; the savings view must honour it
   rather than show a two-shop anecdote as a market fact.
2. **The date is part of the number.** A price from six weeks ago is labelled stale and
   drops out of the headline after 45 days.
3. **Never a verdict about a shop.** The sentence is "KSh 168 cheaper here", not "they
   are overcharging you". The second sentence is defamation-shaped and unprovable; the
   first is a receipt.
4. **We publish what we can evidence.** If nobody has photographed the cheaper shelf,
   the cheaper price does not exist on screen, however loudly a customer insists.

### 4.4 Paying the observer

**[Plan]** A price observation is a paid micro-task, reusing the corridor-task payout rail
(direct payment, reference recorded) rather than any wallet:

| Contribution | Reward |
|---|---|
| 1 confirmed observation (a price, its shop, a date) | **KSh 15** |
| A batch of 12 confirmed observations from one walking route (a "work day") | **KSh 200** |
| An observation that *corrects* a stale price by ≥10% | **KSh 25** |
| An observation that opens a shop nobody has indexed yet | **KSh 50** |

The economics are absurdly good, which is the point. Mapping a town's wholesalers for one
category — say 12 shops × 40 lines — is roughly 480 observations, about **eight worker-days,
KSh 1,600**. For the price of a lunch, we own a town's price truth for a category, and it
is the only asset in this document a competitor cannot copy by launching a prettier app.

On the other side: a shop buying 20 bales a month at KSh 168 saved is **KSh 3,360 a month,
KSh 40,320 a year**, for free. That is the gift, and it is what makes the app impossible
to ignore in a town.

### 4.5 The employee question

You said employees should be able to reveal a better price. **[Must] The line:**

- **allowed:** a price anyone can see as a customer — a shelf label, a quoted price, a
  printed wholesale list handed to buyers, a receipt from their own purchase;
- **refused:** internal documents, costing sheets, supplier contracts, or anything that
  puts the employee in breach of confidence for us.

We never ask an employee to smuggle anything, and we never pay for a leaked internal
document, even a true one. A shop that finds its costing sheet on our screen is entitled
to be furious and would win the argument.

---

## 5. Anyone can advertise: the third-party claim

### 5.1 What is allowed

**[Plan]** Any signed-in person may publish a claim about a business that is not theirs:

| Claim | Example | Allowed |
|---|---|---|
| Price | "This wholesaler sells the bale at KSh 1,932" | Yes, with evidence or ≥2 corroborations |
| Better offer | "The shop next door does the same at KSh 1,850" | Yes, named, dated |
| Service reality | "They deliver the same day to Nyalenda" | Yes, with a date |
| Quality insult | "Their goods are fake" | **No.** Not without a receipt, batch and a dispute record |

**[Must]** A third-party claim is always labelled with who said it: **"Reported by a
customer, 18 Nov — not confirmed by the business."** Anonymity is allowed for the person's
identity but never for the *fact's* provenance; if we cannot say when and how it was seen,
it does not go up.

### 5.2 The business's rights

**[Must]** The business may always:

1. **claim the profile** (existing `market_presences.claimed_vendor_id` path) and correct
   its own prices, no negotiation;
2. **reply** to any third-party claim, in the same view, within the same day;
3. **dispute** a claim → `DisputeCase` (already exists, "evidence, not a verdict"), and the
   claim carries a `disputed` badge until resolved;
4. **have a false claim removed** — a claim with no evidence behind it and an owner denial
   is removed, not just flagged.

**[Must] What the owner cannot do:** delete a receipt-backed price fact. Facts stay, with
the correction attached. The difference between us and a directory is that a directory's
listings are the business's own marketing; ours are the town's observations.

### 5.3 Why a rival being allowed to advertise is the feature

You are right that "we can't rely on a business to kill itself". The consequence is a
design constraint: **the cheaper shop's advocate is a third party, and we carry their
name.** That is what makes it credible. It also means the ad unit is not a banner; it is a
comparison, and it is why §2's "a partner never outranks a cheaper verified offer" matters
— otherwise the rival's honest cheaper price gets buried by someone's marketing budget,
and the whole transparency claim becomes a slogan.

---

## 6. The receipt game: 200 shillings a day, honestly

### 6.1 What it is

You described filling in a bit of data after shopping — window shopping included — being
counted as a whole day's work, KSh 200 a day, reducible to "the percentage you contributed".
That is a **paid data task**, and calling it one is the only way it survives scrutiny.

**[Plan]** One "work day" = one completed batch: 12 accepted observations (prices, shop,
date, photo where possible) inside one town, submitted before midnight. Reward ladder:

```
accepted / required    payout
      100%              KSh 200
       75%              KSh 150
       50%              KSh 100
      <50%              KSh 0, with a written reason for each rejected line
```

That is exactly your "lowered to the percentage you contributed", made arithmetic. The
rejection reason is mandatory — a person who worked and got nothing is owed a sentence
explaining why, or they are right to call it a scam.

### 6.2 The word matters

**[Must] It is a task reward, not wages, and the copy says so:** "You are completing a paid
task. This is not employment, it does not create an employment relationship, and it is not
a daily salary." A person doing 26 full days would earn KSh 5,200 a month, which is below
the statutory minimum wage, so it must never be described as a job — and there must be a
**monthly cap per person** (KSh 4,000 suggested, about 20 full days) so nobody is quietly
living on it as though it were one. If we ever want to pay people to do this full time,
that is an employment question and it deserves a real answer, not a rounding error.

### 6.3 The budget envelope, published

**[Plan]** Each town has a daily reward pool. If submissions exceed the pool, the payout
rate drops for everyone and **the screen says so before they start**:

> "Today's pool pays KSh 150 per full day, not KSh 200 — more people submitted than the
> budget covers. The pool refills at 6am."

Silently paying less after the work is done is the one thing that would destroy this
feature permanently.

### 6.4 Anti-fraud, because this is a cash incentive

**[Must]** All of these, before a single shilling is promised:

- **One receipt, one reward.** Hash the receipt (the `receipt_key` idea already in
  `services/receipt_rewards.py`) and refuse a duplicate.
- **Geofence.** The observation must be within ~150 m of the shop it names, or it needs a
  photo that places it there.
- **Two independent reports** before a price is `confirmed`; a single report stays
  `suggested` and pays the lower "suggested" rate.
- **No pay for a price already confirmed in the last 14 days** by someone else.
- **Cross-check the arithmetic.** A receipt line that contradicts its own total is
  rejected, the way `receipt_items` already preserves what OCR actually read.
- **Pattern review.** Ten submissions from one phone in one hour at ten different shops is
  a review case, not a payout.

### 6.5 "Make it a game" — the line

Points, badges, a town leaderboard, streaks: **yes**, free, and it works. A **cash prize
draw** is a lottery and in Kenya that means the Betting Control and Licensing Board and
the gambling framework — the same gate `docs/TOWN_COMMERCE_LEGAL.md` §5 applies to the
betting category. **[Must]** No prize draws, no "win KSh 50,000 for your hundredth
observation", until someone has done that analysis. A leaderboard that pays the top
observer a *task* bonus for *more verified work* is fine, because it is payment for work,
not a game of chance.

---

## 7. Templates per shelf: stimulate choice with difference

You asked for a category of templates on each shelf so a person chooses between
*differences in offering, options, or type of business*. We already have the pieces:

| Piece | Today | [Plan] |
|---|---|---|
| Page presets | 3 — `service`, `shop`, `host`, a `Literal` on `PageSettingsIn` ([Built] `professional_card/page_settings.py`) | 18–24 named business types, moved to a validated data list so adding one is not a schema change |
| Starter steps | Hand-written `blueprints` (free, reviewed by an adviser) | one blueprint per business type |
| Page sections | tagline, about, offers, hours, credentials | + gallery, price list, comparison |
| Shelves | Data-driven manifest (`outside/shelves.py`) | each shelf names the template pack it offers |

A pack, for example **"Fresh produce wholesale"**, contains: a page preset, five starter
offers with units and price modes, one blueprint, a suggested `buyer_cutback_pct`, and the
first three price observations worth collecting. Choosing the pack creates a draft page the
owner then edits — **[Must]** always a draft, never published automatically, because a
template that goes live in the owner's name before they read it is a liability, not a
feature.

This is cheap: mostly data in one file, plus a cloning endpoint. It also does the thing you
actually want — a wholesaler in Kisii sees a screen that already looks like a wholesaler in
Kisii, instead of a blank form.

---

## 8. The private office: the portfolio and the family whiteboard

You described a place that holds your wealth of information — favourite vendors, skills, a
family venture, a whiteboard with sticky notes and non-permanent markers — close to the
family, sellable to the public, and linkable to a public page as an editable template.

Nearly all of this exists in `app/modules/office/`:

| Your words | Existing | Gap |
|---|---|---|
| "list favourite vendors" | `OfficeSavedItem` with privacy `public_showcase` / `family_shared` / `vault_private` | none |
| "his skills" | vendor profile skills | surface them in the office portfolio |
| "a family business or venture" | `Office` + members + roles | a venture card |
| "family whiteboard for sticky notes" | `OfficeNotice` (title, body, edit history) | `kind`, colour, pinned, **expires_at** |
| "link to his public page as the template and allow editing" | `/p/<handle>` + page editor | "Start from my public page" → clone to a private board |

**[Plan]** The whiteboard is `OfficeNotice` with four added columns — `kind('notice'|
'sticky')`, `colour`, `pinned`, `expires_at`. A sticky note that expires is the whole
metaphor: non-permanent markers mean the board clears itself, and it means an old note
can't resurface as a promise.

**[Must] Privacy is the default, not a setting.** A sticky note starts `family_shared`, never
public. Promotion to `public_showcase` is one deliberate act with the words "this appears on
your public page" on the button — the same discipline `OfficeSavedItem` already documents
("the safe default is `vault_private`").

---

## 9. What is new, and what is assembly

| Mechanism | Reuses | New (smallest honest version) |
|---|---|---|
| Seller terms | offerings (three tables), `commerce_settings`, `PlatformFeeEntry` | `platform_fee_pct` + `buyer_cutback_pct` on each offer; band ranking function |
| Job broadcast | `referrals` conversion pattern, notifications, `TrustSnapshot` | `hiring` module: broadcast, application, hire event, `hiring_claims` |
| Price intelligence | `intake`, `price_index`, `receipt_rewards`, `corridor_tasks`, `TaskPaymentConfirmation` | savings query; observation reward rule |
| Third-party claims | `market_presences`, `merchant_claims`, `DisputeCase` | reply object; `disputed` on an observation |
| Receipt game | receipts + items, corridor-task payouts | work-day batch, reward ladder, town pool |
| Templates | `blueprints`, page presets, shelf manifest | 15–20 template data entries + clone endpoint |
| Private office | `office`, `OfficeNotice`, `OfficeSavedItem`, `work_assignments` | 4 columns + venture card + clone-from-page |

**No wallet. No escrow. No balance. No payout instruction.** Every money row in this
document is a claim, a quote or an evidence note — the same shape as `ReferralBounty` and
`TaskPaymentConfirmation` today.

---

## 10. Legal gates (Kenya) — before any of this is promoted

Not legal advice; the same disclaimer `docs/TOWN_COMMERCE_LEGAL.md` carries applies. These
are the questions an advocate must answer, and the ones I have already designed around.

| Area | Risk | Position taken here |
|---|---|---|
| **Employment agencies** | Charging for "procurement of employment" requires registration under the Labour Institutions Act (s.55(2)); operating unregistered is an offence | We never charge the applicant (§3.2), so the fee is a business-to-business service, not a job-seeker fee. Confirm with counsel that a per-hire employer fee is not itself "procurement of employment" for an unregistered agency — if it is, either register or price the *broadcast service*, not the hire. |
| **Recruitment fraud** | Every Kenyan public body states it charges no fee at any stage; a paid job board reads as the scam pattern | The "free to apply, we never charge the person looking for work" statement is on every broadcast, and the schema cannot hold an applicant payment. |
| **Competition Act 2010** | Publishing a rival's prices, and selling ranking, both touch misleading-conduct and anti-competitive rules | Paid position is labelled and capped at three; a paying partner can never outrank a cheaper verified offer (§2.3); we publish observed prices with dates and samples, and we never say a shop is overcharging (§4.3). |
| **Defamation** | A third-party claim that a business is bad | Claims are attributed, dated and evidenced; quality accusations without a receipt are refused; owner reply is same-day and in-view (§5.2). |
| **Data protection (DPA 2019)** | Price observers photograph shops; employees could be identified | No device fingerprinting, no contact upload; photos of goods and labels, not people; a named person's report carries their name only with their consent; retention and deletion paths defined before P2. |
| **Confidence / contract** | Paying employees for internal documents | Public prices only (§4.5). |
| **Gaming** | A cash prize draw is a lottery | No draws; leaderboard bonuses pay for verified work (§6.5). |
| **Tax & records** | Task rewards and subscription revenue | Rewards recorded as task payments with references; only `settled` counts as paid; `PlatformFeeEntry` remains the revenue ledger — `accrued` is not revenue. |
| **Employment status** | A person doing daily paid work may be an employee in fact | Task reward, explicitly not wages, monthly cap, and no exclusivity (§6.2). |

**Launch gate:** none of §3, §4.4 or §6 turns on a payout until the advocate has answered
the employment-agency question and the task-reward classification. Everything in P0 can
ship without either.

---

## 11. Build order

Each slice is independently shippable and independently useful. Nothing depends on money
moving.

### P0 — no money moves, no migration risk (recommended first)

1. **Seller terms** on each offer: `platform_fee_pct`, `buyer_cutback_pct`, ceilings,
   suggestions by line of business. Shown on the card as "KSh 168 back".
2. **The band** with its three-slot cap, the label, and the override rule as a pure
   function with unit tests (a partner never outranks a cheaper verified offer).
3. **Third-party claim labels** on existing `market_observations`: who reported it, when,
   suggested vs confirmed, owner reply, owner dispute.
4. **Savings figure** from confirmed observations, with the ≥5 sample rule and the 45-day
   staleness rule.
5. **Template packs** as data, six to start, one clone endpoint.

**Acceptance:** a shopper in Kisumu can see "KSh 168 back" on a partner card and still find
a cheaper non-partner above it; a shop owner can reply to a claim about their price the
same day; a wholesaler can start a page from a template and it opens as a draft.

### P1 — hiring

Broadcast (free for direct employers), apply (free forever), hire event with two-signal
confirmation, `hiring_claims` accrual, broadcaster share, verified-hires leaderboard, the
`?via=` attribution. **Acceptance:** a hire produces exactly one claim row per earner, the
row is `accrued` and not payable, a voided hire voids it with a reason, and no code path can
record a payment from an applicant.

### P2 — rewards

Work-day batching, the reward ladder with mandatory rejection reasons, the published town
pool, the anti-fraud checks of §6.4, task payouts on the existing direct-payment rail.
**Acceptance:** the same receipt twice earns once; a batch below 50% earns nothing and
explains every line; nobody is paid beyond the monthly cap.

### P3 — office

Whiteboard columns, venture card, clone-from-my-public-page. **Acceptance:** a sticky note
is family-private by default, expires on the date set, and publishing it is one deliberate
confirmed action.

---

## 12. Questions I could not answer from your message

1. **"Paid by anyone who opened his broadcast"** — I have read this as *the employer who
   hired pays, and the broadcaster shares it* (§3.5). Read literally it would mean viewers
   pay to have opened a job post, which is the applicant-pays model §3.2 refuses. Confirm
   the first reading.
2. **"Even if it's a different business"** — I have read this as *a hire anywhere in the
   network counts, if attribution holds*. The alternative is *the broadcaster earns from
   hires by businesses other than the one that posted*, which would need a payer who has no
   relationship to the hire. Confirm.
3. **Suggested percentages** in §2.2 are my numbers from typical Kenyan margins, not
   measured. They need one week with five real wholesalers in Kisii and Kisumu before they
   are published as "suggested".
4. **The Kisii example** — I have deliberately not named either shop or asserted a saving.
   Which two are they, and may a field worker photograph their public price lists? The
   whole §4 pitch rests on one verified number.
5. **The 40/60 broadcaster split** is a guess; it should be set by what actually makes
   someone forward a job post.
6. **Does the platform ever invoice the hire fee, or is it always a direct payment with a
   recorded reference?** I have designed the second, because the first is the custody
   decision you just closed.
7. **Who funds the KSh 200-a-day pool** — a merchant marketing budget, a town sponsor, or
   us? The design works with any of the three, but the copy changes.

---

## Appendix — the three sentences to put on the wall

1. **A paying partner can never appear above a cheaper verified offer.**
2. **The person looking for work never pays us anything, ever.**
3. **Nobody gets paid until someone is hired, and we never hold the money.**

If a future feature needs one of those to be false, it is a different company.
