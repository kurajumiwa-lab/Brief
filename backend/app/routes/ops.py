"""
Ops endpoints (Directive v2.1 §6.2 — monitoring & observability).

    GET /api/metrics      Prometheus exposition (text/plain). Open by default;
                          set METRICS_TOKEN to require ?token= or a bearer token.
    GET /api/ops/status   JSON snapshot for humans: latency percentiles, error
                          rates, database pool, scheduler hints. Bearer-gated.

Both are built from the in-process registry (`app/middleware/metrics.py`), so
they add no dependency and no sidecar — a scrape target and a `curl` are enough.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import text

from app.config import settings
from app.database import engine
from app.middleware.metrics import registry
from app.middleware.rate_limiter import current_backend
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services import map_viewport as mv
from app.services.storage import storage_mode

router = APIRouter()


def _pool_stats() -> dict:
    pool = engine.pool
    stats: dict = {"class": type(pool).__name__}
    for name in ("size", "checkedout", "checkedin", "overflow"):
        fn = getattr(pool, name, None)
        if callable(fn):
            try:
                stats[name] = fn()
            except Exception:  # pragma: no cover - pool dialect differences
                stats[name] = None
    return stats


@router.get("/metrics", include_in_schema=True, response_class=PlainTextResponse)
async def prometheus_metrics(
    request: Request,
    token: str = Query(None),
):
    """Prometheus scrape target. Add `?token=` when METRICS_TOKEN is set."""
    if settings.METRICS_TOKEN:
        bearer = request.headers.get("authorization", "")
        supplied = token or (bearer[7:] if bearer.lower().startswith("bearer ") else "")
        if supplied != settings.METRICS_TOKEN:
            raise HTTPException(401, "Metrics token required")
    return PlainTextResponse(registry.prometheus(), media_type="text/plain; version=0.0.4")


@router.get("/ops/status")
async def ops_status(
    vendor: Vendor = Depends(get_current_vendor),
):
    """Latency, error rates, pool health and config facts — one screen."""
    db_ok, db_error = True, None
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover - environment dependent
        db_ok, db_error = False, type(exc).__name__

    summary = registry.summary()
    return {
        "version": settings.VERSION,
        "environment": {
            "debug": settings.DEBUG,
            "auto_create_tables": settings.AUTO_CREATE_TABLES,
            "scheduler_on_api": settings.RUN_SCHEDULER,
            "rate_limiter_backend": type(current_backend()).__name__,
            "storage": storage_mode(),
            "redis_configured": bool(settings.REDIS_URL),
        },
        "database": {"reachable": db_ok, "error": db_error, "pool": _pool_stats()},
        "http": summary,
        "limits": {
            "rate_limit_auth_per_min": settings.RATE_LIMIT_AUTH,
            "rate_limit_api_per_min": settings.RATE_LIMIT_API,
            "max_upload_mb": settings.MAX_UPLOAD_MB,
            "slow_request_ms": settings.SLOW_REQUEST_MS,
        },
        "counters": {
            "rate_limited_responses": registry.limiter_rejections,
            "requests_total": registry.total_requests,
        },
        # The map is the heaviest screen in the app, so its two failure modes
        # are surfaced here: a dev-only tile backend in production, and a
        # viewport cache that is never hitting (i.e. clients re-fetching the
        # same streets on every pan).
        "map": {
            "tile_provider": settings.MAP_TILE_PROVIDER,
            "tile_dev_only": settings.MAP_TILE_DEV_ONLY,
            "tile_warning": (
                "Public OpenStreetMap tiles are rate-limited and not licensed "
                "for bulk or high-volume use — set MAP_TILE_URL before launch."
                if settings.MAP_TILE_DEV_ONLY else None
            ),
            "point_zoom": {
                "places": settings.MAP_PLACES_POINT_ZOOM,
                "vendors": settings.MAP_VENDORS_POINT_ZOOM,
                "markets": settings.MAP_MARKETS_POINT_ZOOM,
            },
            "viewport_cache": mv.viewport_cache.stats,
            "counts_cache": mv.counts_cache.stats,
        },
    }


@router.get("/ops/slow")
async def slow_requests(
    vendor: Vendor = Depends(get_current_vendor),
):
    """The routes currently breaching SLOW_REQUEST_MS, worst p95 first."""
    summary = registry.summary()
    return {"threshold_ms": summary["slow_threshold_ms"], "slow_routes": summary["slow_routes"]}
