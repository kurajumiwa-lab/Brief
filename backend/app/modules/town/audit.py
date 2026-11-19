"""Write the commercial audit trail into the existing append-only trust log."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.trust.models import AuditEvent


def audit(
    db: AsyncSession,
    *,
    action: str,
    entity_type: str,
    entity_id,
    actor_vendor_id=None,
    payload: dict[str, Any] | None = None,
    country_code: str = "KE",
) -> AuditEvent:
    """Queue an audit row in the caller's transaction.

    Same transaction is deliberate: a credit confirmation that fails to commit
    must not leave an audit entry claiming it happened. JSON values are reduced
    to primitives so a SQLAlchemy object cannot leak into the log.
    """
    safe: dict[str, Any] = {}
    for key, value in (payload or {}).items():
        if isinstance(value, (str, int, float, bool)) or value is None:
            safe[key] = value
        elif isinstance(value, (datetime,)):
            safe[key] = value.isoformat()
        else:
            safe[key] = str(value)
    row = AuditEvent(
        id=uuid.uuid4(),
        actor_vendor_id=actor_vendor_id,
        action=action[:60],
        entity_type=entity_type[:40],
        entity_id=entity_id,
        country_code=country_code,
        payload=safe,
        created_at=datetime.utcnow(),
    )
    db.add(row)
    return row
