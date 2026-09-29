"""
Wait for Postgres to accept connections, then exit 0 — `entrypoint.sh` runs this
before it migrates and serves.

    python -m app.wait_for_db [--timeout SECONDS]      # default: DB_WAIT_TIMEOUT (60)

It connects with the sync URL through SQLAlchemy: the very URL and code path
`alembic upgrade head` uses next, so a URL this accepts is one the migrations accept.
(Handing the URL string straight to `psycopg2.connect` parses it with libpq instead,
which rejects passwords that SQLAlchemy and the API handle fine, e.g. one holding `/`.)

When it gives up it says *why*: the target, which setting supplied the URL, the
driver's own message (credentials redacted) and the usual fix. To re-check from a
running container:  docker compose exec backend python -m app.wait_for_db --timeout 5
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from typing import Callable, Optional, Sequence, TextIO, Tuple

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, Engine, make_url
from sqlalchemy.exc import ArgumentError
from sqlalchemy.pool import NullPool

from app.config import settings

TAG = "[wait-for-db]"
# One attempt may take at most this long. Without it a connection whose packets are
# silently dropped hangs for minutes, and the retry budget means nothing.
CONNECT_TIMEOUT = 5
RETRY_EVERY = 1.0     # seconds between attempts
REPORT_EVERY = 10.0   # an unchanged error is repeated as a progress line this often

_URL_CREDENTIALS = re.compile(r"(://[^:/@\s]*:)[^@\s]+@")
_PASSWORD_PAIR = re.compile(r"(password\s*=\s*)\S+", re.IGNORECASE)


def redact(message: str, password: Optional[str] = None) -> str:
    """Strip credentials from text that is about to be logged."""
    if password and len(password) >= 4:  # a 1-2 character password would shred the message
        message = message.replace(password, "***")
    message = _URL_CREDENTIALS.sub(r"\1***@", message)
    return _PASSWORD_PAIR.sub(r"\1***", message)


def describe_target(url: URL) -> str:
    """`user@host:port/database` — enough to see where we are connecting, no secrets."""
    host = url.host or url.query.get("host") or "local socket"
    user = f"{url.username}@" if url.username else ""
    port = f":{url.port}" if url.port else ""
    return f"{user}{host}{port}/{url.database or ''}"


def explain(message: str, url: URL, *, explicit: bool = True) -> Optional[str]:
    """The usual fix for a driver error, or None when nothing specific applies.

    `explicit` is False when DATABASE_URL was never set and the built-in default
    (host `db`, which only exists inside docker compose) is what we tried.
    """
    low = message.lower()
    host = url.host or ""
    user = url.username or "(none)"

    if any(s in low for s in ("could not translate host name", "name or service not known",
                              "temporary failure in name resolution", "nodename nor servname",
                              "no address associated")):
        if not explicit:
            return ('DATABASE_URL is not set, so the built-in default was used and its host "db" only exists '
                    "inside docker compose. Set DATABASE_URL on this service to your database's URL "
                    "(Railway: DATABASE_URL=${{Postgres.DATABASE_URL}} — variable changes are staged until "
                    "you deploy them).")
        return (f'the host "{host}" does not resolve from here. Check the host in DATABASE_URL '
                '("db" is the docker compose service name and only exists inside the compose network).')

    if "connection refused" in low:
        return (f"nothing is accepting connections on {host or 'the host'}:{url.port or 5432}. Is Postgres up, and "
                "is the port right? From inside a container 'localhost' is the container itself — use the "
                "database's service or host name instead.")

    if "on socket" in low and "no such file or directory" in low and not url.host and "host" not in url.query:
        return ("the URL names no host, so the driver looked for a local Postgres socket that is not there. "
                "Put the host in DATABASE_URL: postgresql://user:password@host:5432/dbname.")

    if ("password authentication failed" in low or "no password supplied" in low
            or ('role "' in low and "does not exist" in low)):
        return (f'the server answered but rejected user "{user}" (Postgres answers the same for an unknown user). '
                "Check the credentials in DATABASE_URL. The postgres image only reads POSTGRES_USER / "
                "POSTGRES_PASSWORD when it first creates its data volume, so after changing them reset the "
                "volume (`docker compose down -v` — deletes the data) or ALTER USER in the running database. "
                "A password containing @ : / ? # % must be percent-encoded in the URL (@ -> %40).")

    if "does not exist" in low and "database" in low:
        return (f'the server is up but has no database "{url.database}". Create it, or fix the last path segment '
                "of DATABASE_URL (the postgres image creates POSTGRES_DB only when it first initialises its volume).")

    if any(s in low for s in ("timeout expired", "timed out", "network is unreachable", "no route to host")):
        return (f"the host cannot be reached from here (no answer within {CONNECT_TIMEOUT}s, or no route): look for a "
                "firewall / IP allow-list, a wrong host or port, an IPv6-only address on an IPv4-only network, or a "
                "private network that is not up yet.")

    if "pg_hba.conf" in low or "no encryption" in low or re.search(r"\bssl", low):
        return ("the server and this client disagree about TLS or are not allowed to talk: append ?sslmode=require "
                "to DATABASE_URL if the server demands TLS, ?sslmode=disable if it has none, and make sure its "
                "pg_hba.conf / IP allow-list admits this host.")

    if "invalid dsn" in low or "invalid connection option" in low or "invalid uri query parameter" in low:
        return ("DATABASE_URL carries a query option the Postgres driver rejects — remove it. (Only libpq options "
                "such as sslmode, connect_timeout or application_name work.)")

    if "starting up" in low or "shutting down" in low or "recovery" in low:
        return ("Postgres is up but still starting or recovering. This normally clears by itself; raise "
                "DB_WAIT_TIMEOUT if it needs longer.")

    return None


def url_source() -> Tuple[str, bool]:
    """Which setting the probed URL comes from, and whether anyone actually set it."""
    for name in ("DATABASE_URL_SYNC", "DATABASE_URL"):
        if name == "DATABASE_URL_SYNC" and not settings.DATABASE_URL_SYNC:
            continue
        if name in settings.model_fields_set:
            from_env = any(key.upper() == name for key in os.environ)
            return f"{name} in the {'environment' if from_env else '.env file'}", True
    return "the built-in default — DATABASE_URL is not set", False


def _clean(exc: BaseException, password: Optional[str]) -> str:
    """One line: the driver's own message (not SQLAlchemy's wrapper), credentials redacted."""
    inner = getattr(exc, "orig", None) or exc
    message = redact(" ".join(str(inner).split()) or type(inner).__name__, password)
    return message if len(message) <= 300 else message[:297] + "..."


def _bad_url_reason(raw_url: str, exc: Exception) -> str:
    """Why the URL cannot even be parsed. Never echoes it: the text may hold the password."""
    if not raw_url.strip():
        return "DATABASE_URL is empty — set it to postgresql://user:password@host:5432/dbname"
    detail = "" if isinstance(exc, ArgumentError) else f" ({_clean(exc, None)})"
    reason = (f"DATABASE_URL is not a valid database URL{detail} — expected "
              "postgresql://user:password@host:5432/dbname, with @ : / ? # % in the password percent-encoded")
    if "${{" in raw_url:
        reason += (". It still contains a ${{...}} placeholder: the platform did not resolve the reference "
                   "(check the service name)")
    return reason


def _attempt(engine: Engine) -> None:
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))


def wait_for_database(
    raw_url: str,
    timeout: float,
    *,
    source: str = "DATABASE_URL",
    explicit: bool = True,
    out: Optional[TextIO] = None,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> bool:
    """Retry until `raw_url` answers a `SELECT 1` or `timeout` seconds have passed.

    Silent when the first attempt works. Otherwise it reports each *new* error as it
    appears (an unchanged one only as a progress line every REPORT_EVERY seconds) and,
    when it gives up, a summary with a hint. A URL that cannot be parsed fails at once:
    waiting would not change that.
    """

    def say(message: str) -> None:
        print(f"{TAG} {message}", file=out or sys.stderr, flush=True)

    try:
        url = make_url(raw_url)
    except Exception as exc:  # ArgumentError, or ValueError for a non-numeric port
        say(f"database never became reachable: {_bad_url_reason(raw_url, exc)}")
        return False
    if "@" in (url.host or "") or "@" in (url.database or ""):
        # Neither a host nor an (un-decoded) database name can hold "@": the password did, and
        # SQLAlchemy read the rest of it as the host. Echo nothing from the URL — it is part of the password.
        say('database never became reachable: DATABASE_URL has a second "@", so the password almost certainly '
            "contains an unencoded one and the rest of it was read as the host. Percent-encode it as %40 "
            "(and likewise : / ? # %). Nothing from the URL is printed here: it would show part of the password.")
        return False
    target = describe_target(url)
    try:
        engine = create_engine(url, poolclass=NullPool, connect_args={"connect_timeout": CONNECT_TIMEOUT})
    except Exception as exc:
        say(f"database never became reachable: cannot set up a connection to {target}: {_clean(exc, url.password)}")
        return False

    started = clock()
    last_report = started
    last_error: Optional[str] = None
    attempts = 0
    try:
        while True:
            attempts += 1
            try:
                _attempt(engine)
            except Exception as exc:
                now = clock()
                error = _clean(exc, url.password)
                if error != last_error:
                    if last_error is None:
                        say(f"waiting up to {timeout:g}s for {target} (from {source})")
                    say(f"not ready: {error}")
                    last_error, last_report = error, now
                elif now - last_report >= REPORT_EVERY:
                    say(f"still waiting ({now - started:.0f}s of {timeout:g}s), same error")
                    last_report = now
                if now - started >= timeout:
                    break
                sleep(max(0.0, min(RETRY_EVERY, started + timeout - now)))
            else:
                if last_error is not None:
                    say(f"database is reachable after {clock() - started:.0f}s ({attempts} attempts)")
                return True
    finally:
        engine.dispose()

    say(f"database never became reachable: {target} (from {source}) — gave up after "
        f"{clock() - started:.0f}s and {attempts} attempt{'' if attempts == 1 else 's'}")
    say(f"last error: {last_error}")
    hint = explain(last_error or "", url, explicit=explicit)
    if hint:
        say(f"hint: {hint}")
    return False


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.wait_for_db",
                                     description="Wait until Postgres accepts connections.")
    parser.add_argument("--timeout", type=float, default=None,
                        help=f"seconds to keep trying (default: DB_WAIT_TIMEOUT, currently {settings.DB_WAIT_TIMEOUT})")
    args = parser.parse_args(argv)
    timeout = settings.DB_WAIT_TIMEOUT if args.timeout is None else args.timeout
    source, explicit = url_source()
    return 0 if wait_for_database(settings.database_url_sync, timeout, source=source, explicit=explicit) else 1


if __name__ == "__main__":
    sys.exit(main())
