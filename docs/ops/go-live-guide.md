# Go-live guide — what happens on your side

Everything in this branch is code that has been run. This document is the part
only you can do: the accounts, the credentials, the deploy, and the checks that
prove it worked.

Read it top to bottom once before starting. The order matters — §4 and §5 are
where a deploy goes wrong.

| § | Step | Time | Can be skipped? |
|---|---|---|---|
| 1 | Merge the PR | 2 min | no |
| 2 | Run it locally once | 15 min | recommended |
| 3 | Generate the secrets | 2 min | no |
| 4 | Set the environment variables | 10 min | no |
| 5 | Migrate the production database | 5 min | **no — the app needs `0023`** |
| 6 | Deploy and verify | 10 min | no |
| 7 | Claim your operator account | 5 min | no |
| 8 | Turn on real money (Track 1) | hours | when you have PSP keys |
| 9 | Backups and the restore drill | 30 min | no, before taking money |
| 10 | Turn on subscriptions (Track 2) | 1 day | when Track 1 is verified |
| 11 | Pilot with real vendors | weeks | the point of all of it |

---

## 1. Merge the PR

PR **#58** → `main`. Squash or merge, either is fine; there is nothing else in
flight on that branch.

After merging, `main` contains the security fixes. **Do not deploy `main` to
production before §3–§5** — `main` will now refuse to start with the old default
`SECRET_KEY`. That refusal is the feature, but it will look like a broken deploy
if you meet it by surprise.

## 2. Run it locally once

Worth doing before touching production, because it proves the migration and the
new screens on your machine:

```bash
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt -r requirements-dev.txt

# A disposable database. Docker is the least surprising:
docker run -d --name brief-dev -p 5432:5432 \
  -e POSTGRES_USER=brief -e POSTGRES_PASSWORD=brief -e POSTGRES_DB=brief_vendors \
  postgres:16

cp ../.env.example .env          # then set SECRET_KEY (see §3)
alembic upgrade head             # 23 migrations, ends at 0023_subscription_billing
uvicorn app.main:app --reload --port 8000
```

In a second terminal:

```bash
cd frontend && npm install && npm run dev    # http://localhost:5173
```

Register an account, then look at `/brief`, `/payments`, `/billing` and `/legal`
in the sidebar under **Profile**. If those four render, the browser half is fine.

## 3. Generate the secrets

Never reuse the values in `.env.example`, and never put a real value in a file
that git tracks.

```bash
openssl rand -hex 32     # SECRET_KEY — signs every login token
openssl rand -hex 32     # PSP_WEBHOOK_SECRET — only needed once a real PSP is set
openssl rand -hex 24     # METRICS_TOKEN — optional; without it /api/metrics is 404
```

Store them in a password manager now. `SECRET_KEY` cannot be recovered — losing
it only logs everyone out, which is survivable; losing the PSP secret means
re-issuing it in the PSP dashboard.

## 4. Set the environment variables

In the Vercel dashboard → Project → Settings → Environment Variables. Set these
for **Production** (and Preview, if you use previews against a real database).

| Variable | Value | Why |
|---|---|---|
| `ENVIRONMENT` | `production` | Turns every guard on. Set it **last**, after the secrets are in. |
| `SECRET_KEY` | `openssl rand -hex 32` | Startup refuses the default or anything under 32 chars. |
| `DATABASE_URL` | your Supabase URL | Use the **session pooler** (port 5432) for the API. Percent-encode special characters (`@` → `%40`). |
| `PSP_WEBHOOK_SECRET` | `openssl rand -hex 32` | Only required when `PSP_PROVIDER` is not `mock`. Must match the PSP dashboard. |
| `OPERATOR_HANDLES` | your vendor handle | Who may read `/api/ops/*` and dispatch jobs. Empty = nobody, which is safe but blind. |
| `METRICS_TOKEN` | `openssl rand -hex 24` | Or leave it empty and accept `/api/metrics` = 404 in production. |
| `AUTO_CREATE_TABLES` | `false` | Alembic owns the schema. This is the default in production; set it explicitly so nobody "helpfully" turns it on. |
| `ALLOW_SCHEMA_AUTOCREATE_IN_PRODUCTION` | `false` | Only `true` for one first boot on a completely empty database. |
| `CORS_ORIGINS` | your app URL | Not needed when the frontend is served by the API or proxied by Vercel. |
| `REDIS_URL` | your Redis URL | Without it the rate limiter is per-instance, so on Vercel the real limit is *instances × limit*. Worth doing before you have traffic. |

**Order:** add `SECRET_KEY`, `DATABASE_URL`, `PSP_WEBHOOK_SECRET`,
`OPERATOR_HANDLES`, `METRICS_TOKEN` first; add `ENVIRONMENT=production` last, in
the same window as the deploy in §6.

If Supabase hands you a `postgres://` URL, the app rewrites it to the async
driver automatically — but the **password must be percent-encoded** if it
contains `@`, `:`, `/` or `#`.

## 5. Migrate the production database

**This is the step people miss.** On Vercel the FastAPI service starts from
`app/main.py`; the Docker `entrypoint.sh` — which runs `alembic upgrade head` —
is never executed. The app will boot, and then fail on the first query that
touches `subscriptions`.

Run the migration from your machine, pointed at production, **before** the deploy:

```bash
cd backend
export DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
alembic upgrade head        # expect: 0022_local_activity_ledger -> 0023_subscription_billing
```

Then verify what actually landed:

```bash
python scripts/schema_parity.py     # expect: PASS — 114 model tables, 0 missing columns
```

If you already have production data, take a backup first (§9 talks about how),
and note that `0023` is purely additive: two new tables, no existing column
touched, so it is safe to apply while the old code is still serving.

## 6. Deploy and verify

Deploy `main`. Then run these against the real URL — not localhost. Each line
has the answer you are looking for.

```bash
BASE=https://your-app.vercel.app

curl -s $BASE/api/health
# {"status":"ok","database":true,"schema":true,...}

curl -s $BASE/api/brief/morning
# {"detail":"Not authenticated"}   -> correct: the brief needs a token

curl -s $BASE/api/ops/status
# {"detail":"Not authenticated"}   -> correct: operators only

curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/metrics
# 404                              -> correct in production without METRICS_TOKEN
```

If `/api/health` says `"schema":false`, §5 did not run or ran against a
different database than the app is using. If the app returns 500 on every route
and the deploy log ends with `Refusing to start with ENVIRONMENT=production`,
read §3 — that is the guard doing its job.

Then register your real account through the UI and confirm, as a signed-in user:

- `/brief` loads and cites records (an empty brief is a valid answer).
- `/payments` renders "No payments yet".
- `/billing` says **"Recurring billing is not live"** under the mock provider.
- `/legal` shows the export and close-account buttons.

## 7. Claim your operator account

Registration is open, so **the first person to register a handle owns it**. Do
this immediately after the site is reachable, before you share the URL:

1. Register the handle you want as your operator account (e.g. `@yourname`).
2. Set `OPERATOR_HANDLES=yourname` in Vercel and redeploy.
3. Sign in and open `/ops`. You should see the Operations Center, and under it
   the **Activation & usage** panel with the benchmark gate.
4. `curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/ops/measurement` should
   return the funnel, `not_measured`, and `benchmark_gate`.

If you later need a market-ops finance desk (custody, disbursements, disputes),
that is a different allowlist: `MARKET_OPS_ROLES` with roles
`admin,clerk,spotter,negotiator`.

## 8. Turn on real money — Track 1

Only after §9. Do not take a shilling before you know you can restore the
database.

1. **Get merchant credentials** from your PSP (IntaSend or similar): API key,
   API secret, and the webhook signing secret. These are business onboarding
   steps — KYC, settlement account, fees — not code.
2. Set `PSP_PROVIDER=intasend`, `PSP_API_KEY`, `PSP_API_SECRET`,
   `PSP_WEBHOOK_SECRET`, `PSP_BASE_URL` in Vercel.
3. Point the PSP's webhook at `https://your-app.vercel.app/api/payments/webhook`.
   The secret in the dashboard must equal `PSP_WEBHOOK_SECRET` byte for byte.
4. Decide the trade switches deliberately. `TRADE_PAYMENTS_ENABLED=false` and
   `TRADE_SETTLEMENT_ENABLED=false` are the shipping defaults because collecting
   money and paying suppliers are separate legal/financial decisions.
5. **One real transaction, end to end**, with a small amount between two
   accounts you control:
   - buyer pays from the order screen,
   - the receipt appears in `/payments` as **Paid** with the provider's receipt
     number (not before),
   - `POST /api/payments/reconciliation/run` (as market ops) shows the wallet as
     `matched`, not `variance_found`,
   - the ledger row exists in `custody_ledger` for that intent.

That last sequence is the "prove a complete real-money transaction with
reconciliation" gate. Until you have run it, the claim stays **BLOCKED**, no
matter what the code says.

If the provider is unreachable or misconfigured, checkout returns **503** with a
reason — that is the honest failure, and the order stays payable.

## 9. Backups and the restore drill

Do this before §8.

1. In Supabase → Database → Backups, confirm the retention window and whether
   PITR is on. If retention is under 7 days, fix that first.
2. Write the plan name, retention and the date checked into the table at the
   bottom of `docs/ops/runbook.md`.
3. Restore the latest backup into an **isolated** project (never over production),
   then verify it:

```bash
cd backend
DATABASE_URL='postgresql://...isolated-restore...' python scripts/restore_check.py
```

You are looking for the final line:

```
RESTORE CHECK PASSED — schema complete, ledger immutable, no orphans.
```

and exit code 0. Paste that output, with the backup timestamp, into the evidence
row in the runbook. If the ledger line fails, the restore is not usable — stop.

## 10. Turn on subscriptions — Track 2

The state machine is built and tested; **recurring billing is not live** and the
app says so. Once Track 1 is verified with real money:

1. Make sure `PSP_PROVIDER` is a real provider and the scheduler is running —
   `RUN_SCHEDULER=true` on a single container, or `python -m app.worker` as its
   own process on a multi-instance deploy. The worker now runs the subscription
   sweep every minute: trials end, grace lapses, periods close. If neither runs,
   a trial never expires and nobody is ever charged.
2. Run one real subscription charge on your own account and watch it move
   `trialing → active` in `/billing`, with a `subscription` row in
   `revenue_events`.
3. Only then, edit `backend/app/modules/catalog/catalog.py`:
   `TRIAL_TERMS["status"] = "not_yet_live"` → the live value, and update the
   status note. That string is the last honest barrier between "we can bill" and
   "we claim we bill"; flipping it before step 2 makes it a lie in the UI.

On Vercel, `RUN_SCHEDULER` must stay **false** on the API (nothing survives
between requests there) — run the worker as a separate always-on process, or a
scheduled job hitting `POST /api/billing/sweep` with an operator token.

## 11. Pilot with consenting vendors

The code cannot tell you whether any of this is useful. Ten vendors can.

- Recruit small, consent in writing, and start with `/brief` and `/stock`.
- Watch `/ops` → **Activation & usage** weekly: registered → activated →
  repeated. `activated` means a vendor created at least one real record;
  `repeated` means they came back on two different days. Those are the two
  numbers that decide whether the product is being used or merely installed.
- Ask what they would pay for: operational visibility (the brief), trusted
  records (the passport), or reporting. Then price the thing they named, not the
  thing that was easiest to build.
- Do **not** promise a benchmark. The gate refuses below 25 vendors with settled
  trade, and it will keep refusing until the network is real.

## Rollback

- **Bad deploy, app won't start:** Vercel → Deployments → promote the previous
  one. Migrations `0023` is additive, so old code runs fine against the new
  schema.
- **Bad migration:** `alembic downgrade -1` reverses `0023` cleanly (it only
  drops the two billing tables). Anything already sold is lost, so do it before
  taking money, not after.
- **Rotated `SECRET_KEY` by accident:** every user is logged out. Nothing is
  lost; they sign in again.
- **PSP is misbehaving:** set `PSP_PROVIDER=mock` and redeploy to stop new
  charges while you investigate. Existing intents remain and reconcile from the
  ledger.

## Things not to do

- Don't commit `.env`, PSP keys, or a database password. `.gitignore` already
  covers `.env`; `.env.example` must keep its placeholder values.
- Don't set `ALLOW_SCHEMA_AUTOCREATE_IN_PRODUCTION=true` "just for now". It is a
  one-boot escape hatch for an empty database.
- Don't turn `ENVIRONMENT=production` off to make a startup error go away. The
  error is the security boundary; fix the secret instead.
- Don't widen `OPERATOR_HANDLES` to a handle you have not registered yourself.
- Don't claim live payments or subscriptions until §8 step 5 and §10 step 2 have
  actually run.
