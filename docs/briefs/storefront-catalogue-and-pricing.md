# Storefront catalogue & pricing architecture (v2.14)

> **Decision:** don't invent demand, and don't build a second storefront.
> Package existing spending into offers inside Brief_ — data in
> `backend/app/modules/catalog/catalog.py`, public at `/storefront`
> (`GET /api/catalog`), purchases start as enquiries
> (`POST /api/catalog/enquiries`) that a human invoices and delivers.
> Prices are **[Test]** ranges to validate, readiness is stated per
> offer, and nothing is sold that is not operational, a supervised
> pilot, a people-delivered service, or a written quotation.

---

## 1. The catalogue: three lines, twelve offers

| Line | Offer | Test price | How it can truthfully be sold today |
|---|---|---|---|
| A. Digital services | Logo & brand starter | KSh 2,500–8,000 once | Productised studio service (sold on the Business Desk) |
| A | Business website | KSh 15,000–45,000 once | Productised service, fixed pages/revisions/milestones |
| A | Mobile app UI/UX prototype | KSh 8,000–30,000 once | Prototype only — never described as a production app |
| A | Business automation setup | KSh 5,000–25,000 once | Scoped per workflow after a short audit |
| B. Business software | Customer & sales records | KSh 1,500–4,000/mo | **Operational**: stock, orders, counterparties, analytics |
| B | Membership management | KSh 5,000–15,000/mo | **Pilot**: enterprise workspace register & field tracking (v2.13), manual contract |
| B | Private business workspace | KSh 5,000–20,000/mo | **Pilot**: seats/workspaces operational, caps server-side; larger rollouts use the workspace ladder (Association KSh 24,500/mo) |
| B | Custom enterprise deployment | Scoped quotation | No published price, no deposit before a written scope |
| C. Field operations | Mobile form & reporting setup | KSh 7,500–20,000 once | Field registration/reporting built; bespoke forms are implementation |
| C | Agent workflow management | KSh 3,000–10,000/mo | **Pilot**, BYOD-first (work profile on officers' own phones) |
| C | Android device enrolment & configuration | Scoped setup fee | Via the organisation's Android Enterprise/EMM; mode-dependent |
| C | Device procurement & ongoing support | Quoted separately | Per-device written quote; hardware never bundled into software |

Every offer in the API carries deliverables, exclusions, what the
customer must provide, revisions and turnaround — fixed **before**
payment is accepted. Hardware, data bundles, travel, third-party
licences and specialised integrations are always separate line items.

**BYOD before hardware.** A buyer may already have 15 field officers
with their own phones. Sell the BYOD deployment (work apps in a work
profile, role-based access, registration forms, supervisor dashboard)
and offer fully managed company-owned devices as a separate tier.
Android Enterprise capabilities depend on enrolment mode: a work-profile
phone can lose its *company data* only — never promise unrestricted
control, or a full wipe, over a personally owned device.

## 2. Pricing architecture: Junior → Enterprise

| Tier | Test price | Public label | Maps to (operational) | Purpose |
|---|---|---|---|---|
| Junior | KSh 0 | **Junior — Free account** | `starter` | Marketplace supply: one profile, limited listings, basic visibility |
| Professional | KSh 500–1,500/mo | Professional account | `readiness` | Discovery monetisation: listings, portfolios, enquiry/lead tracking, basic stats |
| Business | KSh 3,000–10,000/mo | Business account | `network` | Private workspace, multiple users, customer/job records, reporting |
| Enterprise | Custom | Enterprise account | `institution` + workspace | Organisation accounts, field agents, integrations, managed-device options, SLA by contract |

Rules enforced in product copy (and on the vendor profile):

- A free account is an acquisition channel, not a failure — it becomes
  a problem only when support cost exceeds its contribution. Junior
  excludes analytics, teams and private workspaces so it stays cheap.
- The Junior label describes the **subscription tier only**. It must not
  imply the person is unqualified or untrustworthy. Verification is a
  separate, evidence-based Passport state, shown separately
  (`account_tier` beside `is_verified` in the API and profile UI) and
  **never sold**.
- These are proposed prices, not commitments: calculate hosting,
  support, payment fees, staff time and delivery cost per plan before
  publishing a final price list.

**Trial.** Business tier, 30 days. Card-required *only where the
payment provider supports the flow for this merchant account* — verify
eligibility, settlement, currencies, fees and exact subscription
behaviour (e.g. against the provider's current subscription/payment-link
documentation) before promising it. Always: exact first-charge date and
amount shown before confirmation (the API computes an example: Business
test price KSh 6,500, +30 days), a reminder ≥3 days before, easy
cancellation that stops charges, provider-hosted checkout/tokenisation
only (card details are never collected here), and an M-Pesa alternative
(manual renewal or a supported recurring arrangement). Status in the
product today: **`not_yet_live`** — the trial button records a request
with the acknowledged disclosure; it takes no card and makes no charge.
Test card-required against a shorter capped no-card trial; do not
assume card-required is superior.

## 3. Sell tomorrow (no new build required)

1. **One landing page, three offers** — `/storefront` leads with the
   website package, membership management and agent workflow management.
2. **Real productised listings** — fixed pages/revisions/milestones for
   services; screenshots only of work owned or authorised for display.
3. **Payments & invoicing** — if the merchant account is ready, use its
   supported method; otherwise legitimate business invoices on an
   existing verified channel (M-Pesa/bank). Don't delay selling to
   automate checkout. Enquiries land as `catalog_enquiries` rows a human
   works: new → contacted → quoted → won/lost.
4. **Contact qualified buyers directly** — distributors, service
   companies, agencies, organisations with field teams; a short
   discovery call or a paid implementation package.
5. **Deliver manually where necessary** — fulfil with the current
   software and team; record repeated tasks to decide what to automate.

First target: a small number of paying customers whose contracts can be
fulfilled profitably — not thousands of free registrations.

## 4. Financial reality & the 48-hour cash review

Illustration only: at KSh 300,000/month of operating costs and an
average recurring contract of KSh 10,000/month, **30 active contracts**
cover that amount — before payment fees, delivery costs and taxes.
One-off setup work, prepaid implementation contracts and collectable
receivables matter more immediately than new subscriptions alone. Never
take deposits for work that cannot be delivered, and avoid steep annual
discounts bought with tomorrow's delivery capacity.

48-hour cash review (fill in before setting the launch price push):
cash available now · receivables realistically collectable · payroll,
hosting, rent and unavoidable obligations · contracts deliverable
immediately · minimum cash to keep operating. That answer decides
whether services, implementations or renewals lead.

## 5. Protect the company as it scales

- **Data protection.** Member identities, employment/contact details
  and location data may trigger mandatory ODPC registration for data
  controllers/processors regardless of size — determine the specific
  obligations before handling a customer's records.
- **Delivery & security answers must reflect the actual system:**
  who can access records (workspace roles), how accounts are disabled
  (membership/seat revocation), backups, the lost-device procedure
  (command audit + EMM), and data export at contract termination.
  Anything not true today is a contract risk, not a sales line.

## 6. 30-day plan

| Days | Focus |
|---|---|
| 1–2 | Storefront selling: three scoped offers live, a real payment/invoicing path, contact existing customers and warm leads |
| 3–7 | Prove payment: paid pilots and deposits tied to defined deliverables; track outreach, conversion, cash collected, delivery cost |
| 8–14 | Standardise delivery: repeatable packages, templates, onboarding checklists, monthly support plans |
| 15–30 | Build only what customers validate: the recurring workflow buyers use and pay for; expand self-service from purchasing behaviour |

The moat is not the storefront's looks: it is repeatable delivery,
business workflows, reliable integrations, customer trust and recurring
revenue behind it.
