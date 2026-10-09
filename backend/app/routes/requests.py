"""Requests — express a need, collect offers, close the loop.

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

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.market_locks import MarketZone
from app.models.requests import (
    BusinessRequest,
    OfferStatus,
    RequestOffer,
    RequestStatus,
    RequestType,
    RequestUrgency,
)
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services.routing import haversine_km

router = APIRouter()

MAX_OPEN_FEED = 60

REQUEST_TYPES = {t.value for t in RequestType}
URGENCIES = {u.value for u in RequestUrgency}

async def _request_out(db: AsyncSession, r: BusinessRequest, viewer: Vendor) -> dict:
    offers = (await db.execute(
        select(RequestOffer).where(RequestOffer.request_id == r.id)
        .order_by(RequestOffer.created_at.asc())
    )).scalars().all()
    zone_name = None
    if r.zone_id:
        zone_name = (await db.get(MarketZone, r.zone_id)).name
    mine = r.requester_vendor_id == viewer.id
    is_requester = mine
    return {
        "id": str(r.id),
        "request_type": r.request_type.value if hasattr(r.request_type, "value") else r.request_type,
        "description": r.description,
        "location": r.location,
        "zone_id": str(r.zone_id) if r.zone_id else None,
        "zone_name": zone_name,
        "needed_by": r.needed_by.value if hasattr(r.needed_by, "value") else r.needed_by,
        "budget_kes": r.budget_kes,
        "status": r.status.value if hasattr(r.status, "value") else r.status,
        "offers_count": len(offers),
        # The requester sees every offer; everyone else sees only the count and
        # their own. An offer is a negotiation, not a public price list.
        "offers": (
            [_offer_out(o, viewer) for o in offers] if is_requester
            else [_offer_out(o, viewer) for o in offers if o.responder_vendor_id == viewer.id]
        ),
        "my_offer": next((_offer_out(o, viewer) for o in offers if o.responder_vendor_id == viewer.id), None),
        "accepted_offer_id": str(r.accepted_offer_id) if r.accepted_offer_id else None,
        "is_mine": mine,
        "created_at": r.created_at.isoformat(),
        "closed_at": r.closed_at.isoformat() if r.closed_at else None,
        "distance_km": (
            None if None in (viewer.geo_lat, viewer.geo_lng, r.geo_lat, r.geo_lng)
            else round(haversine_km(
                {"lat": viewer.geo_lat, "lng": viewer.geo_lng},
                {"lat": r.geo_lat, "lng": r.geo_lng}) or 0.0, 1)
        ),
    }


def _offer_out(o: RequestOffer, viewer: Vendor) -> dict:
    return {
        "id": str(o.id),
        "price_kes": o.price_kes,
        "note": o.note,
        "lead_time": o.lead_time,
        "status": o.status.value if hasattr(o.status, "value") else o.status,
        "is_mine": o.responder_vendor_id == viewer.id,
        "created_at": o.created_at.isoformat(),
    }


class RequestIn(BaseModel):
    request_type: str = Field(min_length=2, max_length=20)
    description: str = Field(min_length=8, max_length=2000)
    location: str = Field(min_length=2, max_length=300)
    needed_by: str = "flexible"
    budget_kes: Optional[int] = Field(default=None, ge=0, le=100_000_000)
    zone_id: Optional[UUID] = None


class OfferIn(BaseModel):
    note: str = Field(min_length=4, max_length=1000)
    price_kes: Optional[int] = Field(default=None, ge=0, le=100_000_000)
    lead_time: Optional[str] = Field(default=None, max_length=120)


@router.post("", status_code=201)
async def create_request(
    body: RequestIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Post a business request. The type picks the audience, not the flow."""
    if body.request_type not in REQUEST_TYPES:
        raise HTTPException(400, f"request_type must be one of {', '.join(sorted(REQUEST_TYPES))}")
    if body.needed_by not in URGENCIES:
        raise HTTPException(400, f"needed_by must be one of {', '.join(sorted(URGENCIES))}")

    zone_id = body.zone_id
    lat = lng = None
    if zone_id:
        zone = await db.get(MarketZone, zone_id)
        if not zone:
            raise HTTPException(404, "That market does not exist")
        lat, lng = zone.center_lat, zone.center_lng
    elif vendor.geo_lat is not None:
        # Default the pin to the requester's own location; the words stay theirs.
        lat, lng = vendor.geo_lat, vendor.geo_lng

    request = BusinessRequest(
        requester_vendor_id=vendor.id,
        request_type=RequestType(body.request_type),
        description=body.description.strip(),
        location=body.location.strip(),
        zone_id=zone_id,
        geo_lat=lat, geo_lng=lng,
        needed_by=RequestUrgency(body.needed_by),
        budget_kes=body.budget_kes,
    )
    db.add(request)
    await db.commit()
    await db.refresh(request)
    return await _request_out(db, request, vendor)


@router.get("")
async def list_requests(
    scope: str = Query("open", description="mine | open"),
    request_type: str = Query("", description="stock | worker | delivery | rental | errand | service"),
    q: str = Query("", max_length=120),
    limit: int = Query(30, ge=1, le=MAX_OPEN_FEED),
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
        if request_type not in REQUEST_TYPES:
            raise HTTPException(400, f"request_type must be one of {', '.join(sorted(REQUEST_TYPES))}")
        type_filter = RequestType(request_type)

    term = q.strip()
    if scope == "mine":
        sql = select(BusinessRequest).where(BusinessRequest.requester_vendor_id == vendor.id)
        if type_filter:
            sql = sql.where(BusinessRequest.request_type == type_filter)
        if term:
            sql = sql.where(BusinessRequest.description.ilike(f"%{term}%")
                            | BusinessRequest.location.ilike(f"%{term}%"))
        sql = sql.order_by(BusinessRequest.created_at.desc()).limit(limit)
        rows = (await db.execute(sql)).scalars().all()
    else:
        # Open requests from everyone else, ranked by shared context: my market
        # zone first, then my city words in the location, then my categories —
        # distance settles the rest. Every factor is a readable WHERE clause.
        relevance = []
        params: dict = {"me": str(vendor.id)}
        if vendor.market_zone_id:
            relevance.append("zone_score")
            params["zone"] = str(vendor.market_zone_id)
        my_cats = [c for c in (vendor.business_categories or []) if isinstance(c, str)]
        cat_clauses = " OR ".join(
            f"br.description ILIKE {':cat' + str(i)}" for i in range(len(my_cats))) or "FALSE"
        for i, c in enumerate(my_cats):
            params[f"cat{i}"] = f"%{c}%"

        sql = text(f"""
            SELECT br.id,
                   (CASE WHEN br.zone_id IS NOT NULL AND br.zone_id = CAST(:zone AS uuid) THEN 3 ELSE 0 END
                    + CASE WHEN lower(br.location) = ANY(
                        SELECT lower(word) FROM unnest(CAST(:city_words AS text[])) word
                         WHERE br.location ILIKE '%' || word || '%') THEN 2 ELSE 0 END
                    + CASE WHEN ({cat_clauses}) THEN 1 ELSE 0 END) AS relevance
              FROM business_requests br
             WHERE br.status = 'open'
               AND br.requester_vendor_id <> CAST(:me AS uuid)
               AND (CAST(:type_filter AS requesttype) IS NULL
                    OR br.request_type = CAST(:type_filter AS requesttype))
               AND (CAST(:q AS text) = ''
                    OR br.description ILIKE '%' || CAST(:q AS text) || '%'
                    OR br.location ILIKE '%' || CAST(:q AS text) || '%')
             ORDER BY relevance DESC, br.geo_lat IS NULL, br.created_at DESC
             LIMIT CAST(:limit AS int)
        """)
        feed = (await db.execute(sql, {
            **params,
            "zone": str(vendor.market_zone_id) if vendor.market_zone_id else None,
            "city_words": _city_words(vendor),
            "type_filter": type_filter.value if type_filter else None,
            "q": term,
            "limit": limit,
        })).all()
        # Relevance rank comes from the query; distance only settles ties.
        rank = {r.id: int(r.relevance) for r in feed}
        rows = (await db.execute(
            select(BusinessRequest).where(BusinessRequest.id.in_(rank.keys()))
        )).scalars().all()
        out = [await _request_out(db, r, vendor) for r in rows]
        out.sort(key=lambda d: (
            -rank.get(UUID(d["id"]), 0),
            d["distance_km"] is None,
            d["distance_km"] if d["distance_km"] is not None else 0.0,
        ))
        return out

    return [await _request_out(db, r, vendor) for r in rows]


def _city_words(vendor: Vendor) -> list:
    """City and market words from the viewer's own location strings — the same
    words their requests and profile use. Lowercased for the SQL match."""
    words = set()
    for source in (vendor.physical_location,):
        for token in (source or "").replace(",", " ").split():
            if len(token) >= 3:
                words.add(token.lower())
    return sorted(words)


@router.get("/{request_id}")
async def request_detail(
    request_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    request = await db.get(BusinessRequest, request_id)
    if not request:
        raise HTTPException(404, "Request not found")
    return await _request_out(db, request, vendor)


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
    if request.status != RequestStatus.OPEN:
        raise HTTPException(409, "This request is no longer open")
    if request.requester_vendor_id == vendor.id:
        raise HTTPException(409, "You cannot respond to your own request")

    existing = (await db.execute(
        select(RequestOffer).where(
            RequestOffer.request_id == request.id,
            RequestOffer.responder_vendor_id == vendor.id,
        ))).scalars().first()
    if existing:
        # One offer per responder — but the latest words win: update in place.
        existing.note = body.note.strip()
        existing.price_kes = body.price_kes
        existing.lead_time = (body.lead_time or "").strip() or None
        existing.status = OfferStatus.OFFERED
        await db.commit()
        await db.refresh(existing)
        return _offer_out(existing, vendor)

    offer = RequestOffer(
        request_id=request.id,
        responder_vendor_id=vendor.id,
        note=body.note.strip(),
        price_kes=body.price_kes,
        lead_time=(body.lead_time or "").strip() or None,
    )
    db.add(offer)
    await db.commit()
    await db.refresh(offer)
    return _offer_out(offer, vendor)


@router.post("/{request_id}/offers/{offer_id}/accept")
async def accept_offer(
    request_id: UUID,
    offer_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Accept one offer: the request is fulfilled and the loop is closed.
    The other offers stay on the record as declined — that history is the
    completion data trust is built from."""
    request = await db.get(BusinessRequest, request_id)
    if not request:
        raise HTTPException(404, "Request not found")
    if request.requester_vendor_id != vendor.id:
        raise HTTPException(403, "Only the requester accepts an offer")
    if request.status != RequestStatus.OPEN:
        raise HTTPException(409, "This request is already closed")

    offer = await db.get(RequestOffer, offer_id)
    if not offer or offer.request_id != request.id:
        raise HTTPException(404, "Offer not found on this request")

    offer.status = OfferStatus.ACCEPTED
    request.status = RequestStatus.FULFILLED
    request.accepted_offer_id = offer.id
    request.closed_at = datetime.utcnow()
    for other in (await db.execute(
        select(RequestOffer).where(
            RequestOffer.request_id == request.id,
            RequestOffer.id != offer.id,
        ))).scalars():
        if other.status == OfferStatus.OFFERED:
            other.status = OfferStatus.DECLINED
    await db.commit()
    return {"id": str(request.id), "status": request.status.value,
            "accepted_offer_id": str(offer.id)}


@router.post("/{request_id}/cancel")
async def cancel_request(
    request_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    request = await db.get(BusinessRequest, request_id)
    if not request:
        raise HTTPException(404, "Request not found")
    if request.requester_vendor_id != vendor.id:
        raise HTTPException(403, "Only the requester cancels a request")
    if request.status != RequestStatus.OPEN:
        raise HTTPException(409, "This request is already closed")
    request.status = RequestStatus.CANCELLED
    request.closed_at = datetime.utcnow()
    await db.commit()
    return {"id": str(request.id), "status": request.status.value}
