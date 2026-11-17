"""Shared spotted-deal visibility, moderation and expiry policy helpers."""
from datetime import datetime
from decimal import Decimal

from sqlalchemy import and_

from app.models.receipts import ReceiptMerchant
from app.models.spotted_deals import SpottedDeal

PUBLIC_STATUSES = ("LIVE_UNVERIFIED", "RECEIPT_LINKED")
ABUSE_FLAGS = frozenset(("FALSE_PRICE", "WRONG_SHOP", "SPAM"))


def public_visibility(now: datetime):
    """Canonical SQL predicate; caller must join ReceiptMerchant by merchant_id."""
    return and_(SpottedDeal.status.in_(PUBLIC_STATUSES), SpottedDeal.expires_at > now,
                ReceiptMerchant.allow_spotted_deals.is_(True))


def flag_weight(flag_type: str, level: int, dampened: bool) -> Decimal:
    if flag_type not in ABUSE_FLAGS | {"DEAL_ENDED"}:
        raise ValueError("Unknown flag type")
    if level < (1 if flag_type == "DEAL_ENDED" else 2):
        raise ValueError("Insufficient standing")
    base = Decimal("3.00") if flag_type == "DEAL_ENDED" and level >= 3 else Decimal("1.00")
    return base * (Decimal("0.50") if dampened else Decimal("1.00"))


def exclusive_relationship(pair_trades: int, total_trades: int, distinct_counterparties: int) -> bool:
    return pair_trades > 0 and total_trades > 0 and (
        distinct_counterparties == 1 or pair_trades * 5 >= total_trades * 4
    )


def jury_outcome(remove_votes: int, restore_votes: int, expires_at: datetime,
                 review_deadline: datetime, now: datetime, has_prior_confirmation: bool):
    """Return a transition or None while open; dispute receipts are not confirmations."""
    if now >= review_deadline:
        return "OPTED_OUT"
    if remove_votes >= 2:
        return "OPTED_OUT"
    if restore_votes >= 2:
        if expires_at <= now:
            return "EXPIRED"
        return "RECEIPT_LINKED" if has_prior_confirmation else "LIVE_UNVERIFIED"
    return None


async def sweep_expired(db, now: datetime) -> dict[str, int]:
    """Expire live deals and fail closed on overdue opt-outs/reviews.

    Single conditional UPDATEs serialize against row-locked transitions in the
    API. The caller owns the transaction and commits. No receipt state,
    standing credit or shop ownership is inferred here.
    """
    from sqlalchemy import update, delete
    from datetime import timedelta
    from app.models.spotted_deals import SpottedDealFlag, SpottedOptOutAttempt
    live = await db.execute(update(SpottedDeal).where(
        SpottedDeal.status.in_(PUBLIC_STATUSES), SpottedDeal.expires_at <= now,
    ).values(status="EXPIRED", updated_at=now))
    opt_out = await db.execute(update(SpottedDeal).where(
        SpottedDeal.status == "PAUSED_OPT_OUT", SpottedDeal.opt_out_deadline <= now,
    ).values(status="OPTED_OUT", updated_at=now))
    jury = await db.execute(update(SpottedDeal).where(
        SpottedDeal.status == "DISPUTED_REVIEW", SpottedDeal.jury_review_deadline <= now,
    ).values(status="OPTED_OUT", updated_at=now))
    await db.execute(update(SpottedDealFlag).where(SpottedDealFlag.created_at < now - timedelta(days=2), SpottedDealFlag.ip_subnet_hash.is_not(None)).values(ip_subnet_hash=None))
    await db.execute(update(SpottedDeal).where(SpottedDeal.opt_out_requested_at < now - timedelta(days=2), SpottedDeal.opt_out_subnet_hash.is_not(None)).values(opt_out_subnet_hash=None))
    await db.execute(delete(SpottedOptOutAttempt).where(SpottedOptOutAttempt.created_at < now - timedelta(days=2)))
    return {"expired": live.rowcount, "opted_out": opt_out.rowcount + jury.rowcount}
