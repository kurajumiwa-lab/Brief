# Load testing Brief_

Two harnesses, same scenario, same SLOs. Both drive the read paths a vendor
actually uses — network stock, their own shelf and movements, notifications,
analytics, tools and lists — and both fail loudly when latency or errors cross
the line.

| Harness | Needs | Use it when |
| --- | --- | --- |
| `brief_load.py` | nothing but the repo (`httpx` ships with `backend/requirements-dev.txt`) | default; runs in CI, prints a route table, can gate a deploy |
| `k6-brief.js` | [k6](https://k6.io) installed | you already run k6 and want its dashboards/cloud output |

## Python harness

```bash
# smoke — 2 vendors, 40 requests, relaxed SLO (what CI runs)
python loadtest/brief_load.py --smoke

# real run against staging
python loadtest/brief_load.py \
  --base-url https://staging.example.com \
  --vendors 25 --duration 60 --p95 800 --error-rate 2

# reuse one account instead of registering per vendor
python loadtest/brief_load.py --email me@example.com --password 'My-pass-9?'
```

Exit codes: `0` SLO met · `1` SLO missed (`--p95` / `--error-rate`) · `2` the
target was unreachable or no token could be obtained.

Useful flags: `--requests N` (fixed budget instead of `--duration`),
`--think 0.2` (pause between a vendor's calls), `--json out.json` (raw summary
for a dashboard or CI artefact), `--token` (reuse an existing bearer token).

**Auth rate limiting is real.** `/api/auth/*` allows 20 requests/minute/IP by
default, and each virtual vendor registers once. Keep `--vendors ≤ 20`, reuse
an account (`--email`), or raise `RATE_LIMIT_AUTH` on the target. The harness
prints a clear hint when registration is rejected.

## k6

```bash
BASE_URL=https://staging.example.com VENDORS=25 k6 run loadtest/k6-brief.js
```

Thresholds live in the script: `http_req_failed < 2%`, `p(95) < 800 ms`,
`p(99) < 2000 ms`. Registration happens in `setup()` for the same rate-limit
reason.

## Reading the results

The run prints per-route request counts, rps, p50/p95/p99 and status mix, then
totals and any sample errors. Compare against the live server-side view in the
**Ops** page (`/api/ops/status`) or scrape `/api/metrics` while the run is in
flight — the client-side table and the server-side registry should agree on
which routes are slow.

Docker Compose in `deploy/monitoring/` brings up Prometheus + Grafana wired to
`/api/metrics` if you want the load test to show up on a graph.
