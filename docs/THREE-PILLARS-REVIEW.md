# Three pillars — review packet

Branch: `arena/a25a9f65-brief` (from `2da3c18`)
Scope: Work-From-Home task board, recurring hustle routines, social-seller trust signals.
Status: **feature-complete, tested, not yet deployed.** This document is the edge-case review surface before Railway.

> Follow-on batch: the Live Corridor Price Index (`0069`) is shipped in
> [`CORRIDOR-PRICE-INDEX-REVIEW.md`](./CORRIDOR-PRICE-INDEX-REVIEW.md). The
> figures below describe the three-pillar run and are followed by that doc.

---

## 1. What shipped

### Pillar 1 — Inbox WFH Task & Bounty Board (`0066_wfh_tasks`)

**Data**
- `corridor_tasks`: creator/assignee, `region_slug`, `town`, `task_type`
  (`DELIVERY_HANDOFF | DEAL_SPOT_CHECK | MERCHANT_ONBOARD | ERRAND_PICKUP`), title,
  instructions, `scheduled_date`, `due_at`, `worker_payout_kes`, `platform_fee_kes`,
  `fee_pct`, `payment_tag_snapshot` JSONB, `status`
  (`OPEN | CLAIMED | PROOF_SUBMITTED | COMPLETED | EXPIRED | DISPUTED`),
  `min_standing_level` (default 2), `proof_payload` JSONB, `claim_expires_at`, timestamps.
- Index: `idx_corridor_tasks_inbox (region_slug, scheduled_date, status)`.
- `corridor_task_fee_ledger`: append-only commission rows, `settlement_mode='direct_mpesa'`.

**API** (`/api/tasks`)
`POST /` · `GET /board` · `GET /inbox` · `GET /mine` ·
`POST /{id}/claim` · `/proof` · `/approve` · `/dispute` · `/withdraw`.

**Money rules**
| Type | Fee % of worker payout |
|---|---|
| Delivery handoff | 5 |
| Errand pickup | 5 |
| Deal spot check | 7 |
| Merchant onboard | 8 |

Fee is charged to the **creator**, on top of the payout. The platform never holds funds.

**UI**
- Emerald task dot on the 7-day Inbox strip (`taskDays`).
- Compact work rows: type pill (`Delivery • Kondele`), bold `Earn KSh 250`,
  due time, one action (`Claim task` / `Submit proof` / `Approve & pay`).
- Approve reveals the worker's M-Pesa tag with a copy button and the line
  “The platform never holds this money.”
- “Post a task” composer (type, title, instructions, region/town, day, due time,
  payout, minimum level).
- Proof sheet: handoff code, note, timestamped photo, method + number.
- Link to `Weekly routines` in the same header.

### Pillar 2 — Recurring Hustle Routines (`0067_recurring_routines`)

**Data**
- `recurring_routines`: owner, `region_slug`, `town`, `kind`
  (`scheduled | event | offer`), title, `template_payload` JSONB, `day_of_week` 0–6,
  `start_time_local` (EAT), `duration_hours` 6, `publish_lead_hours` 48, `is_active`,
  `last_generated_for_date`, timestamps.
- `recurring_routine_instances`: unique `(routine_id, occurrence_date)`, activity id,
  `whatsapp_shared_at`.

**Sweep**
- Hourly in-process task (`ROUTINE_SWEEP_INTERVAL`) and callable from the worker.
- Generates one ordinary `local_activities` row inside the lead window, with the
  `0064_activity_expiry` `expires_at` set, then stamps `last_generated_for_date`.
- Idempotent via `pg_insert(...).on_conflict_do_nothing(index_elements=[...])`;
  a duplicate sweep returns empty rather than rolling back sibling inserts.

**API** (`/api/routines`)
`GET /` · `POST /` · `PATCH /{id}` · `DELETE /{id}` ·
`POST /{id}/publish` · `POST /instances/{id}/shared`.

**UI**
- `Repeat Weekly` switch on **Create** → Mon–Sun selector + start time → saves the
  current draft as a routine (Publish still posts this week only).
- `/routines` manager: Weekly pill, pause/resume, publish now, remove, and the
  one-tap **“Share this week's round”** — an organic `https://wa.me/?text=` link.
- The same one-tap share appears in the **Inbox** and disappears after the server
  records `whatsapp_shared_at`.
- `Weekly • Every Sat` pill on region cards (`RegionsGrid`) and on the seller trust card
  (Your Page / `/p/:handle`).

### Pillar 3 — Social-seller bio-link & stock-in-hand trust (`0068_social_trust`)

**Data**
- `vendors.social_links` JSONB (the real account table is `vendors`, not `users`).
- `social_bio_checks`: append-only history per check.
- `stock_in_hand_proofs`: HMAC challenge code, item, price, image, status,
  `expires_at`; partial unique `uq_stock_proof_active` allows one ACTIVE photo.
- `seller_delivery_reports`: reporter, note, trade evidence, status; unique open
  pair `uq_delivery_report_open_pair`.

**API**
`GET /api/social-trust/me` · `PUT /links` · `POST /verify-bio` · `GET /challenge` ·
`POST /stock-proof` · `GET|POST /delivery-reports` · `POST /delivery-reports/{id}/resolve` ·
`GET /public/{handle}`. Aliases: `POST /api/profile/verify-social-bio`,
`GET /api/social-proof/challenge`.

**Rules**
- Bio fetch: exact-host allowlist (`tiktok.com`, `instagram.com`, `facebook.com`),
  HTTPS only, no redirects, 5 s timeout, 512 kB cap; a substring match of the exact
  `/p/{handle}` path in the public HTML. `bio_verified` is a **signal**, never standing.
- Challenge: `HMAC(SECRET_KEY, vendor_id + YYYY-MM-DD)` → three-letter corridor prefix
  + two digits (e.g. `KSM-92`), stable across calls, changes at EAT midnight.
- Stock photo: valid 48 h, labelled `Stock-in-Hand Photo • Code KSM-92 (Valid 48h)`.
- Banner: ≥ 2 **distinct, unrelated Level 2+** buyers with unresolved reports on
  verified trades → `⚠ 2 Unresolved Delivery Reports — Inspect Before Paying`, on the
  page **and** in the OpenGraph card.
- UI: trust header (completed deliveries, dispute ratio, bio badges), stock card,
  routines, `Copy Trust Reply` (`Check my verified delivery record & stock-in-hand
  proof before ordering: {origin}/p/{handle}`), and a Level 2+ buyer “Report a
  delivery problem” action on `/p` and `/page`.

### Palette and ergonomics

- Forest green `brand` tokens for confirmed/primary.
- Amber `amber-*` for unverified, pending and warning states.
- Rose `rose-*` for disputes and opt-outs.
- Primary row actions are `min-h-[44px]`; on phones the task action stacks below
  the text, in the lower half of the row. Pass codes remain offline-cached.

---

## 2. Edge cases to review

1. **Claim race** — `SELECT … FOR UPDATE`; second claimer gets 409; a lapsed 4 h
   claim is released on read and by the sweep; the worker sees the release.
2. **Self-claim** — creator claiming own task is 403, not a silent no-op.
3. **Standing gate** — `min_standing_level` default 2; below it the row explains
   `Needs standing Level N`. **Level 5 cannot be reached server-side**, so any copy
   promising Level 5 work is out of scope.
4. **Approve replay** — double-tap records one commission row.
   `fee_recorded` = “this call wrote a row”; `fee_already_recorded` = “a row exists”.
5. **Handoff code** — `HO-XXX`, creator-only. Worker never sees it. A mismatch is
   recorded as `handoff_verified: false` plus a note; the poster still decides.
6. **Payout tag visibility** — disclosed to the creator only after `COMPLETED`;
   hidden from the board and from other viewers. A completed row stays in the
   creator's board with a copyable number, so a reload does not lose the tag.
7. **Corridor scoping** — the Inbox board shows OPEN work in the viewer's corridor
   (`Kisumu → nyanza`, `Nairobi → nairobi-metro`, `Mombasa → coast`) plus anything
   they created or claimed; no cross-country noise.
8. **Routine sweep concurrency** — unique `(routine_id, occurrence_date)` +
   `on_conflict_do_nothing`; no `try/except IntegrityError: rollback` (that would
   discard sibling inserts).
9. **Routine publishing** — outside the lead window `publish now` returns 409;
   a second publish for the same occurrence also 409. Removing a routine does not
   delete an already live round (it expires normally).
10. **Timezone** — occurrence days are EAT; storage is UTC; `_aware()` normalises
    the naive `local_activities` timestamps against the new aware columns.
11. **Share prompt** — hidden after `markShared`; the WhatsApp link is organic and
    carries no Business API dependency.
12. **Bio checks** — login walls/redirects are reported as “no match yet”, not as a
    failure of the seller's link. Unmatched links stay amber, never red.
13. **Stock proof** — publishing retires the previous ACTIVE row in the same
    transaction; a concurrent double publish returns 409 instead of a 500.
14. **Delivery reports** — require confirmed trade evidence and a Level 2+ reporter;
    one open report per reporter/seller pair; resolving needs a note; the banner
    counts distinct reporters, so one angry buyer cannot raise it.
15. **Honesty language** — no “KRA-verified”, “bank-verified”, “verified business”
    or standing credit from tasks, bio matches, stock photos, routine badges or
    report resolution. The public-card `signals_note`, `SIGNAL_NOTES` and the
    in-context lines are the copy contract.
16. **Public trust card auth** — `GET /api/social-trust/public/` is a GET-only
    public-read prefix; removing it re-breaks a bio-link visitor with no token.
17. **OpenGraph escaping** — `alert_html` is built first and interpolated once; no
    f-string containing `style="..."` inside the HTML template.

---

## 3. Test evidence

### Backend
- Focused suites: `tests/test_wfh_tasks.py` (5), `tests/test_recurring_routines.py` (4),
  `tests/test_social_trust.py` (4) → **13 passed**.
- Migrations: `0065_handle_redirects → 0066_wfh_tasks → 0067_recurring_routines →
  0068_social_trust`, single head; `tests/test_migrations.py` **3 passed**.
- Full backend suite (earlier run): **981 passed, 1 failed, 1 skipped**.
  The one failure is `tests/test_smoke.py::test_full_loop`
  (`GET /api/events/browse` omits the event). It reproduces identically on base
  `2da3c18` in a throwaway worktree — **pre-existing, not a regression.**

### Frontend
- New tests: `corridorTaskBoard` (5), `socialTrustCard` (4), `routinesPage` (3),
  `repeatWeeklyCard` (2), plus the Inbox share-prompt case (2 in `inboxPage`) →
  **16 passing**.
- `npm run build` → success.
- Full Vitest run: **660 passed, 4 failed**. All four failures reproduce on base
  `2da3c18`:
  - `outside.test.jsx` — “publishes a house party…” (local vs UTC datetime string)
  - `pages.test.jsx` — 3 portfolio/shop-front cases (mock drift around
    `professionalAPI.page`)
  These are environment/mock issues in the existing suite, not caused by this work.

---

## 4. Deploy notes (Railway)

1. `alembic upgrade head` runs from `entrypoint.sh`; three new migrations apply in order.
2. Uvicorn already runs with `--proxy-headers --forwarded-allow-ips="*"`, so
   `request.base_url` behind Railway produces the public origin used in the trust reply.
3. The trust reply and OpenGraph page URL follow the request host. Confirm the custom
   domain is the one users open, or links will point at the Railway service hostname.
4. `SECRET_KEY` must be stable across deploys — the handoff codes and daily challenge
   codes are HMAC-derived from it. Rotating it invalidates codes already given out.
5. The routine sweep runs in-process by default and is also available to the worker.
   Run **one** worker, or keep the in-process interval on and the worker sweep off,
   to avoid duplicate (harmless but noisy) sweeps.
6. Uploads need a writable media store; stock-in-hand photos and task proof photos
   are validated against `/static/<key>`.
7. `AUTO_CREATE_TABLES=false` is correct — the migrations are the schema.

---

## 5. Deliberate decisions

- **`/tasks` route collision:** corridor work lives in the Inbox, not in the existing
  `TasksPortal`/`squadAPI` screen. The new client is `corridorTaskAPI`; there is no
  `/tasks` page. This avoids merging two unrelated task models.
- **No utility ledger table exists:** commissions go to `corridor_task_fee_ledger`
  (`settlement_mode='direct_mpesa'`), not `FeeRecord`.
- **`users` → `vendors`:** the brief's SQL referenced `users`; every FK and the
  `social_links` ALTER target `vendors`.
- **No paid APIs:** no Daraja STK, WhatsApp Business, SMS OTP or third-party AI.
  WhatsApp is an organic `wa.me` link; M-Pesa text is pasted, not fetched.
