"""The rules of the request loop — importable without FastAPI.

This module owns what it means to post, offer, accept and cancel. The router
is a translator; jobs, other modules and future surfaces call these functions
directly. Rules refuse with `RequestFlowError(status=…)`, so the HTTP layer
stays a mapping, not a second brain.
"""

import logging
from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

# Read-only references to neighbouring data. Identity (Vendor) and the market
# zones are shared context; per the architecture brief these become declared
# interfaces as their own modules extract.
from app.models.market_locks import MarketZone
from app.models.notification import NotificationType
from app.models.vendor import Vendor
from app.modules.standing import catalog as claim_catalog
from app.modules.standing import service as standing
from app.modules.standing.models import BusinessClaim, ClaimStatus
from app.modules.trade.models import (
    BusinessRequest,
    OfferStatus,
    RequestEvent,
    RequestOffer,
    RequestStatus,
    RequestType,
    RequestUrgency,
    RequestWatch,
)
from app.platform.event_outbox import emit
from app.services.notification_service import create_notification
from app.services.routing import haversine_km

log = logging.getLogger("brief.trade")

MAX_OPEN_FEED = 60

# Alerts (v2.11). A posted request can ring at most this many bells, and a
# business can keep at most this many standing watches. Both caps are product
# decisions, and both are visible in the API rather than silently applied.
MATCH_NOTIFY_CAP = 25
MAX_WATCHES = 10
# Candidate pool for requirement-based matching: the query narrows, the
# verified-fact check decides.
MATCH_CANDIDATE_POOL = 60

REQUEST_TYPES = {t.value for t in RequestType}
URGENCIES = {u.value for u in RequestUrgency}

# The locked decision: the trade lifecycle is an EXPLICIT state machine.
# Every legal change is in the map; anything else is refused with 409, no
# matter which code path asked. Terminal states map to nothing.
REQUEST_FLOW = {
    RequestStatus.OPEN: {RequestStatus.FULFILLED, RequestStatus.CANCELLED},
    RequestStatus.FULFILLED: set(),
    RequestStatus.CANCELLED: set(),
}
OFFER_FLOW = {
    OfferStatus.OFFERED: {OfferStatus.ACCEPTED, OfferStatus.DECLINED},
    OfferStatus.ACCEPTED: set(),
    OfferStatus.DECLINED: set(),
}


def _require_transition(flow: dict, current, target, message: str) -> None:
    if target not in flow.get(current, set()):
        raise RequestFlowError(message, status=409)


def _record(db: AsyncSession, request: BusinessRequest, event_type: str,
            actor_vendor_id=None, offer_id=None, payload: dict | None = None) -> None:
    """Append one line to the request's audit history — same transaction as
    the change it describes, never updated afterwards."""
    db.add(RequestEvent(
        request_id=request.id, event_type=event_type,
        actor_vendor_id=actor_vendor_id, offer_id=offer_id, payload=payload or {},
    ))


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
    events = None
    if is_requester:
        rows = (await db.execute(
            select(RequestEvent).where(RequestEvent.request_id == r.id)
            .order_by(RequestEvent.id.asc()).limit(50)
        )).scalars().all()
        events = [
            {"type": e.event_type,
             "offer_id": str(e.offer_id) if e.offer_id else None,
             "at": e.created_at.isoformat()}
            for e in rows
        ]
    out = {
        "id": str(r.id),
        "request_type": r.request_type.value if hasattr(r.request_type, "value") else r.request_type,
        "description": r.description,
        "location": r.location,
        "zone_id": str(r.zone_id) if r.zone_id else None,
        "zone_name": zone_name,
        "needed_by": r.needed_by.value if hasattr(r.needed_by, "value") else r.needed_by,
        "budget_kes": r.budget_kes,
        # What the buyer asks a supplier to evidence. Public: a requirement
        # nobody can read is a requirement nobody can meet.
        "requirements": r.requirements or [],
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
        # The audit trail is the requester's instrument; other viewers get the
        # facts (status, offers, counts) without the play-by-play.
        "events": events,
    }
    if not is_requester:
        out.pop("events", None)
    return out


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
                         budget_kes: int | None, zone_id: UUID | None,
                         requirements: list | None = None) -> BusinessRequest:
    """Post a business request. The type picks the audience, not the flow.

    `requirements` names what the buyer wants a supplier to evidence. Claim
    keys are checked against verified facts when a supplier looks at the
    request; a "stated" requirement is the buyer's own words and says so.
    """
    if request_type not in REQUEST_TYPES:
        raise RequestFlowError(f"request_type must be one of {', '.join(sorted(REQUEST_TYPES))}")
    if needed_by not in URGENCIES:
        raise RequestFlowError(f"needed_by must be one of {', '.join(sorted(URGENCIES))}")
    wanted = normalize_requirements(requirements)

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
        requirements=wanted,
    )
    db.add(request)
    await db.flush()   # assign the id the history line and the event carry
    _record(db, request, "posted", actor_vendor_id=vendor.id,
            payload={"request_type": request_type, "needed_by": needed_by})
    emit(db, "trade.request.posted", {
        "request_id": str(request.id), "request_type": request_type,
        "zone_id": str(zone_id) if zone_id else None,
        "requirements": [r["key"] for r in wanted],
    })
    # ── the two alert loops (v2.11) ────────────────────────────────────────
    # Standing watches, then suppliers whose verified facts already satisfy
    # the request's must-haves. Both are capped, both write inside this
    # transaction, and both can fail without failing the post.
    try:
        rang = await notify_watchers(db, request, vendor)
        await notify_requirement_matches(db, request, vendor, already=rang)
    except Exception:  # pragma: no cover - a broken alert must not lose the post
        log.exception("request %s: alerting failed", request.id)
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
        _record(db, request, "offer_updated", actor_vendor_id=vendor.id, offer_id=existing.id)
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
    await db.flush()   # the offer's id is needed by the history and the event
    _record(db, request, "offer_received", actor_vendor_id=vendor.id, offer_id=offer.id,
            payload={"responder_vendor_id": str(vendor.id)})
    emit(db, "trade.request.offer_received", {
        "request_id": str(request.id), "offer_id": str(offer.id),
        "responder_vendor_id": str(vendor.id),
    })
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
    _require_transition(REQUEST_FLOW, request.status, RequestStatus.FULFILLED,
                        "This request is already closed")

    offer = await db.get(RequestOffer, offer_id)
    if not offer or offer.request_id != request.id:
        raise RequestFlowError("Offer not found on this request", status=404)
    _require_transition(OFFER_FLOW, offer.status, OfferStatus.ACCEPTED,
                        "That offer is no longer on the table")

    offer.status = OfferStatus.ACCEPTED
    request.status = RequestStatus.FULFILLED
    request.accepted_offer_id = offer.id
    request.closed_at = datetime.utcnow()
    rivals = 0
    for other in (await db.execute(
        select(RequestOffer).where(
            RequestOffer.request_id == request.id,
            RequestOffer.id != offer.id,
        ))).scalars():
        if other.status == OfferStatus.OFFERED:
            other.status = OfferStatus.DECLINED
            rivals += 1
    _record(db, request, "offer_accepted", actor_vendor_id=vendor.id, offer_id=offer.id,
            payload={"accepted_offer_id": str(offer.id)})
    if rivals:
        _record(db, request, "rival_offers_declined", payload={"count": rivals})
    _record(db, request, "request_fulfilled", actor_vendor_id=vendor.id)
    emit(db, "trade.request.fulfilled", {
        "request_id": str(request.id), "accepted_offer_id": str(offer.id),
        "request_type": request.request_type.value
        if hasattr(request.request_type, "value") else str(request.request_type),
    })
    await db.commit()
    return {"id": str(request.id), "status": request.status.value,
            "accepted_offer_id": str(offer.id)}


async def cancel_request(db: AsyncSession, vendor: Vendor, request: BusinessRequest) -> dict:
    if request.requester_vendor_id != vendor.id:
        raise RequestFlowError("Only the requester cancels a request", status=403)
    _require_transition(REQUEST_FLOW, request.status, RequestStatus.CANCELLED,
                        "This request is already closed")
    request.status = RequestStatus.CANCELLED
    request.closed_at = datetime.utcnow()
    _record(db, request, "request_cancelled", actor_vendor_id=vendor.id)
    emit(db, "trade.request.cancelled", {"request_id": str(request.id)})
    await db.commit()
    return {"id": str(request.id), "status": request.status.value}

# ─────────────────────────────────────────────────────────────────────────────
# requirements, fit and alerts (v2.11)
#
# The brief's rule: never recommend an opportunity "because it is popular", and
# never hide why. A requirement is either a claim key (checkable against
# verified facts) or the buyer's own words (checkable by nobody). The fit
# answer says which is which, counts what is met, and names what is missing.
# ─────────────────────────────────────────────────────────────────────────────

MAX_REQUIREMENTS = 12
STATED_KEY = "stated"


def normalize_requirements(raw: list | None) -> list[dict]:
    """Validate and shrink a buyer's requirement list to what the app speaks.

    A claim key is checked against the catalog (so a typo cannot quietly
    become an unmeetable requirement); `stated` carries the buyer's own words
    and is labelled as unverifiable wherever it surfaces. Claim labels come
    from the catalog, never from the request body — two requests asking for
    the same document must read the same.
    """
    if not raw:
        return []
    if len(raw) > MAX_REQUIREMENTS:
        raise RequestFlowError(f"Keep it to {MAX_REQUIREMENTS} requirements or fewer")
    out, seen = [], set()
    for item in raw:
        if not isinstance(item, dict):
            raise RequestFlowError("Each requirement is {key, label?, must_have?}")
        key = str(item.get("key") or "").strip()
        must = bool(item.get("must_have"))
        if key == STATED_KEY:
            label = str(item.get("label") or "").strip()
            if len(label) < 3:
                raise RequestFlowError("A stated requirement needs the buyer's words (3+ characters)")
            if "stated" in seen:
                continue
            seen.add("stated")
            out.append({"key": STATED_KEY, "label": label[:160], "must_have": must,
                        "checkable": False})
            continue
        spec = claim_catalog.claim_spec(key)
        if not spec:
            raise RequestFlowError(
                f"Unknown requirement '{key}'. Use a claim key from /api/passport/catalog, or 'stated'."
            )
        if key in seen:
            continue
        seen.add(key)
        out.append({"key": key, "label": spec.label, "must_have": must, "checkable": True})
    return out


def _token_set(text: str | None) -> set[str]:
    return {t for t in (text or "").lower().replace(",", " ").split() if len(t) >= 3}


async def fit_for(db: AsyncSession, request: BusinessRequest, viewer: Vendor) -> dict:
    """How this business measures against this request — stated, not scored.

    Three answers per requirement: `met` (a live verified fact), `needs_confirmation`
    (paperwork on file that a human has not cleared, or that has lapsed), and
    `missing` (nothing on file). A requirement in the buyer's own words is
    `unverifiable` and says so. The summary keeps the counts apart; there is no
    single number that could be read as a judgement of the business.
    """
    requirements = request.requirements or []
    claims = await standing.claim_map(db, viewer.id)
    day = standing.today()

    checklist, met, pending, missing, unverifiable, missing_must = [], 0, 0, 0, 0, []
    next_steps: list[str] = []
    for req in requirements:
        key = req.get("key")
        label = req.get("label") or key
        must = bool(req.get("must_have"))
        entry = {"key": key, "label": label, "must_have": must}

        if key == STATED_KEY or not claim_catalog.claim_spec(key):
            entry.update({
                "state": "unverifiable",
                "reason": "The buyer's own words — the platform cannot check this one.",
                "next_step": "Answer it in your offer note so the buyer can judge.",
            })
            unverifiable += 1
        else:
            claim = claims.get(key)
            state = standing.claim_state(claim, today_=day) if claim else None
            if state == ClaimStatus.VERIFIED.value:
                entry.update({
                    "state": "met",
                    "reason": ("Verified document on file"
                               + (f", valid to {claim.expires_on.isoformat()}" if claim.expires_on else "")),
                    "next_step": None,
                    "claim_id": str(claim.id),
                })
                met += 1
            elif claim is not None:
                entry.update({
                    "state": "needs_confirmation",
                    "reason": {
                        ClaimStatus.EXPIRED.value: "On file, but it has expired",
                        ClaimStatus.REJECTED.value: f"On file, but it was sent back: {(claim.rejection_reason or '')[:120]}",
                        ClaimStatus.DECLARED.value: "Declared on your Passport — no document seen yet",
                    }.get(state, "On file, waiting for a verifier to check it"),
                    "next_step": "Ask for a check on your Passport" if state != ClaimStatus.EXPIRED.value
                                 else "Upload the renewed document",
                    "claim_id": str(claim.id),
                })
                pending += 1
                next_steps.append(f"{label}: {'renew it' if state == ClaimStatus.EXPIRED.value else 'get it verified'}")
                if must:
                    missing_must.append(label)
            else:
                entry.update({
                    "state": "missing",
                    "reason": "Nothing on your Passport for this one yet",
                    "next_step": f"Add {label} and attach the document, then ask for a check",
                    "claim_id": None,
                })
                missing += 1
                next_steps.append(f"{label}: add it to your Passport")
                if must:
                    missing_must.append(label)
        checklist.append(entry)

    # Context — why this request is in front of you at all, in readable words.
    context = []
    if request.zone_id and request.zone_id == viewer.market_zone_id:
        context.append("It is in your market zone.")
    shared = _token_set(request.description) | _token_set(request.location)
    my_words = _token_set(viewer.physical_location) | {c.lower() for c in (viewer.business_categories or [])}
    overlap = sorted(shared & my_words)
    if overlap:
        context.append("Shared words with your profile: " + ", ".join(overlap[:4]) + ".")
    distance = None
    if None not in (viewer.geo_lat, viewer.geo_lng, request.geo_lat, request.geo_lng):
        distance = round(haversine_km(
            {"lat": viewer.geo_lat, "lng": viewer.geo_lng},
            {"lat": request.geo_lat, "lng": request.geo_lng}) or 0.0, 1)
        context.append(f"About {distance} km away.")

    total = len(requirements)
    summary = {"total": total, "met": met, "needs_confirmation": pending,
               "missing": missing, "unverifiable": unverifiable}
    sentence_bits = [f"You meet {met} of {total} requirements"] if total else ["This request names no requirements"]
    if pending:
        sentence_bits.append(f"{pending} still need confirmation")
    if missing:
        sentence_bits.append(f"{missing} not on file")
    if unverifiable:
        sentence_bits.append(f"{unverifiable} the platform cannot check")
    return {
        "request_id": str(request.id),
        "checklist": checklist,
        "summary": summary,
        "sentence": "; ".join(sentence_bits) + ".",
        # On-paper eligibility is a statement about documents, never about the
        # business — and it never blocks an offer: buyers decide who they talk to.
        "eligible_on_paper": not missing_must,
        "missing_must_haves": missing_must,
        "next_steps": next_steps[:3],
        "context": context,
        "distance_km": distance,
        "can_offer": (request.status == RequestStatus.OPEN and request.requester_vendor_id != viewer.id),
        "disclaimer": (
            "Verified means a person saw the document on the date shown. It is not a judgement "
            "about the business, and an unmet requirement does not stop you offering."
        ),
    }


def watch_matches(watch: RequestWatch, request: BusinessRequest) -> tuple[bool, list[str]]:
    """The readable match: type, every keyword, the market, the budget floor.

    Each clause that fired becomes a sentence the bell can show, so a
    notification can always explain itself.
    """
    if not watch.is_active or watch.vendor_id == request.requester_vendor_id:
        return False, []
    reasons = []
    if watch.request_type and watch.request_type != request.request_type:
        return False, []
    if watch.request_type:
        reasons.append(f"type: {request.request_type.value}")
    if watch.zone_id:
        if watch.zone_id != request.zone_id:
            return False, []
        reasons.append("your market")
    tokens = _token_set(watch.keywords)
    if tokens:
        haystack = f"{request.description} {request.location}".lower()
        if not all(t in haystack for t in tokens):
            return False, []
        reasons.append("words: " + ", ".join(sorted(tokens)))
    if watch.min_budget_kes:
        if request.budget_kes is not None and request.budget_kes < watch.min_budget_kes:
            return False, []
        reasons.append(f"budget at least KSh {watch.min_budget_kes:,}"
                       if request.budget_kes is not None else "budget not stated")
    return bool(reasons), reasons


async def notify_watchers(db: AsyncSession, request: BusinessRequest,
                          poster: Vendor) -> set[UUID]:
    """Ring the bells of everyone whose standing watch this request matches.

    Capped at MATCH_NOTIFY_CAP and ordered by recency of watch so no account
    can be flooded and no long-standing watch starves. Returns who was rung,
    so the requirement loop below does not ring them twice.
    """
    watches = (await db.execute(
        select(RequestWatch)
        .where(RequestWatch.is_active.is_(True), RequestWatch.vendor_id != poster.id)
        .order_by(RequestWatch.created_at.desc())
        .limit(200)
    )).scalars().all()

    rang: set[UUID] = set()
    now = datetime.utcnow()
    for watch in watches:
        if len(rang) >= MATCH_NOTIFY_CAP:
            break
        ok, reasons = watch_matches(watch, request)
        if not ok or watch.vendor_id in rang:
            continue
        watch.last_notified_at = now
        await create_notification(
            db, watch.vendor_id, NotificationType.OPPORTUNITY_MATCH,
            title=f"New {request.request_type.value} request in {request.location}",
            body=(request.description[:180] + " — matches " + ", ".join(reasons) + "."),
            sender_id=poster.id,
            data={"request_id": str(request.id), "watch_id": str(watch.id),
                  "reasons": reasons, "request_type": request.request_type.value},
        )
        rang.add(watch.vendor_id)
    return rang


async def notify_requirement_matches(db: AsyncSession, request: BusinessRequest,
                                     poster: Vendor, *, already: set[UUID]) -> set[UUID]:
    """Tell businesses whose verified facts already cover this request.

    The pool is narrowed by the same readable factors the feed uses — shared
    market zone, shared trade categories — and then the *documents* decide:
    only a live verified claim counts. Capped, and it explains itself with the
    count ("2 of 2 documents the buyer asked for are already verified").
    """
    claim_keys = [r["key"] for r in (request.requirements or [])
                  if r.get("key") != STATED_KEY and r.get("key")]
    if not claim_keys:
        return set()

    params: dict = {"me": str(poster.id), "limit": MATCH_CANDIDATE_POOL}
    clauses = []
    if request.zone_id:
        clauses.append("v.market_zone_id = CAST(:zone AS uuid)")
        params["zone"] = str(request.zone_id)
    tokens = sorted(_token_set(request.description))[:6]
    for i, token in enumerate(tokens):
        clauses.append(f"v.business_categories::text ILIKE :tok{i}")
        params[f"tok{i}"] = f"%{token}%"
    if not clauses:
        return set()
    sql = text(f"""
        SELECT v.id, v.vendor_handle, v.business_name
          FROM vendors v
         WHERE v.id <> CAST(:me AS uuid)
           AND v.fraud_suspended_at IS NULL
           AND ({' OR '.join(clauses)})
         ORDER BY (CASE WHEN v.market_zone_id IS NOT NULL THEN 1 ELSE 0 END) DESC,
                  v.network_score DESC
         LIMIT CAST(:limit AS int)
    """)
    candidates = (await db.execute(sql, params)).all()
    if not candidates:
        return set()

    ids = [row.id for row in candidates]
    day = standing.today()
    rows = (await db.execute(
        select(BusinessClaim.vendor_id, BusinessClaim.claim_key).where(
            BusinessClaim.vendor_id.in_(ids),
            BusinessClaim.status == ClaimStatus.VERIFIED,
            (BusinessClaim.expires_on.is_(None)) | (BusinessClaim.expires_on >= day),
        )
    )).all()
    held: dict[UUID, set[str]] = {}
    for vendor_id, claim_key in rows:
        held.setdefault(vendor_id, set()).add(claim_key)

    rang: set[UUID] = set()
    for row in candidates:
        if len(rang) >= MATCH_NOTIFY_CAP:
            break
        if row.id in already or row.id in rang:
            continue
        have = held.get(row.id, set())
        if not set(claim_keys) <= have:
            continue
        await create_notification(
            db, row.id, NotificationType.OPPORTUNITY_MATCH,
            title=f"A request asks for documents you already hold: {request.location}",
            body=(f"{len(claim_keys)} of {len(claim_keys)} documents the buyer asked for are "
                  f"verified on your Passport. {request.description[:120]}"),
            sender_id=poster.id,
            data={"request_id": str(request.id), "request_type": request.request_type.value,
                  "claim_keys": claim_keys, "reasons": ["verified documents on file"]},
        )
        rang.add(row.id)
    return rang


# ── standing watches: the CRUD behind the bell ───────────────────────────────

def watch_out(watch: RequestWatch) -> dict:
    return {
        "id": str(watch.id),
        "label": watch.label,
        "request_type": watch.request_type.value if watch.request_type else None,
        "keywords": watch.keywords,
        "zone_id": str(watch.zone_id) if watch.zone_id else None,
        "min_budget_kes": watch.min_budget_kes,
        "is_active": watch.is_active,
        "last_notified_at": watch.last_notified_at.isoformat() if watch.last_notified_at else None,
        "created_at": watch.created_at.isoformat(),
    }


async def create_watch(db: AsyncSession, vendor: Vendor, *, label: str | None,
                       request_type: str | None, keywords: str | None,
                       zone_id: UUID | None, min_budget_kes: int | None) -> RequestWatch:
    """Start following a question. At least one filter, or it is a firehose."""
    existing = (await db.execute(
        select(func.count()).select_from(RequestWatch).where(RequestWatch.vendor_id == vendor.id)
    )).scalar() or 0
    if existing >= MAX_WATCHES:
        raise RequestFlowError(f"You are already following {MAX_WATCHES} watches — remove one first")
    type_value = None
    if request_type:
        if request_type not in REQUEST_TYPES:
            raise RequestFlowError(f"request_type must be one of {', '.join(sorted(REQUEST_TYPES))}")
        type_value = RequestType(request_type)
    words = (keywords or "").strip()
    if zone_id:
        zone = await db.get(MarketZone, zone_id)
        if not zone:
            raise RequestFlowError("That market does not exist", status=404)
    if not any((type_value, words, zone_id, min_budget_kes)):
        raise RequestFlowError("A watch needs at least one filter: a type, words, a market or a budget floor")
    if min_budget_kes is not None and min_budget_kes < 0:
        raise RequestFlowError("min_budget_kes cannot be negative")

    watch = RequestWatch(
        vendor_id=vendor.id,
        label=(label or "").strip()[:120] or None,
        request_type=type_value,
        keywords=words[:200] or None,
        zone_id=zone_id,
        min_budget_kes=min_budget_kes,
    )
    db.add(watch)
    await db.commit()
    await db.refresh(watch)
    return watch


async def list_watches(db: AsyncSession, vendor: Vendor) -> list[RequestWatch]:
    return (await db.execute(
        select(RequestWatch).where(RequestWatch.vendor_id == vendor.id)
        .order_by(RequestWatch.created_at.desc())
    )).scalars().all()


async def delete_watch(db: AsyncSession, vendor: Vendor, watch_id: UUID) -> None:
    watch = await db.get(RequestWatch, watch_id)
    if not watch or watch.vendor_id != vendor.id:
        raise RequestFlowError("Watch not found", status=404)
    await db.delete(watch)
    await db.commit()


async def set_watch_active(db: AsyncSession, vendor: Vendor, watch_id: UUID, active: bool) -> RequestWatch:
    watch = await db.get(RequestWatch, watch_id)
    if not watch or watch.vendor_id != vendor.id:
        raise RequestFlowError("Watch not found", status=404)
    watch.is_active = bool(active)
    await db.commit()
    await db.refresh(watch)
    return watch
