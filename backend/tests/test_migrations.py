"""Guard the migration path itself.

Every other test in this suite boots the schema from the ORM
(`AUTO_CREATE_TABLES=true`), which builds whatever `Base.metadata` declares.
Production never does that: `entrypoint.sh` runs `alembic upgrade head` and the
app serves. Those are two independent descriptions of the same schema, and
nothing checked that they agree — so they drifted, CI stayed green, and the
deploy broke instead. The deploy is the one place a schema bug cannot be
iterated on quickly, which makes it the worst place to find one.

The drift that actually happened: `0012_business_requests` created its four
PostgreSQL enum types under snake_case names (`request_type`, …) while the ORM
derives the name from the Python class (`RequestType` → `requesttype`). The
mismatch is silent until something hard-codes the ORM's name in DDL — which
`0015_business_standing` did — at which point `alembic upgrade head` dies with
`type "requesttype" does not exist` and the container never serves anything.

So: migrate a throwaway database from scratch and assert the enum types the
models declare are the ones the migrations produce, under the same name, on
every column that uses them.
"""

import os
import subprocess
import sys
import uuid

import pytest
import sqlalchemy as sa
from sqlalchemy import create_engine, text

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _scratch_database(async_url: str) -> str:
    """A brand-new database on the same server the suite already runs against,
    so the migration chain starts from nothing exactly as it does on a fresh
    deploy."""
    from sqlalchemy.engine import make_url

    url = make_url(async_url)
    name = f"brief_migr_{uuid.uuid4().hex[:8]}"
    admin = create_engine(url.set(database="postgres", drivername="postgresql+psycopg2"),
                          isolation_level="AUTOCOMMIT", poolclass=sa.pool.NullPool)
    try:
        with admin.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{name}"'))
    finally:
        admin.dispose()
    return str(url.set(database=name))


@pytest.fixture(scope="session")
def migrated_database_url():
    """`alembic upgrade head` against an empty database, run in a subprocess.

    A subprocess because alembic reads `app.config.settings`, a module-level
    singleton: pointing it at another database from in here would repoint the
    API the rest of the suite is exercising.
    """
    from tests import conftest  # the session server conftest started

    base = os.environ["DATABASE_URL"]
    pgserver = getattr(conftest, "_server", None)
    if pgserver is None:
        url = _scratch_database(base)
    else:
        name = f"brief_migr_{uuid.uuid4().hex[:8]}"
        pgserver.psql(f'CREATE DATABASE "{name}";')
        from sqlalchemy.engine import make_url

        url = str(make_url(base).set(database=name))

    env = {**os.environ, "DATABASE_URL": url, "AUTO_CREATE_TABLES": "false",
           "REDIS_URL": "", "SECRET_KEY": "migration-test-secret"}
    result = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"],
                            cwd=BACKEND_DIR, env=env, capture_output=True, text=True)
    assert result.returncode == 0, (
        "`alembic upgrade head` failed — the production boot path is broken:\n"
        f"{result.stdout}\n{result.stderr}"
    )
    return url


def _expected_enum_columns():
    """{(type name): {(table, column)}} for every native enum the ORM declares."""
    from app.database import Base
    import app.models  # noqa: F401  — registers every table on the metadata

    expected = {}
    for table in Base.metadata.tables.values():
        for column in table.columns:
            ctype = column.type
            if isinstance(ctype, sa.Enum) and ctype.native_enum and ctype.name:
                expected.setdefault(ctype.name, set()).add((table.name, column.name))
    return expected


def _actual_enum_columns(sync_url: str):
    """What the database actually ended up with: type name → {(table, column)}."""
    engine = create_engine(sync_url, poolclass=sa.pool.NullPool)
    try:
        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT c.table_name, c.column_name, c.udt_name "
                "FROM information_schema.columns c "
                "WHERE c.table_schema = 'public' AND c.udt_name IN "
                "      (SELECT t.typname FROM pg_type t "
                "       JOIN pg_enum e ON e.enumtypid = t.oid)"))
            actual = {}
            for table, column, type_name in rows:
                actual.setdefault(type_name, set()).add((table, column))
            return actual
    finally:
        engine.dispose()


def test_migrations_create_every_enum_the_models_declare(migrated_database_url):
    """A type the ORM declares but the migrations never create is the bug that
    took the deploy down — it only surfaces when some later migration names it
    in DDL, by which point it is a production incident rather than a red build."""
    from sqlalchemy.engine import make_url

    sync_url = str(make_url(migrated_database_url).set(drivername="postgresql+psycopg2"))
    expected = _expected_enum_columns()
    actual = _actual_enum_columns(sync_url)

    assert expected, "no native enums found in the metadata — this guard has stopped testing anything"

    missing = {name: sorted(cols) for name, cols in expected.items() if name not in actual}
    assert not missing, (
        "the migrations never created these enum types under the names the ORM uses "
        f"(they are created, if at all, under different names): {missing}"
    )


def test_migrations_bind_enum_columns_to_the_declared_type(migrated_database_url):
    """Stronger than the check above: not only must the type exist, the column
    must use it. A column left on a same-values, differently-named type passes
    the existence check and still breaks every cast the ORM emits."""
    from sqlalchemy.engine import make_url

    sync_url = str(make_url(migrated_database_url).set(drivername="postgresql+psycopg2"))
    expected = _expected_enum_columns()
    actual = _actual_enum_columns(sync_url)

    wrong = {}
    for type_name, columns in expected.items():
        for column in columns:
            if column not in actual.get(type_name, set()):
                bound_to = next((t for t, cols in actual.items() if column in cols), None)
                wrong[f"{column[0]}.{column[1]}"] = f"expected {type_name!r}, bound to {bound_to!r}"

    assert not wrong, f"enum columns bound to the wrong PostgreSQL type: {wrong}"


def test_migration_head_matches_the_revision_the_models_are_on(migrated_database_url):
    """`upgrade head` applied every revision — a chain that stops early leaves
    tables the code queries, and the failure shows up as a 500, not a 500-line
    traceback."""
    from sqlalchemy.engine import make_url

    from alembic.config import Config
    from alembic.script import ScriptDirectory

    sync_url = str(make_url(migrated_database_url).set(drivername="postgresql+psycopg2"))
    heads = ScriptDirectory.from_config(
        Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    ).get_heads()

    engine = create_engine(sync_url, poolclass=sa.pool.NullPool)
    try:
        with engine.connect() as conn:
            current = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    finally:
        engine.dispose()

    assert [current] == heads, f"database is at {current!r} but the migration head is {heads!r}"
