from typing import List, Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _rename_query_option(url: str, old: str, new: str) -> str:
    """Rename one `?key=value` option, leaving every other byte of the URL alone.

    libpq (psycopg2) spells the TLS option `sslmode`, asyncpg spells it `ssl`, and
    SQLAlchemy forwards query options to the driver verbatim — so the wrong
    spelling is rejected (`invalid connection option "ssl"` / `unexpected keyword
    argument 'sslmode'`). Hosts hand out the libpq spelling; people copy the asyncpg
    one from SQLAlchemy docs. Accepting both means one DATABASE_URL serves both
    drivers. If the target spelling is already present it wins and `old` is dropped.
    """
    # rpartition: a `?` inside the password must not be mistaken for the query start.
    base, sep, query = url.rpartition("?")
    if not sep:
        return url
    pairs = query.split("&")
    keys = [pair.partition("=")[0] for pair in pairs]
    if old not in keys:
        return url
    kept = []
    for pair, key in zip(pairs, keys):
        if key == old:
            if new in keys:
                continue
            pair = new + pair[len(old):]
        kept.append(pair)
    return base + "?" + "&".join(kept)


def _to_async_url(url: str) -> str:
    """Accept the URL shapes hosts hand out (`postgres://`, `postgresql://`)
    and normalise to the asyncpg driver the app uses."""
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://"):]
    return _rename_query_option(url, "sslmode", "ssl")


def _to_sync_url(url: str) -> str:
    """Alembic and one-off scripts use psycopg2."""
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql+asyncpg://"):
        url = "postgresql://" + url[len("postgresql+asyncpg://"):]
    return _rename_query_option(url, "ssl", "sslmode")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    APP_NAME: str = "Brief_ Vendor Network"
    VERSION: str = "2.2.0"
    DESCRIPTION: str = "No consumers. Only vendors."
    DEBUG: bool = False

    # Database — Postgres only. Either shape is accepted; both derived URLs are
    # normalised in the validators below.
    DATABASE_URL: str = "postgresql+asyncpg://brief:brief@db:5432/brief_vendors"
    DATABASE_URL_SYNC: Optional[str] = None
    # Dev convenience: create tables at boot. Production runs `alembic upgrade head`.
    AUTO_CREATE_TABLES: bool = True
    # entrypoint.sh keeps retrying this many seconds for Postgres to accept connections
    # before it gives up with "database never became reachable" (0 = one attempt).
    DB_WAIT_TIMEOUT: int = 60

    # Redis for the rate limiter (optional; falls back to in-process memory).
    REDIS_URL: str = "redis://redis:6379/0"

    # Auth
    SECRET_KEY: str = "vendor-network-secret-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours - vendors are busy
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    # Password rule: PASSWORD_MIN_LENGTH+ chars, one uppercase, one digit (v2.1).
    PASSWORD_MIN_LENGTH: int = 8
    # Login lockout: after MAX_LOGIN_ATTEMPTS failures for one account (or from
    # one client) within LOGIN_LOCKOUT_MINUTES, further attempts get a 429.
    MAX_LOGIN_ATTEMPTS: int = 5
    LOGIN_LOCKOUT_MINUTES: int = 15

    # Browser clients on another origin. The Vite dev server proxies /api and the
    # production image serves the built frontend itself, so same-origin needs
    # none of these. Comma-separated so it can be set from any host's env UI.
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000"

    # POS Bridge + housekeeping scheduler (hold expiry, event reminders).
    # Multi-worker deploys set RUN_SCHEDULER=false on the API and run
    # `python -m app.worker` once instead.
    POS_SYNC_INTERVAL: int = 300  # seconds between scheduler passes
    RUN_SCHEDULER: bool = True
    ALLOWED_POS_SYSTEMS: str = "square,shopify,csv,manual,custom_api"

    # Rate limits (requests per minute)
    RATE_LIMIT_AUTH: int = 20
    RATE_LIMIT_API: int = 600

    # Observability (v2.2 §6.2). METRICS_ENABLED off removes the timing middleware;
    # METRICS_TOKEN set gates GET /api/metrics behind ?token= or a bearer token.
    METRICS_ENABLED: bool = True
    METRICS_TOKEN: str = ""
    SLOW_REQUEST_MS: int = 1000          # requests above this are logged and listed by /api/ops/slow

    # Tool bookings & routing (v2.2 §5.x)
    BOOKING_MAX_DAYS: int = 365          # longest window a single booking may span
    ROUTE_DEFAULT_SPEED_KMH: float = 25.0

    # Payments & custody (v2.5) — PSP-as-abstraction model, no direct Daraja.
    # PSP holds all float in segregated sub-accounts; this app holds the
    # append-only ledger. Funds never touch the operating account.
    #   mock      — in-process PSP with in-memory wallets (dev, tests, demo)
    #   intasend  — real PSP (set PSP_API_KEY / PSP_API_SECRET)
    PSP_PROVIDER: str = "mock"
    PSP_API_KEY: str = ""
    PSP_API_SECRET: str = ""
    PSP_BASE_URL: str = ""   # override; provider default otherwise
    # HMAC-SHA256 secret for the single inbound webhook (X-Webhook-Signature).
    PSP_WEBHOOK_SECRET: str = "psp-webhook-secret-dev"
    # Disbursements above this amount require two different approvers.
    DUAL_APPROVAL_THRESHOLD_KSH: int = 10_000
    # Platform facilitation fee on settled Lock clusters (supplier settlement).
    PLATFORM_FEE_RATE: float = 0.04
    # Pending payment intents expire after this long (the PSP may still deliver
    # a late success, which is then treated as an orphan by reconciliation).
    PAYMENT_INTENT_TTL_MINUTES: int = 30
    # Reconciliation: run daily at this UTC hour (01:00 EAT) and flag any
    # wallet whose PSP balance disagrees with the ledger by more than this.
    DAILY_RECONCILIATION_HOUR_UTC: int = 22
    RECONCILIATION_VARIANCE_TOLERANCE_KSH: int = 100
    # When true, collections require vendor.phone_verified_at to be set.
    PAYMENT_REQUIRE_VERIFIED_PHONE: bool = False
    # Marketplace orders stay payment-disabled until a licensed PSP has agreed
    # to the collection/settlement flow and the merchant sub-account is set.
    # Never point order collections at an ordinary operating account.
    TRADE_PAYMENTS_ENABLED: bool = False
    TRADE_SETTLEMENT_ENABLED: bool = False
    TRADE_PSP_SUB_ACCOUNT: str = ""
    TRADE_PLATFORM_FEE_RATE: float = 0.0
    # Per-transaction and per-day collection caps (KSh).
    COLLECT_PER_TRANSACTION_LIMIT_KSH: int = 150_000
    COLLECT_DAILY_PER_VENDOR_LIMIT_KSH: int = 500_000
    # Per-transaction disbursement cap (KSh).
    DISBURSE_PER_TRANSACTION_LIMIT_KSH: int = 250_000
    # Digital chamas (Layer 2, table banking).
    CHAMA_MIN_MEMBERS: int = 5          # members required before a chama activates
    CHAMA_MAX_MEMBERS: int = 30
    CHAMA_MAX_POOL_KSH: int = 5_000_000  # per-chama pool cap
    # Halal pools (v2.6): flat admin fee (KSh) netted from each zero-interest
    # loan payout — covers PSP network charges; it is a disclosed cost, not
    # interest. Loans must exceed it.
    CHAMA_QARD_ADMIN_FEE_KSH: int = 50
    # Murabaha (cost-plus) advances: grace days after the payment due date
    # before the worker marks the contract defaulted.
    MURABAHA_GRACE_DAYS: int = 3

    # Pilot market staff are explicitly allow-listed as role:vendor_handle pairs,
    # e.g. admin:brief_admin,spotter:market_spotter,negotiator:market_negotiator.
    MARKET_OPS_ROLES: str = ""
    # Cooperative member votes are disabled unless a registered entity and its
    # reviewed legal basis are configured explicitly.
    GOVERNANCE_COOPERATIVE_ENABLED: bool = False
    GOVERNANCE_LEGAL_BASIS: str = ""

    # Single-container deploys: serve the built frontend from here if it exists.
    FRONTEND_DIST: str = "../frontend/dist"

    # File storage (spec sheets, CSVs, images) — Directive v2.1 §2.4.
    # Setting S3_BUCKET switches uploads to any S3-compatible bucket (AWS,
    # MinIO, Cloudflare R2, DO Spaces — S3_ENDPOINT selects the host).
    # Otherwise files land under UPLOAD_DIR and are served at /static.
    S3_BUCKET: str = ""
    AWS_ACCESS_KEY: str = ""
    AWS_SECRET_KEY: str = ""
    AWS_REGION: str = "us-east-1"
    S3_ENDPOINT: str = ""
    S3_PUBLIC_URL: str = ""      # CDN / public base URL for keys; optional
    S3_PUBLIC_ACL: bool = False  # send ACL=public-read (only buckets with ACLs enabled accept it)
    UPLOAD_DIR: str = "./static"
    MAX_UPLOAD_MB: int = 10
    # Voice notes live outside the public /static mount and are served only by
    # the authenticated chat endpoint. In production, use a private S3 bucket.
    VOICE_UPLOAD_DIR: str = "./voice_uploads"
    VOICE_MAX_BYTES: int = 512 * 1024
    VOICE_MAX_SECONDS: int = 15

    # ── Map / viewport tiles (v2.7) ──────────────────────────────────────────
    # The map NEVER downloads the whole directory. Every screenful is a bbox
    # query that returns clusters below these zoom levels and individual pins
    # above them, capped at MAP_POINT_LIMIT.
    #
    # Tile backend: chosen here, in one setting, and served to the client by
    # GET /api/map/config together with the attribution its licence requires
    # (see app/services/tile_providers.py).
    #
    #   auto      MapTiler when MAP_TILE_KEY is set, else the public OSM tiles
    #             (dev only) — so a fresh checkout needs no signup
    #   maptiler  OSM-derived raster, keyed  ← the production default
    #   stadia / thunderforest   OSM-derived alternatives, keyed
    #   osm       public OpenStreetMap tile server — DEVELOPMENT ONLY
    #   custom    your own tile stack; set MAP_TILE_URL (+ attribution)
    #
    # The public OSM tile server is community-funded, rate-limited and its
    # policy forbids bulk downloading. `/api/ops/status` and `/api/map/config`
    # both keep warning until it is replaced.
    MAP_TILE_PROVIDER: str = "auto"
    MAP_TILE_KEY: str = ""                          # {key} in a provider template
    MAP_TILE_URL: str = ""                          # override: self-hosted stack
    MAP_TILE_ATTRIBUTION: str = ""                  # override: its licence credit
    MAP_TILE_SUBDOMAINS: str = ""                   # e.g. "abc" for {s}-style CDNs
    MAP_TILE_MIN_ZOOM: int = 2
    MAP_TILE_MAX_ZOOM: int = 19
    # Zoom at or above which a layer stops clustering and returns real pins.
    MAP_PLACES_POINT_ZOOM: int = 15
    MAP_VENDORS_POINT_ZOOM: int = 12
    MAP_MARKETS_POINT_ZOOM: int = 6
    MAP_POINT_LIMIT: int = 300          # hard ceiling on pins per layer per view
    MAP_CLUSTER_CELL_PX: int = 96       # grid cell size on screen, in CSS pixels
    MAP_MAX_BBOX_DEG: float = 40.0      # reject absurd viewports (whole continents)
    # Server-side cache for viewport responses (process-local, then ETag/304 for
    # the browser). Redis is not used: these are cheap, short-lived and per-box.
    MAP_CACHE_TTL_SECONDS: int = 60
    MAP_CACHE_ENTRIES: int = 256
    MAP_COUNTS_TTL_SECONDS: int = 300   # the headline counters change slowly
    # Browser cache for a viewport response. Short: pins move, stock changes.
    MAP_HTTP_MAX_AGE_SECONDS: int = 30
    # v2.8 — the network-first map. A pin on the map is not a marketplace
    # member. Unclaimed public-data places are external: hidden by default on
    # the client, muted when shown, and dropped from the commercial map once
    # the source has not confirmed them for MAP_PLACE_STALE_DAYS. A sweep
    # archives what has been silent for MAP_PLACE_ARCHIVE_DAYS (the ingest
    # revives an archived row the day the source lists it again).
    MAP_PLACE_STALE_DAYS: int = 180
    MAP_PLACE_ARCHIVE_DAYS: int = 365

    # Notifications & holds
    STOCK_LOW_THRESHOLD: int = 5        # units at or below which a STOCK_LOW alert fires
    EVENT_REMINDER_HOURS: int = 24
    RESERVATION_HOLD_HOURS: int = 72    # unconfirmed sourcing requests lapse after this
    PERFORMANCE_ON_TIME_HOURS: int = 72  # confirm → ship inside this counts as on time

    @field_validator("DATABASE_URL")
    @classmethod
    def _norm_async(cls, v: str) -> str:
        return _to_async_url(v)

    @property
    def database_url_sync(self) -> str:
        return _to_sync_url(self.DATABASE_URL_SYNC or self.DATABASE_URL)

    @staticmethod
    def _split(value: str) -> List[str]:
        return [part.strip() for part in value.split(",") if part.strip()]

    @property
    def cors_origins(self) -> List[str]:
        return self._split(self.CORS_ORIGINS)

    @property
    def allowed_pos_systems(self) -> List[str]:
        return self._split(self.ALLOWED_POS_SYSTEMS)

    def market_ops_role(self, handle: str) -> Optional[str]:
        """Resolve a configured market staff role without storing role grants in app sessions."""
        valid_roles = {"admin", "clerk", "spotter", "negotiator"}
        for assignment in self._split(self.MARKET_OPS_ROLES):
            role, separator, vendor_handle = assignment.partition(":")
            if separator and role.strip().lower() in valid_roles and vendor_handle.strip().lower() == (handle or "").lower():
                return role.strip().lower()
        return None


settings = Settings()
