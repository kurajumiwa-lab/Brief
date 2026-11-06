"""The confirmed-offer rule.

An offer is shown on the primary home shelf only when ALL of these hold:
  1. the stock item is shared with the network and has stock left;
  2. the business that sells it is verified (membership verification);
  3. EITHER a different business has completed a deal for it (a StockMovement
     that reached `received`), OR the Brief team confirmed it by hand.

Nothing is shown on the shelf for an unverified seller, even if it was
confirmed by hand earlier: verification comes first.

Not yet included: a check for open disputes on the deal. Stock movements have
no dispute record to read yet; add it when one exists.
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock import StockItem, StockMovement
from app.models.vendor import Vendor
from app.modules.membership.models import MemberProfile
from app.modules.offers.models import OfferConfirmation

CONFIRMED = "confirmed"
LISTED = "listed"
HIDDEN = "hidden"


@dataclass(frozen=True)
class Decision:
    status: str
    reason: str


def decide(*, shared: bool, seller_verified: bool, other_business_deals: int, by_hand: bool) -> Decision:
    """Pure rule, kept separate so it can be tested without a database."""
    if not shared:
        return Decision(HIDDEN, "Not shared with the network.")
    if not seller_verified:
        return Decision(LISTED, "Waiting for the business to be verified.")
    if by_hand:
        return Decision(CONFIRMED, "Confirmed by the Brief team.")
    if other_business_deals >= 1:
        plural = "" if other_business_deals == 1 else "es"
        return Decision(CONFIRMED, f"{other_business_deals} other business{plural} completed a deal for it.")
    return Decision(LISTED, "Waiting for its first completed deal with another business.")


def _deal_with_other_business():
    return exists().where(
        StockMovement.stock_item_id == StockItem.id,
        StockMovement.from_vendor_id == StockItem.vendor_id,
        StockMovement.to_vendor_id != StockItem.vendor_id,
        StockMovement.status == "received",
    )


def _by_hand():
    return exists().where(OfferConfirmation.stock_item_id == StockItem.id)


def _seller_verified():
    return exists().where(
        MemberProfile.vendor_id == StockItem.vendor_id,
        MemberProfile.verification_status == "verified",
    )


async def confirmed_offers(db: AsyncSession, viewer_id: uuid.UUID, limit: int = 12,
                           category: str | None = None) -> list[tuple[StockItem, Vendor]]:
    """Offers other businesses can source from, confirmed under the rule above."""
    query = (
        select(StockItem, Vendor)
        .join(Vendor, Vendor.id == StockItem.vendor_id)
        .where(
            StockItem.visible_to_network.is_(True),
            StockItem.quantity_available >= 1,
            StockItem.vendor_id != viewer_id,
            _seller_verified(),
            or_(_deal_with_other_business(), _by_hand()),
        )
        .order_by(StockItem.updated_at.desc())
        .limit(min(max(limit, 1), 50))
    )
    if category:
        query = query.where(StockItem.category.ilike(category))
    return [(item, vendor) for item, vendor in (await db.execute(query)).all()]


async def status_for_my_items(db: AsyncSession, vendor_id: uuid.UUID) -> list[dict]:
    """Every item I sell, with its status and the reason in plain words."""
    verified = (await db.execute(select(MemberProfile.verification_status).where(
        MemberProfile.vendor_id == vendor_id))).scalar_one_or_none() == "verified"

    deal_count = (
        select(func.count(func.distinct(StockMovement.to_vendor_id)))
        .where(
            StockMovement.stock_item_id == StockItem.id,
            StockMovement.from_vendor_id == StockItem.vendor_id,
            StockMovement.to_vendor_id != StockItem.vendor_id,
            StockMovement.status == "received",
        )
        .scalar_subquery()
    )
    rows = (await db.execute(
        select(StockItem, _by_hand().label("by_hand"), deal_count.label("deals"))
        .where(StockItem.vendor_id == vendor_id)
        .order_by(StockItem.updated_at.desc())
        .limit(200)
    )).all()

    out = []
    for item, by_hand, deals in rows:
        d = decide(shared=bool(item.visible_to_network), seller_verified=verified,
                   other_business_deals=int(deals or 0), by_hand=bool(by_hand))
        out.append({"id": str(item.id), "name": item.name, "category": item.category,
                    "unit_price": item.unit_price, "unit": item.unit_of_measure,
                    "quantity_available": item.quantity_available,
                    "status": d.status, "reason": d.reason})
    return out


async def set_by_hand(db: AsyncSession, staff_id: uuid.UUID, item_id: uuid.UUID, reason: str) -> bool:
    """Record a hand confirmation. Returns False if it already existed."""
    existing = (await db.execute(select(OfferConfirmation).where(
        OfferConfirmation.stock_item_id == item_id))).scalar_one_or_none()
    if existing is not None:
        return False
    db.add(OfferConfirmation(stock_item_id=item_id, confirmed_by_vendor_id=staff_id, reason=reason))
    await db.flush()
    return True


async def remove_by_hand(db: AsyncSession, item_id: uuid.UUID) -> bool:
    row = (await db.execute(select(OfferConfirmation).where(
        OfferConfirmation.stock_item_id == item_id))).scalar_one_or_none()
    if row is None:
        return False
    await db.delete(row)
    await db.flush()
    return True


TRUST_CONFIRMED = "confirmed"
TRUST_NEW = "new"


async def public_offers(db: AsyncSession, limit: int = 24, category: str | None = None,
                        q: str | None = None) -> list[dict]:
    """Everything shared with the network and in stock, readable with no account.

    Nothing is hidden for being new: a listed item is open to look at, like any
    shop shelf. Each item carries a plain trust label so a buyer can tell a
    confirmed offer (traded with another business) from a new one.
    """
    confirmed = and_(_seller_verified(), or_(_deal_with_other_business(), _by_hand()))
    query = (
        select(StockItem, Vendor, confirmed.label("confirmed"), _seller_verified().label("seller_verified"))
        .join(Vendor, Vendor.id == StockItem.vendor_id)
        .where(StockItem.visible_to_network.is_(True), StockItem.quantity_available >= 1)
        .order_by(confirmed.desc(), StockItem.updated_at.desc())
        .limit(min(max(limit, 1), 100))
    )
    if category:
        query = query.where(StockItem.category.ilike(category))
    if q and q.strip():
        query = query.where(StockItem.name.ilike(f"%{q.strip()}%"))

    out = []
    for item, seller, is_confirmed, verified in (await db.execute(query)).all():
        if is_confirmed:
            trust = {"level": TRUST_CONFIRMED, "label": "Confirmed: traded with another business"}
        elif verified:
            trust = {"level": TRUST_NEW, "label": "New on the network"}
        else:
            trust = {"level": TRUST_NEW, "label": "New: seller not yet verified"}
        out.append({
            "id": str(item.id), "name": item.name, "category": item.category,
            "unit_price": item.unit_price, "wholesale_price": item.wholesale_price,
            "unit": item.unit_of_measure, "quantity_available": item.quantity_available,
            "min_order_quantity": item.min_order_quantity, "images": item.images or [],
            "trust": trust,
            "seller": {"handle": seller.vendor_handle, "name": seller.business_name,
                       "verified": bool(verified)},
        })
    return out
