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
    squad as squad_routes,
)
from app.routes import (
    surface as surface_routes,
)
from app.services import geo_data, payment_worker, pos_sync
from app.services.psp_client import PSPError
from app.services.storage import local_root

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
    if settings.auto_create_tables:
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

# Local file storage (spec sheets, images). Public by unguessable key; S3 deploys skip this.
_static_root = local_root()
if _static_root:
    app.mount("/static", StaticFiles(directory=_static_root), name="static")


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
    """Liveness plus a real database round-trip and schema probe.

    `degraded` (503) means the database is unreachable *or* the schema has not
    been created yet — the two things that make sign-in and registration fail.
    `error` carries a redacted driver message so a deploy can be diagnosed
    without digging through logs.
    """
    db_ok = False
    schema_ok = None
    error = _boot.get("database")
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
            db_ok = True
            try:
                schema_ok = bool(await conn.scalar(text("SELECT to_regclass('public.vendors') IS NOT NULL")))
            except Exception:  # pragma: no cover - dialect without to_regclass
                schema_ok = None
            if db_ok and schema_ok is not False:
                _boot.pop("database", None)
                error = None
    except Exception as exc:  # pragma: no cover - depends on the environment
        log.warning("health: database unreachable: %s", exc)
        error = _safe_error(exc)

    ok = db_ok and schema_ok is not False
    payload = {
        "status": "ok" if ok else "degraded",
        "database": db_ok,
        "schema": schema_ok,
        "version": settings.VERSION,
    }
    if error:
        payload["error"] = error
    if not ok:
        payload["hint"] = (
            "The schema has not been created yet — redeploy with AUTO_CREATE_TABLES=true "
            "or run `alembic upgrade head` once against this database."
            if schema_ok is False
            else "Check DATABASE_URL in the deployment's environment variables "
                 "(percent-encode special characters in the password), then redeploy."
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
    log.error("schema missing on %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=503,
        content={
            "detail": "The database is reachable but its tables do not exist yet.",
            "error": _safe_error(exc),
            "hint": "Deploy once with AUTO_CREATE_TABLES=true, or run `alembic upgrade head` "
                    "against this database, then retry.",
        },
    )


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
