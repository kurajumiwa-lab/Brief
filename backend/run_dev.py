"""Dev launcher: bundled PostgreSQL + the Outside API on :8000.

Uses the same `pgserver` the test suite uses, so no external database is
required. Not part of the product — a local convenience for running the app.

    ./.venv/bin/python run_dev.py
"""

import os
import subprocess
import sys
import time
import uuid

import pgserver

DATA_DIR = "/tmp/outside-dev-pg"

os.makedirs(DATA_DIR, exist_ok=True)
server = pgserver.get_server(DATA_DIR)
dbname = "outside_dev"
try:
    server.psql(f'CREATE DATABASE "{dbname}";')
except Exception:
    pass  # already there from a previous run

os.environ["DATABASE_URL"] = f"postgresql+asyncpg://postgres@/{dbname}?host={DATA_DIR}"
os.environ.setdefault("SECRET_KEY", "dev-secret-not-for-production")
os.environ.setdefault("AUTO_CREATE_TABLES", "true")
os.environ.setdefault("RUN_SCHEDULER", "false")
os.environ.setdefault("REDIS_URL", "redis://127.0.0.1:1/0")  # unreachable → memory limiter
os.environ.setdefault("CORS_ORIGINS", "*")

# Migrate from zero, exactly as the container entrypoint does.
subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True)

time.sleep(1)
os.execvpe(
    sys.executable,
    [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"],
    os.environ,
)
