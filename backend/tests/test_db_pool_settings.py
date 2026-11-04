"""The connection pool must respect DB_POOL_SIZE / DB_MAX_OVERFLOW.

The live Supabase Session pooler caps total connections, so each API copy
must be able to keep its footprint small. These tests pin the wiring.
"""

from app.config import settings
from app.database import _pool_options, engine


def test_pool_options_follow_settings(monkeypatch):
    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql+asyncpg://u:p@h/db")
    monkeypatch.setattr(settings, "DB_POOL_SIZE", 2)
    monkeypatch.setattr(settings, "DB_MAX_OVERFLOW", 0)
    assert _pool_options() == {"pool_size": 2, "max_overflow": 0}


def test_sqlite_gets_no_pool_options(monkeypatch):
    monkeypatch.setattr(settings, "DATABASE_URL", "sqlite+aiosqlite:///x.db")
    assert _pool_options() == {}


def test_engine_uses_configured_pool_size():
    # The test engine is built from the test DATABASE_URL, so its pool reflects
    # the defaults only when that URL is Postgres (it always is in this suite).
    if engine.dialect.name != "postgresql":
        return
    assert engine.pool.size() == settings.DB_POOL_SIZE
