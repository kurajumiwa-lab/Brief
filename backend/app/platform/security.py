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

# Some surfaces (the guide, park listings) must work for a visitor who has not
# signed in. Using ``oauth2_scheme`` there raises 401 before the handler runs, so
# those routes depend on this one instead: it puts the token in the same
# ``Authorization: Bearer`` header and lets the handler decide what absence means.
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


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


DORMANCY_CONFIRMATION_TYPE = "dormancy_confirmation"
DORMANCY_CONFIRMATION_MINUTES = 5


def create_dormancy_confirmation_token(vendor_id: UUID | str, from_role: str) -> str:
    """Issue a short-lived proof that a dormancy flow was started.

    This is deliberately NOT an access token: ``vendor_id_from_token`` only
    accepts the ``access`` type. The token carries the role it was issued from,
    so a confirmation collected before the role changed cannot be replayed
    against a different state.
    """
    expire = datetime.utcnow() + timedelta(minutes=DORMANCY_CONFIRMATION_MINUTES)
    payload = {
        "sub": str(vendor_id),
        "from_role": str(from_role),
        "to_role": "dormant",
        "type": DORMANCY_CONFIRMATION_TYPE,
        "exp": expire,
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_dormancy_confirmation_token(
    token: Optional[str], vendor_id: UUID | str, from_role: str
) -> bool:
    """Check the proof against this vendor's *current* role."""
    if not token:
        return False
    payload = _decode(token, DORMANCY_CONFIRMATION_TYPE)
    if not payload:
        return False
    return (
        payload.get("sub") == str(vendor_id)
        and payload.get("from_role") == str(from_role)
        and payload.get("to_role") == "dormant"
    )


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
