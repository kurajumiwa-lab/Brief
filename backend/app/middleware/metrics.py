"""
Metrics & observability (Directive v2.1 §6.2).

In-process, dependency-free metrics: request counts by method / route / status,
a latency histogram, and in-flight gauge. `/api/metrics` renders them in the
Prometheus text exposition format so any scraper (or the bundled
`deploy/monitoring/` stack) can consume them without extra libraries.

Cardinality is bounded deliberately: paths are reduced to their route template
(`/api/stock/{stock_id}/alternatives`), never the raw id.

Also sets `X-Request-ID` on every response and logs requests slower than
SLOW_REQUEST_MS, which is usually the first thing to look at when vendors say
"it feels slow today".
"""

import logging
import math
import re
import time
import uuid
from collections import defaultdict

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.config import settings

log = logging.getLogger("brief.metrics")

BUCKETS_MS = (5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000)
_UUID_RE = re.compile(r"/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
# Anything under these prefixes is described by its route; keep the raw path for
# the rest but collapse the tail so ids don't explode the label space.
_KNOWN_PREFIXES = (
    "/api/auth", "/api/vendors", "/api/stock", "/api/vendor-lists", "/api/groups", "/api/chat",
    "/api/tools", "/api/events", "/api/pos", "/api/notifications", "/api/files", "/api/collective",
    "/api/analytics", "/api/metrics", "/api/ops", "/api/health",
)


def normalise_path(request: Request, route_path: str | None = None) -> str:
    """Prefer the router's template; otherwise scrub ids out of the raw path."""
    if route_path:
        return route_path
    path = _UUID_RE.sub("/{id}", request.url.path)
    if not path.startswith(_KNOWN_PREFIXES):
        # Static assets and SPA routes: one bucket each, not one per file.
        return path if path.startswith("/api") else "/static"
    return path


class MetricsRegistry:
    def __init__(self):
        self.started_at = time.time()
        self.counters: dict[tuple[str, str, str], int] = defaultdict(int)
        self.status_counts: dict[int, int] = defaultdict(int)
        self.durations: dict[str, list[float]] = defaultdict(list)  # route -> ms samples (capped)
        self.bucket_counts: dict[tuple[str, float], int] = defaultdict(int)
        self.total_duration_ms = 0.0
        self.total_requests = 0
        self.in_flight = 0
        self.limiter_rejections = 0  # 429s counted inside the middleware
        self.samples_cap = 5000

    def observe(self, method: str, path: str, status: int, duration_ms: float) -> None:
        self.counters[(method, path, str(status))] += 1
        self.status_counts[status] += 1
        self.total_requests += 1
        self.total_duration_ms += duration_ms
        samples = self.durations[path]
        samples.append(duration_ms)
        if len(samples) > self.samples_cap:
            del samples[: len(samples) - self.samples_cap]
        for edge in BUCKETS_MS:
            if duration_ms <= edge:
                self.bucket_counts[(path, edge)] += 1

    def percentile(self, path: str, pct: float) -> float:
        samples = sorted(self.durations.get(path) or [])
        if not samples:
            return 0.0
        idx = min(len(samples) - 1, max(0, math.ceil(pct / 100.0 * len(samples)) - 1))
        return round(samples[idx], 1)

    def global_percentile(self, pct: float) -> float:
        samples = sorted(v for route in self.durations.values() for v in route)
        if not samples:
            return 0.0
        idx = min(len(samples) - 1, max(0, math.ceil(pct / 100.0 * len(samples)) - 1))
        return round(samples[idx], 1)

    def summary(self, slow_ms: int | None = None) -> dict:
        threshold = slow_ms if slow_ms is not None else settings.SLOW_REQUEST_MS
        routes = []
        for path, samples in self.durations.items():
            if not samples:
                continue
            errors = sum(count for (m, p, s), count in self.counters.items() if p == path and not s.startswith("2"))
            routes.append({
                "path": path,
                "requests": len(samples),
                "avg_ms": round(sum(samples) / len(samples), 1),
                "p50_ms": self.percentile(path, 50),
                "p95_ms": self.percentile(path, 95),
                "max_ms": round(max(samples), 1),
                "errors": errors,
                "slow": sum(1 for s in samples if s >= threshold),
            })
        routes.sort(key=lambda r: -r["requests"])
        slow_routes = sorted([r for r in routes if r["slow"]], key=lambda r: -r["p95_ms"])
        uptime = max(0.001, time.time() - self.started_at)
        return {
            "uptime_seconds": round(uptime, 1),
            "requests_total": self.total_requests,
            "avg_ms": round(self.total_duration_ms / self.total_requests, 1) if self.total_requests else 0.0,
            "p50_ms": self.global_percentile(50),
            "p95_ms": self.global_percentile(95),
            "p99_ms": self.global_percentile(99),
            "in_flight": self.in_flight,
            "requests_per_second": round(self.total_requests / uptime, 3),
            "by_status": {str(k): v for k, v in sorted(self.status_counts.items())},
            "error_rate_pct": round(
                100.0 * sum(c for s, c in self.status_counts.items() if s >= 500) / self.total_requests, 2)
            if self.total_requests else 0.0,
            "client_error_rate_pct": round(
                100.0 * sum(c for s, c in self.status_counts.items() if 400 <= s < 500) / self.total_requests, 2)
            if self.total_requests else 0.0,
            "slow_threshold_ms": threshold,
            "routes": routes[:25],
            "slow_routes": slow_routes[:10],
        }

    def prometheus(self) -> str:
        lines = [
            "# HELP brief_up 1 when the API process is serving",
            "# TYPE brief_up gauge",
            "brief_up 1",
            "# HELP brief_uptime_seconds Seconds since process start",
            "# TYPE brief_uptime_seconds gauge",
            f"brief_uptime_seconds {round(time.time() - self.started_at, 1)}",
            "# HELP brief_requests_total Requests served, by method, route and status",
            "# TYPE brief_requests_total counter",
        ]
        for (method, path, status), count in sorted(self.counters.items()):
            lines.append(f'brief_requests_total{{method="{method}",path="{path}",status="{status}"}} {count}')
        lines += [
            "# HELP brief_request_duration_ms Request latency histogram, milliseconds",
            "# TYPE brief_request_duration_ms histogram",
        ]
        for path in sorted(self.durations):
            total = len(self.durations[path])
            for edge in BUCKETS_MS:
                lines.append(f'brief_request_duration_ms_bucket{{path="{path}",le="{edge}.0"}} '
                             f'{self.bucket_counts[(path, edge)]}')
            lines.append(f'brief_request_duration_ms_bucket{{path="{path}",le="+Inf"}} {total}')
            lines.append(f'brief_request_duration_ms_sum{{path="{path}"}} {round(sum(self.durations[path]), 1)}')
            lines.append(f'brief_request_duration_ms_count{{path="{path}"}} {total}')
        lines += [
            "# HELP brief_requests_in_flight Requests currently being served",
            "# TYPE brief_requests_in_flight gauge",
            f"brief_requests_in_flight {self.in_flight}",
            "# HELP brief_errors_total Responses with status >= 500",
            "# TYPE brief_errors_total counter",
            f"brief_errors_total {sum(c for s, c in self.status_counts.items() if s >= 500)}",
        ]
        return "\n".join(lines) + "\n"


registry = MetricsRegistry()


class MetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not settings.METRICS_ENABLED:
            return await call_next(request)

        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        start = time.perf_counter()
        registry.in_flight += 1
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers["X-Request-ID"] = request_id
            return response
        finally:
            registry.in_flight -= 1
            duration_ms = (time.perf_counter() - start) * 1000
            route = request.scope.get("route")
            path = normalise_path(request, getattr(route, "path", None))
            registry.observe(request.method, path, status, duration_ms)
            if status == 429:
                registry.limiter_rejections += 1
            if duration_ms >= settings.SLOW_REQUEST_MS:
                log.warning("slow request %s %s → %s in %.0fms (request_id=%s)",
                            request.method, request.url.path, status, duration_ms, request_id)
