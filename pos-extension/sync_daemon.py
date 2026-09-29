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
BRIEF_PASSWORD in the environment) and the daemon logs in for you.
"""

from __future__ import annotations

import argparse
import getpass
import logging
import os
import sys
import time

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

    def login(self, email: str, password: str) -> None:
        r = self.http.post("/api/auth/login", data={"username": email, "password": password})
        if r.status_code != 200:
            sys.exit(f"login failed: {r.status_code} {r.text[:200]}")
        self.token = r.json()["access_token"]
        log.info("signed in as @%s", r.json().get("vendor_handle"))

    def push(self, connection_id: str, rows: list[dict]) -> dict:
        r = self.http.post(
            f"/api/pos/{connection_id}/push", json={"items": rows},
            headers={"Authorization": f"Bearer {self.token}"},
        )
        if r.status_code == 401:
            raise PermissionError("token rejected (expired?) — sign in again")
        r.raise_for_status()
        return r.json()


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    client = BriefClient(args.api, args.token)
    if not client.token:
        email = args.email or input("Brief_ email or @handle: ")
        password = args.password or getpass.getpass("password: ")
        client.login(email, password)

    adapter = make_adapter(args)
    last_fp = None
    interval = 0 if args.once else args.interval

    while True:
        try:
            rows = list(adapter.read())
            fp = adapter.fingerprint(rows)
            if fp == last_fp and not args.force:
                log.debug("no change (%d rows)", len(rows))
            else:
                result = client.push(args.connection, [r.to_payload() for r in rows])
                last_fp = fp
                log.info(
                    "pushed %d rows → %s: +%d added, %d updated%s",
                    len(rows), result.get("status"), result.get("items_added", 0), result.get("items_updated", 0),
                    f", {len(result['errors'])} errors" if result.get("errors") else "",
                )
                for err in (result.get("errors") or [])[:5]:
                    log.warning("  %s", err)
        except PermissionError as exc:
            log.error("%s", exc)
            if not (args.email and args.password):
                return 2
            client.login(args.email, args.password)
            continue
        except Exception as exc:  # keep the daemon alive through flaky tills and networks
            log.error("sync failed: %s", exc)
            if interval <= 0:
                return 1
        if interval <= 0:
            return 0
        time.sleep(interval)


if __name__ == "__main__":
    sys.exit(main())
