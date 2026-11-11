# Phase 0: permissions and identity audit

Status: implemented on `arena/2879df6d-brief`. Scope: the identity, membership, office, and
visibility foundation. No new identity, membership, role, or messaging system was added.

## Findings (existing system)

| Area | Where | Finding |
|---|---|---|
| Identity | `Vendor` (`app/models/vendor.py`), `account_kind` in {person, household, artisan, institution, business} | One identity table for every account kind. Reused. |
| Signup | `app/routes/auth.py` `register_vendor` | Business name optional. A person is resolved when `display_name` is set and `business_name` is not. Already person-capable. |
| Office membership | `OfficeMember` (`app/modules/office/models.py`), roles owner/editor/member | Owner row is created with the office. Roles and status (active, pending, removed) enforced in `service.require_active`. Reused as the single membership system. |
| Office invites | `invite_account`, `create_link`, `accept_link`, `respond_invite` | Invites are by registered handle or single-use hashed link. Pending members get no read access until they accept. |
| Member removal | `remove_member` | Owner only. Owner row cannot be removed (one-active-owner DB rule). Removed members lose their link credential. |
| Audit | `audit_events` (`app/modules/trust/models.py`), `trust.service.audit` | Used for office creation, member removal, and now visibility changes. |
| Public office read | `GET /api/office/public/offices/{id}` | **Gap found:** every office was public from creation, so anyone could read name, area, and hours without the owner choosing. This conflicts with the directive that public visibility is explicit. |

## Changes made in Phase 0

1. **Explicit visibility on offices.** New column `offices.visibility` (`private` | `public`), default `private`, named CHECK `ck_offices_visibility`. Migration `0041_office_visibility` is additive. Existing offices are set to `public` so that nothing already published is taken down (rule 10). Downgrade drops the column and constraint. No rows are deleted.
2. **Public read is gated.** A private office returns 404 on the public endpoint, the same as a missing office, so its existence does not leak.
3. **Owner-only visibility change.** `PATCH /api/office/offices/{id}/visibility`. Owner only (editors and members get 403, strangers get 403). Invalid values get 422. Every change writes an `office_visibility_changed` audit event.
4. **Every person gets a private home office at signup.** `ensure_home_office` runs in registration. It uses the same creation path as a hand-made office, so the owner membership and audit event are identical. It is idempotent: an existing active owned office is never duplicated.
5. `office_summary` now includes `visibility` for members. This is additive.

## Permission model (unchanged where it was already correct)

- Identity: `Vendor` is the one identity. Joining an office never changes identity or personal data.
- Membership: `OfficeMember` is the one membership table. Status and role are checked in the backend.
- Roles: owner (invite, remove, visibility, events), editor (events), member (read). Owner cannot be removed or demoted.
- Visibility: office public read requires `visibility = public`. Contact details appear only when the owner chose a contact mode.
- Account creation never makes private data public: the home office starts private. Its public area is set to "Not set yet", never copied from `physical_location`, which can hold an exact address.

## Tests

`backend/tests/test_v40_office.py`: updated two tests that asserted public-by-default. Added tests for:
- a new office starts private (404), and opens only when the owner chooses;
- contact shown only when chosen (updated to open first);
- only the owner changes visibility (editor 403, stranger 403);
- invalid visibility is rejected (422) and every change is audited;
- signup gives one private home office;
- `ensure_home_office` is idempotent.

Existing tests for membership, invites, roles, removal, and integrity rules pass unchanged.

## Deferred / isolated

- Office ownership transfer is not built. The one-owner rule stays. Any transfer work is its own change.
- Pre-existing public offices were grandfathered as public. If the owner wants them private, that is a user decision, not a migration.
