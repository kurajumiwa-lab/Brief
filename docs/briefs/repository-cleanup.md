# Repository cleanup: what was consolidated, removed and fixed

One pass over the whole repository: the four inboxes, the abandoned Home, the
product identity, the routes, the bundle, the migrations, CI and the design
tokens. Everything below was executed, not proposed. Where something could not
be verified without production access, it says so.

---

## 1. The Inbox is one screen

**Before.** Four surfaces answered "what is waiting on me", each with its own
filters, empty states and idea of where a notification should send you:

| surface | rendered by | reached by |
|---|---|---|
| `pages/inbox/InboxPage` | the Inbox tab | the tab, `/inbox` |
| `pages/activity/ActivityPage` | `/activity` | old deep links, `HomePaths`, `RadarStrip` |
| `pages/mail/MailPage` | `/mail` (flag, off) | nothing |
| the notification bell | every header | the bell icon |

**After.** `pages/inbox/InboxPage` is the only inbox. `InboxPage`'s own header
comment had claimed to be "the question, answered once" while being the fourth.

What Activity had and the Inbox did not was **absorbed, not dropped**:

- the three-number summary → `activity-stats`, same three numbers, same store as
  the tab badge so they cannot disagree;
- neighbourhood watches → extracted to `components/inbox/WatchesPanel.jsx`. This
  matters most: a watch is the setting that *decides what you are told about*,
  and it lived on a page nothing in the navigation opened;
- grouped notifications with per-group blurbs → `components/inbox/InboxFeed.jsx`;
- "waiting on you" vs "your activity" → two modes, with "Everything" as the
  default so narrowing never hides unread work.

`/mail` and `/activity` still resolve — a link in a WhatsApp thread must keep
working — and both render the one Inbox. `/mail` opens it pre-filtered to
conversations, which is the only thing the old Mail page did.

**Two real defects surfaced by the merge, both fixed:**

1. `notificationRow` flattened every notification group to the kind `"requests"`,
   left over from the old single-column list. The grouped feed had nothing to
   group by: every notification arrived as the same kind.
2. The first draft rendered a *failed* activity load as "nothing is waiting" —
   the page telling a lie in the one moment it matters. Loading, failure and
   emptiness are now three separate branches, and the failure branch names what
   broke and offers a retry.

## 2. Notification destinations

The system had 50 notification types in `models/notification.py` and 32 routes
in `NOTIFICATION_ROUTES`. Nineteen types the backend emits fell through to a
default, and `event_payment_submitted` / `event_payment_confirmed` pointed at
`/inbox` — the page the notification is displayed on, so tapping did nothing.

- All 50 types now map to a route that exists.
- The routing logic from the deleted `NotificationBell` — which used the payload
  (room, order, group, event) before the type table — was **promoted** into the
  Inbox as `destinationFor()`, not discarded with the component.
- The last-resort destination is never the Inbox itself.

`tests/notificationRoutes.test.js` (7 assertions) enforces: every backend type is
mapped, no mapping is dead, every destination matches a real `<Route>`, nothing
points back at the Inbox, every literal `to=`/`href=` in every component
resolves, and no route path is declared twice.

## 3. The abandoned Home

`pages/home/HomeHub.jsx` was imported by **nothing but tests**. Its whole tree
was unreachable: the old Home, six shelves, ten card components, the status/radar
strip, the sign-in hero, and the invite banner.

**57 modules removed** (Home subtree, dead status strip, `homeShelves.js`,
`homeFeedStore`, `tradeOverviewStore`), plus 13 test files that only exercised
them. `ReferralBanner` — the magenta banner that had been given a contrast pass
in an earlier session — was among them: no user ever saw it.

A script, `frontend/scripts/check-reachability.mjs`, walks imports from
`main.jsx` and reports unreachable modules. It found 85; after this work there
are 13, and each remaining one is documented below rather than deleted.

**Deliberately kept, with reasons:**

| module | why it stays |
|---|---|
| `pages/me/MePage` | 803-line implementation; `/me` redirects to `/you`. Test-only reachability — needs a product decision, not a deletion |
| `pages/vendor/VendorProfile` | `/:handle` is unrouted; `YouView`/`PortfolioView` serve the page. Removing it is a product decision |
| `pages/mall/Mall`, `pages/brief/MorningBriefPage` | old URLs redirect to `/me`; the components are the previous implementations |
| `components/circles`, `credentials`, `leads`, `professional`, `relationships`, `vendor/SelectedWork` | reached only from `MePage`/`VendorProfile` |
| `components/ui/{Shelf,SectionHeader,index}` | generic primitives held for reuse |

## 4. Product identity

Four names were in flight: **Byway** (nine root documents, a rendered notice-board
heading), **My Shop App** (the README title), **Home Office** (`config/brand.js`
and 24 rendered strings), **Brief** (the rest of the interface, with a stray
underscore in eight places).

**The name is Brief** — it is what the interface already said on the rate card,
the referral landing, the trust pages, the tasks portal and the CSV disclaimer.

- `config/brand.js`: `Home Office` → `Brief`. `parent: "Ogallo"` kept — that name
  was on real shopfront boards and receipts.
- 24 rendered `Home Office` strings → `Brief`; 7 files with `Brief` fixed.
- `<title>` now derives the same name.
- Notice board heading "Byway Notice Board" → "Notice Board".
- **Nine root documents deleted** (~5,700 lines): `CHANGES_SUMMARY`,
  `COMPLETE_SOLUTION`, `FEATURES_BUSINESS_MARKETPLACE`,
  `FINAL_IMPLEMENTATION_SUMMARY`, `IMPLEMENTATION_PLAN`, `IMPLEMENTATION_ROADMAP`,
  `NEW_FEATURES_INTEGRATION`, `README_IMPLEMENTATION`,
  `BACKEND_API_SPECIFICATION` — all describing "Byway".
- **README rewritten** (621 → ~230 lines) around the application that exists:
  layout, both run paths, environment variables, tests, migrations, deployment,
  CI, and the conventions worth knowing.
- `tests/brand.test.js` fails if any retired name returns to a rendered file, or
  if the config and the document title disagree.

## 5. Routes and broken links

| fix | detail |
|---|---|
| duplicate `/brief` | declared twice in one `<Routes>`; the redirect won, so `MorningBriefPage` was unreachable while still eager in the bundle. Redirect kept, page import removed |
| `/notices` | linked from a home shelf; the page existed and had never been registered. Now routed (lazy) |
| `event_payment_*` | `/inbox` → `/events?tab=mine` |
| 19 unmapped types | all mapped to real destinations |
| feature-gated pages | `IntegrationsPage` and `FrontDoorsPage` were **eager** imports behind flags that are off by default — shipped to every user, reachable by none. Now lazy |

## 6. Bundle

| | main chunk | gzipped |
|---|---|---|
| before | 674.12 kB | 179.20 kB |
| after | **654.78 kB** | **174.55 kB** |
| change | **−19.3 kB (−2.9%)** | **−4.65 kB (−2.6%)** |

Modest by design: every route was already lazy, so this is dead code that was
reachable and feature-gated eager imports, not a structural change. The honest
number is that 654 kB is still large for a first paint, and the largest single
remaining opportunity is the 40 eager page imports in `App.jsx` — a change worth
making deliberately, measuring first-paint, not as a side effect of this pass.

## 7. Migrations

Production `alembic_version` is `0057_public_page_settings`; the code's head is
`0083_merit`. **26 migrations are unapplied**, so every feature after `0057` is in
the bundle and absent from the schema.

Nothing was run against production. What was done:

- `docs/briefs/production-migrations.md` lists every unapplied revision, what it
  enables, and the safe procedure (back up, check for drift, **one revision at a
  time, never `upgrade head`**, verify, do not rewrite history).
- Merit now **reports** the gap instead of crashing: a schema guard probes
  `to_regclass` for its three tables and returns `503` naming the missing tables
  and migration `0083`, where it previously raised `UndefinedTable` → `500`.
  A 500 says "broken"; a 503 says "not switched on". Only one is true.
- `tests/test_merit.py::test_missing_schema_is_a_503_that_names_the_migration`.

## 8. CI

The workflow is committed at **`docs/ci/ci.yml`**, ready to install, because the
GitHub App that opened this branch is not permitted to create files under
`.github/workflows/`. To activate it:

```bash
mkdir -p .github/workflows && cp docs/ci/ci.yml .github/workflows/ci.yml
```

(then commit and push — any account with workflow permission can do this).

There was no `.github` directory at all, with 89 backend and 107 frontend test
files and nothing running them.

- **Frontend**: `npm ci`, tests, production build, bundle-size report. ESLint
  runs and reports but does not block: 26 pre-existing errors in
  `NoticeBoard.jsx` (10), `AuthPage.jsx` (13) and `NoticeBoardPage.jsx` (3),
  none of them authored here. Fixing them is a separate, safe pass; gating on
  them today would block every PR for a pre-existing condition.
- **Backend**: `compileall`, then the full suite on a bundled PostgreSQL 16
  (`pgserver`), because the tests need advisory locks and `to_regclass`.
- **Migrations**: asserts exactly one Alembic head. Verified locally: `0083_merit`,
  83 revisions.

CI cannot tell whether *production* is migrated — that needs the production
credential, which CI must not have. That is an operational decision, documented
in the migration note.

## 9. Design tokens

- `Badge` gained `neutral` as the honest name for the ramp it actually uses (a
  cool slate, not a violet), with `purple` kept as a working alias. The comment
  explains why the name matters: callers were choosing `purple` to mean seven
  unrelated things at once — scheduled, service, rental, shortlisted, moderator,
  stop, patron. A colour that means everything means nothing.
- Corrected an overstated comment written in the previous session: it claimed
  `orchid` "reads as lilac on cream". The ramp is a cool slate and has not been
  purple since it was redefined. The corrected comment states what the ramp is
  for and, more usefully, what it is not for.

---

## Verification actually run

| check | result |
|---|---|
| `npx vitest run` | **94 files, 678 tests, all passing** |
| `npx vite build` | ✓ 19.09s, 654.78 kB / 174.55 kB gzip |
| broken-import sweep (static + dynamic) | **none** |
| reachability | 85 → **13** unreachable modules, each documented |
| `python -m compileall app` | clean |
| `pytest -q` | **1070 passed, 1 failed, 1 skipped** — the failure is `test_smoke::test_full_loop`, which fails on a clean checkout too |
| Alembic heads | `0083_merit`, 83 revisions, single head |
| `eslint src` | 26 pre-existing errors in 3 untouched-by-me files, reported not blocking |

## Remaining blockers needing your access or decision

1. **Apply the 26 migrations** — or keep the features gated. Procedure in
   `docs/briefs/production-migrations.md`. This is the only item that makes
   shipped features unavailable to real users.
2. **`MePage`, `VendorProfile`, `Mall`, `MorningBriefPage`** are unreachable but
   are real implementations behind redirects. Deleting them is a product
   decision; I did not make it.
3. **The 654 kB bundle.** Cutting the 40 eager page imports needs a first-paint
   measurement to justify it, which needs a real device or Lighthouse run.
4. **26 lint errors** in three files, pre-existing.
5. **Deployment protection** is on for the production aliases, so the deployed app
   is not publicly reachable; nothing here changes that.
