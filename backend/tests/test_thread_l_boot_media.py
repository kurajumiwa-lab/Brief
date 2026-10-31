"""Thread L — the two faults that emptied a deployed shop front.

Both were reported from a phone on the same afternoon, and neither looked like
what it was:

  · **A stock card with no photograph.** The deployment had no `ENVIRONMENT`
    variable, so `is_production` was False, so `media_store` resolved to `local`.
    A Vercel function's disk is read-only with an ephemeral /tmp: the upload
    succeeded, the row kept the URL, the next invocation answered 404, and every
    card drew its designed placeholder. Nothing raised, so nothing was logged.

  · **"No vendor answers to @ogallo."** The page's title was the API's own
    sentence — "The database is reachable but its tables do not exist yet." — and
    the description under it said the vendor did not exist. The vendor did exist;
    their shelf rendered one tab away. The database was not empty either: a
    column added by a migration that had never run was the whole fault.

The tests below pin the three behaviours that make those screens honest:

  1. a managed host is detected from the host itself, not from a variable
     somebody has to remember, and it never writes media to a disk it will lose;
  2. the schema is migrated at boot, and `/api/health` says which revision it is
     at, which migrations are pending, and which tables or columns are absent;
  3. a `ProgrammingError` is described by what actually failed.
"""

import os
import re

import pytest

from app import schema
from app.config import Settings
from app.services.storage import StorageError, storage

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOST_MARKERS = ("VERCEL", "AWS_LAMBDA_FUNCTION_NAME", "K_SERVICE", "RENDER", "DYNO", "FLY_APP_NAME")


@pytest.fixture
def clean_env(monkeypatch):
    """Remove every host marker, so a marker a test sets is the only one set."""
    for marker in HOST_MARKERS:
        monkeypatch.delenv(marker, raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    return monkeypatch


# ── 1. the host knows where it is running ───────────────────────────────────


def test_a_deploy_without_ENVIRONMENT_still_gets_durable_media(clean_env):
    """The exact configuration that lost every photograph.

    No `ENVIRONMENT`, no `S3_BUCKET`, running on Vercel. Before this, that
    resolved to `local` — a disk the next request does not have.
    """
    clean_env.setenv("VERCEL", "1")
    deployed = Settings(S3_BUCKET="", MEDIA_STORE="auto", AUTO_CREATE_TABLES=True)

    assert deployed.is_managed_host is True
    assert deployed.is_production is False, "ENVIRONMENT was never set — that is the finding"
    assert deployed.media_store == "db", "a serverless host must keep bytes in Postgres"


def test_a_managed_host_never_creates_tables_with_create_all(clean_env):
    """`create_all` cannot add a column, so on a deployed host it only hides drift."""
    clean_env.setenv("VERCEL", "1")
    deployed = Settings(S3_BUCKET="", MEDIA_STORE="auto", AUTO_CREATE_TABLES=True)

    assert deployed.auto_create_tables is False
    assert deployed.run_migrations_on_boot is True


def test_a_development_machine_is_unchanged(clean_env):
    dev = Settings(ENVIRONMENT="development", S3_BUCKET="", MEDIA_STORE="auto", AUTO_CREATE_TABLES=True)

    assert dev.is_managed_host is False
    assert dev.media_store == "local"
    assert dev.auto_create_tables is True
    assert dev.run_migrations_on_boot is False, "a developer's database is built by create_all"


def test_an_explicit_switch_overrides_the_host_default(clean_env):
    clean_env.setenv("VERCEL", "1")
    off = Settings(S3_BUCKET="", RUN_MIGRATIONS_ON_BOOT=False)
    assert off.run_migrations_on_boot is False

    clean_env.delenv("VERCEL")
    on = Settings(S3_BUCKET="", RUN_MIGRATIONS_ON_BOOT=True)
    assert on.run_migrations_on_boot is True


def test_production_S3_is_never_overridden_by_the_db_default(clean_env):
    """A bucket is a better answer than BYTEA and must keep winning."""
    clean_env.setenv("VERCEL", "1")
    deployed = Settings(S3_BUCKET="brief-media", MEDIA_STORE="auto")
    assert deployed.media_store == "s3"


async def test_a_managed_host_refuses_to_write_an_upload_to_a_disk_it_will_lose(
    client, clean_env, monkeypatch
):
    """A failed upload is a five-minute fix; a successful one that evaporates is not.

    This is the difference between the two outcomes: `HTTPException(503)` with an
    instruction, or a 201 and a photograph that is gone by the next request.
    """
    import uuid

    clean_env.setenv("VERCEL", "1")
    monkeypatch.setattr(storage, "store", "local")

    suffix = uuid.uuid4().hex[:6]
    reg = await client.post("/api/auth/register", json={
        "business_name": f"Lost Photo {suffix}",
        "vendor_handle": f"lost_{suffix}",
        "email": f"lost_{suffix}@example.com",
        "password": "Correct-horse-9",
        "business_categories": ["produce"],
        "physical_location": "Kisumu",
    })
    assert reg.status_code == 201, reg.text

    upload = await client.post(
        "/api/files/upload",
        headers={"Authorization": f"Bearer {reg.json()['access_token']}"},
        files={"file": ("shelf.jpg", b"\xff\xd8\xff\xe0brief\xff\xd9", "image/jpeg")},
    )

    assert upload.status_code == 503, upload.text
    assert "MEDIA_STORE=db" in upload.json()["detail"]
    assert "S3_BUCKET" in upload.json()["detail"]


def test_storage_raises_rather_than_swallowing(clean_env):
    clean_env.setenv("VERCEL", "1")
    original = storage.store
    storage.store = "local"
    try:
        with pytest.raises(StorageError):
            import asyncio

            asyncio.get_event_loop().run_until_complete(
                storage.upload(b"\xff\xd8\xff\xe0x\xff\xd9", "shelf.jpg", "image/jpeg")
            )
    finally:
        storage.store = original


# ── 2. the schema says where it is ──────────────────────────────────────────


def test_the_head_is_the_newest_migration_file():
    """Health can only be trusted if its `head` is the one Alembic would apply.

    Revision files are numbered, and the chain is linear, so the highest number
    is the head. A file added without Alembic noticing (a hand-written revision
    whose `down_revision` points at a branch point, a renamed file) breaks this —
    and a wrong `head` would make every "pending" count in health a lie.
    """
    versions = os.path.join(BACKEND, "alembic", "versions")
    revisions = sorted(
        name[:-3] for name in os.listdir(versions)
        if name.endswith(".py") and re.match(r"^\d{4}", name)
    )
    newest = revisions[-1]

    head = schema.head_revision()
    assert head, "the migration head could not be read at all"
    assert head == newest, f"{newest} is the newest file but health reports head {head}"


def test_every_critical_table_is_a_real_model():
    """A stale name here would report a healthy database as broken forever."""
    import app.models  # noqa: F401

    from app.database import Base

    for name in schema.CRITICAL_TABLES:
        assert name in Base.metadata.tables, f"schema.CRITICAL_TABLES lists {name}, which no model defines"


def test_a_missing_column_is_not_reported_as_a_missing_table():
    """The exact misdiagnosis that sent someone looking for a deleted vendor."""

    class UndefinedTableError(Exception):
        pass

    class UndefinedColumnError(Exception):
        pass

    class Wrapped(Exception):
        def __init__(self, orig):
            self.orig = orig

    column = schema.describe_missing(
        Wrapped(UndefinedColumnError('column stock_items.brand_line does not exist'))
    )
    assert "column" in column.lower()
    assert "behind the application" in column
    assert "missing a table" not in column.lower()

    table = schema.describe_missing(Wrapped(UndefinedTableError('relation "media_objects" does not exist')))
    assert "missing a table" in table
    assert "media_objects" in table

    privilege = schema.describe_missing(Wrapped(Exception("permission denied for table vendors")))
    assert "not allowed" in privilege

    # Anything else is left alone: guessing is how the first wrong message shipped.
    assert schema.describe_missing(Wrapped(Exception("invalid input syntax for integer"))) is None


def test_the_duplicate_check_covers_the_unstamped_database():
    """A `create_all` database has the tables but no version row.

    Replaying 0001 then fails with "already exists" — which is not a broken
    migration, and must not stop the other twenty-nine from being recorded.
    """

    class DuplicateTable(Exception):
        pass

    assert schema._is_duplicate(DuplicateTable('relation "vendors" already exists')) is True
    assert schema._is_duplicate(
        DuplicateTable(
            'duplicate key value violates unique constraint "pg_type_typname_nsp_index"'
        )
    ) is True
    assert schema._is_duplicate(Exception("syntax error at or near SELECT")) is False


# ── 3. health tells the truth ───────────────────────────────────────────────


async def test_health_reports_the_schema_state_not_just_a_boolean(client):
    response = await client.get("/api/health")
    body = response.json()

    assert body["database"] is True
    state = body["schema_state"]
    assert state["head"] and re.match(r"^\d{4}", state["head"]), state
    # The test database is built by create_all, so it is complete but unstamped.
    assert state["missing_tables"] == []
    assert state["drifted"] == {}, state
    assert body["schema"] is True
    assert response.status_code == 200, body

    # `local` is durable on nothing: the hint must appear exactly when the store
    # cannot promise the file is there on the next request.
    durable = body["media_store"] in ("db", "s3")
    assert body["media_durable"] is durable, body
    assert ("media_hint" in body) is (not durable), body

    if not state["stamped"]:
        assert "note" in body, "an unstamped schema must be mentioned, not hidden"
        assert "create_all" not in body.get("hint", "")


async def test_health_names_the_missing_tables_when_the_schema_is_absent(client, monkeypatch):
    """The deploy that produced screenshot 2: `media_objects` was not there."""

    async def pretend_nothing_exists(_conn):
        return ["media_objects"]

    async def pretend_no_columns(_conn):
        return {}

    monkeypatch.setattr(schema, "_missing_tables", pretend_nothing_exists)
    monkeypatch.setattr(schema, "_column_gaps", pretend_no_columns)

    response = await client.get("/api/health")
    body = response.json()

    assert response.status_code == 503, body
    assert body["status"] == "degraded"
    assert body["schema"] is False
    assert "media_objects" in body["hint"]
    assert "alembic upgrade head" in body["hint"]


async def test_health_names_a_missing_column(client, monkeypatch):
    async def no_columns(_conn):
        return {"stock_items": ["brand_line"]}

    monkeypatch.setattr(schema, "_missing_tables", lambda _conn: _empty())
    monkeypatch.setattr(schema, "_column_gaps", no_columns)

    response = await client.get("/api/health")
    body = response.json()

    assert response.status_code == 503, body
    assert "stock_items.brand_line" in body["hint"]
    assert "never adds a column" in body["hint"]


async def _empty():
    return []


# ── 4. the recovery the seller can actually run ─────────────────────────────


async def test_the_audit_names_the_photos_this_deployment_cannot_serve(client):
    """A lost file must be findable by name, not by opening every listing.

    A seller whose photographs evaporated has no way to tell a broken card from a
    listing that never had one. `GET /api/files/audit` answers that from data they
    already own, and says which records to re-photograph.
    """
    import uuid

    from app.services.storage import storage as store

    suffix = uuid.uuid4().hex[:6]
    reg = await client.post("/api/auth/register", json={
        "business_name": f"Audit Vendor {suffix}",
        "vendor_handle": f"audit_{suffix}",
        "email": f"audit_{suffix}@example.com",
        "password": "Correct-horse-9",
        "business_categories": ["produce"],
        "physical_location": "Kisumu",
    })
    assert reg.status_code == 201, reg.text
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    # One photo that exists, one whose bytes are gone (the deployment lost them),
    # and one absolute URL to somebody else's host.
    uploaded = await client.post(
        "/api/files/upload",
        headers=headers,
        files={"file": ("shelf.jpg", b"\xff\xd8\xff\xe0brief\xff\xd9", "image/jpeg")},
    )
    assert uploaded.status_code == 201, uploaded.text
    good = uploaded.json()["url"]
    lost = f"/static/uploads/{uuid.uuid4()}/gone.jpg"

    for name, images in (("Flour, 50kg", [good, lost]), ("Rice, 25kg", ["https://cdn.example.com/rice.jpg"])):
        made = await client.post("/api/stock/add", headers=headers, json={
            "name": name,
            "category": "grains",
            "quantity_in_stock": 10,
            "quantity_available": 10,
            "unit_of_measure": "bag",
            "unit_price": 3200,
            "min_order_quantity": 1,
            "images": images,
        })
        assert made.status_code in (200, 201), made.text

    original = store.store
    store.store = "local"   # the test suite's default backend; disk lookups still apply
    try:
        audit = await client.get("/api/files/audit", headers=headers)
    finally:
        store.store = original

    assert audit.status_code == 200, audit.text
    body = audit.json()
    assert body["checked"] == 2, body          # the two keys this deployment owns
    assert body["external"] == 1, body         # a third party's URL is not checked
    assert body["missing_count"] == 1, body
    assert body["missing"][0]["url"] == lost
    assert body["missing"][0]["label"] == "Flour, 50kg"
    assert body["missing"][0]["where"] == "stock"
    assert "Re-upload" in body["advice"]
    assert good not in [m["url"] for m in body["missing"]]


async def test_health_reports_which_switch_the_process_resolved(client):
    """The values a dashboard cannot show, so `check_deploy.py` can grade them.

    A variable that *exists* is a claim about the project. `/api/health` has to
    report what the running process did with it, because a stale
    `ENVIRONMENT=development` turns off the guard that refuses the shipped
    `SECRET_KEY` while every "set this variable" instruction looks satisfied.
    """
    body = (await client.get("/api/health")).json()

    assert "environment" in body
    assert isinstance(body["production"], bool)
    assert isinstance(body["managed_host"], bool)
    assert body["media_durable"] == (body["media_store"] in ("db", "s3"))
