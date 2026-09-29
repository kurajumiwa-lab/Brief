#!/usr/bin/env python3
"""
Brief_ load-test harness (Directive v2.1 §6.2 — monitoring & load testing).

Drives concurrent virtual vendors against a running API, measures the
endpoints a real vendor touches, and exits non-zero when the SLOs are missed —
so it can gate a deploy from CI just as well as it can explore a staging box.

    # smoke (CI-friendly): 2 vendors, 40 requests, generous SLO
    python loadtest/brief_load.py --smoke

    # a real run: 25 vendors for 60s against production-like data
    python loadtest/brief_load.py --base-url https://staging.brief.example \\
        --vendors 25 --duration 60 --p95 800 --error-rate 2

    # reuse one account instead of registering (avoids the 20/min auth limit)
    python loadtest/brief_load.py --email me@example.com --password 'My-pass-9?'

Design notes
------------
* httpx only — the same client the test suite uses, no extra dependency.
* The scenario mix mirrors how vendors actually use the network: browse stock,
  read their own shelf and movements, check notifications and analytics.
* Auth rate limiting is real: registering >20 vendors from one IP hits 429.
  Either pass `--vendors 20`, reuse an account with `--email/--password`, or
  raise RATE_LIMIT_AUTH on the target.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import statistics
import sys
import time
import uuid
from collections import defaultdict

try:
    import httpx
except ImportError:  # pragma: no cover - developer hint
    sys.exit("httpx is required: pip install -r backend/requirements-dev.txt")

PASSWORD = "Load-9test"
# (weight, method, path, needs_auth)
SCENARIO = [
    (34, "GET", "/api/stock/network-stock", True),
    (16, "GET", "/api/stock/my-stock", True),
    (12, "GET", "/api/analytics/overview", True),
    (10, "GET", "/api/notifications", True),
    (9, "GET", "/api/vendors/network", True),
    (7, "GET", "/api/tools/browse", True),
    (6, "GET", "/api/vendor-lists/browse", True),
    (3, "GET", "/api/movements", True),  # wrapped by stock router below
    (3, "GET", "/api/health", False),
]
WEIGHTS, METHODS, PATHS, AUTHED = zip(*SCENARIO)

# `GET /api/movements` is not a route; the stock module owns it. Kept out of the
# weighted list above and mapped here so the scenario stays readable.
FIXUPS = {"/api/movements": "/api/stock/movements"}


class Stats:
    def __init__(self):
        self.latencies: dict[str, list[float]] = defaultdict(list)
        self.statuses: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
        self.errors: list[str] = []
        self.started = time.perf_counter()
        self.count = 0
        self.completed = 0

    def record(self, key: str, status: int, ms: float, error: str | None = None):
        self.count += 1
        self.completed += 1
        self.latencies[key].append(ms)
        self.statuses[key][status] += 1
        if error:
            self.errors.append(f"{key} → {status} {error[:160]}")

    @staticmethod
    def _percentile(values: list[float], pct: float) -> float:
        if not values:
            return 0.0
        ordered = sorted(values)
        idx = min(len(ordered) - 1, int(round((pct / 100) * (len(ordered) - 1))))
        return ordered[idx]

    def summary(self) -> dict:
        elapsed = max(0.001, time.perf_counter() - self.started)
        everything = [ms for rows in self.latencies.values() for ms in rows]
        failed = sum(
            count for statuses in self.statuses.values() for status, count in statuses.items() if status >= 400
        )
        routes = []
        for key, rows in sorted(self.latencies.items(), key=lambda kv: -len(kv[1])):
            stat = {
                "route": key,
                "requests": len(rows),
                "rps": round(len(rows) / elapsed, 2),
                "p50_ms": round(self._percentile(rows, 50), 1),
                "p95_ms": round(self._percentile(rows, 95), 1),
                "p99_ms": round(self._percentile(rows, 99), 1),
                "max_ms": round(max(rows), 1),
                "statuses": {str(k): v for k, v in sorted(self.statuses[key].items())},
            }
            routes.append(stat)
        return {
            "requests": self.count,
            "failures": failed,
            "error_rate_pct": round(100.0 * failed / self.count, 2) if self.count else 0.0,
            "rps": round(self.count / elapsed, 2),
            "elapsed_s": round(elapsed, 2),
            "p50_ms": round(self._percentile(everything, 50), 1),
            "p95_ms": round(self._percentile(everything, 95), 1),
            "p99_ms": round(self._percentile(everything, 99), 1),
            "max_ms": round(max(everything), 1) if everything else 0.0,
            "mean_ms": round(statistics.fmean(everything), 1) if everything else 0.0,
            "routes": routes,
            "sample_errors": self.errors[:8],
        }


async def register(client: httpx.AsyncClient, base: str) -> str | None:
    suffix = uuid.uuid4().hex[:8]
    body = {
        "business_name": f"Load Vendor {suffix}",
        "vendor_handle": f"load_{suffix}",
        "email": f"load_{suffix}@example.com",
        "password": PASSWORD,
        "business_categories": ["fresh produce"],
        "physical_location": "Nairobi",
    }
    r = await client.post(f"{base}/api/auth/register", json=body)
    if r.status_code != 201:
        print(f"  ! register failed ({r.status_code}): {r.text[:200]}")
        return None
    return r.json().get("access_token")


async def login(client: httpx.AsyncClient, base: str, email: str, password: str) -> str | None:
    r = await client.post(
        f"{base}/api/auth/login",
        data={"username": email, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    if r.status_code != 200:
        print(f"  ! login failed ({r.status_code}): {r.text[:200]}")
        return None
    return r.json().get("access_token")


async def vendor_loop(
    client: httpx.AsyncClient, base: str, token: str, deadline: float, stats: Stats, think: float, budget: list[int]
):
    headers = {"Authorization": f"Bearer {token}"}
    rng = random.Random(token[-6:])
    while time.perf_counter() < deadline and budget[0] > 0:
        budget[0] -= 1
        path = rng.choices(PATHS, weights=WEIGHTS, k=1)[0]
        method = METHODS[PATHS.index(path)]
        needs_auth = AUTHED[PATHS.index(path)]
        resolved = FIXUPS.get(path, path)
        url = f"{base}{resolved}"
        started = time.perf_counter()
        try:
            r = await client.request(method, url, headers=headers if needs_auth else None)
            ms = (time.perf_counter() - started) * 1000
            stats.record(f"{method} {resolved}", r.status_code, ms)
        except Exception as exc:  # network-level failure
            ms = (time.perf_counter() - started) * 1000
            stats.record(f"{method} {resolved}", 0, ms, error=type(exc).__name__)
        if think:
            await asyncio.sleep(think)


async def main() -> int:
    ap = argparse.ArgumentParser(description="Brief_ load-test harness")
    ap.add_argument("--base-url", default="http://localhost:8000")
    ap.add_argument("--vendors", type=int, default=8, help="concurrent virtual vendors")
    ap.add_argument("--duration", type=float, default=15.0, help="seconds to keep each vendor busy")
    ap.add_argument("--requests", type=int, default=0, help="total request budget instead of --duration")
    ap.add_argument("--think", type=float, default=0.05, help="seconds between a vendor's requests")
    ap.add_argument("--email", help="reuse an existing account instead of registering")
    ap.add_argument("--password", default=PASSWORD)
    ap.add_argument("--token", help="reuse an existing bearer token")
    ap.add_argument("--p95", type=float, default=750.0, help="fail when p95 exceeds this (ms)")
    ap.add_argument("--error-rate", type=float, default=2.0, help="fail when the error rate exceeds this (%)")
    ap.add_argument("--json", help="write the raw summary to this path")
    ap.add_argument("--smoke", action="store_true", help="tiny CI-friendly run with relaxed SLOs")
    args = ap.parse_args()

    if args.smoke:
        args.vendors = min(args.vendors, 2)
        args.requests = args.requests or 40
        args.duration = max(args.duration, 20)
        args.p95 = max(args.p95, 2500.0)
        args.error_rate = max(args.error_rate, 10.0)

    base = args.base_url.rstrip("/")
    stats = Stats()
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        try:
            health = await client.get(f"{base}/api/health")
        except Exception as exc:
            print(f"✗ cannot reach {base}: {exc}", file=sys.stderr)
            return 2
        if health.status_code != 200:
            print(f"✗ {base}/api/health answered {health.status_code}", file=sys.stderr)
            return 2

        tokens: list[str] = []
        if args.token:
            tokens = [args.token]
        elif args.email:
            token = await login(client, base, args.email, args.password)
            if token:
                tokens = [token]
        else:
            for _ in range(args.vendors):
                token = await register(client, base)
                if token:
                    tokens.append(token)
                elif not tokens:
                    print("✗ could not obtain a token (auth rate limit?) — try --email/--password", file=sys.stderr)
                    return 2
        if not tokens:
            print("✗ no usable tokens", file=sys.stderr)
            return 2

        print(f"→ {base} · {len(tokens)} virtual vendor(s) · "
              f"{'%ds' % args.duration if not args.requests else '%d requests' % args.requests}")
        budget = [args.requests or 10**9]
        deadline = time.perf_counter() + args.duration
        started = time.perf_counter()
        await asyncio.gather(*[
            vendor_loop(client, base, token, deadline, stats, args.think, budget) for token in tokens
        ])
        elapsed = time.perf_counter() - started

    summary = stats.summary()
    summary["target"] = base
    summary["virtual_vendors"] = len(tokens)
    summary["wall_seconds"] = round(elapsed, 2)

    print("\n%-34s %7s %8s %8s %8s %8s  %s" % ("route", "reqs", "rps", "p50", "p95", "p99", "statuses"))
    for row in summary["routes"]:
        print("%-34s %7d %8.2f %8.1f %8.1f %8.1f  %s" % (
            row["route"], row["requests"], row["rps"], row["p50_ms"], row["p95_ms"], row["p99_ms"],
            ",".join(f"{k}×{v}" for k, v in row["statuses"].items()),
        ))
    print(
        f"\ntotal {summary['requests']} requests in {summary['elapsed_s']}s · {summary['rps']}/s · "
        f"p50 {summary['p50_ms']}ms · p95 {summary['p95_ms']}ms · p99 {summary['p99_ms']}ms · "
        f"errors {summary['error_rate_pct']}%"
    )
    if summary["sample_errors"]:
        print("sample errors:")
        for line in summary["sample_errors"]:
            print(f"  · {line}")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2)
        print(f"→ wrote {args.json}")

    failures = []
    if summary["p95_ms"] > args.p95:
        failures.append(f"p95 {summary['p95_ms']}ms > {args.p95}ms")
    if summary["error_rate_pct"] > args.error_rate:
        failures.append(f"error rate {summary['error_rate_pct']}% > {args.error_rate}%")
    if failures:
        print("✗ SLO missed: " + "; ".join(failures), file=sys.stderr)
        return 1
    print("✓ SLO met")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
