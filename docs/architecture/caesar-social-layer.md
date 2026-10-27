# Caesar on Brief — how the social layer becomes real

**Decision:** Caesar is **Brief's social layer** — conversation alongside commerce,
for the same traders. It should eventually run on Brief's accounts rather than a
`localStorage` prototype.

**Status:** architecture plan. No code in this document.
**Baseline:** `main` @ `8965ea3` + PR #61 (media plan). Caesar suite 131 green.

---

## 1. What this changes

Caesar today is 37 source files with no server: one hard-coded viewer (`@amina`),
state in `localStorage`, and three promises kept by a pure module. Making it a
layer of Brief means those promises move from *the client chooses to keep them*
to *the server enforces them* — which is the only version that survives a
refactor.

The good news, and the reason this is 2–3 weeks rather than a rewrite: **Brief
already has most of the hard parts**, and three of them map onto Caesar almost
without translation.

---

## 2. What Brief already provides (verified, with anchors)

| Need | Exists | Anchor | Fit |
|---|---|---|---|
| Accounts, sessions | JWT bearer, `get_current_vendor` dependency, refreshed tokens | `app/routes/auth.py:95-120` | Direct |
| Identity | `Vendor` — handle, city, role, `network_score`, `parasitism_index` | `app/models/vendor.py` | Direct |
| **Circles** | `VendorGroup` — slug, `group_type` (niche / regional / trade / sourcing / event / open), `rules` JSONB, `region`, `is_public`, `requires_approval`, `max_members` | `app/models/groups.py:27-50` | **Almost 1:1** |
| **Media storage** | `MediaObject` — content-addressed by `sha256`, `byte_size`, `content_type`, bytes in Postgres | `app/models/media.py:31-40` | **Better than planned** |
| Discussion primitives | `ChatRoom`, `ChatMessage` | `app/models/chat.py:33-80` | Reusable patterns |
| **Moderation / appeals** | `GovernanceProposal` — quorum, approval thresholds, status lifecycle, authority levels | `app/models/governance.py` | **Appeals can live here** |
| File serving | `/static` router, `HEAD` supported | `app/routes/files.py`, `app/routes/media.py` | Direct |
| Migrations | Alembic, head `0024_media_objects` | `alembic/versions/` | Direct |

Two findings worth pausing on:

**a. `MediaObject` is content-addressed.** `sha256` as a column with `byte_size`
means the same photo posted by forty traders is stored **once**. Caesar's client-side
plan had to invent dedupe; the server already has it. PR B's IndexedDB work
therefore shrinks to a *cache*, not the source of truth.

**b. `VendorGroup` is Caesar's Circle.** Rules-before-join, region, approval,
capacity — the Circle screen maps onto fields that already exist. The new work is
not "circles", it is "what is posted *into* a circle".

---

## 3. What does not exist and must be built

| Caesar concept | Today | New tables |
|---|---|---|
| Post | nothing | `social_posts` — author, circle (→ `vendor_groups.id`), body, lang, media ref, status, created_at |
| Reaction | nothing | `social_reactions` — post, vendor, value (up/down), created_at, **unique (post, vendor)** |
| Verdict | computed client-side | **not stored** — computed per request from reactions (see §4.3) |
| Report | nothing | `social_reports` — post, reporter, reason, status, case number |
| Block / mute | nothing | `social_blocks` — vendor, target, kind (block / mute) |
| Appeal | `GovernanceProposal` could hold it | `social_appeals` — report ref, author, statement, status |
| Word filter / scope | nothing | defer to P2 |

---

## 4. Five decisions before any code

### 4.1 Does participation require being a vendor?

**Every Brief account is a vendor** (`vendor.py:14`: *"Every user is a vendor"*).
Brief is blunt that "there is no shopper side". So on current accounts, **you
cannot comment unless you are a registered business**.

That is fine if Caesar's community *is* traders — the seed circles are literally
Kisumu Market Traders and Kilimo Youth Network. It is fatal if Caesar is meant to
reach the general public, because the brief's promise is "every community has a
voice", and a business licence is not a voice credential.

**Recommendation:** ship P0 gated on vendor accounts, and treat "reader accounts"
as an explicit P3 decision with its own migration. Do not quietly widen `Vendor`
into "user" — 44 pages and the whole ledger assume a business.

### 4.2 Social reputation must not touch `network_score`

Brief already computes `network_score` from fulfilment, reciprocity, contribution
and reliability — trade money, essentially. Caesar computes *useful contribution*
from reactions.

**These must stay separate.** One number that mixes "delivers on time" with
"writes good posts" would make a reliable supplier look unreliable for a
disagreement, and a popular poster look safe to trade with. Keep them in separate
tables with separate names, and never render them adjacent without saying which
is which.

### 4.3 Ranking moves to the server, and stays explainable

The prototype's `ranking.js` is pure and already testable; it ports to Python as
a straight translation (`wilson_lower`, `score_post`, `rank_posts`) with the
**same published weights**. The client must never compute the order — a feed the
client sorts is a feed the client can lie about.

The API returns the score *and its four parts* per post, so `/measure` and the
Verdict panel keep working from server truth:

```
{ post_id, score, parts: { confidence, participation, recency, circle_fit },
  up, down, contested, coordination: { suspected, count }, needs_more_voices }
```

### 4.4 Circles: reuse `vendor_groups`, or a new `social_circles`?

**Reuse.** A Circle is a `VendorGroup` with `rules` already in JSONB. Creating a
parallel table would give two kinds of membership, two moderation paths, and two
answers to "who is in this room".

Consequence: existing groups become Circles, which is probably desirable — the
traders' groups already converse in `chat`. The mapping needs an explicit
`social_enabled` flag so not every sourcing group suddenly gets a public feed.

### 4.5 Appeals: `GovernanceProposal` or a new table?

Tempting to reuse — it already has quorum and approval thresholds. But governance
is about **binding decisions with a vote**, and an appeal is a **case with two
parties and a deadline**. Recommend a separate `social_appeals` that *links* to
governance when a decision is escalated, rather than overloading a proposal.

---

## 5. Phases, each shippable

| Phase | Work | Verification | Est. |
|---|---|---|---|
| **C0** ✅ | Port `ranking.js` to Python as a pure module, no DB; 34 specs including a JS-generated parity fixture | `pytest` — 34 passed | **done** |
| **C1** | `social_posts`, `social_reactions`, `social_reports`, `social_blocks` + migration `0025`; CRUD routes; membership checks | Backend suite (**needs Postgres** — see §6) | 5–7 d |
| **C2** | Caesar's store swaps `localStorage` for the API; real JWT session; media upload to `MediaObject` instead of IndexedDB | Caesar suite + a contract test per endpoint | 4–5 d |
| **C3** | Feed embedded in Brief's `frontend/` as a community surface, sharing auth and the home tile | Frontend suite + manual | 5 d |

C0 is deliberately database-free, which makes it **the one phase I can actually
build and verify in this environment**. That is where the next PR starts.

---

## 6. What actually runs here — corrected after measuring

The first draft of this section claimed backend tests could not run in this
sandbox because there is no Postgres. **That was wrong**, and it is worth
recording why, because it changes the delivery plan:

- No *system* Postgres — true: `initdb`, `pg_ctl` and `postgres` are all absent.
- But `backend/requirements-dev.txt` already depends on **`pgserver`**, a pip
  package that ships PostgreSQL 16 binaries, and `tests/conftest.py:20-24`
  starts a throwaway cluster with it. A venv plus the requirements file is
  enough, and `pip` is reachable here.

Measured, not assumed:

| Suite | Result |
|---|---|
| `tests/test_verdict.py` (new) | **34 passed** |
| whole backend | **376 passed** in 2m 20s |

So the split I proposed was too pessimistic: **C0 and C1 are both verifiable
here.** What stays unverifiable is only what needs a real device or a deployed
environment — device capture (media plan §7d) and the Vercel smoke test.

---

## 7. Risks to the prototype's integrity

The three promises must survive the move, or the move is a downgrade:

1. **Disagreement ≠ abuse.** Today it is *structurally impossible* for a downvote
   to hide a post, because visibility has exactly three causes and none is a
   reaction. In SQL this becomes an invariant worth a test: `visible(post)`
   mentions only `status`, blocks and mutes — never counts.
2. **Contested posts stay.** The floor (0.25) must live in the server ranking and
   in a test that fails if a contested post is ever absent from a ranked feed.
3. **No follower counts.** There is no table for them, which is the strongest
   form of the rule. Keep it that way when adding profile fields.

---

## 8. C0 — delivered

```
backend/app/services/verdict.py            RANKING, wilson_lower, burst_window,
                                           compute_verdict, score_post, rank_posts,
                                           visible_posts, why_this_appears
backend/tests/test_verdict.py              34 specs
backend/tests/fixtures/verdict_parity.json 9 cases generated by ranking.js itself
```

The parity fixture is the interesting part. Rather than port the JavaScript and
hope, the expected numbers were **produced by running `ranking.js`** over nine
scenarios (consensus, contested, month-old dogpile, a 14-reaction burst, a
two-reaction sample, a first-time account, an outside-circle post, an empty
post, a strong sample) and committed as JSON. The Python test recomputes from
the same inputs and asserts equality to 1e-9, including the full sort order —
`consensus > strong-sample > outside-circle > contested > burst > new-account-only
> small-sample > empty > dogpiled-old`.

All twelve published constants are compared key by key, so re-tuning a weight in
one language and not the other fails the build.

Nothing imports the module yet: no route, no model, no migration. C1 is next.
