import re
import uuid
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.governance import VendorActivityDay
from app.models.vendor import Vendor, VendorProfile, VendorRole
from app.platform.security import (
    _decode,
    create_access_token,
    create_refresh_token,
    oauth2_scheme,
    vendor_id_from_token,  # noqa: F401  (re-exported: chat WS + tests import from here)
)
from app.services import login_guard

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

HANDLE_RE = re.compile(r"^[a-z0-9_]{3,100}$")
PASSWORD_RULE = "Password must be at least {n} characters with one uppercase letter and one number"


def validate_password(password: str) -> str:
    """Directive v2.1 §1.2: 8+ characters, one uppercase letter, one digit.
    bcrypt reads at most 72 bytes, so the upper bound stays."""
    rule = PASSWORD_RULE.format(n=settings.PASSWORD_MIN_LENGTH)
    if len(password) < settings.PASSWORD_MIN_LENGTH:
        raise HTTPException(400, rule)
    if len(password.encode("utf-8")) > 72:
        raise HTTPException(400, "Password must be at most 72 characters")
    if not re.search(r"[A-Z]", password) or not re.search(r"[0-9]", password):
        raise HTTPException(400, rule)
    return password


def client_address(request: Optional[Request]) -> str:
    if request is None:
        return "unknown"
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return forwarded or (request.client.host if request.client else "unknown")


def normalize_handle(raw: str) -> str:
    handle = raw.strip().lstrip("@").lower().replace(" ", "_").replace("-", "_")
    if not HANDLE_RE.match(handle):
        raise HTTPException(400, "Handle must be 3-100 characters: letters, numbers, underscores")
    return handle


class VendorRegister(BaseModel):
    business_name: str = Field(min_length=1, max_length=200)
    vendor_handle: str
    email: EmailStr
    phone: Optional[str] = None
    password: str = Field(min_length=1, max_length=72)  # rule enforced by validate_password()
    business_categories: list[str] = []
    business_description: Optional[str] = None
    physical_location: Optional[str] = None

    @field_validator("business_categories")
    @classmethod
    def _clean_categories(cls, v: list[str]) -> list[str]:
        return [c.strip() for c in v if c and c.strip()][:20]


class Token(BaseModel):
    access_token: str
    token_type: str
    vendor_id: str
    vendor_handle: str
    refresh_token: Optional[str] = None
    expires_in: int = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60  # seconds


class RefreshRequest(BaseModel):
    refresh_token: str


async def get_current_vendor(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> Vendor:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated. All users must be vendors.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    vendor_id = vendor_id_from_token(token)
    if vendor_id is None:
        raise credentials_exception

    vendor = (await db.execute(select(Vendor).where(Vendor.id == vendor_id))).scalar_one_or_none()
    if vendor is None:
        raise credentials_exception

    # Governance activity eligibility is distinct-day based, not request-volume
    # based. Postgres uniqueness makes repeated reads/votes in one local day count once.
    now = datetime.utcnow()
    local_day = datetime.now(ZoneInfo("Africa/Nairobi")).date()
    inserted = await db.execute(
        pg_insert(VendorActivityDay)
        .values(vendor_id=vendor.id, local_day=local_day, created_at=now)
        .on_conflict_do_nothing(index_elements=["vendor_id", "local_day"])
        .returning(VendorActivityDay.id)
    )
    activity_added = inserted.scalar_one_or_none() is not None
    last_active_changed = not vendor.last_active or (now - vendor.last_active).total_seconds() > 60
    if last_active_changed:
        vendor.last_active = now
    if activity_added or last_active_changed:
        await db.commit()
    return vendor


def _pwd_fingerprint(vendor: Vendor) -> str:
    return (vendor.password_hash or "")[-12:]


def _token_for(vendor: Vendor) -> Token:
    return Token(
        access_token=create_access_token({"sub": str(vendor.id)}),
        refresh_token=create_refresh_token({"sub": str(vendor.id), "pwd": _pwd_fingerprint(vendor)}),
        token_type="bearer",
        vendor_id=str(vendor.id),
        vendor_handle=vendor.vendor_handle,
    )


@router.post("/register", response_model=Token, status_code=201)
async def register_vendor(data: VendorRegister, db: AsyncSession = Depends(get_db)):
    """Register as a vendor. There is no consumer registration. You ARE a vendor."""
    handle = normalize_handle(data.vendor_handle)
    email = data.email.lower()
    validate_password(data.password)

    existing = (await db.execute(
        select(Vendor).where((Vendor.email == email) | (Vendor.vendor_handle == handle))
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(400, "Email or handle already registered in vendor network")

    vendor = Vendor(
        business_name=data.business_name.strip(),
        vendor_handle=handle,
        email=email,
        phone=data.phone,
        password_hash=pwd_context.hash(data.password),
        business_categories=data.business_categories,
        business_description=data.business_description,
        physical_location=data.physical_location,
        current_role=VendorRole.BOTH,
    )
    db.add(vendor)
    await db.flush()

    db.add(VendorProfile(vendor_id=vendor.id, primary_goods=list(data.business_categories)))
    await db.commit()
    return _token_for(vendor)


@router.post("/login", response_model=Token)
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    """Log in with email or @handle. Five failures lock the account for
    LOGIN_LOCKOUT_MINUTES (429 with Retry-After)."""
    username = form_data.username.strip().lower().lstrip("@")
    client = client_address(request)
    await login_guard.assert_not_locked(username, client)

    vendor = (await db.execute(
        select(Vendor).where((Vendor.email == username) | (Vendor.vendor_handle == username))
    )).scalar_one_or_none()

    if not vendor or not pwd_context.verify(form_data.password, vendor.password_hash):
        remaining = await login_guard.record_failure(username, client)
        if remaining <= 0:
            raise HTTPException(
                429, f"Too many failed login attempts. Try again in {settings.LOGIN_LOCKOUT_MINUTES} minutes.",
                headers={"Retry-After": str(settings.LOGIN_LOCKOUT_MINUTES * 60)},
            )
        raise HTTPException(401, "Invalid credentials")

    await login_guard.clear(username, client)
    return _token_for(vendor)


@router.post("/refresh", response_model=Token)
async def refresh(data: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """Trade a refresh token for a fresh access token (and a rotated refresh token)."""
    payload = _decode(data.refresh_token, "refresh")
    if not payload:
        raise HTTPException(401, "Invalid or expired refresh token")
    try:
        vendor_id = uuid.UUID(payload.get("sub") or "")
    except ValueError:
        raise HTTPException(401, "Invalid or expired refresh token")

    vendor = await db.get(Vendor, vendor_id)
    if vendor is None or payload.get("pwd") != _pwd_fingerprint(vendor):
        raise HTTPException(401, "Refresh token no longer valid; log in again")
    return _token_for(vendor)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password", response_model=Token)
async def change_password(
    data: PasswordChange,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Rotate the password; every refresh token issued before this stops working."""
    if not pwd_context.verify(data.current_password, vendor.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    validate_password(data.new_password)
    vendor.password_hash = pwd_context.hash(data.new_password)
    await db.commit()
    return _token_for(vendor)
