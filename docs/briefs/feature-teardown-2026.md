# Feature teardown 2026 — what to clone, what to refuse, and the better route

> **Provenance.** Written 2026-10-12 against the repository at v2.11+ (this branch).
> It answers: *what features can we clone from Takealot, Amazon, Alibaba, Oracle,
> Fiverr and eFootball — and where is there a better route?*
>
> Sources are dated in Appendix A and cited inline. Claims are labelled
> **[Built]** (read from this repo), **[Evidence]** (public source),
> **[Assumption]** (belief to test) or **[Target]** (a number we commit to).
>
> **One ambiguity flagged:** "take home" is read as **Takealot** (SA). If a
> different company was meant, the Takealot section is the only one that
> changes — and its conclusion (§6.1) is the same one whichever retailer you
> substitute.
>
> This brief does **not** replace `kenya-opportunity-network-strategy.md` or
> `sacco-moat-strategy.md`. It tests them against what the market did in 2026,
> and proposes the feature layer that serves both.

---

## 0. The answer in one page

Every platform on that list — except Oracle — makes its money by owning the
**transaction**: Amazon's take rate, Alibaba's escrow and ads, Fiverr's 20%,
Takealot's margin, eFootball's virtual currency. That is the instinct to
resist, and 2026 gave us two very expensive proofs of why.

**Twiga Foods raised $185.4M, hit 12,000 deliveries a day across 12 Kenyan
cities and 140,000 retailers — and entered statutory administration in August
and September 2026** after twelve years without a profit [2](https://techcabal.com/2026/09/20/the-next-wave-the-expensive-life-of-twiga-foods/) [3](https://dealroom.co/news/150659-kenyas-twiga-foods-enters-administration-after-35m-lifeline-fails/).
**Wasoko–MaxAB ($240M+ raised, 450,000 merchants) retreated from eight countries
to five, pushed out both founder-CEOs, and abandoned its core e-commerce for
fintech** [1](https://techmoonshot.com/2026/02/24/wasoko-maxab-is-quietly-purging-its-founder-dna-and-betting-everything-on-fintech/) [2](https://news.yahoo.com/african-b2b-e-commerce-startups-083000402.html).
The post-mortems agree on the mechanism: cold chain and enterprise routing cost
more than the gross margin between farm-gate and street-corner, and delivering
micro-orders to kiosks cost more in fuel than the baskets were worth
[2](https://techcabal.com/2026/09/20/the-next-wave-the-expensive-life-of-twiga-foods/).

The survivor is the one that refused the assets: **Kapu runs an asset-light
pickup-agent model with 330+ pickup locations and deliberately capped
geography, rather than owning a fleet** [1](https://trendtype.com/news/twiga-foods-has-been-put-into-administration/).

So the filter is not "is this a good feature." It is:

| Test | Question | Why it decides |
|---|---|---|
| **1. Asset test** | Does it need a warehouse, a fleet, or inventory we own? | If yes, we are re-running Twiga with less money |
| **2. Offline test** | Does it still work when the trade closes on WhatsApp? | Most of this market's trade does, and always will |
| **3. Audit test** | Can a vendor audit every number we show them back to a recorded event? | The house rule; also the only trust position competitors can't copy |
| **4. Take-rate test** | Can we actually collect a fee on it? | A fee on trade we didn't originate is a fee nobody pays |

The features that pass all four are, with one exception, not the famous ones.
They are the **plumbing**: escrow, reorder, handoff, dispute, record, and
habit. That is the recommendation.

**The thesis:** clone Alibaba's *escrow*, Amazon's *reorder*, Takealot's
*pickup points*, Fiverr's *packages and resolution centre*, eFootball's
*LiveOps* and Oracle's *system-of-record*. Refuse all six companies'
logistics, take-rates, ranking economies and engagement-by-anxiety. The
resulting product is not a marketplace — it is the settlement and record layer
for trade that already happens offline. That is a defensible business; a
marketplace is not, and 2026 closed that argument.

---

## 1. Before cloning anything: three 2026 facts that change the plan

### 1.1 The 2G-first assumption is dead — and the strategy docs still say it

`sacco-moat-strategy.md` specifies **"Zero-AI · 2G-first"** for Layer 1.
As of December 2025 Kenya had **48.7M smartphones against 29.6M feature
phones — 92.9% smartphone penetration**, with entry-level Android under
KES 5,000 and average mobile-broadband consumption of **14.6 GB per quarter**
[1](https://techweez.com/2026/04/07/kenya-smartphones-penetration-feature-phone-decline/) [2](https://techmedia.africa/africa/kenya/what-kenyas-92-9-smartphone-penetration-means).
Mobile money penetration is 98% [1](https://techweez.com/2026/04/07/kenya-smartphones-penetration-feature-phone-decline/).

**Recommendation: build smartphone-first with a low-data lane, not 2G-first.**
The 29.6M feature phones are concentrated in rural and older cohorts — a
USSD/SMS lane for *notifications* is worth keeping, but the product surface is
now a real web app. Designing for 2G in 2026 costs you the map, the chat and
the photo-based stock entry to serve a segment that is shrinking every quarter.

### 1.2 Safaricom has already taken the obvious lending product — and left the gap

M-PESA now processes **137.9M transactions a day (KES 118B)** and has pivoted
hard into SME credit: **Fuliza Biashara** (KES 1,000–400,000 overdraft, 2%
access fee, auto-recovered from till inflows every 30 minutes), **Taasi Till**
(KES 1,500–250,000) and **Taasi Pochi** (from KES 1,000), underwritten on
transactional data and delivered over USSD *234# to ~0.7M active merchants
[1](https://business.co.ke/m-pesa-for-business-paybill-till-number-payment-solutions-business-list/) [2](https://streamlinefeed.co.ke/news/why-safaricom-m-pesa-is-pivoting-from-payments-to-sme-credit-under-fintech-2-0) [4](https://techweez.com/2025/05/21/safaricom-business-credit-mpesa/).

**Do not compete here.** But note what M-PESA's data *is*: till inflows. It
knows what a vendor was paid. It does not know what they bought, from whom, at
what price, whether it arrived, or whether they are a reliable counterparty.
**That is exactly the data this platform has** — movements, receipts, claims,
ratings. Fuliza underwrites the till; nobody underwrites the trade.

### 1.3 The SACCO back office is visibly broken, and they know it

Regulated SACCOs held **KSh 1.21 trillion** in assets in 2025, with KSh 832.74B
in deposits and KSh 948.67B gross loans. SASRA lists **176 licensed
deposit-taking SACCOs for 2026**, and approved digital products rose from 345
to 407 in a year [1](https://techtrendske.co.ke/2026/09/30/sacco-payments-kenya-banks-fintechs/) [5](https://www.tuko.co.ke/business-economy/616754-list-176-saccos-licensed-deposits-kenyans-2026/).

The catch, reported this month: those 407 products are **overwhelmingly
lending**, the sector "continues to heavily rely on third-party financial
institutions… as well as fintech companies," SACCOs are **locked out of the
National Payments System**, and there is no liquidity facility for distressed
societies. The summary is worth quoting: *"A Sacco can now reach a member in
Siaya through a USSD menu in seconds. It still cannot tell that member, with
any reliability, when their own money will come back to them"*
[2](https://launchbaseafrica.com/2026/10/08/sacco-sector-kenya/).

This **strengthens** the Sacco Moat brief rather than weakening it — but it
reorders it. The near-term sellable thing to a SACCO is not competition for
deposits; it is **underwriting data and a member-facing record**. They have the
balance sheet and the licence. We have the trade behaviour. They cannot build
ours; we must not try to build theirs.

---

## 2. Amazon — clone the reorder, refuse the warehouse

| Mechanic | Clone? | Why |
|---|---|---|
| **Subscribe & Save / repeat purchase** | **Yes — highest ROI on this list** | Zero assets, pure software, and it matches how informal vendors actually buy: the same crate, weekly |
| "Frequently bought together" / reorder list | **Yes** | Derived from movement history we already hold; no new data capture |
| A-to-z Guarantee | **Yes, as a dispute hold** | Buyer protection is the trust primitive; see §7.2 |
| Personalised recommendations | **Partially** | `services/discovery.py` already ranks with `reasons` **[Built]** — keep it explainable, never a black box |
| **FBA / owned logistics** | **No** | This is Twiga |
| **Sponsored listings / ads on ranking** | **No** | Creates exactly the opaque ranking the house rules ban, and Fiverr shows where it ends (§5) |

### 2.1 The one to build: *standing order*

**Amazon's least glamorous feature is its most transferable.** A vendor's
sourcing pattern is repetitive — the same supplier, the same SKU, the same
quantity, every Tuesday. Amazon turned that into Subscribe & Save; for a
Kenyan vendor it is "reorder last week."

Why it matters more here than it did for Amazon: every reorder is a
**trade event we did not have to originate**. It is the cheapest possible
recording surface for the ledger in §7.3, and it is the natural place to attach
escrow (§7.2) and delivery confirmation.

**[Built]** `app/modules/orders/` already persists the live order journey,
fulfilment and payment detail (migration `0014`). `services/stock_engine.py`
already handles reservation and shelf debit. A "reorder" is a new movement
seeded from a historical one — small build, and it compounds every other
feature on this list.

**[Target]** 30% of repeat-pair movements initiated from a reorder surface
within 90 days of launch. If vendors won't reorder in-app, they don't trust the
supplier record enough for escrow either — and that is the finding to act on.

---

## 3. Alibaba — clone Trade Assurance, refuse the GMV machine

Trade Assurance holds buyer funds in escrow until the buyer confirms receipt,
and — critically — **it protects only objective, verifiable violations**
(spec mismatch, late ship, short quantity), not subjective dissatisfaction,
with a defined inspection window and evidence requirements
[1](https://seller.alibaba.com/blogs/2026/southeast-asia/b2b-trade/trade-assurance-complete-guide-alibaba-secure-payment) [3](https://www.chinaispp.com/what-is-alibaba-trade-assurance-and-how-it-protects-buyers/).

That design maps almost perfectly onto this platform's existing rules — and
onto this market's actual problem.

| Mechanic | Clone? | Why |
|---|---|---|
| **Escrow released on delivery confirmation** | **Yes — the single biggest unlock** | The top reason vendors won't trade with strangers; no assets required |
| Objective-violations-only coverage | **Yes** | Matches the "verified facts, not vibes" rule **[Built]** |
| Named inspection window + evidence | **Yes** | Turns a dispute from an argument into a procedure |
| **Verified Supplier / Gold Supplier tiers** | **Yes, but derived** | The passport exists **[Built]** — see §7.4 |
| **1688 group-buy / pooled ordering** | **Already built, differently** | Daily Flash Locks + collective sourcing are this **[Built]** |
| **Advertising on GMV** | **No** | See §2 |
| Cross-border logistics | No | Not our market |

### 3.1 Why escrow is the whole ballgame here

Alibaba solved "I paid and got nothing" for cross-border trade, where the
parties will never meet. Kisumu's version is stranger, and *harder*: the buyer
and seller may be two stalls apart and **still** not trust each other with
cash-up-front, because the enforcement options are social, not legal.

Escrow works here because it needs **no assets and no legal system** — just a
wallet, a state machine and a release condition. And the schema is mostly
already written: `services/custody.py`, `services/payments.py`,
`services/psp_client.py`, the payment-intent and ledger models **[Built]**, with
`TRADE_PAYMENTS_ENABLED=false` gating it.

The one hard dependency is a licensed PSP — and **M-PESA, not a card
processor, is the right rail.** Daraja STK Push / B2C / B2B covers the flow,
merchant collection is 0.55% capped at KES 200 and free under KES 200
[5](https://www.safaricom.co.ke/main-mpesa/for-your-business/business-till/),
and the money lands where vendors already keep it. A card-first PSP adds FX and
chargeback exposure to a market that is 98% mobile money
[1](https://techweez.com/2026/04/07/kenya-smartphones-penetration-feature-phone-decline/).

**[Assumption to test first]** that vendors will prepay into an escrow at all,
rather than paying on delivery as they do today. **Test it with 20 vendors and
a paper prototype before writing code** — if they won't prepay, escrow is a
solution to a problem they don't have, and the money goes to §7.3 instead.

---

## 4. Oracle — the only non-marketplace on the list, and the most useful

Oracle's product is not a feature set. Two transferable mechanics:

1. **Be the system of record, not the interface.** Oracle wins because ripping
   it out means losing the books, not the UI. Switching cost comes from
   *accumulated history*, not from features.
2. **Sell to the institution.** Oracle sells to the CIO and the board, not to
   the person typing.

### 4.1 Clone: become the vendor's books (§7.3)

Right now a vendor's trade history in this app is a *feature of the app*. Make
it **their property**: an exportable, auditable record of what they bought,
from whom, at what price, and whether it arrived — plus their verified claims
from the standing module **[Built]**.

The moment that record is what they hand to a SACCO loan officer, a county
procurement desk, or a supplier asking for credit, the app stops being a tool
they can drop. That is Oracle's moat, and it costs nothing to build.

### 4.2 Clone: sell sideways, not down

The customer is not only the vendor. It is the **SACCO** (§1.3) and the
**buyer institution**. Both are in the existing strategy docs; Oracle's lesson
is about *packaging*: one integration, one data feed, one compliance story,
sold once, rather than 10,000 individual subscriptions.

### 4.3 Do not clone

Oracle's per-seat enterprise licensing, its sales cycle, or its
enterprise-feature bloat. Wrong segment entirely.

---

## 5. Fiverr — clone the mechanics, refuse the economics

| Mechanic | Clone? | Why |
|---|---|---|
| **Gig packages (Basic / Standard / Premium)** | **Yes** | Removes negotiation overhead for standard work |
| **Escrow + 3-day auto-accept** | **Yes** | Same primitive as Alibaba's; a timeout is what makes escrow practical |
| **Resolution Center with partial refunds** | **Yes** | Disputes need a home; see §7.2 |
| **Seller levels** | **Yes, but derived** | Never a stored badge a bug can grant |
| **20% take rate** | **No — see below** | Destroys the moat and is unenforceable here |
| **Promoted Gigs** | **No** | Pay-to-rank; banned by the audit test |

### 5.1 The economics are the trap

Fiverr takes **20% of every transaction, including tips**
[1](https://www.fastlancer.org/en/fastlancer-blog/fiverr-review/) [3](https://ruul.io/blog/is-fiverr-legit).
It can, because it originated the transaction and controls the payment rail.

Three reasons that fails here:

1. **The trade already happens offline.** We cannot tax a conversation that
   happened at 6am at the market. A take-rate only works on the slice we
   actually carry — which is the argument for escrow, not for GMV.
2. **It inverts the moat.** `sacco-moat-strategy.md` and
   `kenya-opportunity-network-strategy.md` both make *relationships that
   persist off-platform* the defensible asset. A 20% cut gives vendors a
   standing incentive to take the second order off-platform — which is exactly
   what rational people do. **Do not build a business model whose rational
   customer response is to leave.**
3. **The labour context.** The Opportunity Network brief already deferred gig
   features pending HRW/ILO evidence, and required that any entry lead with pay
   transparency **[Evidence, per that brief]**. A 20% rake on a KES 200 task
   is the thing that gets written about.

The Hustle League already has the right instinct structurally: **per-skill
minimum wage floors enforced server-side**, so gamification can never become
underpayment **[Built]** — XP, level, division and streak are *derived* from
completed contracts, and gold is a ledger sum, never a stored balance
**[Built]**. That is the correct Fiverr clone. Keep it.

**Monetise the Hustle League on subscription or on escrow, never on a
percentage of a KES 200 job.**

---

## 6. Takealot — clone the pickup point, refuse the marketplace

Takealot's genuinely transferable idea is not its marketplace. It is that it
**solved "no deliverable address" with collection points**: 2019 pickup
points, then counters inside Pick n Pay stores, so people without a street
address, a home during working hours, or a reliable courier route could still
receive goods [2](https://mybroadband.co.za/news/business/520989-how-takealot-revolutionised-online-shopping-in-south-africa.html).

### 6.1 Clone: pickup points as a zero-capex logistics layer (§7.1)

This is the **single most underrated idea on the list** for this market.

Kisumu's markets, and Kenya's informal trade generally, have precisely the
problem Takealot solved: no street addresses, no one at a fixed location,
micro-parcels, and delivery economics that killed Twiga. Takealot's answer was
capex-heavy (warehouses). **The asset-light version is a network of existing
shops** — a vendor's own stall becomes the handoff point for their neighbours,
for a small fee or a small credit.

- **It inverts Twiga's cost structure.** No fleet, no warehouse, no cold
  chain. The "last mile" is a shop that is already open.
- **It is Kapu's lesson, applied** — pickup-agent, asset-light, geographically
  capped [1](https://trendtype.com/news/twiga-foods-has-been-put-into-administration/).
- **It creates physical network nodes** that strengthen the map and the
  relationship graph **[Built]** — every pickup point is a verified location
  and a trusted intermediary.
- **It monetises without a take-rate** on the trade itself: the fee is for the
  handoff, which is a real service we actually performed.

**[Built]** the courier/shipment model, tracking numbers, forward-only status
history and receiver ratings already exist; `services/routing.py` and
`market_locks` already model zones and pickup windows. Public-place and vendor
location data already backs the map. This is an extension, not a new product.

### 6.2 Refuse: the marketplace itself

Takealot is now being eaten by Amazon's local marketplace, and its own
marketplace has recurring grey-import trust failures
[3](https://mybroadband.co.za/news/business/617622-takealot-marketplace-selling-grey-imports-without-warnings/).
Even at Takealot's scale — $215M raised, Naspers-owned, two 30,000 m²
warehouses — the marketplace did not produce investor returns
[4](https://static1.squarespace.com/static/52246331e4b0a46e5f1b8ce5/t/5cd008fcb208fc5e822f92c2/1557137668486/IDTT+2+eCommerce+1+Research+Report+2.pdf).
Do not enter a race where the winners didn't win.

---

## 7. The recommended build — ranked

Sequenced by (leverage ÷ build cost), and each one passes all four tests in §0.

### 7.1 Tier 1 — build now

**① Pickup-point handoff network** *(Takealot, asset-light)*
A vendor opts their shop in as a handoff point. Couriers drop; both parties
confirm; the point earns a fee or credit. Extends the existing shipment,
routing and zone models. **Build: S–M.**

**② Standing order / one-tap reorder** *(Amazon)*
Reorder from history; seed a new movement from an old one. **Build: S.**
This is the cheapest possible recording surface for ⑤ and the natural attach
point for ③.

**③ Escrow released on delivery confirmation** *(Alibaba × Fiverr)*
M-Pesa-backed, objective-violations-only, with a defined inspection window and
auto-release timeout. Gated behind the §3.1 validation. **Build: M** (schema
largely exists; the work is the PSP rail and the state machine).

**④ Daily objectives and weekly challenges** *(eFootball — done right)*
Three daily objectives that reinforce **real trading behaviour** — post a stock
update, confirm a delivery, close out a claim — plus one weekly challenge.
**Build: S.** See §8 for what to refuse.

### 7.2 Tier 2 — build after Tier 1 validates

**⑤ Dispute / resolution centre** *(Fiverr × Alibaba)*
Timed, evidence-carrying, with a defined decision path and partial-release
outcomes. Escrow without this is a promise you can't keep. **Build: M.**

**⑥ Exportable trade record — "your books"** *(Oracle)*
The export in §4.1. Vendor-owned, portable, audit-grade. This is the switching
cost and the SACCO underwriting asset. **Build: M.**

**⑦ Derived supplier tiers** *(Alibaba Gold Supplier, corrected)*
Never a stored badge. A tier computed from recorded outcomes **with the sample
size shown**, consistent with `TrustSignals.jsx` and the discovery `reasons`
pattern **[Built]**. **Build: S–M.**

**⑧ Gig packages for Hustle League** *(Fiverr)*
Basic/Standard/Premium on job calls, above the existing per-skill wage floors.
**Build: S.**

### 7.3 Tier 3 — the institution play

**⑨ SACCO underwriting feed + member record** *(Oracle × the Sacco Moat)*
Sell the SACCO what §1.3 says they cannot build: real-time trade behaviour on
informal members, and a member-facing record. **Do not take deposits.** This is
Layers 2→3 of `sacco-moat-strategy.md` with the sequencing corrected.
**Build: L.**

**⑩ County / AGPO consortium assembly** — retained from
`kenya-opportunity-network-strategy.md` at P2. Unchanged.

### 7.4 Sequencing logic

① and ② are cheap and each makes the next tier *measurable*: you cannot sell
escrow to a vendor who has never reordered in-app, and a dispute centre is
pointless without escrow. ④ is the only retention mechanism on the list that
costs nothing and doesn't rely on anxiety. ⑥ is the moat and is useless until
there is enough recorded history to export — so start recording (②) now.

---

## 8. eFootball — what to clone, and the line not to cross

The transferable mechanic is **LiveOps**: a reason to open the app today, built
from daily objectives, weekly challenges and seasonal events
[1](https://www.fulltimepredict.com/efootball-daily-login-rewards-2026/).

The equally important half is the critique, which is well summarised in game
design circles: **"do not reward the login — reward the fantasy."** A
login-bribe loop teaches *open → claim → leave*, and streaks retain through
anxiety rather than desire, with a nasty failure mode where a user breaks a
streak for ordinary reasons and then abandons the product
[2](https://www.reddit.com/r/GameDevelopment/comments/1tczba2/a_simple_design_rule_for_daily_rewards_reward_the/).

**Clone:**

- **Daily objectives tied to real work.** The fantasy here is not "I claimed my
  coins," it is *"I am running a serious business."* The reward should follow
  the behaviour — a confirmed delivery, a posted stock update — never the
  pageview.
- **Weekly challenges and seasons** with visible progress and a reset. Cheap,
  and they create cohort moments.
- **Squad-level goals.** The Hustle League already has squads **[Built]**; make
  some objectives collective, because the social unit is the chama/group, not
  the individual.

**Refuse:**

- **Login streaks as a core mechanic.** The failure mode above is worse when
  the user is a market trader with an unpredictable week.
- **Loot boxes / gacha / chance deals.** When real money and real livelihoods
  are involved, randomised reward is a regulatory and ethical problem, not a
  feature.
- **Purchasable premium currency.** Gold must stay earned-only **[Built]** —
  the existing ledger design already implies this. Keep it.
- **Energy gates and FOMO timers.** Punishing a vendor for having a bad week is
  the fastest way to lose a market that already distrusts platforms.

---

## 9. Explicit anti-list — the graveyard

Each of these is a feature someone will suggest. Each has a body count.

| Do not build | Who did it | Why it dies here |
|---|---|---|
| Owned warehousing, fleet, or cold chain | Twiga, Copia | $185M and 12 years; unit economics never closed [2](https://techcabal.com/2026/09/20/the-next-wave-the-expensive-life-of-twiga-foods/) |
| Inventory we buy and hold | Wasoko–MaxAB | Retreated to fintech from 8 markets to 5 [1](https://techmoonshot.com/2026/02/24/wasoko-maxab-is-quietly-purging-its-founder-dna-and-betting-everything-on-fintech/) |
| A general B2B marketplace | Takealot, Jumia | No returns even at Naspers scale [4](https://static1.squarespace.com/static/52246331e4b0a46e5f1b8ce5/t/5cd008fcb208fc5e822f92c2/1557137668486/IDTT+2+eCommerce+1+Research+Report+2.pdf) |
| Take-rate on GMV | Fiverr's 20% | Unenforceable offline; incentives users to leave [1](https://www.fastlancer.org/en/fastlancer-blog/fiverr-review/) |
| Pay-to-rank / promoted listings | Fiverr, Amazon ads | Banned by the audit test; destroys the trust position |
| An opaque seller score | Alibaba-style composite grades | House rule: no number a small business cannot audit **[Built]** |
| Consumer/shopper side | — | Contradicts the founding constraint. "No consumers. Only vendors." |
| Competing with M-PESA on till credit | Safaricom | 137.9M txns/day and the licence [1](https://business.co.ke/m-pesa-for-business-paybill-till-number-payment-solutions-business-list/) |
| Taking SACCO deposits directly | — | SASRA-regulated; partner instead (§1.3) |
| Gamified currency purchasable with cash | eFootball | Regulatory and ethical exposure when livelihoods are attached |
| A 2G-first product surface | — | 92.9% smartphone penetration and falling [1](https://techweez.com/2026/04/07/kenya-smartphones-penetration-feature-phone-decline/) |

---

## 10. Two corrections to the existing strategy docs

Both are consequences of 2026 market movement, not errors in reasoning at the
time of writing.

1. **`sacco-moat-strategy.md` §Layer 1 says "2G-first".** Rewrite as
   **smartphone-first with a low-data and USSD-notification lane.** The device
   data does not support 2G-first in 2026
   [1](https://techweez.com/2026/04/07/kenya-smartphones-penetration-feature-phone-decline/).
   The *constraint that still matters* is data cost and intermittent
   connectivity, not device class — so optimise payload size and
   offline-tolerance, not feature-phone rendering.

2. **"Zero-AI" should become "AI drafts, humans decide."** The durable
   guardrails in `kenya-opportunity-network-strategy.md` §0 are
   *verified-facts-vs-estimates separation*, *no opaque scores*, and *human
   approval before consequential actions*. Those are right and should stay.
   "Zero-AI" is a stronger claim than any of them require, and it forecloses
   cheap wins that violate none of them — drafting a stock entry from a photo,
   reading a price out of a 15-second voice note (the voice-note pipeline
   already exists **[Built]**). **Keep the approval gate; drop the blanket ban.**

---

## 11. What would falsify this brief

Committed as **[Target]** so they can be checked, not argued:

- If fewer than 30% of repeat-pair movements start from a reorder surface
  within 90 days of ② shipping → the record layer has no traction; stop before
  building ③ and ⑤.
- If fewer than 20 of 20 interviewed vendors will prepay into escrow → ③ is
  solving a problem this market doesn't have; redirect to ⑥.
- If pickup points cannot be recruited at >50% of approached vendors in one
  market zone within 30 days → ① is a logistics business in disguise; kill it.
- If no SACCO signs an LOI for the underwriting feed within 6 months of ⑥
  shipping → the institution play is the wrong buyer; the record is still worth
  having, but sell it to the vendor, not the SACCO.

---

## Appendix A — sources

| # | Source | Date | Used for |
|---|---|---|---|
| [1](https://techcabal.com/2026/09/20/the-next-wave-the-expensive-life-of-twiga-foods/) | TechCabal, *The expensive life of Twiga Foods* | 2026-09-20 | $185.4M raised; 12,000 daily deliveries; 140,000 retailers; administration Aug–Sep 2026; unit-economics post-mortem; Kapu's asset-light contrast |
| [2](https://techmoonshot.com/2026/02/24/wasoko-maxab-is-quietly-purging-its-founder-dna-and-betting-everything-on-fintech/) | Techmoonshot, *Wasoko-MaxAB… betting everything on fintech* | 2026-02-24 | Founders out; 8→5 markets; e-commerce abandoned for fintech |
| [3](https://dealroom.co/news/150659-kenyas-twiga-foods-enters-administration-after-35m-lifeline-fails/) | Dealroom, *Twiga Foods enters administration* | 2026-09-14 | Administration confirmed; $35M lifeline failed |
| [4](https://news.yahoo.com/african-b2b-e-commerce-startups-083000402.html) | TechCrunch/Yahoo, Wasoko–MaxAB merger interview | 2024-11-27 | 450,000 merchants; ~200,000 active; fintech margin thesis |
| [5](https://trendtype.com/news/twiga-foods-has-been-put-into-administration/) | Trendtype, *Twiga Foods has been put into administration* | 2026-09-14 | Kapu: asset-light pickup agents, 330+ locations, capped geography |
| [6](https://seller.alibaba.com/blogs/2026/southeast-asia/b2b-trade/trade-assurance-complete-guide-alibaba-secure-payment) | Alibaba Seller Blog, *Trade Assurance complete guide* | 2026-05-20 | Escrow mechanics; objective-verifiable-violations-only; inspection window; evidence matrix |
| [7](https://www.chinaispp.com/what-is-alibaba-trade-assurance-and-how-it-protects-buyers/) | China Sourcing Agent, *What is Alibaba Trade Assurance* | 2026-07-03 | Coverage, dispute windows, limits |
| [8](https://www.fastlancer.org/en/fastlancer-blog/fiverr-review/) | Fastlancer, *Fiverr Seller Fees 2026* | 2026-07-31 | Gig packages; escrow; 3-day auto-accept; 20% fee |
| [9](https://www.tecla.io/blog/fiverr-review/) | Tecla, *Fiverr Review* | 2026-04-06 | Seller level system; escrow; vetting |
| [10](https://business.co.ke/m-pesa-for-business-paybill-till-number-payment-solutions-business-list/) | Business.co.ke, *M-PESA for Business* | 2026-07-02 | 137.9M txns/day; KES 118B; Fuliza Biashara; Pochi; Daraja |
| [11](https://streamlinefeed.co.ke/news/why-safaricom-m-pesa-is-pivoting-from-payments-to-sme-credit-under-fintech-2.0) | Streamline Feed, *M-PESA pivoting to SME credit* | 2026-07-01 | Fuliza Biashara 1k–400k at 2%, 30-min recovery; Taasi Till/Pochi; data-based underwriting |
| [12](https://techweez.com/2025/05/21/safaricom-business-credit-mpesa/) | Techweez, *Safaricom unveils business credit* | 2025-05-21 | ~0.7M active Lipa na M-PESA merchants; USSD *234#; 14–30 day terms |
| [13](https://www.safaricom.co.ke/main-mpesa/for-your-business/business-till) | Safaricom, *M-PESA Business Till* | — | Merchant tariff 0.55% capped KES 200; ≤KES 200 free |
| [14](https://techtrendske.co.ke/2026/09/30/sacco-payments-kenya-banks-fintechs/) | TechTrends KE, *Kenya's KSh1.2 trillion SACCO economy* | 2026-09-30 | KSh 1.21T assets; 832.74B deposits; 948.67B loans; 236→267 digital DT-SACCOs; 345→407 products |
| [15](https://launchbaseafrica.com/2026/10/08/sacco-sector-kenya/) | Launch Base Africa, *The digital illusion inside Kenya's Sacco sector* | 2026-10-08 | Back-office failure; products overwhelmingly lending; third-party reliance; NPS exclusion |
| [16](https://www.tuko.co.ke/business-economy/616754-list-176-saccos-licensed-deposits-kenyans-2026/) | Tuko, *176 SASRA-licensed DT-SACCOs 2026* | 2026-02-02 | 176 licensed deposit-taking SACCOs |
| [17](https://techweez.com/2026/04/07/kenya-smartphones-penetration-feature-phone-decline/) | Techweez, *Kenya now has 93 smartphones for every 100 phones* | 2026-04-07 | 92.9% smartphone penetration; 48.7M vs 29.6M; 98% mobile money; 14.6GB/quarter; <KES 5,000 devices |
| [18](https://techmedia.africa/africa/kenya/what-kenyas-92-9-smartphone-penetration-means) | TechMedia Africa, *What Kenya's 92.9% smartphone penetration means* | 2026-04-05 | 78.3M devices; 149.4% penetration |
| [19](https://mybroadband.co.za/news/business/520989-how-takealot-revolutionised-online-shopping-in-south-africa.html) | MyBroadband, *How Takealot revolutionised online shopping in SA* | 2024-01-08 | Pickup points; Pick n Pay counters; TakealotNow; third-party marketplace; Amazon entry |
| [20](https://mybroadband.co.za/news/business/617622-takealot-marketplace-selling-grey-imports-without-warnings.html) | MyBroadband, *Takealot marketplace selling grey imports* | 2025-11-11 | Marketplace trust failures |
| [21](https://static1.squarespace.com/static/52246331e4b0a46e5f1b8ce5/t/5cd008fcb208fc5e822f92c2/1557137668486/IDTT+2+eCommerce+1+Research+Report+2.pdf) | *Online Retailing in South Africa: An Overview* | 2019 | Takealot scale, warehouses, weak investor returns |
| [22](https://www.fulltimepredict.com/efootball-daily-login-rewards-2026/) | Fulltime Predict, *eFootball daily login rewards 2026* | 2026-06-05 | LiveOps mechanic; daily login, weekly objectives, campaigns |
| [23](https://www.reddit.com/r/GameDevelopment/comments/1tczba2/a_simple_design_rule_for_daily_rewards_reward_the/) | r/GameDevelopment, *Reward the fantasy, not the login* | 2026-05-14 | Critique of login bribes and anxiety-based streaks |
