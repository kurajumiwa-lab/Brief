"""
Vendor-only gate.

Every route already depends on `get_current_vendor`, so this middleware is
defence in depth: an unauthenticated request to anything under /api that is
not the front door is refused before it reaches a handler, with the one
sentence the platform has to say about who it is for.
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

# `/api/metrics` is the Prometheus scrape target (gate it with METRICS_TOKEN in
# production — see app/routes/ops.py). Everything else under /api needs a vendor.
OPEN_PREFIXES = ("/api/auth/", "/api/health", "/api/metrics", "/docs", "/redoc", "/openapi.json")


class VendorOnlyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if path.startswith("/api/") and not path.startswith(OPEN_PREFIXES) and request.method != "OPTIONS":
            auth = request.headers.get("authorization", "")
            # WebSocket upgrades authenticate with ?token= inside the handler.
            is_ws = request.headers.get("upgrade", "").lower() == "websocket"
            if not is_ws and not auth.lower().startswith("bearer "):
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Not authenticated. All users must be vendors."},
                    headers={"WWW-Authenticate": "Bearer", "X-Brief-Network": "vendors-only"},
                )
        response = await call_next(request)
        response.headers["X-Brief-Network"] = "vendors-only"
        return response
