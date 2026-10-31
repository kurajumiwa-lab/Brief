import asyncio
import logging
import os
import re
import socket
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import InterfaceError, OperationalError, ProgrammingError

from app.config import settings, validate_production_settings
from app.database import async_session, engine, init_db
from app.middleware.metrics import MetricsMiddleware
from app.middleware.rate_limiter import RateLimitMiddleware, configure_backend
from app.middleware.vendor_only import VendorOnlyMiddleware
from app.modules.billing import router as billing_routes
from app.modules.brief import router as brief_routes
from app.modules.standing import router as passport_routes
from app.modules.standing import sweep as standing_sweep
from app.modules.catalog import router as catalog_routes
from app.modules.intake import router as intake_routes
from app.modules.enterprise import router as enterprise_routes
from app.modules.growth import router as growth_routes
from app.modules.trade import router as requests_routes
from app.modules.orders.router import router as orders_routes
from app.modules.runs import router as runs_routes
from app.modules.outside import router as outside_routes
from app.modules.ledger import router as ledger_routes
from app.platform import event_outbox
from app.routes import (
    analytics,
    auth,
    bookings,
    chamas,
    chat,
    collective,
    events,
    files,
    governance,
    groups,
    market_locks,
    murabaha,
    notifications,
    payments,
    pos_bridge,
    reviews,
    route_planner,
    stock,
    tools,
    vendor_lists,
    vendors,
    verification,
)
from app.routes import (
    geo as geo_routes,
)
from app.routes import (
    map as map_routes,
)
from app.routes import (
    markets as markets_routes,
)
from app.routes import (
    media as media_routes,
)
from app.routes import (
    social as social_routes,
)
from app.routes import (
    nearby as nearby_routes,
)
from app.routes import (
    news as news_routes,
)
from app.routes import (
    onboarding as onboarding_routes,
)
from app.routes import (
    ops as ops_routes,
)
from app.routes import (
    guide as guide_routes,
)
from app.routes import (
    parks as park_routes,
)
from app.routes import (
    squad as squad_routes,
)
from app.routes import (
    surface as surface_routes,
)
from app import schema
from app.services import geo_data, payment_worker, pos_sync
from app.services.psp_client import PSPError

logging.basicConfig(level=logging.DEBUG if settings.DEBUG else logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("brief")


def _safe_error(exc: BaseException) -> str:
    """Exception text that is safe to hand to a browser.

    A failed DATABASE_URL check is the most useful diagnostic a deploy can show,
    but the driver's message can quote the DSN — and the DSN holds the password.
    Redact anything of the shape `scheme://user:secret@` before returning it.
    """
    text = f"{type(exc).__name__}: {exc}"
    text = re.sub(r"(?i)(://[^:/@\s]+:)[^@\s]+@", r"\1***@", text)
    return text[:300]


# Boot failures that must not take the API down. Failing the ASGI lifespan used
# to kill the whole serverless function, so a bad DATABASE_URL looked like
# "sign in and register are broken" with no explanation anywhere but the logs.
_boot: dict[str, str] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Validated on construction too; re-stated here so a misconfigured deploy
    # fails at startup with the same message rather than at first request.
    validate_production_settings(settings)
    # The schema comes first, because almost everything below reads a table.
    #
    # A deployed host runs the real migrations: `create_all` creates missing
    # tables and never missing columns, so on a database that was built once and
    # then never migrated it silently leaves a schema that fails every query
    # touching a newer column — and reports the failure as "the tables do not
    # exist". That is precisely what a phone showed us: one screen claiming an
    # empty database while the next rendered the same vendor's shelf.
    if settings.run_migrations_on_boot:
        try:
            result = await schema.upgrade_to_head()
            _boot.pop("database", None)
            if result.get("error"):
                _boot["schema"] = result["error"]
            else:
                _boot.pop("schema", None)
                if result.get("applied") or result.get("stamped_revisions"):
                    log.info(
                        "boot: schema migrated to %s — applied %d, stamped %d "
                        "(already present on the database, recorded rather than re-run)",
                        result.get("head"),
                        len(result.get("applied") or []),
                        len(result.get("stamped_revisions") or []),
                    )
        except Exception as exc:
            # Serve anyway: /api/health then explains what is wrong, instead of
            # the platform returning an opaque 500 for every request.
            _boot["schema"] = _safe_error(exc)
            log.exception("boot: migration failed — the API will start, but queries "
                          "needing the newer schema fail until it is applied")
    elif settings.auto_create_tables:
        try:
            await init_db()
            _boot.pop("database", None)
        except Exception as exc:
            # Serve anyway: /api/health then explains what is wrong, instead of
            # the platform returning an opaque 500 for every request.
            _boot["database"] = _safe_error(exc)
            log.exception("boot: database initialisation failed — the API will start, "
                          "but queries fail until DATABASE_URL or the schema is fixed")
    await configure_backend()
    await chat.manager.configure()
    # The East-African market catalog is static reference data, so it is
    # applied at BOOT (idempotent, only adds missing markets) rather than
    # relying on the background loop's first pass. A missing market here is a
    # quiet, permanent gap — not a retried one.
    try:
        async with async_session() as db:
            added = await geo_data.ensure_market_catalog(db)
            if added:
                log.info("boot: market catalog added %d markets", added)
    except Exception:
        log.exception("boot: market catalog seeding failed")
    scheduler = None
    payments_scheduler = None
    open_data = None
    outbox_task = None
    standing_task = None
    if settings.RUN_SCHEDULER:
        scheduler = asyncio.create_task(pos_sync.scheduler_loop(async_session, settings.POS_SYNC_INTERVAL))
        payments_scheduler = asyncio.create_task(payment_worker.scheduler_loop(async_session))
        open_data = asyncio.create_task(geo_data.open_data_loop(async_session))
        outbox_task = asyncio.create_task(event_outbox.scheduler_loop(async_session))
        standing_task = asyncio.create_task(standing_sweep.scheduler_loop(async_session))
    else:
        log.info("scheduler disabled here (RUN_SCHEDULER=false) — run `python -m app.worker` once")
    log.info("🏪 Brief_ Vendor Network v%s initialized", settings.VERSION)
    log.info("📦 People, households, artisans, institutions and businesses.")
    try:
        yield
    finally:
        for task in (scheduler, payments_scheduler, open_data, outbox_task, standing_task):
            if task:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
        await chat.manager.shutdown()
        await engine.dispose()
        log.info("👋 Shutting down vendor network")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    description=settings.DESCRIPTION,
    lifespan=lifespan,
)

# Middleware order: the last one added is the outermost, so CORS answers
# preflights first, then the rate limiter, then the vendor-only gate. Metrics
# wraps everything (added first = innermost) so it times what the handlers spend.
app.add_middleware(MetricsMiddleware)
app.add_middleware(VendorOnlyMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,  # bearer tokens, not cookies
    allow_methods=["*"],
    allow_headers=["*"],
)

# All routes
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(social_routes.router, prefix="/api/social", tags=["Social (Caesar)"])
app.include_router(park_routes.router, prefix="/api/parks", tags=["Caesar Park"])
app.include_router(guide_routes.router, prefix="/api/guide", tags=["Caesar Guide"])
app.include_router(vendors.router, prefix="/api/vendors", tags=["Vendors"])
app.include_router(stock.router, prefix="/api/stock", tags=["Stock (Not Listings)"])
app.include_router(vendor_lists.router, prefix="/api/vendor-lists", tags=["Vendor Lists"])
app.include_router(groups.router, prefix="/api/groups", tags=["Vendor Groups"])
app.include_router(chat.router, prefix="/api/chat", tags=["Chat & Topics"])
app.include_router(market_locks.router, prefix="/api/locks", tags=["Market Locks"])
# v2.15 — Market Runs (Ruiru Fresh · Githurai Sukari · Daraja Mbili consolidated)
app.include_router(runs_routes.router, prefix="/api/locks", tags=["Market Runs"])
app.include_router(payments.router, prefix="/api/payments", tags=["Payments & Custody"])
app.include_router(chamas.router, prefix="/api/chamas", tags=["Digital Chamas (Table Banking)"])
app.include_router(murabaha.router, prefix="/api/murabaha", tags=["Murabaha Advances (Halal Trade)"])
app.include_router(governance.router, prefix="/api/governance", tags=["Vendor Governance & Benefits"])
app.include_router(tools.router, prefix="/api/tools", tags=["Vendor Tools"])
app.include_router(events.router, prefix="/api/events", tags=["Events"])
app.include_router(pos_bridge.router, prefix="/api/pos", tags=["POS Bridge"])
# v2.1
app.include_router(news_routes.router, prefix="/api/news", tags=["Market News"])
app.include_router(geo_routes.router, prefix="/api/geo", tags=["Geo & Open Data"])
app.include_router(squad_routes.router, prefix="/api/squad", tags=["Hustle League"])
app.include_router(markets_routes.router, prefix="/api/markets", tags=["Markets"])
app.include_router(surface_routes.router, prefix="/api/surface", tags=["Surface"])
app.include_router(requests_routes, prefix="/api/requests", tags=["Business Requests"])

# Outside (v4): the location-aware discovery surface. One creation endpoint,
# one ranked feed, one search — reading records the modules below already own.
app.include_router(outside_routes.router, prefix="/api/outside", tags=["Outside Discovery"])
# Local Activity Ledger: 4 posting types, non-custodial bookings, privacy & Phase 2
app.include_router(ledger_routes.router, prefix="/api/ledger", tags=["Local Activity Ledger"])
# v2.11 — verified standing, the passport, renewal reminders and the verifier desk
app.include_router(passport_routes.router, prefix="/api/passport", tags=["Business Passport"])
app.include_router(growth_routes.router, prefix="/api/growth", tags=["Growth & Business Planner"])
# v2.13 — enterprise workspaces: the paid, private side of the dual model
app.include_router(enterprise_routes.router, prefix="/api/enterprise", tags=["Enterprise Workspaces"])
# v2.14 — public storefront catalogue (offers/tiers/trial) + enquiries
app.include_router(catalog_routes.router, prefix="/api/catalog", tags=["Storefront Catalogue"])
# v2.17 — market intake: photographs and pasted signage become confirmed
# market observations, and the market-data views that read them.
app.include_router(intake_routes.router, prefix="/api", tags=["Market Intake"])
app.include_router(orders_routes, prefix="/api/orders", tags=["Order Transactions"])
# v2.7 — the marketplace map: viewport queries, server-side clustering, lazy details
app.include_router(map_routes.router, prefix="/api/map", tags=["Map"])
app.include_router(nearby_routes.router, prefix="/api/nearby", tags=["Nearby (B2C)"])
app.include_router(onboarding_routes.router, prefix="/api/onboarding", tags=["Onboarding"])
app.include_router(notifications.router, prefix="/api/notifications", tags=["Notifications"])
app.include_router(files.router, prefix="/api/files", tags=["Files"])
app.include_router(verification.router, prefix="/api/stock", tags=["Stock Verification"])
app.include_router(collective.router, prefix="/api/collective", tags=["Collective Sourcing"])
# v2.2 — analytics, list reviews, tool bookings & calendars, courier routing, ops
app.include_router(analytics.router, prefix="/api/analytics", tags=["Trade Analytics"])
app.include_router(reviews.router, prefix="/api/vendor-lists", tags=["Vendor List Reviews"])
app.include_router(bookings.router, prefix="/api/tools", tags=["Tool Bookings & Calendars"])
app.include_router(route_planner.router, prefix="/api/tools", tags=["Courier Routing"])
app.include_router(ops_routes.router, prefix="/api", tags=["Ops"])
# v2.15 — Morning Brief: deterministic, read-only, vendor-scoped
app.include_router(brief_routes.router, prefix="/api/brief", tags=["Morning Brief"])
app.include_router(billing_routes.router, prefix="/api/billing", tags=["Subscription Billing"])

# Uploaded files (spec sheets, product photos, CSVs), public by unguessable key.
# One route serves disk AND database bytes — see app/routes/media.py for why a
# StaticFiles mount was not enough on an ephemeral, read-only host.
app.include_router(media_routes.router, tags=["Media"])


@app.get("/api", include_in_schema=False)
@app.get("/api/", include_in_schema=False)
async def api_root():
    return {
        "platform": "Brief_",
        "philosophy": "People, households, artisans, institutions and businesses.",
        "message": "Post what is available, wanted, scheduled, or an opportunity — and keep a record that helps next time.",
        "version": settings.VERSION,
        "endpoints": {
            "auth": "/api/auth",
            "vendors": "/api/vendors",
            "stock": "/api/stock",
            "vendor_lists": "/api/vendor-lists",
            "groups": "/api/groups",
            "chat": "/api/chat",
            "tools": "/api/tools",
            "events": "/api/events",
            "pos_bridge": "/api/pos",
            "notifications": "/api/notifications",
            "passport": "/api/passport",
            "growth": "/api/growth",
            "enterprise": "/api/enterprise",
            "files": "/api/files",
            "collective": "/api/collective",
            "market_locks": "/api/locks",
            "governance": "/api/governance",
            "analytics": "/api/analytics",
            "map": "/api/map/viewport",
            "ops": "/api/ops/status",
            "metrics": "/api/metrics",
            "docs": "/docs",
        },
    }


@app.get("/api/health", tags=["Ops"])
async def health():
    """Liveness, a real database round-trip, and **where the schema actually is**.

    `degraded` (503) means the database is unreachable *or* the schema is not at
    the revision this code expects — the two things that make sign-in,
    registration and shop fronts fail.

    `schema_state` is the diagnostic that was missing when this endpoint could
    only answer "tables exist: yes". A database can have every table 0001 created
    and still be twelve migrations behind, which fails on the first column it
    reads and looks like anything but a migration problem. This reports the
    revision, the head, the pending list, and which critical tables are absent.
    """
    db_ok = False
    error = _boot.get("database")
    state: dict = {}
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
            db_ok = True
            _boot.pop("database", None)
            error = None
    except Exception as exc:  # pragma: no cover - depends on the environment
        log.warning("health: database unreachable: %s", exc)
        error = _safe_error(exc)

    if db_ok:
        try:
            state = await schema.report()
        except Exception as exc:  # pragma: no cover - the report itself is guarded
            log.warning("health: schema report failed: %s", exc)
            state = {"error": _safe_error(exc)}

    missing = state.get("missing_tables") or []
    drifted = state.get("drifted") or {}
    pending = state.get("pending_count") or 0
    current = state.get("current")
    head = state.get("head")
    # The schema is healthy when the tables and columns this code reads actually
    # exist. A create_all database is unstamped but complete; a stamped one that
    # lags behind head is not. Both facts are reported; only a missing object
    # makes the deployment degraded, because only a missing object breaks a page.
    schema_ok = db_ok and not missing and not drifted

    ok = schema_ok
    media_durable = settings.media_store in ("db", "s3")
    payload = {
        "status": "ok" if ok else "degraded",
        "database": db_ok,
        "schema": schema_ok,
        "version": settings.VERSION,
        "media_store": settings.media_store,
        # Durable is the property that matters: `local` means the next request
        # may not find the file, whichever host wrote it.
        "media_durable": media_durable,
        "schema_state": state,
    }
    if error:
        payload["error"] = error
    if _boot.get("schema"):
        payload["boot_error"] = _boot["schema"]
    if not ok:
        if not db_ok:
            payload["hint"] = (
                "Check DATABASE_URL in the deployment's environment variables "
                "(percent-encode special characters in the password), then redeploy."
            )
        elif missing:
            payload["hint"] = (
                "These tables are missing: " + ", ".join(missing) + ". "
                "Run `alembic upgrade head` against this database, or set "
                "RUN_MIGRATIONS_ON_BOOT=true and redeploy."
            )
        else:
            payload["hint"] = (
                "These tables exist but are missing columns this version writes: "
                + "; ".join(f"{table}.{', '.join(cols)}" for table, cols in drifted.items())
                + ". Run `alembic upgrade head` against this database — "
                "`create_all` never adds a column to an existing table."
            )
    if not media_durable:
        payload["media_hint"] = (
            f"media_store is '{settings.media_store}': uploads land on a disk that "
            "does not survive this host, so every photo 404s after the next deploy. "
            "Set MEDIA_STORE=db (or S3_BUCKET) on the deployment. Uploads are "
            "refused here on a managed host rather than lost."
        )
    if pending and not (missing or drifted):
        payload["note"] = (
            f"{pending} migration(s) not recorded as applied (the schema is at "
            f"{current or 'no revision'}, head is {head}). Harmless while the "
            "tables and columns match, but stamp it: `alembic upgrade head`."
        )
    return JSONResponse(status_code=200 if ok else 503, content=payload)


# --- a dead database is a 503 with a reason, not an opaque 500 --------------------
# Connection-level failures (unreachable host, wrong password, pool exhausted)
# reach every route through the session dependency. Turning them into a JSON 503
# means the login form shows "database unavailable" instead of a blank error, and
# the reason is in the response rather than only in the platform logs.
async def database_unavailable(request, exc):  # pragma: no cover - depends on the environment
    log.error("database unavailable on %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=503,
        content={
            "detail": "The database is unavailable. Sign-in and registration cannot complete.",
            "error": _safe_error(exc),
            "hint": "Check DATABASE_URL on the deployment (percent-encode special characters in the password).",
        },
    )


async def schema_missing(request, exc):  # pragma: no cover - depends on the environment
    """A `ProgrammingError` — but *which* one?

    Every missing table, missing column, bad cast and permission failure arrives
    as the same exception class. Answering all of them with "the tables do not
    exist yet" is how a vendor's shop front came to announce an empty database
    while their stock rendered fine: the real fault was a column added by a
    migration that never ran. `schema.describe_missing` names the actual cause,
    and the hint says how to fix it either way.
    """
    log.error("schema missing on %s %s: %s", request.method, request.url.path, exc)
    detail = schema.describe_missing(exc)
    body = {
        "detail": detail or "The database rejected this query: its schema and this code disagree.",
        "error": _safe_error(exc),
        "hint": (
            "The database schema is behind the application. Run `alembic upgrade head` "
            "against this database (or set RUN_MIGRATIONS_ON_BOOT=true and redeploy), "
            "then retry."
        ),
        "code": "schema_out_of_date",
    }
    return JSONResponse(status_code=503, content=body)


# Register the handler for every way a failed connection surfaces. SQLAlchemy
# raises some of these itself; asyncpg's own connect-time errors (bad password,
# wrong database, server starting up) arrive unwrapped.
for _exc in (
    OperationalError,
    InterfaceError,
    ConnectionError,
    socket.gaierror,
    asyncpg.InvalidAuthorizationSpecificationError,
    asyncpg.InvalidCatalogNameError,
    asyncpg.CannotConnectNowError,
    asyncpg.TooManyConnectionsError,
    asyncpg.ConnectionDoesNotExistError,
    asyncpg.AdminShutdownError,
    asyncpg.CrashShutdownError,
):
    app.add_exception_handler(_exc, database_unavailable)

# "relation \"vendors\" does not exist" is the other classic first-deploy
# failure: the database answered, but nothing ever created the schema.
for _exc in (ProgrammingError, asyncpg.UndefinedTableError):
    app.add_exception_handler(_exc, schema_missing)


# --- payments that cannot be taken say so, instead of raising a 500 ---------------
# A production deploy with PSP_PROVIDER=mock (or a half-configured IntaSend) is a
# deliberate state, not a crash: the client gets 503 + the reason so the checkout
# screen can explain itself (audit G-03).
@app.exception_handler(PSPError)
async def payments_unavailable(request, exc):  # pragma: no cover - config dependent
    log.warning("payments unavailable on %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Payments are not available on this deployment yet.",
            "error": _safe_error(exc),
            "provider": (settings.PSP_PROVIDER or "mock").strip().lower(),
        },
    )


# --- unknown /api paths are JSON 404s, never the SPA shell ------------------------
# The catch-all below hands every unmatched path to the frontend so client-side
# routes (/nearby/retail, /place/{id}) survive a refresh. That must not apply to
# the API: a client deserialising JSON has to get a 404 it can read, not
# index.html with a 200. This is registered after the routers, so real routes
# still win, and before the SPA catch-all, so it wins over that.
@app.api_route(
    "/api/{rest:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
    include_in_schema=False,
)
async def api_unknown(rest: str):
    raise HTTPException(404, f"Not found: /api/{rest}")


# --- single-container deploys: serve the built frontend ---------------------------
_dist = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", settings.FRONTEND_DIST))
if os.path.isdir(_dist) and os.path.isfile(os.path.join(_dist, "index.html")):
    app.mount("/assets", StaticFiles(directory=os.path.join(_dist, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        candidate = os.path.join(_dist, full_path)
        if full_path and os.path.isfile(candidate) and os.path.commonpath([_dist, os.path.abspath(candidate)]) == _dist:
            return FileResponse(candidate)
        return FileResponse(os.path.join(_dist, "index.html"))
else:
    @app.get("/", include_in_schema=False)
    async def root():
        return await api_root()
