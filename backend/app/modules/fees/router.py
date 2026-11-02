"""Fee schedule (public) and operator controls.

    GET /api/fees/schedule                 transparent schedule: what is charged, and whether anything is
    PUT /api/fees/admin/{key}              operator: set enabled / amount / rate for one rule
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.fees import service
from app.routes.ops import require_operator

router = APIRouter()


class RuleIn(BaseModel):
    enabled: Optional[bool] = None
    amount_kes: Optional[int] = Field(None, ge=0)
    rate_bps: Optional[int] = Field(None, ge=0)


@router.get("/schedule")
async def get_schedule(db: AsyncSession = Depends(get_db)):
    data = await service.schedule(db)
    await db.commit()
    return data


@router.put("/admin/{key}")
async def set_rule(key: str, body: RuleIn, staff: Vendor = Depends(require_operator),
                   db: AsyncSession = Depends(get_db)):
    try:
        row = await service.update_rule(db, key, enabled=body.enabled, amount_kes=body.amount_kes,
                                        rate_bps=body.rate_bps, actor=staff.vendor_handle)
    except service.FeeError as exc:
        raise HTTPException(exc.status, str(exc))
    await db.commit()
    return {"key": row.key, "enabled": row.enabled, "amount_kes": int(row.amount_kes),
            "rate_bps": int(row.rate_bps)}
