# Scope upgrade (v2.13) — public marketplace + enterprise workspaces, Kisumu first

> **Decision:** do not build a new app. Upgrade the scope of Brief_ from a
> vendor network into **both** of the models below, in one product:
>
> 1. **Public marketplace** — anyone (as a vendor) can find vendors, workers,
>    freelancers and suppliers. *This already exists:* vendors, Stock Room,
>    Business Requests, orders, tools/couriers, the map and markets.
> 2. **Enterprise SaaS** — associations and companies pay for their own
>    private workspace *inside* Brief_: a branded membership portal, a
>    member register, field officers, a field-activity dashboard, and a
>    managed-Android-device register. **New in v2.13:**
>    `backend/app/modules/enterprise/` + `/enterprise` in the frontend.
>
> Everything is labelled **[Built]** (in this repo at v2.13), **[Existing]**
> (built before v2.13 and reused, not rebuilt), **[External]** (provided by
> someone else — Google/EMM, PSP, ODPC) or **[Target]** (a number to test).

---

## 1. What an organisation actually receives

Example: a trade association purchases the platform and receives —

| Promised item | Where it lives | State |
|---|---|---|
| Branded business & membership portal | Workspace branding (name, colour, logo) rendered inside Brief_ at `/enterprise`; members are ordinary `@handle` vendors | **[Built]** v2.13 |
| Member register & controlled access | `enterprise_memberships` with roles `owner / admin / field_officer / member / viewer`; non-members get 403; server-side plan caps | **[Built]** v2.13 |
| App for registering vendors & verifying membership | Existing vendor registration + the officer flow: a field officer adds a vendor by `@handle`; the registration is recorded against that officer. Verification *standing* stays in the Business Passport — a workspace role never verifies a claim | **[Built]** v2.13 on **[Existing]** passport (v2.11) |
| Dashboard for field registration activity | `GET /api/enterprise/workspaces/{id}/dashboard`: members by role, registrations per named officer (30 days), devices by status/mode, pending commands. Counts an official can audit — no officer score | **[Built]** v2.13 |
| Android phones configured for field officers | Enrolment is done in the organisation's **Android Enterprise / EMM console**; Brief_ keeps the device register (`managed_devices`: label, assignee, mode, policy, status) | Register **[Built]**; enrolment **[External]** |
| Controlled access to business records & work apps | Workspace roles gate workspace records; app/work-app control on the phone is an EMM policy, not a Brief_ feature | Workspace **[Built]**; device policy **[External]** |
| Remote lock & company-data removal | `POST …/devices/{id}/commands` with reasons, an enrolment-mode matrix, and an audit trail. Only reported `dispatched` when an EMM is bound **and** `ENTERPRISE_DEVICE_COMMANDS_DISPATCH_ENABLED` is on — otherwise the response says, in words, *not sent to the device* | **[Built]** v2.13 (audit + rules); delivery **[External]** |

## 2. Where Android Enterprise fits — and where it stops

Android Enterprise is an **additional managed service** an organisation can
buy alongside the platform. It provides enrolment modes, app distribution,
device policy and remote actions through an EMM. It does **not** provide:

- the vendor marketplace, stock, deals or collective buying (**[Existing]**);
- job matching — Business Requests, Hustle job calls and offers (**[Existing]**);
- membership, payments, chamas or verification (existing modules).

So the integration is deliberately thin and honest:

```
Field officer's phone ──enrolled by──▶ organisation's EMM (Android Enterprise)
                                              │ policy, apps, lock/wipe
Association office ──▶ Brief_ /enterprise     │
   member register · field activity · device register · command requests ──▶ EMM (only when bound)
```

Enrolment-mode rules enforced server-side (`modules/enterprise/rules.py`):

| Mode | Typical device | Lock | Remove company data | Wipe whole device |
|---|---|---|---|---|
| `work_profile` | Officer's own phone | ✅ | ✅ | ❌ refused — personal data is untouchable |
| `fully_managed` | Organisation-owned phone | ✅ | ✅ | ✅ |
| `dedicated` | Field kit / kiosk device | ✅ | ✅ | ✅ |

## 3. Architecture — modules added, modules reused

**Added (v2.13):** `app/modules/enterprise/{models,rules,service,router}.py`,
migration `0017_enterprise_workspaces`, config flag
`ENTERPRISE_DEVICE_COMMANDS_DISPATCH_ENABLED` (default `false`), frontend
`pages/enterprise/EnterprisePage.jsx`, `enterpriseAPI` in `lib/api.js`,
route `/enterprise`, linked from Business (`/me`).

**Reused, not rebuilt:** vendor identity & auth, Business Passport
(verification), groups & vendor lists (an association can still run both),
stock/requests/orders (the marketplace the workspace connects to), growth
plans (a member's own per-business plan is separate from the workspace
plan), payments/custody (workspace billing must ride the licensed-PSP path
when it goes live — no new money code in v2.13), notifications, the map.

**Data:** `enterprise_workspaces`, `enterprise_memberships` (with
`registered_by_vendor_id` for field activity), `managed_devices`,
`device_commands` (append-only audit; enrolment mode snapshotted at
request time). No existing table was altered.

## 4. Pricing in KSh

Workspace plans (`WORKSPACE_PLANS` — enforced server-side, shown at
`GET /api/enterprise/plans` and on `/enterprise`):

| Plan | KSh / month | Annual | Caps | For |
|---|---|---|---|---|
| Kisumu Pilot | 0 | 0 (90 days) | 25 members · 3 field officers · 5 devices | One association + a concentrated local vendor group |
| Association | 24,500 | 245,000 | 200 members · 10 field officers · 30 devices | Trade associations, cooperatives |
| Enterprise / County | 145,000 | 1,450,000 | 2,000 members · 100 field officers · 500 devices | County programmes, large employers |

This sits on top of the existing per-business ladder (Starter free ·
Readiness KSh 2,900 · Network KSh 9,500 · Institution KSh 90,000 per
business/month): the organisation buys the workspace once; a member who
also wants passport reviews or more seats keeps their own plan. Device
hardware, EMM licences and Android Enterprise setup are the organisation's
own contracts — price them as a quoted onboarding service, never bundle a
per-device margin into the workspace fee without a written EMM agreement.
**[Target]** validate willingness to pay in the pilot interviews (below)
before treating these numbers as a price list.

## 5. First launch: Kisumu, concentrated

Start with **one or two associations and a concentrated group of
businesses** — enough active vendors and service providers in one area for
customers to find what they need. Potential places for *market research
and outreach* (not confirmed partners): Maasai Market Kisumu, Riat Market
Business Centre, and the Nyanza Retail & Wholesale Traders community.
Ask vendors and association officials what they would pay for, how they
currently find customers, and which administrative tasks cost them most.

Pilot shape **[Target]**: 1 association on the free Pilot plan · ≤25
members · 2–3 field officers with work-profile phones (their own devices;
no hardware purchase to evaluate) · weekly check of the dashboard against
the association's own paper register · decision at day 90 on the
Association plan. Walk away or re-scope if fewer than half the registered
members are active vendors in the marketplace after 90 days, or if the
association's officials will not pay anything once the pilot ends.

**Privacy (non-negotiable before pilot data is real):** the platform holds
profiles, contact details, work histories and potentially household
information. Keep the existing controls (bearer auth, role-gated records,
no personal device identifiers — devices carry an asset label, never an
IMEI), minimise what field officers can see to their own workspace, and
complete registration with Kenya's Office of the Data Protection
Commissioner (ODPC) where required before onboarding a real association.

## 6. What v2.13 deliberately does not do

- No new consumer app, no second codebase, no MDM: Android Enterprise/EMM
  stays external and Brief_ never claims a device action it did not send.
- No workspace billing collection: plans change entitlements today (the
  growth-module pattern); collecting the KSh waits for the licensed-PSP
  path already specified for trade payments.
- No job-matching changes: blue-collar/freelancer matching continues to
  run through Business Requests and Hustle on the marketplace side; a
  workspace simply gives an employer/association a private view of the
  people it has registered.
