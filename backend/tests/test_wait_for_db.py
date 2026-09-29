"""
"database never became reachable" — the entrypoint's Postgres wait.

It used to print only the *class* of the first error (`OperationalError`, which psycopg2 uses
for DNS failures, refused connections and bad passwords alike), so every cause looked the same.
These tests pin what replaced it: a probe that goes through the same URL parsing as alembic,
says why it gave up (never echoing a password), and fails at once on a URL that cannot work.
"""

import io
import os
import socket
import subprocess
import sys
import threading

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from app import wait_for_db
from app.config import Settings, _to_async_url, _to_sync_url, settings
from app.wait_for_db import explain, redact, wait_for_database

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _closed_port() -> int:
    """A local port with nothing listening on it."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class FakeTime:
    """A clock that only moves when the code under test sleeps."""

    def __init__(self):
        self.now = 0.0

    def clock(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


def _run(url, timeout, **kwargs):
    out = io.StringIO()
    ok = wait_for_database(url, timeout, out=out, **kwargs)
    return ok, out.getvalue()


# ── the URL's TLS option, spelled for each driver ────────────────────────────

@pytest.mark.parametrize("given, async_url, sync_url", [
    # libpq spelling — what managed hosts hand out
    ("postgres://u:p@h:5432/d?sslmode=require",
     "postgresql+asyncpg://u:p@h:5432/d?ssl=require", "postgresql://u:p@h:5432/d?sslmode=require"),
    # asyncpg spelling — what SQLAlchemy's docs show
    ("postgresql+asyncpg://u:p@h/d?ssl=require",
     "postgresql+asyncpg://u:p@h/d?ssl=require", "postgresql://u:p@h/d?sslmode=require"),
    # other options are left exactly as written, in order
    ("postgresql://u:p@h/d?application_name=x&sslmode=verify-full&connect_timeout=3",
     "postgresql+asyncpg://u:p@h/d?application_name=x&ssl=verify-full&connect_timeout=3",
     "postgresql://u:p@h/d?application_name=x&sslmode=verify-full&connect_timeout=3"),
    # both spellings given: each driver keeps its own
    ("postgresql://u:p@h/d?ssl=require&sslmode=disable",
     "postgresql+asyncpg://u:p@h/d?ssl=require", "postgresql://u:p@h/d?sslmode=disable"),
    # no options: only the scheme changes
    ("postgres://u:p@h:5432/d", "postgresql+asyncpg://u:p@h:5432/d", "postgresql://u:p@h:5432/d"),
    # the unix-socket URL dev_local.py and conftest.py build
    ("postgresql+asyncpg://postgres@/brief?host=/tmp/x",
     "postgresql+asyncpg://postgres@/brief?host=/tmp/x", "postgresql://postgres@/brief?host=/tmp/x"),
    # a "?" inside the password is not where the options start
    ("postgres://u:pa?ss@h/d", "postgresql+asyncpg://u:pa?ss@h/d", "postgresql://u:pa?ss@h/d"),
    ("postgres://u:pa?ss@h/d?sslmode=require",
     "postgresql+asyncpg://u:pa?ss@h/d?ssl=require", "postgresql://u:pa?ss@h/d?sslmode=require"),
])
def test_tls_option_is_spelled_for_each_driver(given, async_url, sync_url):
    assert _to_async_url(given) == async_url
    assert _to_sync_url(given) == sync_url


def test_settings_derive_both_urls_from_either_spelling():
    s = Settings(DATABASE_URL="postgres://u:p@h:5432/d?sslmode=require", DATABASE_URL_SYNC=None)
    assert s.DATABASE_URL == "postgresql+asyncpg://u:p@h:5432/d?ssl=require"
    assert s.database_url_sync == "postgresql://u:p@h:5432/d?sslmode=require"


async def test_libpq_spelled_tls_option_works_for_the_app_engine():
    """`?sslmode=` used to reach asyncpg verbatim: "connect() got an unexpected keyword argument"."""
    url = settings.DATABASE_URL + ("&" if "?" in settings.DATABASE_URL else "?") + "sslmode=prefer"
    engine = create_async_engine(_to_async_url(url))
    try:
        async with engine.connect() as conn:
            assert (await conn.execute(text("SELECT 1"))).scalar() == 1
    finally:
        await engine.dispose()


# ── the wait itself ──────────────────────────────────────────────────────────

def test_a_reachable_database_passes_silently():
    ok, out = _run(settings.database_url_sync, 5)
    assert ok and out == ""


def test_probe_accepts_a_password_libpq_cannot_parse():
    """
    The probe used to hand the URL string to psycopg2.connect, i.e. to libpq's own parser, which
    reads the `/` in this password as the start of the path ('invalid integer value "ab" for
    connection option "port"'). SQLAlchemy — what alembic and the API use — parses it fine, so
    the old probe reported "never became reachable" for a database that was up.
    """
    base = make_url(settings.database_url_sync)
    if "host" not in base.query or base.password:
        pytest.skip("needs the embedded trust-auth Postgres (unix socket), where any password is accepted")
    url = f"postgresql://{base.username}:ab/cd+ef=@/{base.database}?host={base.query['host']}"
    ok, out = _run(url, 5)
    assert ok, out


def test_a_refused_connection_is_diagnosed_and_the_password_stays_out_of_the_log():
    port = _closed_port()
    ok, out = _run(f"postgresql://brief:s3cr3tpw@127.0.0.1:{port}/brief_vendors", 0,
                   source="DATABASE_URL in the environment")
    assert not ok
    assert "database never became reachable" in out
    assert f"brief@127.0.0.1:{port}/brief_vendors (from DATABASE_URL in the environment)" in out
    assert "Connection refused" in out                    # the driver's own words, not just its class name
    assert f"hint: nothing is accepting connections on 127.0.0.1:{port}" in out
    assert "s3cr3tpw" not in out


def test_retries_until_the_database_answers(monkeypatch):
    t = FakeTime()
    calls = []

    def flaky(engine):
        calls.append(t.now)
        if len(calls) < 4:
            raise RuntimeError("the database system is starting up")

    monkeypatch.setattr(wait_for_db, "_attempt", flaky)
    ok, out = _run("postgresql://u:p@db.example:5432/d", 60, sleep=t.sleep, clock=t.clock)
    assert ok
    assert len(calls) == 4 and t.now == 3                 # one second between attempts
    assert out.count("not ready:") == 1                   # the same error is reported once, not per attempt
    assert "database is reachable after 3s (4 attempts)" in out
    assert "never became reachable" not in out


def test_gives_up_at_the_deadline_and_reports_a_new_error_when_it_changes(monkeypatch):
    t = FakeTime()
    calls = []

    def failing(engine):
        calls.append(t.now)
        raise RuntimeError("boom-a" if len(calls) <= 12 else "boom-b")

    monkeypatch.setattr(wait_for_db, "_attempt", failing)
    ok, out = _run("postgresql://u:p@db.example:5432/d", 25, sleep=t.sleep, clock=t.clock)
    assert not ok
    assert len(calls) == 26 and t.now == 25               # attempts at t = 0 .. 25, never past the budget
    assert out.count("not ready: boom-a") == 1 and out.count("not ready: boom-b") == 1
    assert out.count("still waiting") == 2                # progress at 10 s and 20 s; quiet in between
    assert "database never became reachable: u@db.example:5432/d" in out
    assert "gave up after 25s and 26 attempts" in out
    assert "last error: boom-b" in out


def test_zero_timeout_is_a_single_attempt(monkeypatch):
    calls = []

    def refuse(engine):
        calls.append(1)
        raise RuntimeError("no")

    monkeypatch.setattr(wait_for_db, "_attempt", refuse)
    ok, out = _run("postgresql://u:p@db.example/d", 0, sleep=lambda s: pytest.fail("must not sleep"))
    assert not ok and len(calls) == 1
    assert "gave up after 0s and 1 attempt" in out


def test_a_connection_that_never_answers_is_abandoned_instead_of_hanging(monkeypatch):
    """
    Packets that are silently dropped (firewall, allow-list, half-up private network) used to block
    psycopg2.connect for minutes per attempt, so the "60 attempts" budget meant nothing and a
    platform healthcheck gave up first. Each attempt is now bounded by CONNECT_TIMEOUT.
    """
    monkeypatch.setattr(wait_for_db, "CONNECT_TIMEOUT", 1)
    result = {}
    with socket.socket() as silent:                       # completes the TCP handshake, never says a word
        silent.bind(("127.0.0.1", 0))
        silent.listen(1)
        url = f"postgresql://brief:x@127.0.0.1:{silent.getsockname()[1]}/brief_vendors"
        # A watchdog thread, so a regression fails this test instead of hanging the whole run.
        probe = threading.Thread(target=lambda: result.update(done=_run(url, 0)), daemon=True)
        probe.start()
        probe.join(10)
        assert not probe.is_alive(), "the probe hung on a connection that never answers"
    ok, out = result["done"]
    assert not ok
    assert "timeout expired" in out
    assert "hint: the host cannot be reached" in out


@pytest.mark.parametrize("url, expect", [
    ("", "DATABASE_URL is empty"),
    ("${{Postgres.DATABASE_URL}}", "placeholder"),
    ("brief:hunter2hunter2@db/brief", "not a valid database URL"),             # no scheme
    ("postgresql://u:hunter2hunter2@127.0.0.1:abc/d", "not a valid database URL"),  # port is not a number
])
def test_a_url_that_cannot_work_fails_at_once_without_echoing_it(monkeypatch, url, expect):
    monkeypatch.setattr(wait_for_db, "_attempt", lambda engine: pytest.fail("must not try to connect"))
    ok, out = _run(url, 60, sleep=lambda s: pytest.fail("must not wait"))
    assert not ok
    assert "database never became reachable" in out and expect in out
    assert "hunter2hunter2" not in out


@pytest.mark.parametrize("url", [
    "postgresql://brief:p@ssTAIL99@127.0.0.1:5432/brief_vendors",   # tail of the password read as the host
    "postgresql://brief:p@a/ssTAIL99@host/brief_vendors",           # ... or as the database
])
def test_an_unencoded_at_sign_in_the_password_fails_at_once_and_leaks_nothing(monkeypatch, url):
    monkeypatch.setattr(wait_for_db, "_attempt", lambda engine: pytest.fail("must not try to connect"))
    ok, out = _run(url, 60, sleep=lambda s: pytest.fail("must not wait"))
    assert not ok
    assert 'second "@"' in out and "%40" in out
    assert "TAIL99" not in out


def test_a_percent_encoded_at_sign_is_fine():
    port = _closed_port()
    ok, out = _run(f"postgresql://brief:p%40ss@127.0.0.1:{port}/my%40db", 0)
    assert not ok and "Connection refused" in out and 'second "@"' not in out


def test_credentials_in_driver_messages_are_redacted(monkeypatch):
    def leaky(engine):
        raise RuntimeError("could not connect with password=hunter22 via postgresql://brief:hunter22@db/x")

    monkeypatch.setattr(wait_for_db, "_attempt", leaky)
    ok, out = _run("postgresql://brief:hunter22@db.example/x", 0)
    assert not ok and "hunter22" not in out and "***" in out


def test_redact():
    assert redact("failed for postgresql+asyncpg://u:s3cretpw@h/d", None) == "failed for postgresql+asyncpg://u:***@h/d"
    assert redact("x password=abc y") == "x password=*** y"
    assert redact("boom hunter22", "hunter22") == "boom ***"
    assert redact("a short 'ab' stays", "ab") == "a short 'ab' stays"     # a tiny "password" would shred the message
    plain = 'FATAL: password authentication failed for user "brief"'   # the phrase "password" alone is not a secret
    assert redact(plain) == plain


# ── where the URL came from, and the CLI ─────────────────────────────────────

@pytest.fixture
def fresh_settings(monkeypatch):
    """Build a Settings from a controlled environment and make the module use it."""
    def build(**env):
        for name in ("DATABASE_URL", "DATABASE_URL_SYNC"):
            monkeypatch.delenv(name, raising=False)
        for name, value in env.items():
            monkeypatch.setenv(name, value)
        built = Settings(_env_file=None)
        monkeypatch.setattr(wait_for_db, "settings", built)
        return built
    return build


def test_url_source_says_when_nobody_set_a_url(fresh_settings):
    fresh_settings()
    assert wait_for_db.url_source() == ("the built-in default — DATABASE_URL is not set", False)


def test_url_source_names_the_variable(fresh_settings):
    fresh_settings(DATABASE_URL="postgres://u:p@h/d")
    assert wait_for_db.url_source() == ("DATABASE_URL in the environment", True)


def test_url_source_prefers_the_sync_override_but_ignores_an_empty_one(fresh_settings):
    fresh_settings(DATABASE_URL="postgres://u:p@h/d", DATABASE_URL_SYNC="postgres://u:p@other/d")
    assert wait_for_db.url_source() == ("DATABASE_URL_SYNC in the environment", True)
    fresh_settings(DATABASE_URL="postgres://u:p@h/d", DATABASE_URL_SYNC="")
    assert wait_for_db.url_source() == ("DATABASE_URL in the environment", True)


def test_main_exit_codes_and_timeout_flag(fresh_settings, capsys):
    assert wait_for_db.main(["--timeout", "5"]) == 0      # the session's embedded / CI Postgres
    port = _closed_port()
    fresh_settings(DATABASE_URL=f"postgresql+asyncpg://brief:x@127.0.0.1:{port}/brief_vendors")
    assert wait_for_db.main(["--timeout", "0"]) == 1
    err = capsys.readouterr().err
    assert "database never became reachable" in err and f"127.0.0.1:{port}" in err


def test_main_uses_db_wait_timeout_from_settings(fresh_settings, monkeypatch, capsys):
    port = _closed_port()
    fresh_settings(DATABASE_URL=f"postgresql+asyncpg://brief:x@127.0.0.1:{port}/d", DB_WAIT_TIMEOUT="0")
    assert wait_for_db.main([]) == 1
    assert "gave up after 0s and 1 attempt" in capsys.readouterr().err


# ── the hints: real driver messages → the usual fix ──────────────────────────

_DNS = 'could not translate host name "db" to address: Name or service not known'
_AT = 'connection to server at "127.0.0.1", port 5432 failed: '
_DB = make_url("postgresql://brief:x@db:5432/brief_vendors")
_NO_HOST = make_url("postgresql://brief:x@/brief_vendors")


@pytest.mark.parametrize("message, url, explicit, expect", [
    (_DNS, _DB, False, "DATABASE_URL is not set"),                                  # default host, nobody set a URL
    (_DNS, _DB, False, "${{Postgres.DATABASE_URL}}"),                               # ... and what Railway wants instead
    (_DNS, _DB, True, 'the host "db" does not resolve'),
    ("Temporary failure in name resolution", _DB, True, "does not resolve"),
    (_AT + "Connection refused Is the server running on that host and accepting TCP/IP connections?", _DB,
     True, "nothing is accepting connections on db:5432"),
    (_AT + 'FATAL: password authentication failed for user "brief"', _DB, True, 'rejected user "brief"'),
    (_AT + 'FATAL: password authentication failed for user "brief"', _DB, True, "down -v"),
    (_AT + 'FATAL: role "brief" does not exist', _DB, True, 'rejected user "brief"'),
    (_AT + 'FATAL: database "nope" does not exist', make_url("postgresql://b:x@db/nope"), True, 'no database "nope"'),
    (_AT + "server does not support SSL, but SSL was required", _DB, True, "sslmode=disable"),
    (_AT + 'FATAL: no pg_hba.conf entry for host "1.2.3.4", user "brief", database "x", no encryption',
     _DB, True, "pg_hba.conf"),
    (_AT + "timeout expired", _DB, True, "cannot be reached"),
    (_AT + "Connection timed out", _DB, True, "cannot be reached"),
    (_AT + "Network is unreachable", _DB, True, "cannot be reached"),
    ('invalid dsn: invalid connection option "foo"', _DB, True, "query option"),
    (_AT + "FATAL: the database system is starting up", _DB, True, "DB_WAIT_TIMEOUT"),
    ('connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory',
     _NO_HOST, True, "names no host"),
])
def test_explain(message, url, explicit, expect):
    hint = explain(message, url, explicit=explicit)
    assert hint and expect in hint


def test_explain_stays_quiet_when_it_has_nothing_specific_to_say():
    assert explain("something nobody anticipated", _DB) is None
    assert explain("the classless widget failed", _DB) is None    # "ssl" inside another word is not a TLS problem


# ── entrypoint.sh: the shell glue around it ──────────────────────────────────

def _run_entrypoint(tmp_path, **env):
    """Run the real entrypoint with a stand-in `uvicorn` that just announces itself."""
    fake = tmp_path / "uvicorn"
    fake.write_text('#!/bin/sh\necho "SERVING $*"\n')
    fake.chmod(0o755)
    path = os.pathsep.join([str(tmp_path), os.path.dirname(sys.executable), os.environ.get("PATH", "")])
    return subprocess.run(
        ["sh", "entrypoint.sh"], cwd=BACKEND_DIR, capture_output=True, text=True, timeout=60,
        env={**os.environ, "PATH": path, "RUN_MIGRATIONS": "false", "PYTHONDONTWRITEBYTECODE": "1", **env},
    )


def test_entrypoint_serves_once_the_database_is_reachable(tmp_path):
    r = _run_entrypoint(tmp_path)
    assert r.returncode == 0, r.stderr
    assert "SERVING app.main:app" in r.stdout
    assert r.stderr == ""


def test_entrypoint_stops_and_explains_when_the_database_never_answers(tmp_path):
    port = _closed_port()
    r = _run_entrypoint(tmp_path, DATABASE_URL=f"postgresql://brief:s3cr3tpw@127.0.0.1:{port}/brief_vendors",
                        DB_WAIT_TIMEOUT="1")
    assert r.returncode == 1
    assert "SERVING" not in r.stdout                      # it must not start the API against a dead database
    assert "database never became reachable" in r.stderr
    assert "Connection refused" in r.stderr
    assert "s3cr3tpw" not in r.stderr + r.stdout
