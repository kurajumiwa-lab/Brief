"""Migration 0040 (home office): it downgrades cleanly, upgrades again, and matches the models.

Review finding D10: the downgrade order and the parent revision were never exercised. This test
runs them on a real PostgreSQL database, then checks that the named integrity rules the migration
creates are the same rules the ORM declares (the tests in test_v40_office.py run against the ORM
schema, so drift between the two would otherwise go unnoticed).
"""

import os
import subprocess
import sys

import sqlalchemy as sa
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from tests.test_migrations import BACKEND_DIR, migrated_database_url  # noqa: F401  (session fixture)

OFFICE_TABLES = ("offices", "office_members", "office_events")


def _alembic(url: str, *args: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "DATABASE_URL": url, "AUTO_CREATE_TABLES": "false",
           "REDIS_URL": "", "SECRET_KEY": "migration-test-secret"}
    return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND_DIR, env=env,
                          capture_output=True, text=True)


def _sync_engine(url: str):
    return create_engine(str(make_url(url).set(drivername="postgresql+psycopg2")), poolclass=sa.pool.NullPool)


def _tables(engine) -> set[str]:
    with engine.connect() as conn:
        return {r[0] for r in conn.execute(text(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"))}


def _check_names(engine) -> set[str]:
    with engine.connect() as conn:
        return {r[0] for r in conn.execute(text(
            "SELECT c.conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid "
            "WHERE c.contype = 'c' AND t.relname IN ('offices','office_members','office_events')"))}


def _index_names(engine) -> set[str]:
    with engine.connect() as conn:
        return {r[0] for r in conn.execute(text(
            "SELECT indexname FROM pg_indexes WHERE tablename IN ('offices','office_members','office_events')"))}


def test_0040_downgrades_to_0039_and_upgrades_again(migrated_database_url):
    url = migrated_database_url
    engine = _sync_engine(url)
    try:
        assert set(OFFICE_TABLES) <= _tables(engine)

        down = _alembic(url, "downgrade", "0039_branch_delivery")
        assert down.returncode == 0, down.stdout + down.stderr
        assert not (set(OFFICE_TABLES) & _tables(engine)), "downgrade must remove exactly the office tables"

        up = _alembic(url, "upgrade", "head")
        assert up.returncode == 0, up.stdout + up.stderr
        assert set(OFFICE_TABLES) <= _tables(engine)
    finally:
        engine.dispose()


def test_0040_creates_the_named_rules_the_models_declare(migrated_database_url):
    """The migration and the ORM must agree on every named CHECK and index for the office tables."""
    from app.database import Base
    import app.modules.office.models  # noqa: F401  (registers the office tables)
    from sqlalchemy import CheckConstraint

    orm_checks, orm_indexes = set(), set()
    for name in OFFICE_TABLES:
        table = Base.metadata.tables[name]
        orm_checks |= {c.name for c in table.constraints if isinstance(c, CheckConstraint)}
        orm_indexes |= {i.name for i in table.indexes}

    engine = _sync_engine(migrated_database_url)
    try:
        db_checks, db_indexes = _check_names(engine), _index_names(engine)
    finally:
        engine.dispose()

    # Only the office rules are compared. Other tables' checks are not this migration's business.
    assert orm_checks <= db_checks, f"missing in migration: {sorted(orm_checks - db_checks)}"
    assert orm_indexes <= db_indexes, f"missing in migration: {sorted(orm_indexes - db_indexes)}"
    assert "uq_office_one_active_owner" in db_indexes
    assert "ck_office_members_identity_present" in db_checks
