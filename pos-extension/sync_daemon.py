#!/usr/bin/env python3
"""
Brief_ POS sync daemon — runs on the shop computer and keeps a push-type POS
connection (csv / manual / custom_api, or a locally-read Square/Shopify) in
step with your shelf on the vendor network.

    # one-off push of a CSV export
    python sync_daemon.py --api https://your-brief.example --connection <id> \
        --adapter csv --file exports/stock.csv --once

    # keep watching the file, push whenever it changes (every 60s)
    python sync_daemon.py --api https://your-brief.example --connection <id> \
        --adapter csv --file exports/stock.csv --interval 60

    # Square token that stays local
    python sync_daemon.py --connection <id> --adapter square \
        --access-token $SQUARE_TOKEN --location-id L123 --interval 300

Credentials: pass --token <jwt>, or --email/--password (or BRIEF_EMAIL /
BRIEF_PASSWORD in the environment) and the daemon logs in for you. Access
tokens are renewed with the refresh token, so a daemon started with a
password keeps running for as long as the shop computer does.

Long-running behaviour (v2.1): exponential back-off on failures (capped at
10 minutes), clean stop on SIGTERM/SIGINT, `--state-file` remembers the last
pushed fingerprint across restarts and `--health-file` writes a small JSON
status after every pass (Docker's healthcheck reads it).
"""

from __future__ import annotations

import argparse
import getpass
import json
import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone

import httpx

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from adapters import ADAPTERS  # noqa: E402

log = logging.getLogger("brief.sync")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Push local POS stock to the Brief_ vendor network")
    p.add_argument("--api", default=os.environ.get("BRIEF_API", "http://localhost:8000"), help="Brief_ base URL")
    p.add_argument("--connection", required=True, help="POS connection id from the POS Bridge page")
    p.add_argument("--adapter", choices=sorted(ADAPTERS), default="csv")
    p.add_argument("--interval", type=int, default=0, help="seconds between passes; 0 or --once pushes a single time")
    p.add_argument("--once", action="store_true")
    p.add_argument("--force", action="store_true", help="push even when nothing changed")
    p.add_argument("--state-file", default=os.environ.get("BRIEF_STATE_FILE"), help="remember the last pushed fingerprint here")
    p.add_argument("--health-file", default=os.environ.get("BRIEF_HEALTH_FILE"), help="write pass status JSON here (healthcheck)")
    p.add_argument("--max-backoff", type=int, default=600, help="cap for the failure back-off in seconds")
    # auth
    p.add_argument("--token", default=os.environ.get("BRIEF_TOKEN"))
    p.add_argument("--email", default=os.environ.get("BRIEF_EMAIL"))
    p.add_argument("--password", default=os.environ.get("BRIEF_PASSWORD"))
    # adapter options
    p.add_argument("--file", help="csv/manual: path to the export")
    p.add_argument("--encoding", default="utf-8-sig")
    p.add_argument("--access-token", default=os.environ.get("POS_ACCESS_TOKEN"), help="square/shopify token")
    p.add_argument("--location-id", help="square location")
    p.add_argument("--shop-domain", help="shopify: mystore.myshopify.com")
    p.add_argument("-v", "--verbose", action="store_true")
    return p


def make_adapter(args):
    kind = args.adapter
    if kind == "csv":
        if not args.file:
            sys.exit("--file is required for the csv adapter")
        return ADAPTERS[kind](file=args.file, encoding=args.encoding)
    if kind == "manual":
        return ADAPTERS[kind](file=args.file or "stock.json")
    if kind == "square":
        if not args.access_token:
            sys.exit("--access-token is required for square")
        return ADAPTERS[kind](access_token=args.access_token, location_id=args.location_id)
    if kind == "shopify":
        if not (args.access_token and args.shop_domain):
            sys.exit("--access-token and --shop-domain are required for shopify")
        return ADAPTERS[kind](shop_domain=args.shop_domain, access_token=args.access_token)
    sys.exit(f"unknown adapter {kind}")


class BriefClient:
    def __init__(self, base_url: str, token: str | None):
        self.http = httpx.Client(base_url=base_url.rstrip("/"), timeout=60)
        self.token = token
        self.refresh_token: str | None = None

    def login(self, email: str, password: str) -> None:
        r = self.http.post("/api/auth/login", data={"username": email, "password": password})
        if r.status_code != 200:
            raise PermissionError(f"login failed: {r.status_code} {r.text[:200]}")
        body = r.json()
        self.token, self.refresh_token = body["access_token"], body.get("refresh_token")
        log.info("signed in as @%s", body.get("vendor_handle"))

    def refresh(self) -> bool:
        """Renew the access token with the refresh token; False when we need a full login."""
        if not self.refresh_token:
            return False
        r = self.http.post("/api/auth/refresh", json={"refresh_token": self.refresh_token})
        if r.status_code != 200:
            return False
        body = r.json()
        self.token, self.refresh_token = body["access_token"], body.get("refresh_token") or self.refresh_token
        log.info("access token renewed")
        return True

    def push(self, connection_id: str, rows: list[dict]) -> dict:
        r = self.http.post(
            f"/api/pos/{connection_id}/push", json={"items": rows},
            headers={"Authorization": f"Bearer {self.token}"},
        )
        if r.status_code == 401:
            if self.refresh():
                return self.push(connection_id, rows)
            raise PermissionError("token rejected (expired?) — sign in again")
        if r.status_code == 429:
            raise RuntimeError("rate limited by the API (429) — backing off")
        r.raise_for_status()
        return r.json()


class State:
    """Last pushed fingerprint + health status on disk, so restarts do not re-push and Docker can watch us."""

    def __init__(self, state_file: str | None, health_file: str | None):
        self.state_file, self.health_file = state_file, health_file
        self.last_fp: str | None = None
        if state_file and os.path.exists(state_file):
            try:
                with open(state_file) as fh:
                    self.last_fp = json.load(fh).get("fingerprint")
            except (OSError, ValueError):
                self.last_fp = None

    def remember(self, fp: str) -> None:
        self.last_fp = fp
        if self.state_file:
            with open(self.state_file, "w") as fh:
                json.dump({"fingerprint": fp, "pushed_at": datetime.now(timezone.utc).isoformat()}, fh)

    def health(self, ok: bool, **info) -> None:
        if not self.health_file:
            return
        with open(self.health_file, "w") as fh:
            json.dump({"ok": ok, "at": datetime.now(timezone.utc).isoformat(), **info}, fh)


class Stop:
    """SIGTERM / SIGINT → finish the current pass, then exit 0."""

    def __init__(self):
        self.requested = False
        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                signal.signal(sig, self._handle)
            except ValueError:  # not the main thread
                pass

    def _handle(self, signum, _frame):
        log.info("received %s — stopping after this pass", signal.Signals(signum).name)
        self.requested = True

    def sleep(self, seconds: float) -> None:
        end = time.monotonic() + seconds
        while not self.requested and time.monotonic() < end:
            time.sleep(min(1.0, end - time.monotonic()))


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    client = BriefClient(args.api, args.token)
    email, password = args.email, args.password
    if not client.token:
        email = email or input("Brief_ email or @handle: ")
        password = password or getpass.getpass("password: ")
        try:
            client.login(email, password)
        except PermissionError as exc:
            sys.exit(str(exc))

    adapter = make_adapter(args)
    state = State(args.state_file, args.health_file)
    stop = Stop()
    interval = 0 if args.once else args.interval
    failures = 0

    while not stop.requested:
        try:
            rows = list(adapter.read())
            fp = adapter.fingerprint(rows)
            if fp == state.last_fp and not args.force:
                log.debug("no change (%d rows)", len(rows))
                state.health(True, rows=len(rows), changed=False)
            else:
                result = client.push(args.connection, [r.to_payload() for r in rows])
                state.remember(fp)
                log.info(
                    "pushed %d rows → %s: +%d added, %d updated%s",
                    len(rows), result.get("status"), result.get("items_added", 0), result.get("items_updated", 0),
                    f", {len(result['errors'])} errors" if result.get("errors") else "",
                )
                for err in (result.get("errors") or [])[:5]:
                    log.warning("  %s", err)
                state.health(True, rows=len(rows), changed=True, added=result.get("items_added", 0),
                             updated=result.get("items_updated", 0), errors=len(result.get("errors") or []))
            failures = 0
        except PermissionError as exc:
            log.error("%s", exc)
            state.health(False, error=str(exc))
            if not (email and password):
                return 2
            try:
                client.login(email, password)
                continue
            except PermissionError as exc2:
                log.error("%s", exc2)
                failures += 1
        except Exception as exc:  # keep the daemon alive through flaky tills and networks
            failures += 1
            log.error("sync failed (%d in a row): %s", failures, exc)
            state.health(False, error=str(exc), failures=failures)
            if interval <= 0:
                return 1
        if interval <= 0:
            return 0
        # exponential back-off after failures, capped; normal cadence otherwise
        wait = min(interval * (2 ** min(failures, 6)), max(args.max_backoff, interval)) if failures else interval
        stop.sleep(wait)
    return 0


if __name__ == "__main__":
    sys.exit(main())
