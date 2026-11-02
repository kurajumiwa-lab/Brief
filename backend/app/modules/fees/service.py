"""Fee calculation. Pure where it can be, and inert while fees are off."""

from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.modules.fees import rules
from app.modules.fees.models import FeeRecord, FeeRule


class FeeError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def compute_fee(rule_row, base_amount_kes: int = 0) -> int:
    """The fee a rule would charge. Zero for anything disabled or unknown."""
    if rule_row is None or not rule_row.enabled:
        return 0
    if rule_row.basis == "flat":
        return max(0, int(rule_row.amount_kes or 0))
    if rule_row.basis == "bps":
        return max(0, int(base_amount_kes) * int(rule_row.rate_bps or 0) // 10_000)
    return 0


async def ensure_rules(db: AsyncSession) -> None:
    """Seed missing rules as disabled. Existing rows (and their prices) are never changed."""
    existing = {r.key for r in (await db.execute(select(FeeRule.key))).all()}
    for key, label, desc, basis in rules.FEE_SEED:
        if key not in existing:
            db.add(FeeRule(key=key, label=label, description=desc, basis=basis,
                           amount_kes=0, rate_bps=0, enabled=False))
    await db.flush()


async def schedule(db: AsyncSession) -> dict:
    """Public, transparent fee schedule. Says plainly what is being charged now."""
    await ensure_rules(db)
    rows = (await db.execute(select(FeeRule).order_by(FeeRule.key))).scalars().all()
    live = bool(settings.FEES_ENABLED) and not settings.FREE_FOR_NOW
    return {
        "fees_live": live,
        "message": ("Fees are live for the rules marked enabled."
                    if live else "Free for now. No fees are being charged."),
        "rules": [{
            "key": r.key,
            "label": r.label,
            "description": r.description,
            "basis": r.basis,
            "amount_kes": int(r.amount_kes or 0),
            "rate_bps": int(r.rate_bps or 0),
            "enabled": bool(r.enabled),
            "charging_now": live and bool(r.enabled),
        } for r in rows],
    }


async def fee_for(db: AsyncSession, rule_key: str, *, base_amount_kes: int = 0,
                  subject_type: str = "", subject_id: str = "") -> int:
    """Calculate the fee for one event. Records it only when fees are live.

    Product sales and payments never call this. Coordination code calls it, and
    while fees are off it returns 0 and writes nothing.
    """
    if not (settings.FEES_ENABLED and not settings.FREE_FOR_NOW):
        return 0
    row = await db.get(FeeRule, rule_key)
    fee = compute_fee(row, base_amount_kes)
    if fee > 0:
        db.add(FeeRecord(rule_key=rule_key, subject_type=subject_type, subject_id=subject_id,
                         base_amount_kes=int(base_amount_kes), fee_kes=fee,
                         created_at=datetime.utcnow()))
    return fee


async def update_rule(db: AsyncSession, key: str, *, enabled: Optional[bool], amount_kes: Optional[int],
                      rate_bps: Optional[int], actor: str) -> FeeRule:
    if key not in rules.FEE_KEYS:
        raise FeeError("Unknown fee rule.", 404)
    await ensure_rules(db)
    row = await db.get(FeeRule, key)
    if amount_kes is not None:
        if amount_kes < 0 or amount_kes > 10_000_000:
            raise FeeError("Amount is out of range.", 400)
        row.amount_kes = amount_kes
    if rate_bps is not None:
        if rate_bps < 0 or rate_bps > rules.MAX_BPS:
            raise FeeError(f"Rate must be between 0 and {rules.MAX_BPS} (20%).", 400)
        row.rate_bps = rate_bps
    if enabled is not None:
        row.enabled = enabled
    row.updated_at = datetime.utcnow()
    row.updated_by = actor
    await db.flush()
    return row
