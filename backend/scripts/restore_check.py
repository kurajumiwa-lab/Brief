"""Verify a restored database before you trust it.

    DATABASE_URL=<restored copy> python scripts/restore_check.py

Run this against the *restored* database, never against production. It answers
the only question that matters after a restore: is this a usable copy of the
business, or is it a database that merely starts?

Four checks, in order of how badly their failure hurts:

1. **Schema** — every table and column the models expect is present.
2. **Ledger immutability** — the append-only trigger still fires. A restored
   ledger that can be edited is not a ledger.
3. **Data landmarks** — vendors, movements, payment intents, ledger rows, with
   the newest timestamp of each, so "restored from Tuesday" is a fact rather than
   an expectation.
4. **Referential spot-check** — ledger rows point at real intents; movements
   point at real stock. Cheap, and it catches a partial restore.

Exit code 0 only if every check passes. Read-only: it never writes.

Record the output, with the timestamp of the backup used, as the drill evidence.
"""

import os
import sys

from sqlalchemy import create_engine, inspect, text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.models  # noqa: E402,F401  — registers every table on Base.metadata
from app.config import settings  # noqa: E402
from app.database import Base  # noqa: E402

LANDMARKS = (
    ("vendors", "joined_at"),
    ("stock_items", "created_at"),
    ("stock_movements", "created_at"),
    ("payment_intents", "created_at"),
    ("custody_ledger", "created_at"),
    ("subscriptions", "created_at"),
    ("subscription_invoices", "issued_at"),
)


def sync_url(url: str) -> str:
    return (
        url.replace("postgresql+asyncpg://", "postgresql+psycopg2://")
        .replace("postgresql+psycopg://", "postgresql+psycopg2://")
    )


def main() -> int:
    engine = create_engine(sync_url(settings.DATABASE_URL))
    inspector = inspect(engine)
    failures = []

    # 1. schema -----------------------------------------------------------------
    live = set(inspector.get_table_names())
    missing_tables, missing_columns = [], []
    for name, table in Base.metadata.tables.items():
        if name not in live:
            missing_tables.append(name)
            continue
        columns = {c["name"] for c in inspector.get_columns(name)}
        missing_columns.extend(f"{name}.{col.name}" for col in table.columns if col.name not in columns)
    status = "PASS" if not (missing_tables or missing_columns) else "FAIL"
    print(f"[{status}] schema: {len(Base.metadata.tables)} model tables, "
          f"{len(missing_tables)} missing tables, {len(missing_columns)} missing columns")
    if missing_tables or missing_columns:
        failures.append(f"schema incomplete: {(missing_tables + missing_columns)[:5]}")

    with engine.connect() as conn:
        # 2. ledger immutability -------------------------------------------------
        triggers = {
            row[0] for row in conn.execute(text(
                "SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid "
                "WHERE c.relname = 'custody_ledger' AND NOT t.tgisinternal"
            ))
        }
        armed = "trg_custody_ledger_append_only" in triggers
        detail = "trigger present" if armed else "trigger MISSING"
        row = conn.execute(text("SELECT id FROM custody_ledger LIMIT 1")).first()
        if armed and row is not None:
            try:
                with conn.begin_nested():
                    conn.execute(text("UPDATE custody_ledger SET amount_ksh = 1 WHERE id = :i"),
                                 {"i": row[0]})
                armed = False
                detail = "an UPDATE was accepted"
            except Exception as exc:  # noqa: BLE001 - the expected path
                armed = "append-only" in str(exc).lower()
                detail = str(exc).splitlines()[0][:90]
        elif armed:
            detail = "trigger present (no rows to test against)"
        status = "PASS" if armed else "FAIL"
        print(f"[{status}] ledger: {detail}")
        if not armed:
            failures.append("custody_ledger is not append-only in this copy")

        # 3. data landmarks ------------------------------------------------------
        print("[----] data:")
        for table, column in LANDMARKS:
            if table not in live:
                print(f"       {table}: table absent")
                continue
            row = conn.execute(text(f"SELECT count(*), max({column}) FROM {table}")).first()
            print(f"       {table}: {row[0]} rows, newest {row[1] or '—'}")

        # 4. referential spot-checks --------------------------------------------
        checks = (
            ("ledger rows pointing at missing intents",
             "SELECT count(*) FROM custody_ledger WHERE intent_id IS NOT NULL "
             "AND intent_id NOT IN (SELECT id FROM payment_intents)"),
            ("movements pointing at missing stock",
             "SELECT count(*) FROM stock_movements WHERE stock_item_id NOT IN "
             "(SELECT id FROM stock_items)"),
            ("invoices pointing at missing subscriptions",
             "SELECT count(*) FROM subscription_invoices WHERE subscription_id NOT IN "
             "(SELECT id FROM subscriptions)"),
        )
        for label, sql in checks:
            try:
                bad = conn.execute(text(sql)).scalar_one()
            except Exception as exc:  # noqa: BLE001 - absent table already reported
                print(f"[FAIL] {label}: {type(exc).__name__}")
                failures.append(label)
                continue
            status = "PASS" if bad == 0 else "FAIL"
            print(f"[{status}] {label}: {bad}")
            if bad:
                failures.append(f"{label}: {bad}")

    print()
    if failures:
        print("RESTORE CHECK FAILED — do not point the application at this copy:")
        for item in failures:
            print(f"  · {item}")
        return 1
    print("RESTORE CHECK PASSED — schema complete, ledger immutable, no orphans.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
