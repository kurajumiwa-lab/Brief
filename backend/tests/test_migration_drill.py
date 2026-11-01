"""The migration drill is only worth trusting if it fails when a migration is bad.

`test_migrations.py` proves the chain applies to an *empty* database. The
deployed one is not empty, and the failure that costs a deploy is the migration
that works on nothing and breaks on rows. So the drill in
`scripts/migration_drill.py` has to be proven in both directions: it passes over
realistic data, and it fails — loudly, naming the error — when a migration would
break it.

The second test writes a deliberately broken revision as a child of the current
head and deletes it again. If it ever leaks into the repo, the version files
stop describing the schema the models expect, so it is removed in a `finally`
and the file is asserted gone at the end.
"""

import os
import subprocess
import sys
import uuid

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRILL = os.path.join(BACKEND_DIR, "scripts", "migration_drill.py")
VERSIONS = os.path.join(BACKEND_DIR, "alembic", "versions")


def _scratch_database(name_prefix: str = "brief_drill_") -> str:
    """A new database on the server the suite already runs, as a sync DSN."""
    from sqlalchemy.engine import make_url

    from tests import conftest

    base = os.environ["DATABASE_URL"]
    name = f"{name_prefix}{uuid.uuid4().hex[:8]}"
    server = getattr(conftest, "_server", None)
    if server is not None:
        server.psql(f'CREATE DATABASE "{name}";')
        return str(make_url(base).set(database=name).set(drivername="postgresql"))

    import sqlalchemy as sa
    from sqlalchemy import create_engine, text

    admin = create_engine(
        make_url(base).set(database="postgres", drivername="postgresql+psycopg2"),
        isolation_level="AUTOCOMMIT",
        poolclass=sa.pool.NullPool,
    )
    try:
        with admin.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{name}"'))
    finally:
        admin.dispose()
    return str(make_url(base).set(database=name).set(drivername="postgresql"))


def _drill(dsn: str, from_revision: str) -> subprocess.CompletedProcess:
    """Run the drill the way an operator does — a subprocess.

    `app.config.settings` is a module-level singleton built from the environment
    at first import, so repointing it at another database from inside this
    process would repoint the API the rest of the suite is exercising. The same
    reason `test_migrations.py` shells out.
    """
    env = {
        **os.environ,
        "DATABASE_URL": dsn.replace("postgresql://", "postgresql+asyncpg://", 1),
        "DATABASE_URL_SYNC": dsn,
        "AUTO_CREATE_TABLES": "false",
        "RUN_SCHEDULER": "false",
        "SECRET_KEY": "migration-drill-test-secret-000000000000",
        "REDIS_URL": "",
    }
    for marker in ("ENVIRONMENT", "VERCEL", "VERCEL_ENV", "RAILWAY_ENVIRONMENT"):
        env.pop(marker, None)
    return subprocess.run(
        [sys.executable, DRILL, "--dsn", dsn, "--from", from_revision],
        cwd=BACKEND_DIR, env=env, capture_output=True, text=True, timeout=600,
    )


@pytest.fixture
def scratch_database() -> str:
    """One database per drill run: a second run on a migrated, populated database
    is not the situation the drill is meant to reproduce."""
    return _scratch_database()


def test_the_drill_passes_over_a_database_that_already_has_rows(scratch_database):
    result = _drill(scratch_database, "0010_market_patrons")
    output = result.stdout + result.stderr
    assert result.returncode == 0, f"the drill failed over seeded data:\n{output}"
    assert "PASS" in result.stdout
    # The three claims that make the drill worth running.
    assert "row inserted" in output
    assert "at head: True" in output
    assert "rows after migration:" in output
    assert "model read:" in output


def test_the_drill_fails_when_a_migration_would_break_live_data(scratch_database):
    """A NOT NULL column with no default: fine on an empty table, fatal on a full one."""
    from app import schema

    head = schema.head_revision()
    assert head, "could not read the current migration head"

    broken = os.path.join(VERSIONS, "9900_drill_bad_migration.py")
    with open(broken, "w", encoding="utf-8") as handle:
        handle.write(
            f'''"""Deliberately broken — written and deleted by tests/test_migration_drill.py."""

from alembic import op

revision = "9900_drill_bad_migration"
down_revision = "{head}"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Succeeds on an empty table, fails the moment a row exists. Exactly the
    # migration that passes CI and takes down the first cold start after a deploy.
    op.execute('ALTER TABLE "vendors" ADD COLUMN "drill_bad" integer NOT NULL')


def downgrade() -> None:
    op.execute('ALTER TABLE "vendors" DROP COLUMN "drill_bad"')
'''
        )
    try:
        result = _drill(scratch_database, head)
        output = result.stdout + result.stderr
        assert result.returncode == 1, (
            "the drill passed with a migration that cannot apply over live rows — "
            f"it is not testing what it claims:\n{output}"
        )
        assert "would have failed its first boot" in output
        assert "drill_bad" in output or "not-null" in output.lower() or "null" in output.lower()
        assert "PASS" not in result.stdout
    finally:
        os.remove(broken)
    assert not os.path.exists(broken)


def test_the_drill_refuses_a_production_looking_dsn():
    result = subprocess.run(
        [sys.executable, DRILL, "--dsn", "postgresql://u:p@prod-db.internal/x"],
        cwd=BACKEND_DIR, capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 2
    assert "Refusing" in result.stdout
