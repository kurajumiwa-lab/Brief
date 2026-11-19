"""Runtime commercial configuration.

Rates are percentages, stored in `commerce_settings` so an operator can change a
disclosed fee without a deploy. The environment values only seed a missing key;
once a key exists the database wins, which makes the audit trail meaningful.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.modules.corridor_tasks.models import FEE_PCT, TASK_TYPE_LABELS
from app.modules.town.models import CommerceSetting

CAMPAIGN_FEE = "referral_campaign_fee"
LEAD_FEE = "referral_lead_fee"
CREDIT_EXPIRY = "merchant_credit_expiry"

# Scout task fees are percentages too, so they live in the same runtime table
# instead of being a deploy-time constant. The defaults mirror the historical
# 5–8% ladder; an operator can change them without a code change.
SCOUT_FEE_KEYS: dict[str, str] = {
    task_type: f"scout_fee_{task_type.lower()}" for task_type in FEE_PCT
}

DEFAULTS: dict[str, dict[str, Any]] = {
    CAMPAIGN_FEE: {"pct": 2.0, "label": "Referral campaign fee"},
    LEAD_FEE: {"pct": 6.0, "label": "Verified lead fee"},
    CREDIT_EXPIRY: {"days": 365, "label": "Prepaid credit validity"},
    **{
        key: {"pct": float(FEE_PCT[task_type]), "label": f"{TASK_TYPE_LABELS[task_type]} fee"}
        for task_type, key in SCOUT_FEE_KEYS.items()
    },
}


def default_for(key: str) -> dict[str, Any]:
    base = dict(DEFAULTS.get(key, {}))
    if key == CAMPAIGN_FEE:
        base["pct"] = float(settings.TOWN_CAMPAIGN_FEE_PCT)
    elif key == LEAD_FEE:
        base["pct"] = float(settings.TOWN_LEAD_FEE_PCT)
    elif key == CREDIT_EXPIRY:
        base["days"] = int(settings.TOWN_CREDIT_EXPIRY_DAYS)
    return base


async def get_value(db: AsyncSession, key: str) -> dict[str, Any]:
    row = (
        await db.execute(select(CommerceSetting).where(CommerceSetting.key == key))
    ).scalar_one_or_none()
    value = default_for(key)
    if row is not None and isinstance(row.value, dict):
        value.update(row.value)
    return value


async def get_pct(db: AsyncSession, key: str) -> Decimal:
    value = await get_value(db, key)
    try:
        pct = Decimal(str(value.get("pct", 0)))
    except Exception:
        pct = Decimal("0")
    return max(Decimal("0"), min(Decimal("100"), pct))


def charging_enabled() -> bool:
    """Collection needs both switches: the product is currently free-for-now.

    We still *quote* the configured percentage so the merchant sees the rate.
    We simply do not accrue a fee while `FREE_FOR_NOW` is on, and we say why.
    """
    return bool(settings.FEES_ENABLED and not settings.FREE_FOR_NOW)


async def quote(db: AsyncSession, key: str, base_kes: int) -> dict[str, Any]:
    """A transparent fee quote. The percentage is the rule; the fee is derived."""
    pct = await get_pct(db, key)
    base = max(0, int(base_kes or 0))
    fee = 0
    if charging_enabled():
        fee = int((Decimal(base) * pct / Decimal("100")).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        ))
    return {
        "basis": key,
        "base_kes": base,
        "fee_pct": float(pct),
        "fee_kes": max(0, fee),
        "charged": charging_enabled(),
        "reason": None if charging_enabled() else (
            "free_for_now" if settings.FREE_FOR_NOW else "fees_disabled"
        ),
    }


async def set_value(
    db: AsyncSession, key: str, value: dict[str, Any], *, actor_id=None,
    description: str | None = None,
) -> CommerceSetting:
    row = (
        await db.execute(select(CommerceSetting).where(CommerceSetting.key == key))
    ).scalar_one_or_none()
    if row is None:
        row = CommerceSetting(key=key, value=dict(value), description=description)
        db.add(row)
    else:
        row.value = {**(row.value or {}), **dict(value)}
        if description:
            row.description = description
    row.updated_by_vendor_id = actor_id
    await db.flush()
    return row


async def all_values(db: AsyncSession) -> dict[str, dict[str, Any]]:
    rows = (await db.execute(select(CommerceSetting))).scalars().all()
    stored = {row.key: row.value for row in rows}
    return {
        key: {**default_for(key), **(stored.get(key) or {})}
        for key in DEFAULTS
    }
