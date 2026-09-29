# Active backlog

Updated: 2026-09-25. Order approved by the repository owner in this session.
This is the implementation queue; historical audits and builder-prompt records
are evidence, not an instruction to implement every old proposal.

## Current priority — purpose-workspace completeness

The latest owner direction supersedes the moderation-first sequence below:
build actual table-banking, group-buy and event workspaces, their lifecycles,
entry paths and separate permission domains before expanding test counts or
visual polish. Public discovery and private productless shop shells remain
part of this product milestone.

A functional preview implementation now connects these workflows to native
engines and scoped shop-team operations. `/groups` is a standalone anonymous
entry. The eager-import bundle warning was resolved with destination splitting,
not a raised threshold. See [GROUP-WORKSPACES.md](GROUP-WORKSPACES.md) for exact
boundaries, lifecycles, walkthrough evidence and deferred validation.

Next: a deliberate permission/privacy/API/state-transition/adversarial pass.
Most deep integration/security validation remains outstanding; ordinary green
regressions are not a claim of architecture completeness or production readiness.
Phone-first/documents stay gated; payout automation stays separate. No merge,
deployment, live payments or production migration is authorized.

## Earlier ordered implementation queue (status retained)

| Order | Item | Status | Pre-implementation gate |
|---|---|---|---|
| 1 | Date-independent weather test | Done locally, verified | None |
| 2 | Current setup and deployment documentation | Done locally, verified | None for documentation; live enablement remains external |
| 3 | Public-space report moderation | Implemented locally; lifecycle tests pass; not merged | Appeals and guardian reward policy remain separate |
| 4 | Phone-first accounts | Queued, decision + integration gated | OTP channel/provider, migration/linking and recovery policy |
| 5 | Document verification | Queued, decision + infrastructure gated | Capture-policy clarification, private storage/key management, retention and review operations |

“Done locally” does not mean deployed. No provider credentials, live charge,
account migration, moderation action or identity-document collection was used
or authorized by this backlog update.

## 1. Weather test — completed

Evidence: `server/test/worldSignal.mjs` used a September 17–23 fixture while
its HTTP request reached a route using the real `Date.now()`. On September 24
all those days were past, so the production freshness filter correctly
returned no facts and the test failed.

Implemented:
- Pin `Date.now()` to the fixture clock only during the serial HTTP test.
- Exercise the same endpoint seven days later and require an empty facts list.
- Restore the clock and fetch implementation, clear the cache and await server
  shutdown in `finally`.
- Leave production weather logic and its refusal to show past forecasts intact.

Acceptance: the focused suite passes, the expired-date case passes, and the
entire `npm test` chain reaches its final integration suite successfully.
All three verified on 2026-09-24.

## 2. Setup docs — completed

Updated `README.md`, `DEPLOYMENT.md`, `.env.example` and
`server/.env.example` to name KCB Buni collection and manual settlement.
Removed obsolete Tuma configuration from these current setup entry points.
Documented explicit environment loading, the local proxy port, the production
start command, persistent volumes, and the current client entry/navigation.
Expanded `.gitignore` to protect local environment files while retaining both
example templates. Historical test numbers in README are labelled historical.

Acceptance: documented variable names match the connector, templates parse,
local startup instructions distinguish local and deployment environments, and
no setup instruction implies credentials enable automated payouts.

External release checks remain separate: confirm the mounted volume, live URL,
KCB account enablement and callback behavior in the actual deployment. A local
suite pass cannot confirm any of those.

## 3. Public-space report moderation — implemented locally

Scope authorized on 2026-09-25: upheld reports hide/unpublish only the public
page; dismissed reports leave it unchanged; authorized reinstatement explicitly
republishes an active page. No account suspension, selling disablement, order
cancellation, guardian/reward decision or appeal behavior is inferred.

Implemented in dedicated moderation domain/route/UI modules. Existing
`moderate` capability is required (reviewers/admins); self-review is blocked as
the conservative default communicated before implementation. Every successful
review/reinstatement requires a real reason and atomically persists reviewer,
action, reason, timestamps and before/after audit records. Idempotency keys and
hold revisions prevent retries/stale actions from repeating or reversing newer
state. Owners cannot bypass the hold using normal publication controls.

Important dependency resolved without deciding reward policy: guardian status
used to count only reports with no `handledAt`. Newly reviewed reports preserve
their existing guardian-count contribution explicitly, so filling `handledAt`
does not silently release a flag/freeze. Dismissal and reinstatement do not clear
this effect; how outcomes should affect rewards remains a separate policy gate.

Validation: the focused server suite exercises both complete lifecycles
(`pending → upheld → hidden → reinstated` and `pending → dismissed`), forbidden
roles/self-review, reasons, duplicates/repeated actions, concurrency, continued
selling, guardian invariance, atomic rollback and restart persistence. Dedicated
client tests cover the reviewer and owner surfaces. Full server regression,
client regression, typecheck and production build have passed locally.

See [SPACE-MODERATION.md](SPACE-MODERATION.md) for the API, authorization default,
review boundaries and focused test commands. Not deployed, merged or applied to
real reports. The purpose-workspace milestone above now takes priority; phone-first
accounts remains blocked below.

## 4. Phone-first accounts — queued

Confirmed gap: `server/src/domain/auth.js` and `routes/auth.js` do not implement
phone identity or OTP login. The existing decision that the phone is the account
and email is optional is already recorded in `docs/DECISIONS.md`; do not reopen it.

**Decisions/integrations required before implementation:**
- Choose proof-of-possession channel and provider (SMS, WhatsApp or an approved
  fallback), supported number regions, resend limits and expiry. Existing
  outbound messaging is not a complete authentication/OTP service.
- Approve how existing handle/email accounts link a verified phone, resolve
  duplicate claims, and migrate without losing ownership or session access.
- Approve lost-number recovery, number changes and recycled-number safeguards.
- Provision the provider through deployment secrets and verify sender/template
  enablement outside chat. No live send is implied by this backlog.

Acceptance: extend the existing auth/session system; normalize and uniquely
bind verified phone identities; enforce rate limits and OTP single-use/expiry;
avoid account enumeration; test migration, collisions, recovery and ownership
preservation. Never make an unverified contact phone an account credential.

## 5. Document verification — queued

Confirmed gap: `server/src/domain/verification.js` stores review provenance,
not identity documents. `docs/DECISIONS.md` already specifies encryption at
rest, front-only ID capture, JPG/PNG and document-only PDF support, a 10 MB cap,
and deletion 90 days after completed verification.

**Clarifications/infrastructure required before implementation:**
- Resolve the capture-rule ambiguity: PDFs are allowed for documents, but
  missing camera metadata is rejected. Define the PDF validation path and the
  policy for genuine camera uploads whose metadata was stripped. Metadata
  alone is not proof of authenticity.
- Confirm verification scope (person vs shop), reviewer access, and the review
  method (manual or a separately approved identity provider).
- Approve private encrypted storage, key ownership/rotation, access logging,
  backup deletion and a reliable scheduled purge. Do not use public media
  uploads or assume the existing Huduma credential key is suitable.
- Define retention for abandoned, pending, rejected and appealed submissions,
  the exact completion event starting the 90-day clock, and any legal-hold
  exception. Reconcile older reports quoting an 8 MB limit with the canonical
  10 MB decision before changing upload limits.

Acceptance: purpose-scoped authenticated access; encrypted private files;
validated type/size and the agreed capture policy; reviewer audit trail;
retry-safe deletion of primary files and the agreed backup/key lifecycle;
expiry tests; no document content in logs, public URLs or source control.
Do not collect real identity documents until these gates are closed.

## Separate blocked workstream — automated payouts

**Not in the implementation queue.** Unblock only when the verified KCB
transfer contract is available: confirmed production endpoint, request/response
schema, account entitlement, transaction-status/callback semantics,
idempotency/reconciliation rules and fee schedule or an explicit treatment of
unknown fees. Plan an approved sandbox/provider exercise before live money-out.

Current behavior is intentional: `connectors/buni.js:disburse()` refuses,
`SETTLEMENT_RAIL=manual`, and a person moves money with finance confirmation.
Do not guess the payload, enable the unverified-transfer switch, replace manual
settlement, or present “configured” as “working.” Contract receipt enables a
separate implementation review, not an automatic live transfer.

## Three-pillar commerce architecture — recorded, previewed locally

Owner direction, 2026-09-29: the three feature pillars become the **primary
architecture** of Brief's commerce side, and every screen is fitted to a phone
first.

- Record: `docs/THREE-PILLAR-PRIMARY-ARCHITECTURE.md` — the three pillars
  (Supply, Shop, Gather), the reuse/extend/build split against the domains that
  already exist, the additive data model, the API surface, the USSD menu tree,
  the money path, the verification ladder, the comparison layer, twenty edge
  cases, the implementation order and the mobile fit contract.
- Preview: `/pillars` (`preview/src/features/pillars/`) — eighteen interactive
  mobile-fitted screens with the spec for each beside the device, a working USSD
  session, and disabled actions that state why they are disabled.
- Client suite `preview/pillarspage.jsx` (32 checks) is registered in
  `run-suites.sh`; `server/test/productionSafety.mjs` asserts the concept route
  serves with an honest title.

Status: local, unmerged. No vendor onboarding, border crossing, pool fill, stall
sale, payout or payment was performed. Automated payouts, live rails, credit
scoring and cross-border customs filing remain gated exactly as before.

## Secondary confirmed gaps — not ahead of the ordered queue

- Rider/service-provider profiles: scope and sponsorship/availability semantics
  need product approval before building on the existing carrier authorization.
- Twilio delivery callbacks and outbound email: provider/integration gated;
  inbound WhatsApp ingestion and outbound WhatsApp already exist and are not
  missing wholesale.
- Additional languages: choose languages, translation ownership and maintenance
  before introducing an i18n selector.
- Main-bundle size: technical optimization; no external integration required.
- Deployment durability/live collection readiness: operational verification,
  not established by source inspection.

## Earlier weather/docs verification record — 2026-09-24

- `node server/test/worldSignal.mjs`: 11 passed.
- `npm test`: exit 0, including suites previously blocked by the weather failure.
- `npm run test:typecheck`: exit 0.
- Client code unchanged. Prior audit: 2,297 client checks passed and production
  build passed with a large-chunk warning; those results are not new runs here.
