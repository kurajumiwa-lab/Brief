"""HTTP adapter for the trade module's request flow.

    POST /api/requests                              post one (any type)
    GET  /api/requests?scope=mine|open&type=&q=     my requests, or open ones relevant to me
    GET  /api/requests/{id}                         detail: request + offers
    POST /api/requests/{id}/offers                  respond with an offer
    POST /api/requests/{id}/offers/{offer_id}/accept  requester accepts one → fulfilled
    POST /api/requests/{id}/cancel                  requester withdraws

This is the reusable interface the whole product hangs on: the request type
changes the wording, never the flow. Post → relevant businesses see it →
offers arrive → the requester accepts one → it becomes completed trade.

The `open` feed is deliberately explainable: a request is relevant to you when
it shares your market, your city words, your trade categories or your street —
in that order — nearest first. No scores without reasons, no shadow ranking.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.trade import service
from app.modules.trade.models import BusinessRequest, RequestType
from app.modules.trade.schemas import OfferIn, RequestIn
from app.routes.auth import get_current_vendor

router = APIRouter()


@router.post("", status_code=201)
async def create_request(
    body: RequestIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        request = await service.create_request(
            db, vendor,
            request_type=body.request_type,
            description=body.description,
            location=body.location,
            needed_by=body.needed_by,
            budget_kes=body.budget_kes,
            zone_id=body.zone_id,
        )
    except service.RequestFlowError as e:
        raise HTTPException(e.status, str(e))
    return await service.to_dict(db, request, vendor)


@router.get("")
async def list_requests(
    scope: str = Query("open", description="mine | open"),
    request_type: str = Query("", description="stock | worker | delivery | rental | errand | service"),
    q: str = Query("", max_length=120),
    limit: int = Query(30, ge=1, le=service.MAX_OPEN_FEED),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """`scope=mine` — what I posted and the offers waiting on me.
    `scope=open` — other businesses' open requests, nearest and most relevant
    first: same market, then same city words, then my trade categories."""
    if scope not in ("mine", "open"):
        raise HTTPException(400, "scope must be mine or open")
    type_filter = None
    if request_type:
        if request_type not in service.REQUEST_TYPES:
            raise HTTPException(400, f"request_type must be one of {', '.join(sorted(service.REQUEST_TYPES))}")
        type_filter = RequestType(request_type)

    term = q.strip()
    if scope == "mine":
        rows = await service.list_mine(db, vendor, type_filter=type_filter, term=term, limit=limit)
        return [await service.to_dict(db, r, vendor) for r in rows]
    return await service.open_feed(db, vendor, type_filter=type_filter, term=term, limit=limit)


@router.get("/{request_id}")
async def request_detail(
    request_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    request = await db.get(BusinessRequest, request_id)
    if not request:
        raise HTTPException(404, "Request not found")
    return await service.to_dict(db, request, vendor)


@router.post("/{request_id}/offers", status_code=201)
async def offer_on_request(
    request_id: UUID,
    body: OfferIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Respond to a request with what you can do and at what price."""
    request = await db.get(BusinessRequest, request_id)
    if not request:
        raise HTTPException(404, "Request not found")
    try:
        offer = await service.add_offer(
            db, vendor, request,
            note=body.note, price_kes=body.price_kes, lead_time=body.lead_time,
        )
    except service.RequestFlowError as e:
        raise HTTPException(e.status, str(e))
    return service.offer_dict(offer, vendor)


@router.post("/{request_id}/offers/{offer_id}/accept")
async def accept_offer(
    request_id: UUID,
    offer_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Accept one offer: the request is fulfilled and the loop is closed."""
    request = await db.get(BusinessRequest, request_id)
    if not request:
        raise HTTPException(404, "Request not found")
    try:
        return await service.accept_offer(db, vendor, request, offer_id)
    except service.RequestFlowError as e:
        raise HTTPException(e.status, str(e))


@router.post("/{request_id}/cancel")
async def cancel_request(
    request_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    request = await db.get(BusinessRequest, request_id)
    if not request:
        raise HTTPException(404, "Request not found")
    try:
        return await service.cancel_request(db, vendor, request)
    except service.RequestFlowError as e:
        raise HTTPException(e.status, str(e))
