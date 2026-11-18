"""One card per service provider, not one per service.

A barber, nurse, fundi or photographer is available continuously. If discovery
showed one row per service, a provider with eight services would flood the
goods feed with eight rows a buyer cannot use. This directory groups every live
offer by its Page and returns a single provider row:

    GET /api/service-providers?region_slug=&town=&q=&limit=

Sources (both already exist):
  · booking_services    a service a client can book on the provider's Page
  · tool_listings       a B2B service/rental a business offers

Nothing is invented. A provider appears only when they have a Page handle
(`vendor_handle`) and at least one active, unarchived offer. The viewer's own
offers are excluded, blocked/suspended Pages are excluded, and a Page whose
owner switched discovery off is excluded.

The response carries public facts only: page handle, business name, area, and
the offerings' names and prices. It never returns a phone number, an exact
address, an owner identity document or a private stock level.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.tools import ToolListing
from app.models.vendor import Vendor
from app.modules.price_index.service import place_parts
from app.modules.schedule.models import BookableService
from app.routes.auth import get_current_vendor
from app.services.discovery_visibility import discoverable

router = APIRouter()

MAX_SOURCE_ROWS = 400
DEFAULT_LIMIT = 24


def _public(vendor: Vendor) -> bool:
    page = vendor.public_page or {}
    return (
        bool(vendor.vendor_handle and vendor.business_name)
        and page.get("discoverable", True) is not False
        and vendor.fraud_suspended_at is None
    )


def _area(vendor: Vendor) -> Optional[str]:
    return (vendor.physical_location or "").strip() or None


def _provider(vendor: Vendor) -> dict:
    return {
        "id": str(vendor.id),
        "handle": vendor.vendor_handle,
        "name": vendor.business_name,
        "area": _area(vendor),
        "about": (vendor.business_description or "").strip() or None,
        "offerings": [],
        "owner": {
            "id": str(vendor.id),
            "handle": vendor.vendor_handle,
            "name": vendor.business_name,
            "physical_location": vendor.physical_location,
            "business_description": vendor.business_description,
            "movements_completed": int(vendor.movements_completed or 0),
            "confirmed_trade_proofs": int(vendor.confirmed_trade_proofs or 0),
            "is_verified": bool(vendor.is_verified),
            "contact_exposed": bool(
                vendor.phone_verified_at
                or (vendor.phone and vendor.allow_direct_calls)
                or getattr(vendor, "email_verified_at", None)
            ),
            "page_live": bool(vendor.vendor_handle and vendor.business_name),
        },
    }


async def _service_rows(db: AsyncSession, viewer: Vendor) -> list[tuple[Any, Vendor]]:
    return (await db.execute(
        select(BookableService, Vendor)
        .join(Vendor, Vendor.id == BookableService.vendor_id)
        .where(
            BookableService.is_active.is_(True),
            BookableService.archived_at.is_(None),
            BookableService.vendor_id != viewer.id,
            discoverable(Vendor),
            Vendor.fraud_suspended_at.is_(None),
        )
        .order_by(BookableService.created_at.desc(), BookableService.id.desc())
        .limit(MAX_SOURCE_ROWS)
    )).all()


async def _tool_rows(db: AsyncSession, viewer: Vendor, now: datetime) -> list[tuple[Any, Vendor]]:
    return (await db.execute(
        select(ToolListing, Vendor)
        .join(Vendor, Vendor.id == ToolListing.vendor_id)
        .where(
            ToolListing.is_available.is_(True),
            ToolListing.archived_at.is_(None),
            ToolListing.vendor_id != viewer.id,
            or_(ToolListing.available_until.is_(None), ToolListing.available_until > now),
            discoverable(Vendor),
            Vendor.fraud_suspended_at.is_(None),
        )
        .order_by(ToolListing.created_at.desc(), ToolListing.id.desc())
        .limit(MAX_SOURCE_ROWS)
    )).all()


@router.get("")
async def list_providers(
    region_slug: Optional[str] = Query(None, max_length=120),
    town: Optional[str] = Query(None, max_length=120),
    q: Optional[str] = Query(None, max_length=200),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=50),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Service providers in a corridor, one row each.

    A provider who offers six services is one row, six offerings. Sorting is
    deliberately plain: the order the source rows arrived in (newest offer
    first), then name. No popularity, rating or paid placement.
    """
    now = datetime.utcnow()
    grouped: dict[str, dict] = {}
    # Someone this viewer blocked is not offered back to them in a new dress.
    from app.modules.outside.feed import blocked_author_ids
    blocked = await blocked_author_ids(db, vendor)

    for service, owner in await _service_rows(db, vendor):
        if not _public(owner) or str(owner.id) in blocked:
            continue
        entry = grouped.setdefault(str(owner.id), _provider(owner))
        entry["offerings"].append({
            "name": service.name,
            "price_kes": service.price_kes,
            "price_unit": service.price_unit,
            "mode": "booking",
            "domain": service.domain,
            "category": None,
            "duration_minutes": service.duration_minutes,
            "description": (service.description or "").strip() or None,
        })

    for tool, owner in await _tool_rows(db, vendor, now):
        if not _public(owner) or str(owner.id) in blocked:
            continue
        category = getattr(tool.category, "value", None) or str(tool.category)
        entry = grouped.setdefault(str(owner.id), _provider(owner))
        entry["offerings"].append({
            "name": tool.title,
            "price_kes": int(tool.price_per_unit) if tool.price_per_unit is not None else None,
            "price_unit": tool.price_unit,
            "mode": "tool",
            "domain": None,
            "category": category,
            "duration_minutes": None,
            "description": (tool.description or "").strip() or None,
        })

    providers = []
    for entry in grouped.values():
        if not _matches_place_dict(entry, region_slug, town):
            continue
        if not _matches_query_dict(entry, q):
            continue
        prices = [o["price_kes"] for o in entry["offerings"] if o.get("price_kes") is not None]
        entry["service_count"] = len(entry["offerings"])
        entry["starting_price_kes"] = min(prices) if prices else None
        entry["domains"] = sorted({o["domain"] for o in entry["offerings"] if o.get("domain")})
        entry["categories"] = sorted({o["category"] for o in entry["offerings"] if o.get("category")})
        entry["is_bookable"] = any(o["mode"] == "booking" for o in entry["offerings"])
        entry["starting_price_unit"] = next(
            (o["price_unit"] for o in entry["offerings"] if o.get("price_kes") == entry["starting_price_kes"]),
            None,
        )
        providers.append(entry)

    providers.sort(key=lambda p: ((p.get("name") or "").lower(), p["id"]))
    total = len(providers)
    return {
        "providers": providers[:limit],
        "count": min(total, limit),
        "total": total,
        "limit": limit,
        "filters": {"region_slug": region_slug, "town": town, "q": q},
        "note": (
            "One card per provider. Prices are the provider's own stated prices; "
            "nothing here is a quote or a platform-held payment."
        ),
    }


def _matches_place_dict(entry: dict, region_slug: Optional[str], town: Optional[str]) -> bool:
    """The Page area is the only place signal; a provider with no area is not
    silently assigned to the viewer's corridor."""
    area = entry.get("area") or ""
    if not area:
        return not region_slug and not town
    region, place = place_parts(area)
    if region_slug:
        wanted = region_slug.strip().lower()
        # A region page passes the corridor slug; accept the region the area
        # maps to, never an invented nearby region.
        if region != wanted:
            return False
    if town:
        needle = town.strip().lower()
        return needle in " ".join((area, place)).lower()
    return True


def _matches_query_dict(entry: dict, query: Optional[str]) -> bool:
    if not query or not query.strip():
        return True
    needle = query.strip().lower()
    haystack = " ".join([
        entry.get("name") or "",
        entry.get("area") or "",
        entry.get("about") or "",
        *(str(o.get("name") or "") for o in entry.get("offerings", [])),
        *(str(o.get("category") or "") for o in entry.get("offerings", [])),
        *(str(o.get("domain") or "") for o in entry.get("offerings", [])),
    ]).lower()
    return needle in haystack
