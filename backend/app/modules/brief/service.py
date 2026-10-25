"""Morning Brief — what needs your attention today (v2.15).

The first intelligence layer, deliberately deterministic and read-only.

Every line in the brief is derived from a record the authenticated vendor owns or
is party to, and carries the id of that record plus the route that opens it. No
model is involved: there is nothing here that can invent a number, and nothing
that can move money, stock or a permission.

Design rules (audit 2026-10-25, §D2):

* **Vendor scope comes from the token**, never from a query parameter.
* **Silence is a valid answer.** An empty brief says "nothing needs you", not an
  error and not a fabricated suggestion.
* **Freshness is stated.** Each signal carries the timestamp of the record that
  produced it, so the UI can say how current it is.
* **Severity is ordered**, so the screen has a natural top.
"""

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock import MovementStatus, StockItem, StockMovement
from app.models.vendor import Vendor
from app.modules.standing.models import BusinessClaim, ClaimStatus
from app.modules.trade.models import BusinessRequest, RequestOffer, RequestStatus

# Stock at or below this many sellable units is worth flagging.
LOW_STOCK_UNITS = 5
# A claim this close to its printed expiry is still current, but worth acting on.
CLAIM_WARNING_DAYS = 30
# A pending movement older than this has stopped being "in progress".
MOVEMENT_STALE_HOURS = 48
# Open requests are only interesting while they are still askable.
REQUEST_WINDOW_DAYS = 14

SEVERITY_ORDER = {"critical": 0, "warning": 1, "info": 2}


def _signal(
    *,
    kind: str,
    severity: str,
    title: str,
    detail: str,
    count: int,
    record_ids: list,
    route: str,
    occurred_at: Optional[datetime],
) -> dict:
    """One cited finding: every field the UI needs, nothing it has to guess."""
    return {
        "id": f"{kind}:{route}",
        "kind": kind,
        "severity": severity,
        "title": title,
        "detail": detail,
        "count": count,
        "record_ids": [str(rid) for rid in record_ids[:10]],
        "route": route,
        "occurred_at": occurred_at.isoformat() + "Z" if occurred_at else None,
    }


async def low_stock(db: AsyncSession, vendor: Vendor) -> Optional[dict]:
    """Stock that has run out, or is down to a handful of units.

    There is no reorder-point column in this schema (and inventing one would be
    a migration for a cosmetic feature), so the rule is explicit and stated on
    screen: nothing sellable, or fewer than LOW_STOCK_UNITS left.
    """
    rows = (await db.execute(
        select(StockItem).where(
            StockItem.vendor_id == vendor.id,
            StockItem.visible_to_network.is_(True),
            StockItem.quantity_available <= LOW_STOCK_UNITS,
        ).order_by(StockItem.quantity_available.asc()).limit(50)
    )).scalars().all()
    if not rows:
        return None
    worst = rows[0]
    out = [r for r in rows if r.quantity_available <= 0]
    return _signal(
        kind="low_stock",
        severity="critical" if out else "warning",
        title="Stock needs attention",
        detail=(f"{len(rows)} item{'s' if len(rows) != 1 else ''} at or below "
                f"{LOW_STOCK_UNITS} {worst.unit_of_measure}"
                + (f" — {len(out)} already out" if out else "")),
        count=len(rows),
        record_ids=[r.id for r in rows],
        route="/stock",
        occurred_at=max((r.updated_at for r in rows if r.updated_at), default=None),
    )


async def pending_movements(db: AsyncSession, vendor: Vendor) -> Optional[dict]:
    """Movements that have not finished their confirmation step."""
    stale_before = datetime.utcnow() - timedelta(hours=MOVEMENT_STALE_HOURS)
    rows = (await db.execute(
        select(StockMovement).where(
            or_(StockMovement.from_vendor_id == vendor.id,
                StockMovement.to_vendor_id == vendor.id),
            StockMovement.status.in_([
                MovementStatus.PENDING.value,
                MovementStatus.CONFIRMED.value,
                MovementStatus.SHIPPED.value,
            ]),
        ).order_by(StockMovement.created_at.asc()).limit(50)
    )).scalars().all()
    if not rows:
        return None
    stale = [r for r in rows if r.created_at and r.created_at < stale_before]
    return _signal(
        kind="pending_movements",
        severity="warning" if stale else "info",
        title="Awaiting confirmation",
        detail=(f"{len(rows)} movement{'s' if len(rows) != 1 else ''} not yet received"
                + (f", {len(stale)} waiting more than {MOVEMENT_STALE_HOURS} hours" if stale else "")),
        count=len(rows),
        record_ids=[r.id for r in rows],
        route="/orders",
        occurred_at=rows[0].created_at,
    )


async def expiring_claims(db: AsyncSession, vendor: Vendor) -> Optional[dict]:
    """Verified facts with a printed expiry that is close or already past."""
    horizon = datetime.utcnow().date() + timedelta(days=CLAIM_WARNING_DAYS)
    rows = (await db.execute(
        select(BusinessClaim).where(
            BusinessClaim.vendor_id == vendor.id,
            BusinessClaim.expires_on.isnot(None),
            BusinessClaim.expires_on <= horizon,
            BusinessClaim.status.in_([ClaimStatus.VERIFIED, ClaimStatus.DOCUMENTED,
                                      ClaimStatus.DECLARED]),
        ).order_by(BusinessClaim.expires_on.asc()).limit(50)
    )).scalars().all()
    if not rows:
        return None
    expired = [r for r in rows if r.expires_on < datetime.utcnow().date()]
    return _signal(
        kind="expiring_claims",
        severity="critical" if expired else "warning",
        title="Paperwork expiring",
        detail=(f"{len(rows)} document{'s' if len(rows) != 1 else ''} expiring within "
                f"{CLAIM_WARNING_DAYS} days"
                + (f" — {len(expired)} already expired" if expired else "")),
        count=len(rows),
        record_ids=[r.id for r in rows],
        route="/me",
        occurred_at=datetime.combine(rows[0].expires_on, datetime.min.time()),
    )


async def open_requests(db: AsyncSession, vendor: Vendor) -> Optional[dict]:
    """Open requests in the network this vendor has not answered yet."""
    since = datetime.utcnow() - timedelta(days=REQUEST_WINDOW_DAYS)
    mine = select(RequestOffer.request_id).where(RequestOffer.responder_vendor_id == vendor.id)
    rows = (await db.execute(
        select(BusinessRequest).where(
            BusinessRequest.status == RequestStatus.OPEN,
            BusinessRequest.requester_vendor_id != vendor.id,
            BusinessRequest.created_at >= since,
            BusinessRequest.id.notin_(mine),
        ).order_by(BusinessRequest.created_at.desc()).limit(50)
    )).scalars().all()
    if not rows:
        return None
    return _signal(
        kind="open_requests",
        severity="info",
        title="Requests you could answer",
        detail=(f"{len(rows)} open request{'s' if len(rows) != 1 else ''} from the last "
                f"{REQUEST_WINDOW_DAYS} days with no offer from you"),
        count=len(rows),
        record_ids=[r.id for r in rows],
        route="/",  # the request feed lives on the home surface
        occurred_at=rows[0].created_at,
    )


SIGNALS = (low_stock, pending_movements, expiring_claims, open_requests)


async def build_brief(db: AsyncSession, vendor: Vendor) -> dict:
    """Run every signal for one vendor and return a prioritised, cited brief."""
    found = []
    for builder in SIGNALS:
        try:
            signal = await builder(db, vendor)
        except Exception as exc:  # one broken signal must not erase the others
            found.append({
                "id": f"{builder.__name__}:error",
                "kind": builder.__name__,
                "severity": "info",
                "title": "Could not be checked",
                "detail": f"{type(exc).__name__} — the rest of the brief is unaffected",
                "count": 0,
                "record_ids": [],
                "route": "/",
                "occurred_at": None,
            })
            continue
        if signal:
            found.append(signal)

    found.sort(key=lambda s: (SEVERITY_ORDER.get(s["severity"], 9), -s["count"], s["title"]))
    return {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "vendor_handle": vendor.vendor_handle,
        "total": sum(s["count"] for s in found),
        "signals": found,
        "empty": not found,
        "sources": ["stock_items", "stock_movements", "business_claims", "business_requests"],
        "note": "Read-only summary of your own records. Nothing here is generated "
                "text, and no line can change a payment, a ledger entry or a balance.",
    }
