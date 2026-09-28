# Brief — Economic coordination for Kenyan women, workers and micro-enterprises

**Brief is a distribution-and-economic infrastructure layer for organizations that already have trusted groups of women, workers, traders, suppliers and entrepreneurs — not a bank, and not another consumer app.**

A member requests something they source, a supplier quotes it, the two agree on
terms and run the work to completion, the completion is remembered so the same
sourcing is one tap next time, both parties build a **derived, explainable**
track record, and payment is collected and settled through real rails — with
every figure derived from real rows, never stored as a second source of truth.

---

## What Brief is, and what it is not

**The positioning.** Brief does not try to become a bigger consumer app. It is
a *distribution and economic-coordination layer* for organizations that already
hold a trusted group — women-focused banks, SACCOs, table-banking groups, coops, employers,
NGOs, KNCCI-type networks, corporate supplier-diversity programs. They bring
the cohort; Brief supplies the shop, the records, the verification and the
money rails; the ledger proves what the cohort actually did.

**Not a bank, not a lender.** Brief does not hold user funds, does not lend,
does not score credit, does not insure, and does not touch crypto. "Brief is
not a bank" is a hard constraint, not a slogan.

**Honesty is the product.** Every number the UI shows — earnings, commission,
withdrawable, trust history, partner revenue share — is **derived** by scanning
real rows. A stored total is a second source of truth waiting to disagree with
the first. When something is unavailable, Brief says so instead of fabricating
success: an unconfigured payment rail returns `503` with a reason, not a fake
"paid".

---

## The product surface

Production enters through `preview/src/main.jsx` → `preview/src/app/AppShell.tsx`.
The bar is **five doors and one action**, in the order the loop actually runs:

| Door | Hash | What it is |
|---|---|---|
| **Home** | `#home` | The atrium (`SellerHome`): what needs attention, your own numbers, a shelf of doors that exist, then what is moving on the board. |
| **Market** | `#market` | The board. The mixed feed is its face; the taxonomy (bulk · direct · niche · groups · events · errands · shops · circles) sits behind one entry that opens the picker. |
| **Trade** | `#trade` | The work loop as six deep-linkable sections: `demand · open · quotes · work · procurement · supply` (`#trade/<section>[/<id>]`). |
| **Shop** | `#duka` | Your business: spaces, offers, orders, team, ledger, catalogue, pipeline, tools, operating (`#duka/<section>`). |
| **You** | `#you` | Identity, standing, connections, money, settings, help (`#you/<section>`). |
| **Create (+)** | `#create` | Eight verbs, "I need something done" first. Not a destination. |

Legacy addresses keep working and light the door that now owns them:
`#city` → Market, `#requests`/`#supply` → Trade,
`#mine`/`#spaces`/`#selling`/`#orders`/`#ledger`/`#catalog`/`#pipeline` → Shop.
Nothing 404s because the map changed.

What the bar refuses to hold, the **directory** (`#menu`) does: Pulse, Partners,
Workforce, Elevate, group-buy, table banking, the shop sections, notices, following,
saved, subscriptions, language, privacy, and the gated admin / moderation rows — each
with a unit number, grouped by floor. The shape and the reason for it are in
`docs/MALL-RESTRUCTURE-REPORT.md`; the routing itself is
`preview/src/app/Navigation.tsx` (doors), `surfaces.ts` (aliases) and
`NavSheet.tsx` (directory). If those three and this table ever disagree, the code is
right and this table is a bug.

---

## The core economic loop

One chain, all derived, all honest:

1. **Request** — a member posts structured demand (`domain/requests.js`): quantity, unit, category, budget, deadline, specs.
2. **Match** — demand is matched to participant capabilities, every match explaining itself in words (`domain/matching.js`).
3. **Quote** — the participant proposes integer-minor-unit terms; totals are BigInt-exact (`domain/quotes.js`, `quoteValidation.js`).
4. **Work order** — accepting a quote freezes an agreement and runs a two-party fulfillment state machine (`domain/workOrders.js`).
5. **Repeat procurement** — completing a work order records a repeatable pattern, so "request again" is one tap (`domain/procurement.js`).
6. **Trust** — economic history is derived per participant/capability with explainable signals, never a secret score (`domain/participantTrust.js`).
7. **Payment** — collection through KCB Buni STK push when configured; payouts remain manual and finance-confirmed. Automated Buni disbursement is blocked pending a verified transfer contract (`domain/workPayment.js`, `connectors/buni.js`).

The **supply layer** (`domain/supply.js`, `supplyVerification.js`) models
enterprises and their capabilities (production / stock / service / logistics /
sourcing access), with scoped verification records (identity, business type,
sourcing role, capability, capacity, authorization) — never an aggregate
"fully verified" badge.

---

## The distribution layer (attribution + partners)

The strategic core of the product. Two first-class domains:

**Attribution** (`domain/attribution.js`) — the provenance chain. When a member
arrives, Brief captures *once* (first-touch-wins) how they got here:

```
partner=WEF → program=women-enterprise-2026 → cohort=nairobi-west
  → invite=ABC123 → member=USER456 → work order → KES 12,500
```

Economic activity per member and per partner/cohort is **derived** from real
rows (fulfilled orders, completed work, repeat patterns) — never stored. A
partner with no members shows zero, plainly.

**Partner** (`domain/partner.js`) — first-class distribution partners. A
partner is a *stored, contracted* record (organisation → programs → cohorts)
keyed against the attribution keys. Its revenue share is a **derived
obligation** (`floor(shareRate × verifiedCommercialKes)`) that becomes money
only through a settlement that finance confirms, writing a real ledger
transaction (`partner_revenue_share`). The transparent ledger reads:

```
Partner generated KES 482,300 → Partner share KES 48,230 → Brief KES 38,584 → costs KES 9,646
```

These are operator-created records, not member claims; revenue share is a
derived number, never fabricated money.

---

## One economic layer

`ledgerTransactions` is the single source of economic truth. There is no
wallet, no balance column and no per-feature economy. Money is
server-authoritative: a client posting `{price: 1}` against a KES 2,500 listing
gets an order for 2,500. Settlement is refused unless a genuinely settled
ledger transaction backs it.

- **Collection:** KCB Buni STK push (`server/src/connectors/buni.js`) — fails closed when unconfigured. Configuration alone does not verify a working payment.
- **Disbursement:** manual + finance-confirmed. Buni automated transfers are deliberately refused; adding credentials does not implement payouts. Keep `SETTLEMENT_RAIL=manual`. The separate Daraja connector serves Huduma, not the core commerce payout rail.
- **Referrals** (`domain/referrals.js`): depth hard-capped at **one level**, no entry fee anywhere, points convert to cash only from a pool backed by a fixed fraction of confirmed service-fee revenue.

---

## Repository layout

```
preview/src/main.jsx    Production entry: AppShell, or PublicCampaignPage at /c/:slug.
preview/src/App.tsx     Legacy feature-test harness, not the production shell.
preview/src/app/        Production shell and navigation.
preview/src/features/   Modular product surfaces.
preview/src/api/        Typed client API and transport.
preview/src/model/      Client types and derivations.
server/src/connectors/  External-provider adapters.
server/src/domain/      Business rules and workflows.
server/src/routes/      Express HTTP routes.
server/src/store.js     File-backed JSON store and additive migrations.
server/test/            Server test suites.
preview/                Vite build and jsdom client suites.
tc/                     Typecheck config reading preview/src directly.
```

`preview/src/` is the single canonical client source tree — built by Vite and
read directly by the typechecker (`tc/tsconfig.json` includes
`../preview/src`). The legacy `App.tsx` shell remains only as the test harness
for the older feature suites (Circles, Marketplace, events, tickets, …); the
production entry (`preview/src/main.jsx`) renders `AppShell` and never imports
it.

---

## Running it

Use Node 22 LTS for the commands below (the `--env-file` option requires
Node 20.6+), and npm 9+. Run commands from the repository root.

### Install and start locally

```bash
npm ci                                  # all workspaces, from the root lockfile
cp server/.env.example server/.env.local # optional connectors; keep secrets local
node --env-file=server/.env.local server/src/index.js
```

In a second terminal:

```bash
npm run dev                             # Vite on :5173, API proxy to :8787
```

The server binds `0.0.0.0:8787` by default. Keep `PORT=8787` in the local
server env file to match Vite's `/ingest/*` proxy. Browser code uses that
relative proxy path, not a localhost backend URL.

**Environment files are not loaded by `npm start` automatically.** Use the
explicit `node --env-file=...` command above, or export variables before
starting. Node 18 users must export variables instead of using `--env-file`.
The root `.env.example` is a **deployment** template: its `/data` path needs
a mounted volume and is not the default local setup.

### Run the production build locally

```bash
npm run build:client
NODE_ENV=production node --env-file=server/.env.local server/src/index.js
```

Stop the dev backend first if it is using the same port. With variables already
exported (as on Railway), `npm start` is the equivalent production command.

No external credentials are needed for local domains. Unconfigured connectors
fail closed; they do not manufacture a delivery or payment. For optional Buni
collection, configure `BUNI_CONSUMER_KEY`, `BUNI_CONSUMER_SECRET`,
`BUNI_WEBHOOK_SECRET`, `BUNI_ENV=uat`, and a real HTTPS `BRIEF_PUBLIC_ORIGIN`.
Use KCB-issued organization/passkey/till values where applicable. Before
production, obtain KCB's confirmed host and account enablement. See
[deployment setup](DEPLOYMENT.md) and the detailed
[payment integration record](docs/PAYMENTS-INTEGRATION.md).

**Automated payouts are a separate blocked workstream.** Do not set
`BUNI_ALLOW_UNVERIFIED_TRANSFERS` or switch the settlement rail to an adapter
that does not exist.

---

## Tests

Run from the repo root after `npm ci`:

```bash
npm run build:client       # Vite production build (preview/src is the source)
./run-suites.sh            # client suites (jsdom)
cd server && npm test      # server suite (run.js + per-domain files)
npx tsc -p tc/tsconfig.json  # strict typecheck (expects exit 0)
```

**Historical baseline — measured 2026-09-10 (not the current release status):**

| Suite | Result |
|---|---|
| Server (`cd server && npm test`, 21 suites) | **2892 passed / 0 failed / 1 skipped** |
| Client (`./run-suites.sh`) | **1861 passed / 0 failed** |
| Strict typecheck (`tc`) | exit 0 |

The server suite skips (rather than passes) network-dependent assertions when
the network is unavailable, so a green run always means something real
happened.

---

## Deployment

`railway.json` builds the client with `npm run build:client` and starts
`NODE_ENV=production node server/src/index.js`, serving the compiled frontend
from `preview/dist`. The server binds `0.0.0.0:$PORT` (default 8787) and
exposes `/api/health` and `/api/ready`.

Environment variables: server secrets must **never** carry the `VITE_` prefix —
that prefix is what exposes a value to the browser. See `.env.example` and
`server/.env.example`.

---

## Deliberately out of scope

No star ratings, no review walls, no credit scoring, no lending, no BNPL, no
insurance, no crypto, no opaque AI scoring, no M-Pesa onboarding that pretends
a payment happened. Keep Brief "not a bank".

---

## Further reading

- `docs/ACTIVE-BACKLOG.md` — current implementation order, acceptance criteria and decision/integration gates. Older audit reports are historical, not the active backlog.

- `PUBLIC-FEED-API.md` — the anonymous, read-only feed contract (`GET /api/public/feed`).
- `ONBOARDING.md` — the service ladder (progress derived from real rows, never a stored counter).
- `docs/WORKFORCE.md` — organisations run field teams and home workers from phones: onboarding checklist, territories, task templates, proof and review, flat fees paid only for approved outcomes. Lists the open decisions (provisional 20% fee, pay for honest non-conversion).
- `server/CONNECTORS.md` — what each connector can and cannot do, and why.

### Administration and registered users

The live app exposes **All sections → Admin · Members** for platform admins.
Search registrations, paginate the directory, and open each member's Account,
Business profiles and Worker profile. Direct entry: `/#admin/members`.
For first-admin provisioning (`BRIEF_ADMINS`), permission boundaries and tests,
see [Admin members guide](docs/ADMIN-MEMBERS.md). No account is auto-promoted.

## Production entry and safety checks

The shipped browser entry is `preview/src/main.jsx` → `preview/src/app/AppShell.tsx`.
`preview/src/App.tsx` is a legacy **test harness**, not the shipped application.
Standalone public `/collections/:id`, `/groups`, `/track` and `/reviews` routes
are selected in `main.jsx`; do not infer production coverage from a harness-only
component. Use `bash run-suites.sh compacthome doorways spaceloop activityreel
offlineisolation dialogfocus collectionroute` plus the server `productionSafety`
suite for the production-critical journeys; browser/device manual checks remain
necessary.

Mailbox sign-in is disabled unless an HTTPS public origin and a verified Resend
sender are configured. Member-minted login links are gone. Restores prepare
the on-disk primary before any live store loads; a corrupt primary without a
valid backup fails startup. Production refuses development authentication and
requires an explicit durable data directory. See [DEPLOYMENT.md](DEPLOYMENT.md)
for the first-boot gate, recovery drill, and incident response.

### CloudBites local-food concept

`/cloudbites` is a public, mobile-first demonstration of **CloudBites, a food concept on Brief**. Brief is the wider local work and commerce network; CloudBites shows how it could connect people with nearby hotels, restaurants and food inventory at the place and time they need it. Its suggested framing is “Food from where you’re going”: destination-led discovery, local pickup and preorders, date- or day-based offers, table requests, team meals and visitors finding businesses before arrival. Pickup is the default; workplace fulfillment could be an optional future path where locally available, not a promised citywide home-delivery fleet. Businesses would control their menus, prices, pickup terms and offers, with no exclusivity or requirement to leave Uber, Bolt, direct sales or other channels. “Free to join and list” describes an intended no-upfront-fee entry point, not a promise that all future services are free forever. Fees on completed business, promoted offers or paid workplace tools are possible strategic models, not implemented terms.

This page is a **concept preview only**. It uses optimized local sample photography, an illustrative menu and prices, filters, a temporary in-browser lunch list, sample Nairobi area names and a QR code to this web page. Selecting an area does not confirm coverage or availability. There are no live CloudBites merchants, menus, inventory, offers, orders, pickup slots, bookings, payments, workplace plans, delivery services, app listings, partnerships, or completed transactions. The lunch list is not transmitted and cannot check out. Sample dishes and ingredients are not verified allergen information. Any future launch would need real merchant participation, clear pricing and transaction terms, verified availability, published policies, and tested fulfillment and payment flows before those capabilities are advertised.
