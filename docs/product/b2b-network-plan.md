# Brief business network — build plan

Status: approved direction (owner, this session). Build order decided. Credit is out of scope for now.

## 1. What we are building

A **network of businesses that discover, verify, buy from, collaborate with, learn from and grow with each other.**
Not a shop for shoppers. Retail storefronts stay as they are; the value is in business-to-business relationships.

The measure of success is **meaningful business relationships and transactions**, not the number of registered businesses.

Each step of the loop should strengthen the network:

| Step | What the business does | What the network needs |
|---|---|---|
| Discover | finds a supplier, service or mentor | verified listings in the home feed and directories |
| Verify | checks the other side is real | membership verification, confirmed-offer rule, reviews from businesses |
| Buy | orders or books | orders, bookings, calendar (built) |
| Collaborate | shares work, stock or a group order | group orders (exist), later chama pooling |
| Learn | attends a seminar or consultation | niche knowledge directory with delivered-vs-promised records |
| Grow | repeats the loop, uses free templates | daily routine, blueprint templates, relationship records |

## 2. Principles

1. **Confirmed, not claimed.** The home feed shows only offers that pass the confirmed-offer rule. Backroom work stays off the feed.
2. **Transparent control.** Users decide which notifications and daily checks they see. Every prompt can be switched off, and the reason for it is shown.
3. **Evidence over claims.** Mentor and seminar pages show what was promised, what was delivered, the price and reviews from people who attended.
4. **Respect the licence lines.** No deposit-taking, no lending. Credit is revisited only with a licensed partner.
5. **Free stays free.** Blueprint templates stay free. No feature is paywalled for now (free-for-now directive).

## 3. Definitions

### Verified business
A business that has passed membership verification (`verification_status = verified`). Already in the codebase.

### Confirmed offer (the rule for the home feed)
An offer (product or service with a stated price and unit) appears on the **primary shelf** only when all are true:
- the seller is a verified business;
- the offer has at least **1 completed transaction** with a **different** business (order, booking, or group order);
- the price and unit are shown;
- the seller has no open dispute or fraud flag.

Until enough transactions exist, the owner may confirm an offer by hand after checking it. Every hand confirmation is recorded with who did it and why.

Offers that are not yet confirmed can still be seen in the seller's profile, marked "not yet confirmed".

### Relationship (what we count)
A completed link between two businesses: a transaction, a booking, a group order, a collaboration, or a mentor session. Repeat links count as stronger. This is the network metric.

### Seminar and mentor record (knowledge directory)
Each listing has:
- niche (one of the sectors in §5);
- promised outcomes (written by the organiser before the event);
- delivered outcomes (written after the event, by the organiser, marked with the date);
- price, and what is included;
- reviews, only from people who registered and checked in;
- organiser verification status.

## 4. Build phases

### Phase 1 — Verified offer shelf (first)
- Offer model: seller, title, price, unit, category, status (draft / listed / confirmed).
- Confirmed-offer rule implemented as a query, not a manual flag, with the manual override recorded.
- Primary shelf in the home feed reads confirmed offers only.
- Seller profile shows all their offers with the status shown.
- Acceptance: a fresh account cannot appear on the primary shelf until a second business has transacted with it, or an owner has confirmed it by hand.

Existing pieces to reuse: markets and listings, `homeShelves.js` (shelves are configured there), membership verification.

### Phase 2 — Relationship record and the loop
- Record each completed link between two businesses (order, booking, group order).
- "Businesses you have worked with" and "trusted by" lines on profiles.
- Discover page: find a supplier in a sector, filter by confirmed offers and relationships.

### Phase 3 — Chama bulk buying (on top of Phase 1 and 2)
- Group orders already exist in logistics; extend them so a group of verified businesses pools demand for one confirmed offer.
- Only confirmed offers can be pooled. Only verified businesses can join.
- Group ledger records contributions. No holding or moving of member money.

### Phase 4 — Niche knowledge directory
- Seminars and mentors with the record in §3.
- Sector pages (§5). Buyers can filter by niche, price and reviews from attendees.
- Mentor consultations use the existing calendar booking page.

### Phase 5 — Daily routine
- A "Today" window and notification dots for the daily checks.
- Each dot is explained on tap. The user can turn each one off.
- Blueprint templates (free) link to the routine steps.

### Later — Group credit
Not in scope. Revisit with a licensed partner after Phases 1–4 are working. The regulator licenses digital lenders and bars deposit-taking for them; any group credit would need a licensed structure first.

## 5. Sectors for the knowledge directory (first list)
Agriculture · Retail · Manufacturing · Hospitality · Beauty and personal care · Technology · Construction · Transport and logistics · Health services · Education and training · Finance and bookkeeping · Professional services. The list can grow; each listing must pick one sector.

## 6. Existing code to reuse
- Calendar and booking (merged, PR #72): mentor consultations.
- Logistics group orders: chama buying in Phase 3.
- Events and event registrations: seminar records in Phase 4.
- Membership and directory: verified business status.
- Markets: listings base for offers.

## 7. Open decisions
- Who may confirm an offer by hand during the early phase (owner only, or a named reviewer)?
- The number of completed transactions required (proposed: 1 different business).
- Whether seminar reviews are shown before or after the organiser's delivered-outcomes note is published.
