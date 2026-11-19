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
# production — see app/routes/ops.py). Everything else under /api needs a member.
# The PSP webhook is signed (HMAC-SHA256) instead of bearer-authenticated.
OPEN_PREFIXES = ("/api/auth/", "/api/health", "/api/metrics", "/api/payments/webhook",
                 "/api/catalog", "/docs", "/redoc", "/openapi.json",
                 # Caesar's front door: a participant joins the conversation
                 # without being a vendor, so there is no token to present yet.
                 # Every other /api/social/* route still requires one.
                 "/api/social/accounts",
                 # Customer reviews: no login. Each route checks its own device key and till code.
                 "/api/trust/customer")
# Home office: a single-use invite link is the proof, so the person needs no account. Only
# the exact POST in OFFICE_OPEN_POST is open; every other /api/office route needs a signed-in member.


# Read-only public browsing (no account): the open offer list, the knowledge
# directory and the free blueprint library. Only GET is open here. Every route
# under these prefixes that is personal or changes data still depends on
# `get_current_vendor`, so it answers 401 without a token at the route level too.
PUBLIC_READ_PREFIXES = ("/api/profiles/", "/api/og/events/", "/api/offers/public", "/api/knowledge/sectors", "/api/knowledge/listings",
                        "/api/blueprints", "/api/trust/public", "/api/office/public/",
                        # Offerings a person shows the network: visible rows only, GET only.
                        "/api/offerings/of/",
                        # The public Page (/page/:handle): one read per business, no account.
                        "/api/professional/page/",
                        # Social seller trust card: the page a TikTok/Facebook buyer
                        # opens from a bio link. Read-only, GET only.
                        "/api/social-trust/public/",
                        # Corridor price ranges: market information, no seller
                        # identities and no personal data. Read-only, GET only.
                        "/api/corridors/",
                        # Receipt-network shop cards and merchant-funded deals:
                        # readable without an account, GET only. A claim, a claim
                        # of a voucher and redemption all still require a member.
                        "/api/receipts/merchants", "/api/receipts/offers",
                        "/api/receipts/invites",
                        # A referral link arrives in WhatsApp. Opening it needs no
                        # account; claiming it is a POST and stays behind auth.
                        "/api/referrals/public/",
                        # The referral index is browsable before sign-in. Its
                        # share-link landing records a click; claiming is a POST
                        # and stays behind auth.
                        "/api/town/referral-index/public/")

OFFICE_OPEN_POST = ("/api/office/links/accept",)


class VendorOnlyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        public_read = (request.method == "GET" and path.startswith(PUBLIC_READ_PREFIXES)) or (request.method == "HEAD" and path.startswith("/api/og/events/"))
        office_link = request.method == "POST" and (path in OFFICE_OPEN_POST or (path.startswith("/api/spotted-deals/") and path.endswith("/opt-out")))
        if path.startswith("/api/") and not path.startswith(OPEN_PREFIXES) and not public_read \
                and not office_link and request.method != "OPTIONS":
            auth = request.headers.get("authorization", "")
            # WebSocket upgrades authenticate with ?token= inside the handler.
            is_ws = request.headers.get("upgrade", "").lower() == "websocket"
            if not is_ws and not auth.lower().startswith("bearer "):
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Not authenticated. Sign in to continue."},
                    headers={"WWW-Authenticate": "Bearer", "X-Brief-Network": "members"},
                )
        response = await call_next(request)
        response.headers["X-Brief-Network"] = "members"
        return response
