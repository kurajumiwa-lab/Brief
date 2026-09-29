"""
Run the API against an embedded PostgreSQL — no Docker, no system Postgres.

    pip install -r requirements-dev.txt      # pulls in pgserver (bundled PG 16)
    python dev_local.py                      # http://0.0.0.0:8000

The database lives in ./.pgdata (git-ignored) and survives restarts. Every
setting can still be overridden through the environment; DATABASE_URL is only
defaulted when you have not set one yourself.
"""

import os
import pathlib
import sys

import pgserver
import uvicorn

data_dir = pathlib.Path(os.environ.get("PG_DATA_DIR", ".pgdata")).resolve()
db_name = os.environ.get("PG_DBNAME", "brief")

server = pgserver.get_server(str(data_dir))
try:
    server.psql(f'CREATE DATABASE "{db_name}";')
except Exception:
    pass  # already exists

os.environ.setdefault("DATABASE_URL", f"postgresql+asyncpg://postgres@/{db_name}?host={data_dir}")
os.environ.setdefault("AUTO_CREATE_TABLES", "true")
os.environ.setdefault("REDIS_URL", "")  # in-memory rate limiter unless you point at a Redis

host = os.environ.get("HOST", "0.0.0.0")
port = int(os.environ.get("PORT", "8000"))
print(f"embedded postgres at {data_dir} · database {db_name} · api on http://{host}:{port}", file=sys.stderr)

uvicorn.run("app.main:app", host=host, port=port, reload="--reload" in sys.argv, log_level="info")
