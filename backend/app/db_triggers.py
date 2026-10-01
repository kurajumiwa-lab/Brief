"""Database-level guardrails that ORM models cannot express.

Applied by `alembic upgrade head` in production and by `init_db()` in dev
(`AUTO_CREATE_TABLES=true`), so the two paths stay in lock-step.
"""

from sqlalchemy import text

LEDGER_APPEND_ONLY_TRIGGER = text("""
CREATE OR REPLACE FUNCTION brief_custody_ledger_no_mutate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'custody_ledger is append-only: % is not allowed (id=%)',
        TG_OP, CASE WHEN TG_OP = 'UPDATE' THEN OLD.id WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    RETURN NULL;
END;
$$;
""")

# Kept as separate statements: asyncpg refuses multi-statement prepared SQL.
LEDGER_APPEND_ONLY_TRIGGER_DROP = text(
    "DROP TRIGGER IF EXISTS trg_custody_ledger_append_only ON custody_ledger")
LEDGER_APPEND_ONLY_TRIGGER_CREATE = text("""
CREATE TRIGGER trg_custody_ledger_append_only
    BEFORE UPDATE OR DELETE ON custody_ledger
    FOR EACH ROW EXECUTE FUNCTION brief_custody_ledger_no_mutate()
""")


async def ensure_guardrails(conn) -> None:
    """Install the guardrails on a raw connection (idempotent)."""
    await conn.execute(LEDGER_APPEND_ONLY_TRIGGER)
    await conn.execute(LEDGER_APPEND_ONLY_TRIGGER_DROP)
    await conn.execute(LEDGER_APPEND_ONLY_TRIGGER_CREATE)
