"""
Test fixtures. A bundled PostgreSQL 16 (pgserver) is started once per session
so the suite runs against the real dialect — JSONB containment, UUIDs, enums,
row locks — anywhere `pip install -r requirements-dev.txt` works.

Set TEST_DATABASE_URL to point at an existing Postgres instead.
"""

import asyncio
import os
import shutil
import tempfile
import uuid

import pytest

_TMP = tempfile.mkdtemp(prefix="brief-pg-")
_server = None

if os.environ.get("TEST_DATABASE_URL"):
    os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]
else:
    import pgserver  # noqa: E402

    _server = pgserver.get_server(_TMP)
    _dbname = f"brief_test_{uuid.uuid4().hex[:8]}"
    _server.psql(f'CREATE DATABASE "{_dbname}";')
    os.environ["DATABASE_URL"] = f"postgresql+asyncpg://postgres@/{_dbname}?host={_TMP}"

os.environ.setdefault("AUTO_CREATE_TABLES", "true")
os.environ.setdefault("REDIS_URL", "redis://127.0.0.1:1/0")  # unreachable → memory limiter
os.environ.setdefault("POS_SYNC_INTERVAL", "3600")
os.environ.setdefault("SECRET_KEY", "test-secret-not-for-production")

from httpx import AsyncClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
async def client():
    async with app.router.lifespan_context(app):
        async with AsyncClient(app=app, base_url="http://test") as c:
            yield c


def pytest_sessionfinish(session, exitstatus):
    global _server
    if _server is not None:
        try:
            _server.cleanup()
        except Exception:
            pass
        _server = None
    shutil.rmtree(_TMP, ignore_errors=True)
