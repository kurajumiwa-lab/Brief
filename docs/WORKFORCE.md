# Workforce — a distributed team run from phones

Organisations run field teams, agents and home-based workers inside Brief
without needing an office. People onboard on their phones, get placed in
territories, take tasks, submit proof, and are paid a stated flat fee for
approved work. Everything a manager sees (the roster, coverage, funnel and
money) is derived from rows. Nothing is stored as a balance or a score.

> **Intent → Task → Proof → Outcome → Money**

| Primitive (from the design brief) | Where it lives |
|---|---|
| Work Request | `workPrograms`: the outcome being bought, e.g. "sign up 50 shops in Westlands at KES 300 each" |
| Task Template | `server/src/domain/workTemplates.js`, a closed set in code (see below) |
| Worker Capability | `workerProfiles` (modes, device, areas) + briefings + the track record, derived as counts |
| Task Assignment | `workTasks`: one step of one unit, held by one worker |
| Work Proof | `workProofs`: answers, private photos, location, consent, automatic checks |
| Work Settlement | `workforceSettlements` + `ledgerTransactions` (`work_task_fee`), confirmed by finance |

The feature is in the drawer under **Your work → Workforce** (`#workforce`). It
has two views of the same rows: **My work** (the worker) and **Organisation**
(owner and supervisors, `#workforce/org`). One person can hold both roles.

---

## 1. The model

```
workforces ──< workforceMembers >── users ── workerProfiles (one per person)
     │                │
     ├──< workforceTerritories (centre + radius, named areas)
     │
     └──< workPrograms (template, target, price, deadline, territories, rate card frozen)
              └──< workUnits (one merchant / supplier / interview)
                       └──< workTasks (one per template step, in order)
                                └──< workProofs (one per attempt)
workforceSettlements ── ledgerTransactions (kind: work_task_fee)
```

All nine collections are additive in `store.js` `EMPTY`. The name
`workforceSettlements` is deliberate: Work Orders already owns
`workSettlements`.

## 2. Onboarding (HR, without an office)

1. **The owner creates a workforce** and gets an 8-character join code.
   Ambiguous characters (0/O, 1/I/L) are excluded, and the code can be rotated.
2. **The worker joins by code** and becomes a member with status `applied`.
   Joining your own workforce is refused (`self_join`).
3. **The worker completes a checklist** on their phone. It is derived, not stored:
   - profile (name, valid Kenyan mobile, how they work, GPS-capable phone)
   - independent-work terms accepted, **current version** (`work-terms-2026-09`)
   - at least one task briefing read
   - placed in a territory (field workers only; home-only workers skip this)
   - activated by a person
4. **A manager activates them.** This is a human decision: activation is
   refused with `onboarding_incomplete` and the list of `missing` items until
   the checklist is done. A manager can tick territories and activate in one
   step. Placement and activation are written together, so a refused
   activation leaves nothing half-applied.

HR actions: `assign_territories`, `set_role` (owner only), `set_supervisor`,
`activate`, `suspend`, `reinstate` and `offboard`.
- Suspend and offboard need a reason the person can read, and release the
  tasks they hold back to the pool.
- Nobody can act on their own membership (`self_action`).
- Only the owner can manage a supervisor.
- Every action is appended to the member's history and audited
  (`workforce_*`).

Roles are depth-one: owner → supervisors → workers. There is no upline and no
override on anyone else's earnings.

## 3. Territories

A territory is a name, a list of areas, and optionally a centre and radius in km.
- **Placement**: field work is offered only in territories the worker is placed in.
- **Quotas**: a program can cap approved units per territory.
- **Checks**: a field proof's GPS is compared with the centre and radius.
  If a territory has no centre, the check says `not_checked` instead of
  passing.
- **Coverage**: approved and in-progress counts per territory, derived for
  the dashboard.

## 4. Task templates

The templates are a closed set in code, because the evidence rules *are* the
quality contract. A client who could type "no photo, no location" for a field
visit would be buying unverifiable work.

| Key | Mode | Steps (share of worker pool, hold window, evidence) |
|---|---|---|
| `merchant_onboarding` | hybrid | qualify call (home, 25%, 48 h; gate: interested = yes) → visit & register (field, 75%, 72 h, 2 photos, GPS, consent) |
| `merchant_verification` | field | verify visit (100%, 72 h, 1 photo, GPS) |
| `supplier_sourcing` | hybrid | find supplier (home, 40%, 48 h; gate: can supply = yes) → collect quote (field, 60%, 72 h, 2 photos, GPS) |
| `market_survey` | field | interview (100%, 48 h, 1 photo, GPS, consent) |
| `lead_calling` | home | call (100%, 24 h) |
| `document_errand` | field | pick up & deliver (100%, 24 h, 1 photo, GPS, consent) |

- **Gate:** if the answer is not the expected one, the unit closes honestly
  as `not_converted` instead of moving to the next step.
- **Later steps:** a later step opens only when the earlier one is approved.
  It can be taken by someone else, e.g. a caller qualifies and a field agent
  visits.
- **Briefings:** each template carries a plain-language briefing per step.
  Reading it is recorded. It is not a certificate and is never shown as one.

## 5. Matching: explainable, no score

For each open program the worker sees `eligible`, plus `reasons[]` (✓) and
`blockers[]` (✗), in words. For example: "Active member of Westlands Field
Team", "Briefed on merchant onboarding", or "✗ Read the merchant onboarding
briefing". There is no ranking, score or hidden weighting. A claim that is
refused returns the same blockers.

Claim limits:
- at most 10 held tasks per worker, 10 per claim;
- claims are idempotent per key;
- claims respect the target and territory quotas (`full`).

Unsubmitted tasks return to the pool when their window ends.

## 6. Proof and quality control

A submission carries answers, photos (`private_work` uploads), location and
consent.
- **Hard errors refuse the submission:** a missing required answer, too few
  photos, no location on a GPS step, missing consent, or a photo already used
  elsewhere (a photo proves one thing only).
- **Soft checks** are recorded with the submission as `pass`, `flag` or
  `not_checked`:
  - inside the territory;
  - location accuracy (flag above 150 m);
  - unique business phone within the program;
  - before the deadline.

  `flags` counts them.

Review is always a person:
- **Approve**, **Return** (a reason is required; the worker reads it on the
  task and corrects it) or **Reject** (a reason is required).
- **Approve all clean** approves only submissions with zero flags.
- A reviewer never reviews their own submission.

The reviewer sees the answers, photos, a map link, consent, the automatic
checks, earlier reviews of the same task, and the worker's record as counts.

**Photos are private.** Only the worker who took them and managers of that
workforce can read them. They are fetched with the session token, never
through a public URL, and strangers get 404. A photo attached to proof cannot
be deleted (`evidence_in_use`).

## 7. Money

**Rate card.** It is frozen into the program at creation and is exact in
integer KES:

```
price per approved unit = Brief fee + worker pool
worker pool             = Σ step fees (by template share, remainder to the last step)
e.g. KES 300 → fee 60 + pool 240 → call 60 + visit 180
```

**When work pays.** A task is **payable** only when the task is approved *and*
its unit is approved, i.e. the outcome happened. Before that, it is shown as
`awaiting_outcome`. If the unit closes without approval (`not_converted`,
`rejected`, `abandoned`), the task shows as `outcome_failed` and pays nothing.
The payable week is the ISO week in which the unit was decided.

**Settlement.** It is manual, finance-confirmed and weekly:
1. Finance requests a settlement for a worker's payable week. This writes a
   pending ledger transaction `work_task_fee`.
2. Finance confirms it or refuses it with a reason.
3. Only confirmed money counts as paid.

There is no balance, no wallet and no automated disbursement
(`SETTLEMENT_RAIL=manual`). Worker earnings, "earned today", the program's
committed/verified/remaining KES, and the fee are all derived from rows.

## 8. Open decisions

1. **The Brief fee is provisional.** `BRIEF_WORK_FEE_BPS = 2000` (20%) is a
   placeholder in `workExecution.js`, not an agreed commercial term. Because
   it is frozen per program, changing it never rewrites a live program's terms.
2. **Pay for honest non-conversion.** Today a caller who correctly records
   "not interested" earns nothing, because the unit closes `not_converted`.
   That follows the strict outcome-only rule. The alternative is a small flat
   fee for an approved gated step, whatever the answer. That would make honest
   "no" answers cost the caller nothing. *Decide before real callers work on
   commission-free terms.*
3. **Collecting from the client.** The dashboard shows KES committed and
   verified, but invoicing and collecting from the organisation is not
   automated.
4. **Adding people.** People join by code only; there is no add-by-handle or
   phone invite yet.
5. **Custom templates.** There is no template editor. New templates are a
   reviewed code change (see §4).
6. **Relation to Decision 5.** Brief's own field agents stay on Decision 5
   (KES 150 flat per approved visit). Workforce programs are organisations
   paying their own teams per approved unit. They share the rules (flat fees,
   no bonus or tier, finance confirmation) but not the price.

## 9. Code and tests

| Layer | Files |
|---|---|
| Templates | `server/src/domain/workTemplates.js` |
| HR (workforces, members, territories, profiles, terms) | `server/src/domain/workforce.js` |
| Execution, QC, pay, views | `server/src/domain/workExecution.js` |
| HTTP (feature flag `workforce`) | `server/src/routes/workforce.js` |
| Client API | `preview/src/api/briefApi.ts` (WORKFORCE section) |
| UI | `preview/src/features/workforce/` (`WorkforceDesk`, `WorkerView`, `TaskRunner`, `OrgView`, `ui`) |

- `npm run test:workforce` (server, 30 tests): domain rules and HTTP with real
  sessions.
- `bash run-suites.sh workforcedesk` (client, 13 stages): the real UI in jsdom
  driven against a **real server process**. It runs the full lifecycle for an
  owner and a worker, including a return-for-correction, real photo uploads,
  GPS, consent, and exact KES at each stage.

### HTTP surface

| Who | Endpoints |
|---|---|
| Worker | `GET /api/work-templates` · `GET /api/me/work` · `PUT /api/me/work/profile` · `POST /api/me/work/terms` · `POST /api/me/work/briefings` · `POST /api/me/work/join` · `POST /api/work-programs/:id/claim` · `POST /api/work-tasks/:id/accept\|submit\|release` |
| Manager | `GET/POST /api/workforces` · `GET /api/workforces/:id` · `POST /api/workforces/:id/join-code` · `POST /api/workforces/:id/territories` · `PATCH /api/work-territories/:id` · `POST /api/workforces/:id/members/:memberId/actions` · `POST /api/workforces/:id/programs` · `GET /api/work-programs/:id` · `POST /api/work-programs/:id/status` · `GET /api/workforces/:id/review` · `POST /api/work-tasks/:id/review` · `POST /api/workforces/:id/review/approve-clean` |
| Finance | `GET/POST /api/ops/workforce-settlements` · `POST /api/ops/workforce-settlements/:id/confirm\|refuse` |

Identity always comes from the session: an owner or worker id in a request
body is ignored. Non-members get 404 for another workforce's ids, not 403.
