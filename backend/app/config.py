from typing import List, Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _to_async_url(url: str) -> str:
    """Accept the URL shapes hosts hand out (`postgres://`, `postgresql://`)
    and normalise to the asyncpg driver the app uses."""
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://"):]
    return url


def _to_sync_url(url: str) -> str:
    """Alembic and one-off scripts use psycopg2."""
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql+asyncpg://"):
        url = "postgresql://" + url[len("postgresql+asyncpg://"):]
    return url


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


settings = Settings()
