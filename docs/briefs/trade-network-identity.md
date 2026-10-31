# Vendor World is a connection layer (v2.18)

> **Decision: direction C — a connected business network *with* digital
> identities, business registers, vendor fronts and automation inside it.**
>
> The network creates the relationships; the technology makes them useful,
> organised and repeatable. Neither half ships alone: a directory without
> records is a phone book, and records without a network is an ERP nobody asked
> for.

This document records the decision, what it changed on the home screen, and the
things it deliberately did **not** claim yet.

---

## 1. The position, in one paragraph

Vendor World does not create a new market. It connects existing ones. It does not
replace businesses — it gives them a digital presence they can be found at. It
does not separate buyers from sellers, because the same record can be both: a
school buys electricians and stationery, a household buys a plumber and can rent
out a ladder, an artisan supplies institutions and sources materials. The thing
being sold is *infrastructure* — identity, discoverability, connection and a
record of the relationship — not a stall in a marketplace.

Concretely, what a participant gets that a phone number in a bio cannot give:

| Question | Answer on the network |
|---|---|
| Who is this business? | A structured record: categories, location, verification state, gallery |
| Who around me does this? | Discovery ranked by fit, **with the reasons** behind each result |
| Is this price current? | A vendor-stated price on a dated record |
| Did this trade happen? | A movement ledger — the history a client or a lender asks for |
| Can I reach them again? | A stable handle (`/@handle`), searchable by name and trade |

---

## 2. What changed on the home screen

### 2.1 The hero

| Before (v3.2) | After (v2.18) |
|---|---|
| Market photograph: tomatoes, sacks, a stall | Workshop floor: a technician at a bench, shelving, machines |
| Directional green scrim (52–95%) | Flat ≈82% deep-teal scrim, so contrast is predictable |
| Headline **changed with the vendor's trading mode** | One headline for every participant |
| "Find the stock your business needs." / "Put your stock in front of the network." | "The businesses around you. Connected." |
| No categories in the hero | Six doors: Technology · Manufacturing · Skilled trades · Products · Enterprises · Logistics |
| No ask | The ask, in the second voice: "Have a business or skill? Create your vendor identity" |

**Why the mode-dependent headline had to go.** `HomeHero` read
`vendor.current_role` and printed one of four sentences. That is a marketplace
speaking: it assumes you arrived as either a buyer or a seller. On this network
`account_kind ∈ {person, household, artisan, institution, business}` and every
one of them can hold stock — so a headline that changes with `current_role`
changes the *product* depending on who is looking. One sentence, one product.

The ask is the one place the hero differs per visitor, and only in wording: a
vendor who already has a handle is asked to *open* their front; a visitor is
asked to *create* one. Both land on a route that exists.

### 2.2 The category panel

The old opening strip (`ShelfTiles`, nine square tiles) began *Online services ·
Farms · Your category*, and no amount of work further down the page recovers from
a first line that says "agricultural platform". It was replaced by
`TradeNetworkPanel`: five rows, a picture-free icon, a title, a description and a
chevron.

Each row is a **door, not a taxonomy**:

| Category | Lands on |
|---|---|
| Technology and digital services | `/browse?type=services` |
| Manufacturing and fabrication | `/browse?type=goods` |
| Skilled trades and technical work | `/browse?type=people` |
| Products and equipment | `/browse?type=equipment` |
| Business and operational services | `/tools` |

The panel ends with the sentence that keeps it honest and open: *"Starting
categories, not restrictions"* → `/create`. A trade that is not listed is a shelf
someone has not opened yet. Nothing here is counted, because a count that is
wrong is worse than no count.

### 2.3 One network, different participants

`ParticipantBand` states the both-directions rule with four rows — school
(institution), household (consumer **and** potential vendor), enterprise
(business), skilled worker (independent provider) — and one sentence that is a
schema fact rather than a slogan: *the account kind decides what the record looks
like, not what it is allowed to do.*

### 2.4 The four systems, each with a screen

`FoundationStrip` names the four systems the network is built on. Each points at
the surface that exists today; the one that does not is labelled **Next**:

| System | Screen | State |
|---|---|---|
| Digital business identity | `/passport`, `/@handle` | Shipped |
| Discovery and relationships | `/network` (ranked, with reasons) | Shipped |
| Business codes and automation | — the handle *is* the address | **QR printing: next** |
| Trade activity and records | `/orders`, `/analytics` | Shipped |

Saying "business codes and QR" before a QR can be generated would be the first
thing a buyer discovers is not true. It says *next* until it isn't.

### 2.5 Navigation

`Home · Discover · Create · Connect · My World`. Routes unchanged (`/explore`,
`/activity`, `/me`), so every saved link and every area array still resolves; see
`docs/outside/01-route-map.md`. The mobile tab bar is now keyed by route
(`tab-explore`, `tab-activity`, `tab-me`) instead of by label, so a rename cannot
silently rename a test hook.

---

## 3. The palette

| Role | Token | Value | Where it is allowed |
|---|---|---|---|
| Primary | `brand-600` | `#103C35` deep forest teal | The hero, primary buttons, the identity block |
| Working teal | `brand-500` | `#1F7A66` | Links on light surfaces, selected states |
| Second voice | `tech-500` | `#19A783` | Confirmation, live state, the *ask* band — never a second action colour |
| Accent | `electric-500` | `#5265E8` | The one place a screen points forward; `info` state |
| Page | `surface-0` | `#F5F7F6` | The page behind cards |
| Card | `surface-1` | `#FFFFFF` | Every card |
| Text | `ink-1` | `#182522` | Titles (15.0:1 on white) |

Defined once in `frontend/src/styles/tokens.css`; `.dark` is a true peer theme,
not a pile of overrides. `tech` and `electric` are new Tailwind families
(`bg-tech-50`, `text-electric-500`, …).

**Why teal and not the old pine green.** Pine green at `#176344` was chosen for a
discovery feed and read as "produce". `#103C35` is darker and bluer: it holds
white type at 10.4:1, sits behind photographs without tinting them, and does not
look like a vegetable.

**Agricultural imagery is gone from the brand**, not from the product: produce is
still what a greengrocer sells. What changed is the picture that greets somebody
who has never heard of us.

---

## 4. What is *not* built yet, and is therefore not claimed

1. **Printed QR business codes.** The handle is a stable address; generating and
   printing a QR is the next step, and the panel says so.
2. **A public "business register" browse** — a searchable list of institutions by
   kind (schools, clinics, SACCOs) is a screen that does not exist. The
   participant band links to discovery, which does.
3. **Automated quotations and follow-ups.** Enquiries exist (`/storefront/inbox`);
   automation does not.
4. **Mobile-browser verification of the new home screen.** The suite and the build
   are green; a real phone pass is still outstanding, as it is for the intake desk.
5. **A privacy notice covering institutional records.** Records about a school are
   a business record; records about a *person* (a fundi) are personal data under
   the Kenya Data Protection Act, 2019, and need the same review flagged in
   `docs/briefs/tiktok-shop-front-link.md` §5.

The rule this document is written under, and which the product has kept since
v2.1: **a claim on the home screen is a promise a stranger will test in the first
thirty seconds.** Every band added in v2.18 either links to a screen that exists
or says *next*.
