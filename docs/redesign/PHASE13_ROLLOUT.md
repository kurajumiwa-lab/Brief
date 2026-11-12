# Redesign Phase 13: integration and rollout checklist

Status: **ready for owner review. Nothing is deployed, and no production flag is changed.**
Branch: `arena/b6ee7dfc-brief`, PR #91 (Phases 11 to 13 stacked on it).

## 1. Feature flags (all default OFF)

Every flag is a Vite build-time variable. Off means the previous behaviour, and the old routes still work.

| Flag | Turns on | Phase |
|---|---|---|
| `VITE_BRIEF_LANDING_ENABLED` | Morning Brief at `/`; Home hub at `/home` | 10 |
| `VITE_FIVE_TAB_NAV_ENABLED` | Five-tab shape: Desk, Nearby, Mail, Search, Me | 2 |
| `VITE_DESK_ENABLED` | `/desk` (offerings, worker assignments) | 3, 4 |
| `VITE_MAIL_ENABLED` | Consolidated `/mail` | 5 |
| `VITE_CIRCLES_TRUSTED_ENABLED` | Circles and add-by-handle trusted contacts on Me | 7 |
| `VITE_NEARBY_DOORS_ENABLED` | `/doors` (open front doors) | 8 |
| `VITE_ONBOARDING_ACTIVITIES_ENABLED` | "What do you do?" card on Home | 1 |

Not flagged: network search (Phase 6, `GET /api/search/network`), the Phase 0 office privacy default, the Phase 9 event filters, and the Phase 12 geographic query change. Those are backend or behaviour changes and ship with their release.

## 2. Database migrations (additive; applied in order)

Single head: `0045_front_door_visibility`. Run `alembic heads` from `backend/` to confirm.

- `0041_office_visibility`: offices are private by default. Existing offices are grandfathered public.
- `0042_onboarding_activities`
- `0043_offering_lifecycle`
- `0044_work_assignments`
- `0045_front_door_visibility`: `vendors.front_door_visible`, default false.

No table deletions or destructive changes. **These migrations have not been run against a staging or production database.** Do that as the first step of a rollout.

## 3. Test results (this branch, this session)

| Check | Result |
|---|---|
| Backend `pytest` (full) | 873 passed, 1 skipped, exit 0 |
| Frontend `vitest` (full) | 57 files, 539 passed, exit 0 |
| `vite build`, all flags off | Pass |
| `vite build`, all flags on | Pass |
| `vite build`, Brief landing on | Pass |
| ESLint, changed files | Clean. One existing warning in `Analytics.jsx` (line 48), not from this work |

Failure found and fixed in Phase 13:
- `frontDoors.test.jsx` (6 tests) failed after Phase 8 because its mock of `nearbyAPI` was missing `frontDoorSetting`. The mock is fixed. No assertions changed.

Fixed in Phase 13:
- Home tab pointed at `/` while the Brief flag was on. It now goes to `/home` only when that flag is on.

Note on tests: under the owner's instruction, Phases 6 to 11 ran builds and lint but not test suites. Phase 13 ran the existing suites to find regressions. It wrote no new test files.

## 4. Known open items (not blocking flag-off rollout)

1. Events cannot be hosted by an office (Phase 9).
2. `GET /api/vendors/network` and `GET /api/stock/network-stock` lack the block and suspension filters that search uses (Phase 6).
3. Blocks come from `OutsideContentReport` (`is_block`), not `SocialBlock`. Unifying them needs an owner decision.
4. Front-door responses still include exact coordinates for opted-in businesses. This needs a product decision.
5. The Desk tab falls back to `/` when Desk is off. With the Brief flag on, that opens the Brief.
6. The "Vendor World" brand decision is overturned by the owner (2026-11). The product is "Home Office". The rename ships in the Phase 7 PR 1 rebrand.
7. Signup name-field copy is waiting for review (Phase 0).
8. Finance review: `app/services/halal.py:83` and `app/routes/chamas.py:266` are unchanged and need finance sign-off.
9. Governance copy needs a governance reviewer.

## 5. Rollout order (staging first; each step needs owner approval)

1. Confirm `alembic heads` is `0045`. Run migrations `0041` to `0045` against staging. Check that existing offices remain public.
2. Deploy to staging with all flags off. Check that existing routes and deep links work.
3. Turn on flags one at a time in staging, in this order: `ONBOARDING_ACTIVITIES`, `FIVE_TAB_NAV`, `DESK`, `MAIL`, `CIRCLES_TRUSTED`, `NEARBY_DOORS`, `BRIEF_LANDING`. Check the affected screens and links at each step.
4. Ask the owner for release approval before any production flag is turned on.
5. Keep the rollback path: switching a flag off restores the previous screens. The migrations are additive and need no reverse step to keep data.

## 6. Not done in this phase

- No deploy, no production configuration change, no production flag change.
- No merge. PR #91 waits for owner approval.
- No new test files.
