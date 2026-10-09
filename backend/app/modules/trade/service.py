"""The rules of the request loop — importable without FastAPI.

This module owns what it means to post, offer, accept and cancel. The router
is a translator; jobs, other modules and future surfaces call these functions
directly. Rules refuse with `RequestFlowError(status=…)`, so the HTTP layer
stays a mapping, not a second brain.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

# Read-only references to neighbouring data. Identity (Vendor) and the market
# zones are shared context; per the architecture brief these become declared
# interfaces as their own modules extract.
from app.models.market_locks import MarketZone
from app.models.vendor import Vendor
from app.modules.trade.models import (
    BusinessRequest,
    OfferStatus,
    RequestOffer,
    RequestStatus,
    RequestType,
    RequestUrgency,
)
from app.services.routing import haversine_km

MAX_OPEN_FEED = 60

REQUEST_TYPES = {t.value for t in RequestType}
URGENCIES = {u.value for u in RequestUrgency}


class RequestFlowError(Exception):
    """A rule of the request loop refused an action.

    `status` is the HTTP code the adapter should return; jobs and other
    modules can catch this without knowing HTTP exists.
    """

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


# ─────────────────────────────────────────────────────────────────────────────
# serialization — one shape for the API, the feed and any future consumer
# ─────────────────────────────────────────────────────────────────────────────

async def to_dict(db: AsyncSession, r: BusinessRequest, viewer: Vendor) -> dict:
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
            [offer_dict(o, viewer) for o in offers] if is_requester
            else [offer_dict(o, viewer) for o in offers if o.responder_vendor_id == viewer.id]
        ),
        "my_offer": next((offer_dict(o, viewer) for o in offers if o.responder_vendor_id == viewer.id), None),
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


def offer_dict(o: RequestOffer, viewer: Vendor) -> dict:
    return {
        "id": str(o.id),
        "price_kes": o.price_kes,
        "note": o.note,
        "lead_time": o.lead_time,
        "status": o.status.value if hasattr(o.status, "value") else o.status,
        "is_mine": o.responder_vendor_id == viewer.id,
        "created_at": o.created_at.isoformat(),
    }


def city_words(vendor: Vendor) -> list:
    """City and market words from the viewer's own location strings — the same
    words their requests and profile use. Lowercased for the SQL match."""
    words = set()
    for source in (vendor.physical_location,):
        for token in (source or "").replace(",", " ").split():
            if len(token) >= 3:
                words.add(token.lower())
    return sorted(words)


# ─────────────────────────────────────────────────────────────────────────────
# the flow: post → match → offers → compare → confirm → complete
# ─────────────────────────────────────────────────────────────────────────────

async def create_request(db: AsyncSession, vendor: Vendor, *, request_type: str,
                         description: str, location: str, needed_by: str,
                         budget_kes: int | None, zone_id: UUID | None) -> BusinessRequest:
    """Post a business request. The type picks the audience, not the flow."""
    if request_type not in REQUEST_TYPES:
        raise RequestFlowError(f"request_type must be one of {', '.join(sorted(REQUEST_TYPES))}")
    if needed_by not in URGENCIES:
        raise RequestFlowError(f"needed_by must be one of {', '.join(sorted(URGENCIES))}")

    lat = lng = None
    if zone_id:
        zone = await db.get(MarketZone, zone_id)
        if not zone:
            raise RequestFlowError("That market does not exist", status=404)
        lat, lng = zone.center_lat, zone.center_lng
    elif vendor.geo_lat is not None:
        # Default the pin to the requester's own location; the words stay theirs.
        lat, lng = vendor.geo_lat, vendor.geo_lng

    request = BusinessRequest(
        requester_vendor_id=vendor.id,
        request_type=RequestType(request_type),
        description=description.strip(),
        location=location.strip(),
        zone_id=zone_id,
        geo_lat=lat, geo_lng=lng,
        needed_by=RequestUrgency(needed_by),
        budget_kes=budget_kes,
    )
    db.add(request)
    await db.commit()
    await db.refresh(request)
    return request


async def list_mine(db: AsyncSession, vendor: Vendor, *, type_filter: RequestType | None,
                    term: str, limit: int) -> list[BusinessRequest]:
    sql = select(BusinessRequest).where(BusinessRequest.requester_vendor_id == vendor.id)
    if type_filter:
        sql = sql.where(BusinessRequest.request_type == type_filter)
    if term:
        sql = sql.where(BusinessRequest.description.ilike(f"%{term}%")
                        | BusinessRequest.location.ilike(f"%{term}%"))
    sql = sql.order_by(BusinessRequest.created_at.desc()).limit(limit)
    return (await db.execute(sql)).scalars().all()


async def open_feed(db: AsyncSession, vendor: Vendor, *, type_filter: RequestType | None,
                    term: str, limit: int) -> list[dict]:
    """Open requests from everyone else, ranked by shared context: my market
    zone first, then my city words in the location, then my categories —
    distance settles the rest. Every factor is a readable WHERE clause."""
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
        "city_words": city_words(vendor),
        "type_filter": type_filter.value if type_filter else None,
        "q": term,
        "limit": limit,
    })).all()
    # Relevance rank comes from the query; distance only settles ties.
    rank = {r.id: int(r.relevance) for r in feed}
    rows = (await db.execute(
        select(BusinessRequest).where(BusinessRequest.id.in_(rank.keys()))
    )).scalars().all()
    out = [await to_dict(db, r, vendor) for r in rows]
    out.sort(key=lambda d: (
        -rank.get(UUID(d["id"]), 0),
        d["distance_km"] is None,
        d["distance_km"] if d["distance_km"] is not None else 0.0,
    ))
    return out


async def add_offer(db: AsyncSession, vendor: Vendor, request: BusinessRequest, *,
                    note: str, price_kes: int | None, lead_time: str | None) -> RequestOffer:
    """Respond to a request with what you can do and at what price."""
    if request.status != RequestStatus.OPEN:
        raise RequestFlowError("This request is no longer open", status=409)
    if request.requester_vendor_id == vendor.id:
        raise RequestFlowError("You cannot respond to your own request", status=409)

    existing = (await db.execute(
        select(RequestOffer).where(
            RequestOffer.request_id == request.id,
            RequestOffer.responder_vendor_id == vendor.id,
        ))).scalars().first()
    if existing:
        # One offer per responder — but the latest words win: update in place.
        existing.note = note.strip()
        existing.price_kes = price_kes
        existing.lead_time = (lead_time or "").strip() or None
        existing.status = OfferStatus.OFFERED
        await db.commit()
        await db.refresh(existing)
        return existing

    offer = RequestOffer(
        request_id=request.id,
        responder_vendor_id=vendor.id,
        note=note.strip(),
        price_kes=price_kes,
        lead_time=(lead_time or "").strip() or None,
    )
    db.add(offer)
    await db.commit()
    await db.refresh(offer)
    return offer


async def accept_offer(db: AsyncSession, vendor: Vendor, request: BusinessRequest,
                       offer_id: UUID) -> dict:
    """Accept one offer: the request is fulfilled and the loop is closed.
    The other offers stay on the record as declined — that history is the
    completion data trust is built from."""
    if request.requester_vendor_id != vendor.id:
        raise RequestFlowError("Only the requester accepts an offer", status=403)
    if request.status != RequestStatus.OPEN:
        raise RequestFlowError("This request is already closed", status=409)

    offer = await db.get(RequestOffer, offer_id)
    if not offer or offer.request_id != request.id:
        raise RequestFlowError("Offer not found on this request", status=404)

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


async def cancel_request(db: AsyncSession, vendor: Vendor, request: BusinessRequest) -> dict:
    if request.requester_vendor_id != vendor.id:
        raise RequestFlowError("Only the requester cancels a request", status=403)
    if request.status != RequestStatus.OPEN:
        raise RequestFlowError("This request is already closed", status=409)
    request.status = RequestStatus.CANCELLED
    request.closed_at = datetime.utcnow()
    await db.commit()
    return {"id": str(request.id), "status": request.status.value}
