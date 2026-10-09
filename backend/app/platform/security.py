"""Token mechanics — minting and verifying the vendor's keys to the network.

Extracted from routes/auth.py (the locked decision: authorization mechanics
are platform, not a router's private stash). `get_current_vendor` — the
vendor lookup and its governance side-effects — stays in routes/auth.py until
the identity wave gives it a proper home; this module deliberately knows
nothing about vendors.

Re-exported by app.routes.auth, so every existing import keeps working.
"""

import uuid
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

from app.config import settings

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(data: dict) -> str:
    """Long-lived, only good for /auth/refresh. Carries a `pwd` fingerprint so
    changing the password invalidates refresh tokens issued before it."""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh", "jti": uuid.uuid4().hex})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def _decode(token: str, expected_type: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None
    # Tokens minted before v2.1 carry no type; treat them as access tokens.
    if payload.get("type", "access") != expected_type:
        return None
    return payload


def vendor_id_from_token(token: str) -> Optional[UUID]:
    """Shared by the HTTP dependency and the chat WebSocket. Refresh tokens
    are refused here: they only open /auth/refresh."""
    payload = _decode(token, "access")
    if not payload:
        return None
    try:
        sub = payload.get("sub")
        return uuid.UUID(sub) if sub else None
    except ValueError:
        return None
