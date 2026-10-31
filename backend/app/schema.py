"""
SCHEMA STATE — what the database thinks it is, and the step a deploy forgets.
---------------------------------------------------------------------------
Two production faults wore the same disguise, and both were reported from a
phone in the same afternoon:

  · **Every photograph was missing.** The deployment had no `ENVIRONMENT`
    variable, so `settings.is_production` was False, so `media_store` resolved to
    `local` — and a Vercel function's disk is read-only with an ephemeral /tmp.
    Uploads landed in /tmp, the record kept the URL, the next invocation served a
    404, and every card drew its designed placeholder. Nothing was logged as an
    error because nothing was an error: the file simply was not there.

  · **"The database is reachable but its tables do not exist yet."** The same
    deployment had `AUTO_CREATE_TABLES=true` and no `alembic upgrade head`. So
    boot ran `create_all`, which creates missing *tables* and never missing
    *columns*. Any query that selected a column added after that schema was
    frozen raised `UndefinedColumnError` — an `asyncpg` subclass of
    `ProgrammingError`, which `main.py` was mapping to the "tables do not exist"
    message. A vendor's own shop front therefore claimed the database was empty
    while their shelf rendered perfectly one tab away.

Both are the same underlying thing: **the deployment never ran its migrations,
and nothing told it to.** `create_all` is a development convenience that hides
drift; this module replaces it in production with the real answer.

    report()            what revision the DB is at, what head is, what is missing
    upgrade_to_head()   run `alembic upgrade head`, once, behind an advisory lock

`upgrade_to_head` is safe to call from every instance of a serverless function at
once: `pg_advisory_lock` serialises them, and `alembic` is idempotent once the
schema is at head. It is called from the lifespan when
`RUN_MIGRATIONS_ON_BOOT` resolves true (the default on a managed host), and it
never prevents the app from starting — a failure is recorded and reported by
`/api/health` with the database's own words.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from pathlib import Path
from typing import Optional

from sqlalchemy import text

log = logging.getLogger("brief.schema")

BACKEND_DIR = Path(__file__).resolve().parent.parent
ALEMBIC_INI = BACKEND_DIR / "alembic.ini"
ALEMBIC_DIR = BACKEND_DIR / "alembic"

#: One lock, one migrator. Any random 32-bit constant works as long as every
#: deploy uses the same one — this spells "BRIEF" in hex-ish.
LOCK_ID = 0x0B21EF

#: The tables whose absence explains a whole class of broken screen. Checking
#: five names is cheap (to_regclass is an index lookup) and turns "something is
#: wrong" into "media_objects is missing".
CRITICAL_TABLES = (
    "vendors",
    "vendor_profiles",
    "stock_items",
    "media_objects",
    "market_observations",
)


def _config():
    """An Alembic config that works whatever the process's cwd is.

    Vercel runs the function from the service root, a container may run it from
    `/app`, and a test runs from `backend/`. Resolving `script_location` from
    this file removes the guess.
    """
    from alembic.config import Config

    cfg = Config(str(ALEMBIC_INI) if ALEMBIC_INI.exists() else None)
    cfg.set_main_option("script_location", str(ALEMBIC_DIR))
    cfg.set_main_option("prepend_sys_path", str(BACKEND_DIR))
    return cfg


_head_cache: dict[str, Optional[str]] = {}


def head_revision() -> Optional[str]:
    """The revision the code expects. Reads the version files, not the DB.

    Cached: the version files cannot change inside a running process, and
    `/api/health` is polled.
    """
    if "head" in _head_cache:
        return _head_cache["head"]
    try:
        from alembic.script import ScriptDirectory

        head = ScriptDirectory.from_config(_config()).get_current_head()
    except Exception as exc:  # a missing ini, a broken version file
        log.warning("schema: cannot read the migration head: %s", exc)
        head = None
    _head_cache["head"] = head
    return head


def _revision_path(current: Optional[str], head: Optional[str]) -> list[str]:
    """Every revision between `current` and `head`, oldest first.

    Alembic can answer this exactly; the filesystem walk is the fallback when the
    script directory cannot be loaded (a partial deploy that did not ship
    `alembic/`).
    """
    try:
        from alembic.script import ScriptDirectory

        script = ScriptDirectory.from_config(_config())
        if current is None:
            return [rev.revision for rev in script.walk_revisions(base="base", head="head")][::-1]
        return [rev.revision for rev in script.walk_revisions(base=current, head=head or "head")][::-1]
    except Exception:
        return []


async def _read_state() -> dict:
    """Revision, missing tables, missing columns — over one connection.

    One connect, not three: on a serverless host every connection is a fresh TCP
    and TLS handshake against a managed Postgres, and `/api/health` is polled.
    """
    from app.database import engine

    try:
        async with engine.connect() as conn:
            current = await conn.run_sync(_read_revision)
            missing = await _missing_tables(conn)
            drifted = await _column_gaps(conn) if not missing else {}
            return {
                "current": current,
                "missing_tables": missing,
                "drifted": drifted,
                "reachable": True,
            }
    except Exception as exc:
        log.warning("schema: cannot read the schema state: %s", exc)
        return {
            "current": None,
            "missing_tables": [],
            "drifted": {},
            "reachable": False,
            "error": str(exc)[:300],
        }


async def _column_gaps(conn) -> dict:
    """Critical tables whose columns do not match the models. One query.

    A table can exist and still be the wrong shape — that is the difference
    between the two faults in this thread. `media_objects` present but
    `stock_items` missing a column added later fails every shelf query, and the
    database reports it as `UndefinedColumnError`, not a missing table.

    Only `CRITICAL_TABLES` are inspected: each one missing produces a whole
    broken screen, and checking sixty tables on every health poll would make the
    poll itself the problem.
    """
    from sqlalchemy import text as sql

    from app.database import Base
    import app.models  # noqa: F401  — registers every table on Base.metadata

    expected = {}
    for name in CRITICAL_TABLES:
        table = Base.metadata.tables.get(name)
        if table is not None:
            expected[name] = {column.name for column in table.columns}

    rows = (await conn.execute(
        sql(
            "SELECT table_name, column_name FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = ANY(:names)"
        ),
        {"names": list(expected)},
    )).all()
    present: dict[str, set[str]] = {}
    for table_name, column_name in rows:
        present.setdefault(table_name, set()).add(column_name)

    gaps = {}
    for name, columns in expected.items():
        missing = sorted(columns - present.get(name, set()))
        if missing:
            gaps[name] = missing
    return gaps


def _read_revision(sync_conn) -> Optional[str]:
    from alembic.runtime.migration import MigrationContext

    return MigrationContext.configure(sync_conn).get_current_revision()


async def _missing_tables(conn) -> list[str]:
    missing = []
    for name in CRITICAL_TABLES:
        found = (
            await conn.execute(text("SELECT to_regclass(:n)"), {"n": f"public.{name}"})
        ).scalar()
        if found is None:
            missing.append(name)
    return missing


async def report() -> dict:
    """The whole answer in one object, for `/api/health` and the ops screen."""
    head = head_revision()
    state = await _read_state()
    current = state["current"]
    pending = _revision_path(current, head) if (head and current != head) else []
    return {
        "current": current,
        "head": head,
        "stamped": bool(current),
        "pending": pending,
        "pending_count": len(pending),
        "at_head": bool(head) and current == head,
        "missing_tables": state["missing_tables"],
        "drifted": state["drifted"],
        "reachable": state["reachable"],
        "migrations_available": ALEMBIC_INI.exists() and ALEMBIC_DIR.exists(),
    }


DUPLICATE_MARKERS = (
    "already exists",
    "DuplicateTable",
    "DuplicateColumn",
    "DuplicateObject",
    'duplicate key value violates unique constraint "pg_type_typname_nsp_index"',
)


def _is_duplicate(exc: BaseException) -> bool:
    """Did this migration fail only because its object is already there?

    A database built by `create_all` has the tables but no `alembic_version`
    row, so replaying migration 0001 tries to CREATE a table that exists. That is
    not a broken migration — it is a database that was never stamped, and the
    honest repair is to record the object as present and move on.
    """
    text_ = f"{type(exc).__name__}: {exc}"
    return any(marker in text_ for marker in DUPLICATE_MARKERS)


def _pending_sync() -> list[str]:
    """Pending revisions, read over one short-lived sync engine."""
    from sqlalchemy import create_engine

    from app.config import settings

    engine = create_engine(settings.database_url_sync, future=True)
    try:
        with engine.connect() as conn:
            current = _read_revision(conn)
    finally:
        engine.dispose()
    head = head_revision()
    if current == head:
        return []
    return _revision_path(current, head)


def _upgrade_sync() -> dict:
    """Bring the schema to head, one revision at a time, under an advisory lock.

    Blocking on purpose; called through `asyncio.to_thread`.

    Revision by revision rather than one `upgrade head` call, because of the
    un-stamped database described in `_is_duplicate`: a single `upgrade head`
    stops at the first already-present table and leaves every later migration
    unapplied — which is exactly the state that produced the 503 that started
    this. Stepping and stamping converges on the same place Alembic would have
    reached, and records what it did.
    """
    from alembic import command

    from app.config import settings

    started = time.monotonic()
    applied: list[str] = []
    stamped: list[str] = []
    lock_conn = None
    try:
        import psycopg2

        url = settings.database_url_sync.replace("postgresql+psycopg2://", "postgresql://")
        lock_conn = psycopg2.connect(url, connect_timeout=10)
        lock_conn.autocommit = True
        with lock_conn.cursor() as cur:
            # Wait rather than skip: an instance that returns before the schema is
            # ready serves a broken page to the first person who requests it.
            cur.execute("SELECT pg_advisory_lock(%s)", (LOCK_ID,))

        cfg = _config()
        for revision in _pending_sync():
            try:
                command.upgrade(cfg, revision)
                applied.append(revision)
            except Exception as exc:
                if not _is_duplicate(exc):
                    raise
                command.stamp(cfg, revision)
                stamped.append(revision)
                log.warning(
                    "schema: %s already present on this database — stamped, not re-run",
                    revision,
                )

        return {
            "ran": True,
            "applied": applied,
            # Named differently from `report()["stamped"]` (a boolean) on purpose:
            # `upgrade_to_head` merges the two dicts, and the same key would let
            # one silently overwrite the other in the log line and the JSON.
            "stamped_revisions": stamped,
            "seconds": round(time.monotonic() - started, 2),
            "error": None,
        }
    except Exception as exc:
        log.exception("schema: `alembic upgrade head` failed")
        return {
            "ran": False,
            "applied": applied,
            "stamped_revisions": stamped,
            "seconds": round(time.monotonic() - started, 2),
            "error": f"{type(exc).__name__}: {exc}",
        }
    finally:
        if lock_conn is not None:
            try:
                with lock_conn.cursor() as cur:
                    cur.execute("SELECT pg_advisory_unlock(%s)", (LOCK_ID,))
                lock_conn.close()
            except Exception:
                pass


async def upgrade_to_head() -> dict:
    """Apply every pending migration, then report where the database ended up."""
    if not (ALEMBIC_INI.exists() and ALEMBIC_DIR.exists()):
        # A deploy that did not ship `alembic/` cannot migrate. Say so once,
        # clearly, instead of failing on the first query that needs a column.
        return {"ran": False, "error": "alembic/ was not deployed with the API"}

    result = await asyncio.to_thread(_upgrade_sync)
    state = await report()
    result.update(state)
    if result.get("error"):
        log.error("schema: still behind head after upgrade: %s", result["error"])
    elif state.get("at_head"):
        log.info(
            "schema: at head %s (%ss)", state.get("head"), result.get("seconds")
        )
    return result


def describe_missing(exc: BaseException) -> Optional[str]:
    """Turn a driver error into the sentence a maintainer needs.

    `ProgrammingError` is a catch-all: a missing table, a missing column, a bad
    literal cast and a permission problem all arrive as one. The deployed app
    reported every one of them as "the tables do not exist", which sent the first
    person who read it looking for an empty database that was not empty.
    """
    orig = getattr(exc, "orig", exc)
    name = type(orig).__name__
    message = " ".join(str(orig).split())[:240]

    if "UndefinedTable" in name or re.search(r'relation "?[\w.]+"? does not exist', message):
        return (
            f"The database is missing a table this version needs ({message}). "
            "Its schema was never fully created."
        )
    if "UndefinedColumn" in name or re.search(r'column "?[\w.]+"? does not exist', message):
        return (
            f"The database is missing a column this version needs ({message}). "
            "The schema is behind the application, not empty."
        )
    if "UndefinedFunction" in name or "does not exist" in message and "function" in message:
        return f"The database is missing a function this version needs ({message})."
    if "InsufficientPrivilege" in name or "permission denied" in message:
        return (
            f"The database user is not allowed to do this ({message}). "
            "Check the role granted to DATABASE_URL."
        )
    return None


def serverless() -> bool:
    """Is this process running on a host whose disk does not survive a request?"""
    markers = (
        "VERCEL",
        "AWS_LAMBDA_FUNCTION_NAME",
        "K_SERVICE",
        "NETLIFY",
        "CF_PAGES",
        "DYNO",
        "RAILWAY_ENVIRONMENT",
        "FLY_APP_NAME",
        "RENDER",
    )
    return any(os.environ.get(marker) for marker in markers)
