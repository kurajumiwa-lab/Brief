"""
Ops endpoints (Directive v2.1 §6.2 — monitoring, observability & job execution).

    GET  /api/metrics                 Prometheus exposition (text/plain).
    GET  /api/ops/status              JSON snapshot: latency percentiles, error
                                      rates, database pool, scheduler hints.
    GET  /api/ops/slow                Routes breaching SLOW_REQUEST_MS.
    GET  /api/ops/jobs                Operations Center: live job status counts,
                                      supported workflows, worker diagnostics,
                                      and recent job executions.
    POST /api/ops/jobs                Validate, review (dry_run) or start a
                                      supported operational / squad job.
    POST /api/ops/jobs/{job_id}/action Retry or cancel a job record.
"""

from datetime import datetime, timedelta
import time
from typing import Any, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session, engine, get_db
from app.middleware.metrics import registry
from app.middleware.rate_limiter import current_backend
from app.models.hustle import HustleContract, HustleJobCall
from app.models.pos_bridge import POSConnection, POSSyncLog
from app.models.vendor import Vendor
from app.modules.standing import sweep as standing_sweep
from app.platform import event_outbox
from app.routes.auth import get_current_vendor


async def require_operator(vendor: Vendor = Depends(get_current_vendor)) -> Vendor:
    """Platform operations access (v2.15).

    Every /api/ops/* route exposes internal state (pool health, slow routes,
    error rates) or drives jobs. Before this dependency existed, any signed-in
    vendor could read it and start a job (audit 2026-10-25, G-05). The role is
    an explicit allowlist in config, so it fails closed when OPERATOR_HANDLES
    is unset.
    """
    if not settings.is_operator(vendor.vendor_handle):
        raise HTTPException(403, "This operations surface is restricted to platform operators")
    return vendor
from app.services import (
    governance,
    hustle,
    map_viewport as mv,
    market_locks,
    notification_service,
    payment_worker,
    pos_sync,
    stock_engine,
    tile_providers,
)
from app.services.storage import storage_mode

router = APIRouter()

# In-memory ledger of admin-triggered operational job runs in this process,
# merged with durable DB records (HustleJobCall, POSSyncLog, OutboxEvent) on read.
_OPS_JOB_RUNS: list[dict[str, Any]] = []

SUPPORTED_WORKFLOWS: list[dict[str, Any]] = [
    {
        "workflow_type": "squad_job_call",
        "label": "Marketplace Shift / Squad Call-Up",
        "endpoint": "POST /api/squad/job-calls",
        "category": "Marketplace Dispatch",
        "description": "Posts a verified temporary shift call-up to the Hustle League board with minimum-wage and tier validation.",
        "fields": [
            {"name": "title", "label": "Shift title", "type": "text", "required": True, "default": "Offload & grade morning crates"},
            {"name": "skill", "label": "Skill category", "type": "select", "required": True, "default": "mover", "options": list(hustle.SKILLS.keys())},
            {"name": "task_type", "label": "Task type", "type": "text", "required": True, "default": "shift"},
            {"name": "required_tier", "label": "Minimum worker tier", "type": "select", "required": True, "default": "common", "options": list(hustle.TIER_ORDER)},
            {"name": "pay_kes", "label": "Pay (KES)", "type": "number", "required": True, "default": 500},
            {"name": "location", "label": "Location", "type": "text", "required": False, "default": "Main Market Bay"},
            {"name": "expires_in_hours", "label": "Expires in (hours)", "type": "number", "required": True, "default": 24},
        ],
    },
    {
        "workflow_type": "outbox_drain",
        "label": "Transactional Outbox Drain",
        "endpoint": "event_outbox.drain",
        "category": "Platform Worker",
        "description": "Drains unprocessed domain events from the event_outbox table using FOR UPDATE SKIP LOCKED.",
        "fields": [
            {"name": "batch_size", "label": "Max batch size", "type": "number", "required": True, "default": 200},
        ],
    },
    {
        "workflow_type": "standing_sweep",
        "label": "Passport Standing Expiry & Reminders",
        "endpoint": "standing.sweep.run_once",
        "category": "Compliance & Trust",
        "description": "Flips expired Business Passport claims and dispatches 30/14/7-day renewal notifications.",
        "fields": [],
    },
    {
        "workflow_type": "payments_housekeeping",
        "label": "Payments & Intent Housekeeping",
        "endpoint": "payment_worker.housekeeping",
        "category": "Finance & Ledger",
        "description": "Expires stale pending payment intents, flags overdue chama/murabaha advances, and runs daily reconciliation.",
        "fields": [],
    },
    {
        "workflow_type": "stock_housekeeping",
        "label": "Stock Hold Expiry & Market Lock Windows",
        "endpoint": "pos_sync.housekeeping",
        "category": "Inventory & Trade",
        "description": "Releases unconfirmed stock holds, sends event reminders, and processes due market lock windows and governance ballots.",
        "fields": [],
    },
    {
        "workflow_type": "pos_sync_all",
        "label": "POS Bridge Inventory Sync",
        "endpoint": "pos_sync.run_sync",
        "category": "Inventory & Trade",
        "description": "Runs an immediate inventory sync pass across active POS connections and writes POSSyncLog audit records.",
        "fields": [],
    },
]


class OpsJobCreateRequest(BaseModel):
    workflow_type: str = Field(..., min_length=2, max_length=60)
    title: Optional[str] = Field(default=None, max_length=200)
    params: dict[str, Any] = Field(default_factory=dict)
    dry_run: bool = False


class OpsJobActionRequest(BaseModel):
    action: str = Field(..., pattern="^(retry|cancel)$")
    reason: Optional[str] = Field(default=None, max_length=300)


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


def _validate_job_payload(workflow_type: str, params: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Validate workflow inputs and return normalized parameters + any warnings."""
    wf = next((w for w in SUPPORTED_WORKFLOWS if w["workflow_type"] == workflow_type), None)
    if not wf:
        valid = ", ".join(w["workflow_type"] for w in SUPPORTED_WORKFLOWS)
        raise HTTPException(400, f"Unsupported workflow_type '{workflow_type}'. Supported: {valid}")

    warnings: list[str] = []
    normalized = dict(params or {})

    if workflow_type == "squad_job_call":
        title = str(normalized.get("title") or "").strip()
        if len(title) < 3:
            raise HTTPException(400, "Shift title must be at least 3 characters.")
        skill = str(normalized.get("skill") or "mover").strip().lower()
        if skill not in hustle.SKILLS:
            raise HTTPException(400, f"Unknown skill '{skill}'. Must be one of: {', '.join(hustle.SKILLS.keys())}")
        required_tier = str(normalized.get("required_tier") or "common").strip().lower()
        if required_tier not in hustle.TIER_ORDER:
            raise HTTPException(400, f"Tier must be one of: {', '.join(hustle.TIER_ORDER)}")
        try:
            pay_kes = int(normalized.get("pay_kes") or 0)
        except (TypeError, ValueError):
            raise HTTPException(400, "pay_kes must be a valid integer amount in KES.")
        floor = hustle.SKILLS[skill]["min_wage_kes"]
        if pay_kes < floor:
            raise HTTPException(
                400,
                f"{hustle.SKILLS[skill]['label']} shifts require at least KES {floor} (minimum wage guard).",
            )
        expires_in_hours = int(normalized.get("expires_in_hours") or 24)
        if expires_in_hours < 1 or expires_in_hours > 168:
            raise HTTPException(400, "expires_in_hours must be between 1 and 168 hours.")
        normalized.update(
            {
                "title": title,
                "skill": skill,
                "task_type": str(normalized.get("task_type") or "shift").strip().lower(),
                "required_tier": required_tier,
                "pay_kes": pay_kes,
                "location": str(normalized.get("location") or "").strip() or None,
                "expires_in_hours": expires_in_hours,
            }
        )
        warnings.append(
            "Note: Posting a Squad Call-Up creates an open marketplace shift (status='open') that awaits worker acceptance via POST /api/squad/job-calls/{id}/accept."
        )
    elif workflow_type == "outbox_drain":
        try:
            batch_size = int(normalized.get("batch_size") or 200)
        except (TypeError, ValueError):
            raise HTTPException(400, "batch_size must be an integer.")
        if batch_size < 1 or batch_size > 2000:
            raise HTTPException(400, "batch_size must be between 1 and 2000.")
        normalized["batch_size"] = batch_size

    return normalized, warnings


async def _execute_workflow(
    workflow_type: str,
    title: Optional[str],
    params: dict[str, Any],
    vendor: Vendor,
    db: AsyncSession,
) -> dict[str, Any]:
    """Execute a validated workflow against the real backend services & DB."""
    started_at = datetime.utcnow()
    t0 = time.perf_counter()
    job_id = str(uuid4())
    wf_meta = next((w for w in SUPPORTED_WORKFLOWS if w["workflow_type"] == workflow_type), {})
    job_name = (title or "").strip() or wf_meta.get("label", workflow_type)

    record: dict[str, Any] = {
        "id": job_id,
        "name": job_name,
        "workflow_type": workflow_type,
        "workflow_label": wf_meta.get("label", workflow_type),
        "created_by": f"@{vendor.vendor_handle}",
        "status": "running",
        "params": params,
        "created_at": started_at.isoformat(),
        "completed_at": None,
        "duration_ms": None,
        "result_summary": None,
        "error": None,
        "source": "ops_trigger",
    }
    _OPS_JOB_RUNS.insert(0, record)

    try:
        if workflow_type == "squad_job_call":
            call = HustleJobCall(
                vendor_id=vendor.id,
                title=params["title"],
                task_type=params["task_type"],
                skill=params["skill"],
                required_tier=params["required_tier"],
                pay_kes=params["pay_kes"],
                location=params.get("location") or vendor.physical_location,
                geo_lat=vendor.geo_lat,
                geo_lng=vendor.geo_lng,
                status="open",
                expires_at=datetime.utcnow() + timedelta(hours=params["expires_in_hours"]),
            )
            db.add(call)
            await db.commit()
            await db.refresh(call)
            record["id"] = str(call.id)
            record["name"] = call.title
            record["status"] = "queued"
            record["result_summary"] = (
                f"Shift call-up posted (KES {call.pay_kes:,} · {call.skill} · {call.required_tier}). Awaiting worker acceptance."
            )
        elif workflow_type == "outbox_drain":
            processed = await event_outbox.drain(async_session, batch=params.get("batch_size", 200))
            remaining = await event_outbox.unprocessed_count(async_session)
            record["status"] = "succeeded"
            record["result_summary"] = f"Drained {processed} outbox events ({remaining} remaining in queue)."
        elif workflow_type == "standing_sweep":
            res = await standing_sweep.run_once(async_session)
            expired = res.get("expired", 0)
            reminded = res.get("reminded", 0)
            record["status"] = "succeeded"
            record["result_summary"] = f"Standing sweep complete: {expired} expired claims flipped, {reminded} renewal reminders sent."
        elif workflow_type == "payments_housekeeping":
            expired_intents = await payment_worker.expire_stale_intents(async_session)
            chama_defaults = await payment_worker.flag_chama_defaults(async_session)
            murabaha_defaults = await payment_worker.flag_murabaha_defaults(async_session)
            reconciled = await payment_worker.run_daily_reconciliation(async_session)
            record["status"] = "succeeded"
            record["result_summary"] = (
                f"Expired {expired_intents} stale intents · {chama_defaults} chama defaults · "
                f"{murabaha_defaults} murabaha defaults · {reconciled} reconciled."
            )
        elif workflow_type == "stock_housekeeping":
            holds = await stock_engine.expire_stale_holds(db)
            reminders = await notification_service.send_event_reminders(db)
            locks = await market_locks.process_due_windows_in_session(db)
            proposals = await governance.process_due_proposals(db)
            await db.commit()
            record["status"] = "succeeded"
            record["result_summary"] = (
                f"Released {holds} stale stock holds · {reminders} event reminders · "
                f"{locks} market lock windows · {proposals} governance proposals."
            )
        elif workflow_type == "pos_sync_all":
            conns = (
                await db.execute(select(POSConnection).where(POSConnection.is_active.is_(True)))
            ).scalars().all()
            synced = 0
            failed_conns = 0
            for conn in conns:
                log_row = await pos_sync.run_sync(db, conn, sync_type="manual_ops")
                if log_row.status == "failed":
                    failed_conns += 1
                else:
                    synced += 1
            await db.commit()
            record["status"] = "failed" if (failed_conns > 0 and synced == 0) else "succeeded"
            record["result_summary"] = (
                f"Processed {len(conns)} active POS connection(s): {synced} succeeded, {failed_conns} failed."
            )
    except Exception as exc:
        record["status"] = "failed"
        record["error"] = f"{type(exc).__name__}: {exc}"
        record["result_summary"] = f"Execution failed: {exc}"
    finally:
        record["completed_at"] = datetime.utcnow().isoformat()
        record["duration_ms"] = round((time.perf_counter() - t0) * 1000, 1)

    return record


def _payment_reason() -> str:
    provider = (settings.PSP_PROVIDER or "mock").strip().lower()
    if provider == "mock":
        return ("PSP_PROVIDER=mock: simulated payments are refused in production, "
                "so no real money can be collected until a licensed PSP is configured")
    if provider == "intasend":
        return "IntaSend is selected but PSP_API_KEY / PSP_API_SECRET are not both set"
    return f"Unknown PSP_PROVIDER {provider!r} (use intasend)"


@router.get("/metrics", include_in_schema=True, response_class=PlainTextResponse)
async def prometheus_metrics(
    request: Request,
    token: str = Query(None),
):
    """Prometheus scrape target. Add `?token=` when METRICS_TOKEN is set.

    Production requires the token: without it the scrape target exposes traffic
    volume, latency and error rates to anyone who finds the URL (audit G-10), so
    an unconfigured production deployment serves 404 here instead of data.
    """
    if not settings.METRICS_TOKEN:
        if settings.is_production:
            raise HTTPException(404, "Not Found")
    else:
        bearer = request.headers.get("authorization", "")
        supplied = token or (bearer[7:] if bearer.lower().startswith("bearer ") else "")
        if supplied != settings.METRICS_TOKEN:
            raise HTTPException(401, "Metrics token required")
    return PlainTextResponse(registry.prometheus(), media_type="text/plain; version=0.0.4")


@router.get("/ops/status")
async def ops_status(
    vendor: Vendor = Depends(require_operator),
):
    """Latency, error rates, pool health and config facts — one screen."""
    resolved_tiles = tile_providers.tile_config(
        settings.MAP_TILE_PROVIDER,
        api_key=settings.MAP_TILE_KEY,
        url_override=settings.MAP_TILE_URL,
        attribution_override=settings.MAP_TILE_ATTRIBUTION,
    )
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
            "operator_gate": True,
        },
        "payments": {
            "provider": (settings.PSP_PROVIDER or "mock").strip().lower(),
            "available": settings.payments_available,
            "reason": None if settings.payments_available else _payment_reason(),
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
        "map": {
            "tile_provider": resolved_tiles["provider"],
            "tile_provider_label": resolved_tiles["label"],
            "tile_key_missing": resolved_tiles["key_missing"],
            "tile_dev_only": resolved_tiles["dev_only"],
            "tile_warning": resolved_tiles.get("warning"),
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
    vendor: Vendor = Depends(require_operator),
):
    """The routes currently breaching SLOW_REQUEST_MS, worst p95 first."""
    summary = registry.summary()
    return {"threshold_ms": summary["slow_threshold_ms"], "slow_routes": summary["slow_routes"]}


@router.get("/ops/jobs")
async def list_ops_jobs(
    status: Optional[str] = Query(None),
    vendor: Vendor = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    """Return live job counts, worker diagnostics, supported workflows, and recent jobs."""
    outbox_pending = 0
    calls_rows: list[HustleJobCall] = []
    pos_logs: list[POSSyncLog] = []

    try:
        outbox_pending = await event_outbox.unprocessed_count(async_session)
    except Exception:
        outbox_pending = 0

    try:
        calls_res = await db.execute(
            select(HustleJobCall).order_by(HustleJobCall.created_at.desc()).limit(25)
        )
        calls_rows = list(calls_res.scalars().all())
    except Exception:
        calls_rows = []

    try:
        pos_res = await db.execute(
            select(POSSyncLog).order_by(POSSyncLog.started_at.desc()).limit(15)
        )
        pos_logs = list(pos_res.scalars().all())
    except Exception:
        pos_logs = []

    unified_jobs: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for run in _OPS_JOB_RUNS[:40]:
        seen_ids.add(str(run["id"]))
        unified_jobs.append(dict(run))

    for call in calls_rows:
        cid = str(call.id)
        if cid in seen_ids:
            continue
        seen_ids.add(cid)
        mapped_status = {
            "open": "queued",
            "contracted": "running",
            "in_progress": "running",
            "proof_pending": "running",
            "completed": "succeeded",
            "cancelled": "failed",
        }.get(call.status, "queued")
        unified_jobs.append(
            {
                "id": cid,
                "name": call.title,
                "workflow_type": "squad_job_call",
                "workflow_label": "Marketplace Shift / Squad Call-Up",
                "created_by": "my_business" if call.vendor_id == vendor.id else "network_vendor",
                "status": mapped_status,
                "raw_status": call.status,
                "params": {
                    "title": call.title,
                    "skill": call.skill,
                    "task_type": call.task_type,
                    "required_tier": call.required_tier,
                    "pay_kes": call.pay_kes,
                    "location": call.location,
                },
                "created_at": call.created_at.isoformat() if call.created_at else None,
                "completed_at": call.updated_at.isoformat() if call.updated_at else None,
                "duration_ms": None,
                "result_summary": f"KES {call.pay_kes:,} · {call.skill} ({call.required_tier}) · state: {call.status}",
                "error": None,
                "source": "squad_job_call",
            }
        )

    for plog in pos_logs:
        pid = str(plog.id)
        if pid in seen_ids:
            continue
        seen_ids.add(pid)
        mapped_status = {
            "running": "running",
            "success": "succeeded",
            "partial": "succeeded",
            "failed": "failed",
        }.get(plog.status, "succeeded")
        errs = plog.errors or []
        unified_jobs.append(
            {
                "id": pid,
                "name": f"POS Sync ({plog.sync_type or 'scheduled'})",
                "workflow_type": "pos_sync_all",
                "workflow_label": "POS Bridge Inventory Sync",
                "created_by": "scheduler" if plog.sync_type == "scheduled" else f"@{vendor.vendor_handle}",
                "status": mapped_status,
                "raw_status": plog.status,
                "params": {},
                "created_at": plog.started_at.isoformat() if plog.started_at else None,
                "completed_at": plog.completed_at.isoformat() if plog.completed_at else None,
                "duration_ms": None,
                "result_summary": f"Processed {plog.items_processed or 0} items (+{plog.items_added or 0} added, {plog.items_updated or 0} updated)",
                "error": "; ".join(str(e) for e in errs) if errs and plog.status == "failed" else None,
                "source": "pos_sync_log",
            }
        )

    counts = {
        "running": sum(1 for j in unified_jobs if j["status"] == "running"),
        "queued": sum(1 for j in unified_jobs if j["status"] == "queued") + outbox_pending,
        "succeeded": sum(1 for j in unified_jobs if j["status"] == "succeeded"),
        "failed": sum(1 for j in unified_jobs if j["status"] == "failed"),
    }

    filtered = unified_jobs if not status else [j for j in unified_jobs if j["status"] == status]
    limiter_name = type(current_backend()).__name__

    return {
        "summary": counts,
        "worker_health": {
            "scheduler_on_api": bool(settings.RUN_SCHEDULER),
            "execution_mode": "in_process_asyncio" if settings.RUN_SCHEDULER else "external_worker_required",
            "rate_limiter_backend": limiter_name,
            "rate_limiter_note": (
                f"{limiter_name} is the HTTP sliding-window rate limiter, not a background task queue. "
                "Background loops run via asyncio in-process when RUN_SCHEDULER=true or via `python -m app.worker`."
            ),
            "outbox_pending": outbox_pending,
            "squad_calls_note": (
                "POST /api/squad/job-calls creates a marketplace shift call-up (HustleJobCall) with status='open' "
                "that awaits worker acceptance via POST /api/squad/job-calls/{id}/accept."
            ),
        },
        "supported_workflows": SUPPORTED_WORKFLOWS,
        "jobs": filtered,
    }


@router.post("/ops/jobs", status_code=201)
async def create_or_run_ops_job(
    body: OpsJobCreateRequest,
    vendor: Vendor = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    """Validate, preview (dry_run=True), or execute a job from the Operations Center."""
    normalized_params, warnings = _validate_job_payload(body.workflow_type, body.params)
    wf_meta = next((w for w in SUPPORTED_WORKFLOWS if w["workflow_type"] == body.workflow_type), {})

    if body.dry_run:
        return {
            "valid": True,
            "dry_run": True,
            "workflow_type": body.workflow_type,
            "workflow_label": wf_meta.get("label", body.workflow_type),
            "endpoint": wf_meta.get("endpoint"),
            "normalized_params": normalized_params,
            "warnings": warnings,
        }

    record = await _execute_workflow(
        workflow_type=body.workflow_type,
        title=body.title,
        params=normalized_params,
        vendor=vendor,
        db=db,
    )
    return {
        "valid": True,
        "dry_run": False,
        "warnings": warnings,
        "job": record,
    }


@router.post("/ops/jobs/{job_id}/action")
async def act_on_ops_job(
    job_id: str,
    body: OpsJobActionRequest,
    vendor: Vendor = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    """Retry a previous job run or cancel an open Squad Job-Call / queued job."""
    existing = next((j for j in _OPS_JOB_RUNS if str(j["id"]) == job_id), None)

    if body.action == "cancel":
        # Check if it's a HustleJobCall in the DB
        try:
            call_uuid = UUID(job_id)
            call = await db.get(HustleJobCall, call_uuid)
            if call:
                if call.status not in ("open", "contracted"):
                    raise HTTPException(409, f"Cannot cancel call-up in state '{call.status}'.")
                call.status = "cancelled"
                call.updated_at = datetime.utcnow()
                await db.commit()
        except ValueError:
            pass

        if existing:
            existing["status"] = "failed"
            existing["error"] = body.reason or "Cancelled by administrator"
            existing["result_summary"] = "Cancelled from Operations Center."
            existing["completed_at"] = datetime.utcnow().isoformat()
            return {"message": "Job cancelled", "job": existing}

        return {"message": "Job cancelled", "job_id": job_id, "status": "cancelled"}

    # action == "retry"
    if existing:
        normalized_params, _ = _validate_job_payload(existing["workflow_type"], existing.get("params") or {})
        retried = await _execute_workflow(
            workflow_type=existing["workflow_type"],
            title=f"{existing['name']} (Retry)",
            params=normalized_params,
            vendor=vendor,
            db=db,
        )
        return {"message": "Job re-executed", "job": retried}

    # Check if it's a HustleJobCall in the DB that can be re-posted
    try:
        call_uuid = UUID(job_id)
        call = await db.get(HustleJobCall, call_uuid)
        if call:
            params = {
                "title": call.title,
                "skill": call.skill,
                "task_type": call.task_type,
                "required_tier": call.required_tier,
                "pay_kes": call.pay_kes,
                "location": call.location,
                "expires_in_hours": 24,
            }
            retried = await _execute_workflow("squad_job_call", f"{call.title} (Repost)", params, vendor, db)
            return {"message": "Squad call-up reposted", "job": retried}
    except ValueError:
        pass

    raise HTTPException(404, "Job record not found for retry")
