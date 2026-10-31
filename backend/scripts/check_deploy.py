"""Verify a deployment from the outside, using only what it says about itself.

    python scripts/check_deploy.py https://brief-navy-rho.vercel.app
    python scripts/check_deploy.py https://… --photo /static/uploads/<uuid>/<file>.jpg
    python scripts/check_deploy.py https://… --json

Run this after setting environment variables and redeploying. It answers the
question the Vercel dashboard cannot: **did the values take effect, and can this
deployment serve a photograph?**

Why it exists. Setting environment variables by name is not the same as setting
them correctly, and Vercel reports the two identically:

  · "a variable with the name `MEDIA_STORE` already exists for the target
    production" is what you get when the *name* is already there. The dashboard
    cannot tell you what it is set to, and a variable created months ago may hold
    `local` — the value that discarded every upload.
  · A change to an environment variable does nothing until a **new deployment**
    is built. Redeploying is not implied by the dashboard's "saved".

So this reads the deployment's own `/api/health`, which reports what the running
process actually resolved (not what the project's settings say it should be), and
grades it. Exit code 0 only if nothing is broken.

Read-only: three GETs, no credentials, nothing written. Safe to run against
production, and safe to run from CI.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

PASS = "PASS"
FAIL = "FAIL"
NOTE = "NOTE"

TIMEOUT = 20


# ── the judgement, separated from the network so it can be tested ───────────


def inspect_health(payload: dict) -> list[tuple[str, str, str]]:
    """Grade a `/api/health` body. Returns `(level, title, advice)` rows.

    Every FAIL here is one of the two faults that emptied a shop front: media on
    a disk that does not survive, or a schema behind the code. A NOTE is a real
    observation that does not stop the app serving — usually a value that is
    right today and fragile later.
    """
    rows: list[tuple[str, str, str]] = []
    state = payload.get("schema_state") or {}

    # ── the database is reachable at all ──────────────────────────────────
    if not payload.get("database"):
        rows.append((
            FAIL,
            "the API cannot reach its database",
            payload.get("error")
            or "Check DATABASE_URL on the deployment — percent-encode @ : / # in the password.",
        ))
        return rows  # nothing else can be judged without a database

    rows.append((PASS, "the database answers", ""))

    # ── the schema has what this code reads ───────────────────────────────
    missing = state.get("missing_tables") or []
    drifted = state.get("drifted") or {}
    if missing:
        rows.append((
            FAIL,
            "tables are missing: " + ", ".join(missing),
            "Run `alembic upgrade head` against this database, or set "
            "RUN_MIGRATIONS_ON_BOOT=true and redeploy. Boot-time migration needs "
            "alembic/ to be deployed with the API.",
        ))
    if drifted:
        detail = "; ".join(f"{table}.{', '.join(cols)}" for table, cols in drifted.items())
        rows.append((
            FAIL,
            "tables exist but columns are missing: " + detail,
            "This is the state `create_all` leaves behind — it never adds a column "
            "to an existing table. Run `alembic upgrade head`.",
        ))
    if not missing and not drifted:
        rows.append((PASS, "every table and column this code reads exists", ""))

    head, current = state.get("head"), state.get("current")
    if head and current == head:
        rows.append((PASS, f"schema is at {head}", ""))
    elif not missing and not drifted:
        # Complete but unstamped is a working database with a debt: the next
        # migration cannot be ordered against a revision nobody recorded.
        rows.append((
            NOTE,
            f"the schema works but is not stamped (current: {current or 'no revision'}, head: {head})",
            "Harmless while the tables and columns match; stamp it with "
            "`alembic upgrade head` so the next migration has a starting point.",
        ))
    pending = state.get("pending_count") or 0
    if pending and current != head:
        rows.append((
            NOTE,
            f"{pending} migration(s) are not recorded as applied",
            "The app serves, but a deploy that applies them later will change the "
            "schema underneath live traffic. Apply them deliberately.",
        ))

    # ── the photographs ───────────────────────────────────────────────────
    media = payload.get("media_store")
    if payload.get("media_durable"):
        rows.append((PASS, f"photos are stored durably ({media})", ""))
    else:
        rows.append((
            FAIL,
            f"photos are stored on this host's disk ({media}) — every upload will 404 after the next request",
            "Set MEDIA_STORE=db (or S3_BUCKET for object storage) and redeploy. On a "
            "managed host uploads are now refused rather than written somewhere they "
            "will be lost, so this fails loudly instead of quietly.",
        ))

    # ── the values nobody can see in the dashboard ────────────────────────
    if payload.get("production") is False:
        rows.append((
            NOTE,
            f"ENVIRONMENT is {payload.get('environment')!r}, not 'production'",
            "Two things follow: the startup guard that refuses the shipped SECRET_KEY "
            "never runs, and `is_production` is False. Media is safe anyway on a "
            "managed host, but set ENVIRONMENT=production and a private SECRET_KEY.",
        ))
    elif payload.get("production") is True:
        rows.append((PASS, "ENVIRONMENT=production, so the published-secret guard is armed", ""))

    return rows


def verdict(payload: dict, photo: dict | None = None) -> tuple[bool, list[tuple[str, str, str]]]:
    """All findings, plus whether the deployment passes.

    A photo check that was asked for and did not happen is a failure: silence is
    how "the picture is missing" became a mystery in the first place.
    """
    rows = inspect_health(payload)
    if photo is not None:
        if photo.get("ok"):
            rows.append((PASS, f"the photo at {photo['path']} is served ({photo['content_type']}, {photo['bytes']} bytes)", ""))
        else:
            rows.append((
                FAIL,
                f"the photo at {photo['path']} is not served ({photo.get('status') or photo.get('error')})",
                "If this key was uploaded before MEDIA_STORE=db, its bytes were written "
                "to a disk that is gone and cannot be recovered — re-upload it. A key "
                "uploaded now and still 404ing means the store is still the disk: "
                "check MEDIA_STORE and that a new deployment was built.",
            ))
    return all(level != FAIL for level, _, _ in rows), rows


# ── the network ────────────────────────────────────────────────────────────


def _get(url: str) -> tuple[int, bytes, str]:
    request = urllib.request.Request(url, headers={"Accept": "application/json,image/*"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return response.status, response.read(), response.headers.get("content-type", "")
    except urllib.error.HTTPError as exc:  # a 503 is an answer, not a transport failure
        return exc.code, exc.read(), exc.headers.get("content-type", "")


def fetch_health(base: str) -> tuple[dict, int]:
    status, body, _ = _get(f"{base.rstrip('/')}/api/health")
    return json.loads(body.decode("utf-8") or "{}"), status


def fetch_photo(base: str, path: str) -> dict:
    url = f"{base.rstrip('/')}{path}"
    try:
        status, body, content_type = _get(url)
    except Exception as exc:  # noqa: BLE001 — a transport failure is a finding
        return {"ok": False, "path": path, "error": f"{type(exc).__name__}: {exc}"}
    ok = status == 200 and content_type.startswith("image/")
    return {
        "ok": ok,
        "path": path,
        "status": status,
        "bytes": len(body),
        "content_type": content_type,
        "error": None if ok else "not an image" if status == 200 else None,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify a Brief deployment from the outside.")
    parser.add_argument("base", help="e.g. https://brief-navy-rho.vercel.app")
    parser.add_argument("--photo", help="a /static/uploads/… URL to fetch and grade")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args(argv)

    try:
        payload, status = fetch_health(args.base)
    except Exception as exc:  # noqa: BLE001
        print(f"FAIL  could not read {args.base}/api/health — {type(exc).__name__}: {exc}")
        print("      The host is unreachable from here, or the deployment does not exist.")
        return 1

    photo = fetch_photo(args.base, args.photo) if args.photo else None
    ok, rows = verdict(payload, photo)

    if args.json:
        print(json.dumps({"base": args.base, "http_status": status, "ok": ok,
                          "findings": [{"level": l, "title": t, "advice": a} for l, t, a in rows],
                          "health": payload, "photo": photo}, indent=2))
    else:
        print(f"\n{args.base}  (HTTP {status})\n")
        for level, title, advice in rows:
            print(f"  {level:<4} {title}")
            if advice:
                print(f"        → {advice}")
        passed = sum(1 for level, _, _ in rows if level == PASS)
        print(f"\n  {passed} passed, {sum(1 for l, _, _ in rows if l == FAIL)} failed, "
              f"{sum(1 for l, _, _ in rows if l == NOTE)} to note")
        print("\n  READY.\n" if ok else "\n  NOT READY — fix the FAIL lines above, then redeploy and run this again.\n")

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
