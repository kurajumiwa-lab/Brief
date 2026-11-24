# Wasta rebrand record

**Status:** Phase 1 (brand core) complete. Phases 2–6 not started.
**Branch of record:** `arena/c9480888-brief`, branched from `8450c9f`.
**Deployed:** no. Production remains `8450c9f`.

This document is an **append**. Earlier records — `docs/PRODUCT-ARCHAEOLOGY.md`,
`docs/REBUILD-LOG.md`, `docs/OGALLO-REDESIGN-AUDIT.md` and the rest — are left
exactly as written. They describe the product under the names it had at the
time. Rewriting them would destroy the audit trail this project has relied on
repeatedly.

---

## The name

| | |
|---|---|
| Name | **Wasta** |
| Tagline | The power of the right connections. |
| Sub-line | Find opportunities. Meet the right people. Get things done. |
| Category | A network for people who make business happen. |
| Splash line | The right connections. |
| Parent attribution | **Ogallo** — retained |

The five pillars are Connections, Opportunities, Trust, Access and Progress.

### What the name means, and the obligation that comes with it

"Wasta" (واسطة) is Arabic for *connections* — knowing someone who can help get
something done. In parts of the Middle East the same word carries a strong
negative charge, covering favouritism and cronyism. A Dubai professional-
networking startup also uses the name and has publicly targeted Africa.

The name was chosen deliberately, not in ignorance of that. The distinction the
brand must keep is the one that makes it legitimate:

> **Wasta helps people access opportunities. It does not manufacture credentials,
> manipulate rankings or reward dishonest dealings.**

And the point of the network, in the owner's words: *a small trader should be
able to find the supplier that a well-connected business already knows.*

**Outstanding, not closed by this document:** trademark clearance, domain
availability, and market reception testing in Nairobi (Swahili/Sheng) and at
least one other East African market. Choosing the name is not proof it is
available.

---

## Product honesty: what is claimed vs what ships

The tagline promises connections. Audited against the code, this is what
actually exists:

| Claimed | Module | State |
|---|---|---|
| Find suppliers and providers | `network_search`, `service_directory` | Shipped, permission-aware SQL |
| Named endorsements | `merit` / `TrustEndorsement` | Shipped — endorser's name is shown, append-only |
| Referral attribution | `referrals` | Shipped — stays *pending* until a receipt verifies |
| **Introductions (A introduces B to C)** | — | **Not built** |

Because introductions are not built, the paid **Network** plan's bullet
advertising *"consent-based introductions"* (`backend/app/modules/growth/rules.py`)
overstates what the tier delivers. Phase 1 did **not** change it — that is a
backend copy change outside this scope, and it remains open.

### Integrity rules for all future Wasta copy

1. Never claim an introduction the product did not make.
2. No paid organic advantage. **Clearly labelled advertising and featured
   placements may exist** — but payment must never buy an organic trust score,
   an endorsement, a verification badge or an undisclosed ranking advantage.
3. Every trust claim names its source.
4. Say "access", never "advantage".
5. Avoid the idiom "who you know" — in Arabic-context reading that *is* the
   corruption framing.
6. Never use the word to mean special treatment.
7. In Swahili comms, lead with the benefit rather than transliterating the
   Arabic term.

---

## Phase 1 — what changed

### Brand configuration (`frontend/src/config/brand.js`)
- `name`, `wordmark`, `short` → `"Wasta"`.
- `tagline` → `"The power of the right connections."`
- `shortLine` **added** → `"The right connections."`, because the full tagline
  is 35 characters and the splash renders it at `text-2xs` inside `max-w-xs`
  with `px-8`, where it wraps and truncates. The short line is 22.
- `parent` → **unchanged** (`"Ogallo"`).
- `domain` → `""`. `vendorworld.ke` was never registered and no deployment
  sets `VITE_PAGE_DOMAIN`, so `pageAddress()` was printing an address that did
  not answer. It now falls back to `/p/{handle}`, which does. `pageUrl()`
  already returned working links, so **no shared link changed**.
- `legacyDomain` → unchanged, per instruction.

### Metadata (`frontend/index.html`)
Title, `og:title`, `description` and `og:description` → Wasta. This also fixed a
pre-existing defect: `og:title` had been reading **"Home Office — …"**, so every
shared link previewed under a name retired several rebrands ago.

`localStorage.getItem("brief-theme")` was **deliberately not renamed**. It is a
live storage key; changing it would silently reset every returning user's
dark/light preference for no branding benefit.

### Bilingual copy (`frontend/src/lib/i18n.js`)
20 occurrences across 8 string pairs, English **and** Swahili. `Brief Trust` →
`Wasta Trust` in both languages. Two negative statements were rewritten
character-for-character in meaning, because inverting them would be a safety and
honesty defect, not a rebrand:

- *"Wasta does not set or hold any money."* / *"Wasta haiweki wala kushika pesa yoyote."*
- *"Wasta has not checked this rider."* / *"Wasta haijamhakiki rider huyu."*

### Splash (`frontend/src/components/system/BootSplash.jsx`)
Now renders `BRAND.shortLine`.

### Fallbacks (`pages/storefront/BusinessDeskPage.jsx`, `lib/failure.js`)
`{BRAND.wordmark || "Brief"}` → `{BRAND.wordmark}`: the fallback would have
silently resurrected the old name if the config failed to load. Four rendered
error strings in `failure.js` now name the platform Wasta — including
*"Wasta answered, but couldn't build …"*, which must stay a failure message.

### `pages/auth/AuthPage.jsx`
**No change required.** It already reads `BRAND.wordmark` in both places (lines
164 and 203) and contained no hardcoded brand string.

### Regression guard (`frontend/src/test/brand.test.js`)
Rewritten deliberately rather than deleted. It now asserts the Wasta
configuration, the parent attribution, the splash-line length, the empty domain,
and agreement between config and `index.html`.

**It is not a blanket substring check.** Three legitimate uses of the English
word must survive: **Morning Brief** (a feature), **`/brief`** (a route that
still redirects to `/me`), and **`label="Brief"`** on the event form (a post's
short description). The guard therefore (a) requires the brand-core files to be
clean, and (b) holds the remaining user-facing strings to a recorded
`PHASE_2_BACKLOG` ceiling that may shrink but never grow.

---

## Explicitly NOT changed in Phase 1

No change to: home office naming or routing, navigation, routes, API contracts,
database structures, migrations, permissions, roles, financial settings, feature
flags, environment variables, integrations, deployment configuration,
`logo.svg`, `favicon.svg`, or any artwork. The house mark is retained
temporarily.

Also unchanged, by instruction:

- `"platform": "Brief"` in the `/api` root response. Nothing in this repository
  reads it — `pos-extension` does not, the frontend never fetches bare `/api`,
  and no backend test asserts it. Left alone anyway until external consumers are
  confirmed.
- All `BRIEF_*` environment variables (`BRIEF_API`, `BRIEF_EMAIL`,
  `BRIEF_PASSWORD`, `BRIEF_TOKEN`, `BRIEF_STATE_FILE`, `BRIEF_HEALTH_FILE`) and
  the `X-Brief-Network` response header. These are integration contracts with
  installed POS software; migrating them is a separate, separately approved
  project.

---

## Phase 2 backlog — user-facing strings still saying Brief

Recorded so the work is visible and cannot regress. This is a ceiling, not a
target.

Highest external visibility first:

1. **`pages/events/PublicRateCardPage.jsx`** — renders the wordmark on an
   **unauthenticated** page.
2. `components/you/PortfolioView.jsx` — "Powered by Brief" (the footer of every
   public profile), plus "Checked by Brief", "A page on Brief".
3. `components/discover/MarketplaceHero.jsx`, `ShopToolbar.jsx`,
   `HowBriefWorks.jsx` (component name is internal; its rendered strings are not).
4. `pages/trust/*` and `components/trust/TrustSignals.jsx` — trust copy.
5. Money statements, which must keep their meaning: `CounterShelf.jsx`,
   `EventForm.jsx`, `PaymentTag.jsx`, `EventPaymentCard.jsx`,
   `ReferralsPage.jsx`, `PriceWorkPage.jsx`, `PageEditor.jsx`,
   `MeritPage.jsx`, `JobsPages.jsx`.
6. `lib/tradeRecordsCsv.js` and `TradeRecordsPage.jsx` — the exported CSV
   disclaimer.
7. `pages/referrals/ReferralLandingPage.jsx`, `pages/trades/*`,
   `pages/enterprise/EnterprisePage.jsx`, and the remainder of the list held in
   `brand.test.js`.

**Deliberately left alone in Phase 2:** `components/layout/Sidebar.jsx`'s
`"Tasks & Brief"` label and the `/brief` route labels in `SurfaceFeed.jsx` and
`TaskTrack.jsx`, which name the **workspace/feature**, not the product. These
need a naming decision, not a replacement.

---

## Open items

| # | Item | Owner |
|---|---|---|
| 1 | Trademark clearance (KE/EAC) | Owner |
| 2 | Domain availability and purchase | Owner |
| 3 | Market reception testing — Nairobi + one other market | Owner |
| 4 | Reword the paid Network tier's "consent-based introductions" bullet | Backend, unapproved |
| 5 | New visual identity; retire the house mark | Owner review |
| 6 | Home Office / My Work naming | Deferred |
| 7 | Operators visibility investigation | Separate project |
| 8 | `BRIEF_*` env var and header migration | Separate project |
