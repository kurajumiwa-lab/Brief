import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.config import settings
from app.database import async_session, engine, init_db
from app.middleware.rate_limiter import RateLimitMiddleware, configure_backend
from app.middleware.vendor_only import VendorOnlyMiddleware
from app.routes import auth, chat, events, groups, pos_bridge, stock, tools, vendor_lists, vendors
from app.services import pos_sync

logging.basicConfig(level=logging.DEBUG if settings.DEBUG else logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("brief")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.AUTO_CREATE_TABLES:
        await init_db()
    await configure_backend()
    scheduler = asyncio.create_task(pos_sync.scheduler_loop(async_session, settings.POS_SYNC_INTERVAL))
    log.info("🏪 Brief_ Vendor Network initialized")
    log.info("📦 No consumers. Only vendors.")
    try:
        yield
    finally:
        scheduler.cancel()
        try:
            await scheduler
        except (asyncio.CancelledError, Exception):
            pass
        await engine.dispose()
        log.info("👋 Shutting down vendor network")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    description=settings.DESCRIPTION,
    lifespan=lifespan,
)

# Middleware order: the last one added is the outermost, so CORS answers
# preflights first, then the rate limiter, then the vendor-only gate.
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
app.include_router(tools.router, prefix="/api/tools", tags=["Vendor Tools"])
app.include_router(events.router, prefix="/api/events", tags=["Events"])
app.include_router(pos_bridge.router, prefix="/api/pos", tags=["POS Bridge"])


@app.get("/api", include_in_schema=False)
@app.get("/api/", include_in_schema=False)
async def api_root():
    return {
        "platform": "Brief_",
        "philosophy": "No consumers. Only vendors.",
        "message": "You source today, you sell tomorrow.",
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
            "docs": "/docs",
        },
    }


@app.get("/api/health", tags=["Ops"])
async def health():
    """Liveness plus a real database round-trip. Says `degraded`, not `ok`, when the DB is unreachable."""
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception as exc:  # pragma: no cover - depends on the environment
        log.warning("health: database unreachable: %s", exc)
        db_ok = False
    return JSONResponse(
        status_code=200 if db_ok else 503,
        content={"status": "ok" if db_ok else "degraded", "database": db_ok, "version": settings.VERSION},
    )


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
