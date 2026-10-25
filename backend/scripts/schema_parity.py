"""Does the database on the other end of DATABASE_URL have every table and column
the models expect?

    DATABASE_URL=... python scripts/schema_parity.py

Why this exists next to `alembic check`: `alembic check` also compares index
*names*, and this repo's models use `index=True` (auto-named `ix_table_column`)
while several older migrations used hand-written names. That noise is real but
harmless; a missing table or column is not. This gate answers only the question
that breaks a deploy, and exits non-zero when the answer is bad.

Read-only: inspects, never writes.
"""

import os
import sys

from sqlalchemy import create_engine, inspect

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.models  # noqa: E402,F401  — registers every table on Base.metadata
from app.config import settings  # noqa: E402
from app.database import Base  # noqa: E402


def sync_url(url: str) -> str:
    return (
        url.replace("postgresql+asyncpg://", "postgresql+psycopg2://")
        .replace("postgresql+psycopg://", "postgresql+psycopg2://")
    )


def main() -> int:
    engine = create_engine(sync_url(settings.DATABASE_URL))
    inspector = inspect(engine)
    live = set(inspector.get_table_names())

    missing_tables, missing_columns = [], []
    for name, table in Base.metadata.tables.items():
        if name not in live:
            missing_tables.append(name)
            continue
        columns = {c["name"] for c in inspector.get_columns(name)}
        missing_columns.extend(f"{name}.{col.name}" for col in table.columns if col.name not in columns)

    print(f"model tables:    {len(Base.metadata.tables)}")
    print(f"database tables: {len(live)}")
    print(f"missing tables:  {missing_tables or 'none'}")
    print(f"missing columns: {missing_columns or 'none'}")
    print(f"extra tables:    {sorted(live - set(Base.metadata.tables)) or 'none'}")

    if missing_tables or missing_columns:
        print("\nFAIL — run `alembic upgrade head` before starting this code.")
        return 1
    print("\nPASS — schema matches the models.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
