import re
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.vendor import Vendor, VendorProfile, VendorRole

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

HANDLE_RE = re.compile(r"^[a-z0-9_]{3,100}$")


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
    password: str = Field(min_length=8, max_length=72)  # bcrypt's input limit
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


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def vendor_id_from_token(token: str) -> Optional[uuid.UUID]:
    """Shared by the HTTP dependency and the chat WebSocket."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        sub = payload.get("sub")
        return uuid.UUID(sub) if sub else None
    except (JWTError, ValueError):
        return None


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

    # Update last active, at most once a minute so reads stay reads.
    now = datetime.utcnow()
    if not vendor.last_active or (now - vendor.last_active).total_seconds() > 60:
        vendor.last_active = now
        await db.commit()
    return vendor


def _token_for(vendor: Vendor) -> Token:
    return Token(
        access_token=create_access_token({"sub": str(vendor.id)}),
        token_type="bearer",
        vendor_id=str(vendor.id),
        vendor_handle=vendor.vendor_handle,
    )


@router.post("/register", response_model=Token, status_code=201)
async def register_vendor(data: VendorRegister, db: AsyncSession = Depends(get_db)):
    """Register as a vendor. There is no consumer registration. You ARE a vendor."""
    handle = normalize_handle(data.vendor_handle)
    email = data.email.lower()

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
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    """Log in with email or @handle."""
    username = form_data.username.strip().lower().lstrip("@")
    vendor = (await db.execute(
        select(Vendor).where((Vendor.email == username) | (Vendor.vendor_handle == username))
    )).scalar_one_or_none()

    if not vendor or not pwd_context.verify(form_data.password, vendor.password_hash):
        raise HTTPException(401, "Invalid credentials")

    return _token_for(vendor)
