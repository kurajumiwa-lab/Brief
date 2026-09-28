# Admin access and registered member profiles

## Open the directory

1. Sign in with an administrator account.
2. Open **All sections → Administration → Admin · Members**.
3. Search by name or handle (with or without `@`). The directory contains all
   registered accounts, newest first, with 30 rows per page and Previous/Next.
4. Select a member. The profile opens and focuses beneath the directory:
   - **Account:** registration, status, email if provided, sign-in method,
     verification, onboarding, effective roles and audited role/status actions.
   - **Business profiles:** owned spaces and seller/supplier summaries. Public,
     active, non-hidden spaces have links to their public page. Private spaces
     do not receive public links or a shortcut into the owner's workspace.
   - **Worker profile:** stated contact, modes, areas, languages, briefings,
     terms acceptance, workforce memberships, onboarding, territories and
     capability-specific work counts. These are not a universal trust score.

A registered account need not have a business or worker profile. Those sections
say so explicitly; workforce enrollment is not confused with app registration.

### Direct links (same app domain)

- `/#admin` or `/#admin/members`: directory for admins; the operator desk for
  accounts with lesser `ops.read` permission.
- `/#admin/members/<user-id>`: a specific admin-only profile, reloadable and
  compatible with browser navigation.

The live production `AppShell` now loads the existing `AdminDesk` lazily.
The old `?admin=1` legacy harness is not the production entry point. The desk's
existing health, content, commerce, media, security and diagnostic tabs remain.
The **Members** tab leads for administrators. Sign-in is offered on anonymous
direct links. Consumer first-run onboarding does not intercept admin routes.

## Bootstrap your first administrator

**No account is automatically promoted by this change.** Register and verify
control of the account you intend to use, then configure its exact handle in
YOUR server hosting environment (not a browser/Vite variable):

```env
BRIEF_ADMINS=your_existing_handle
```

Use no `@`. For multiple administrators, comma-separate their handles. Restart
or redeploy the server, then reopen the app/menu (or sign in again). Confirm
that `GET /api/auth/me` for that account includes the `admin` capability.
Do not name an unregistered handle someone else could claim. Do not turn on
`BRIEF_DEV_AUTH` in production to get admin access.

Once bootstrapped, an admin can grant stored roles from **Account → Platform
roles**. Existing roles remain capability-scoped:

| Role | Access |
|---|---|
| operator | Operations reads/runs; not the member directory |
| reviewer | Operations + moderation; not the member directory |
| finance | Operations + finance; not the member directory |
| admin | Includes the member directory and role administration |

Roles named in deployment variables remain effective until removed from those
variables. The profile distinguishes effective roles from stored assignments;
a button cannot revoke a deployment grant. Self-suspension and removing one's
own admin access through the API are refused to avoid accidental lockout.
Suspending another account needs a reason and revokes existing sessions;
reinstatement allows a new login but does not revive old sessions.

## API and privacy boundary

- `GET /api/ops/members?q=&page=0` — existing admin-only directory, now with
  validated non-negative page indices, stable ordering and `@handle` search.
- `GET /api/ops/onboarding` — existing admin-only registration/onboarding counts.
- `GET /api/ops/members/:id` — new admin-only unified **allowlisted** projection.
  A successful read logs `ops.member.view` with actor and target IDs.
- Role and account-status changes reuse existing audited ops routes. The
  caller comes from the session, never a request body or URL parameter.

All three reads return `Cache-Control: no-store`. The unified profile does not
return password hashes/salts, tokens, sessions, invite codes, private proof,
customer records, or private financial ledgers. IDs shown in an administrative
summary do not grant authority to impersonate a business/workforce owner.
The full `GET /api/spaces/:id` owner-workspace read is now owner-only, as it
contains private conversations and financial metrics. Public profiles remain
at `/api/public/spaces/:slug/page`; delegated staff use `/api/spaces/:id/team`.

The browser discards cached admin views when identity changes, including a
login/logout in another tab. Focus refreshes identity. A 401/403 on a member
read/action rechecks permission and removes the privileged screen when revoked.
Errors, missing users, absent profiles and empty searches are distinct states;
failed reads never silently appear as an empty directory. Out-of-order profile
and search responses cannot replace a newer selection.

## Verification

```sh
npm run test:admin       # domain + actual HTTP sessions, authorization, paging,
                        # bootstrap, projections, audit, suspension/revocation
npm run test:admin:ui    # real AppShell + real isolated server, plus desk suites
npm run test:typecheck
npm run build:client
```

Tests use disposable stores. No fixtures are inserted into live registration
records and no real user is granted admin by a test. Browser layout screenshots
are not part of the jsdom integration tests.
