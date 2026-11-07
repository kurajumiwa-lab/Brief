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
    for stmt in trust_guard_statements():
        await conn.execute(stmt)


# ── MarketTrust: append-only tables ───────────────────────────────────────────
# One shared guard for branch_verifications, audit_events and points_ledger.
# Kept as separate statements so asyncpg can run them one at a time.
TRUST_APPEND_ONLY_FUNCTION = text("""
CREATE OR REPLACE FUNCTION brief_trust_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
    RETURN NULL;
END;
$$;
""")

TRUST_APPEND_ONLY_TABLES = ("branch_verifications", "audit_events", "points_ledger")


def trust_append_only_drop(table: str):
    return text(f"DROP TRIGGER IF EXISTS trg_{table}_append_only ON {table}")


def trust_append_only_create(table: str):
    return text(f"""
CREATE TRIGGER trg_{table}_append_only
    BEFORE UPDATE OR DELETE ON {table}
    FOR EACH ROW EXECUTE FUNCTION brief_trust_append_only()
""")


def trust_guard_statements() -> list:
    """Every statement needed to install the MarketTrust guards, in order.

    Used by `ensure_guardrails` (dev and tests) and by alembic 0037 (production),
    so the two paths cannot drift apart.
    """
    out = [TRUST_APPEND_ONLY_FUNCTION]
    for table in TRUST_APPEND_ONLY_TABLES:
        out.append(trust_append_only_drop(table))
        out.append(trust_append_only_create(table))
    return out
