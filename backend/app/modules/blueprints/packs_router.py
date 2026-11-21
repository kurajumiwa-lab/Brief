"""Template packs API. Mounted at /api/template-packs.

    GET  /api/template-packs                 the library (public, no account)
    GET  /api/template-packs/{key}           one pack in full (public)
    POST /api/template-packs/{key}/start     signed in: create the DRAFT it describes

What `start` does, and does not do:

* creates the starter offers from the pack, all `ask_me` — a template never
  invents a price for a business;
* starts the matching free blueprint, so the steps appear in the owner's day;
* sets the page preset and stores the pack's suggested terms as a *suggestion*;
* **publishes nothing.** The page stays exactly as private as it was, and a
  field the owner has already set is never overwritten.

Starting the same pack twice is idempotent: it reports what already exists
rather than duplicating five offers.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.stock import StockItem, StockSource
from app.models.tools import ToolCategory, ToolListing
from app.models.vendor import Vendor
from app.modules.blueprints import service as blueprint_service
from app.modules.blueprints.catalogue import BY_KEY as BLUEPRINTS
from app.modules.blueprints.packs import BY_KEY, list_packs
from app.modules.blueprints.packs import PACKS  # noqa: F401  (re-exported for ops)
from app.modules.offerings import service as offerings_service
from app.modules.professional_card import page_settings
from app.modules.schedule.models import BookableService
from app.routes.auth import get_current_vendor

router = APIRouter()


@router.get("")
async def library(sector: Optional[str] = None):
    return {
        "packs": list_packs(sector=sector),
        "note": (
            "Every pack creates a draft. Nothing is published in your name until you "
            "read it, and no pack invents a price."
        ),
    }


@router.get("/{key}")
async def one(key: str):
    pack = BY_KEY.get(key)
    if pack is None:
        raise HTTPException(status_code=404, detail="No template pack with that name.")
    suggestions = {s["key"]: s for s in offerings_service.suggestions()["lines"]}
    line = suggestions.get(pack.get("line_key") or "")
    return {
        **pack,
        "blueprint_title": (BLUEPRINTS.get(pack["blueprint"]) or {}).get("title"),
        "suggested_terms": {
            "platform_fee_pct": line["platform_fee_pct"] if line else 0.5,
            "buyer_cutback_pct": line["buyer_cutback_pct"] if line else 1.0,
            "reason": line["reason"] if line else "",
        },
        "publishes_nothing": True,
    }


@router.post("/{key}/start", status_code=201)
async def start(key: str, vendor: Vendor = Depends(get_current_vendor),
                db: AsyncSession = Depends(get_db)):
    pack = BY_KEY.get(key)
    if pack is None:
        raise HTTPException(status_code=404, detail="No template pack with that name.")

    created = {"goods": 0, "service": 0, "tool": 0, "skipped": 0}

    # Existing titles are respected: re-running a pack never duplicates lines the
    # owner already has, and never overwrites a price they have already set.
    existing_goods = {r.name.lower() for r in (await db.execute(
        select(StockItem).where(StockItem.vendor_id == vendor.id)
    )).scalars().all()}
    existing_services = {r.name.lower() for r in (await db.execute(
        select(BookableService).where(BookableService.vendor_id == vendor.id)
    )).scalars().all()}
    existing_tools = {r.title.lower() for r in (await db.execute(
        select(ToolListing).where(ToolListing.vendor_id == vendor.id)
    )).scalars().all()}

    for offer in pack["offers"]:
        title = offer["title"]
        if offer["kind"] == "goods":
            if title.lower() in existing_goods:
                created["skipped"] += 1
                continue
            db.add(StockItem(
                vendor_id=vendor.id, name=title,
                quantity_in_stock=0, quantity_available=0,
                unit_of_measure=offer.get("price_unit") or "units",
                unit_price=None, price_mode="ask_me",
                source=StockSource.MANUAL_ENTRY, images=[],
                # Draft: not on the network until the owner switches it on.
                visible_to_network=False,
            ))
            existing_goods.add(title.lower())
            created["goods"] += 1
        elif offer["kind"] == "service":
            if title.lower() in existing_services:
                created["skipped"] += 1
                continue
            db.add(BookableService(
                vendor_id=vendor.id, name=title, duration_minutes=60,
                price_kes=None, price_mode="ask_me", is_active=False,
                price_unit=offer.get("price_unit"), images=[],
            ))
            existing_services.add(title.lower())
            created["service"] += 1
        else:
            if title.lower() in existing_tools:
                created["skipped"] += 1
                continue
            db.add(ToolListing(
                vendor_id=vendor.id, category=ToolCategory.EQUIPMENT, title=title,
                price_per_unit=None, price_unit=offer.get("price_unit"),
                price_mode="ask_me", is_available=False, images=[],
            ))
            existing_tools.add(title.lower())
            created["tool"] += 1

    # The page preset, but only where the owner has not chosen one yet.
    current = page_settings.view(vendor.public_page)
    if current.get("preset") in (None, "", "service"):
        raw = {**current, "preset": pack["preset"]}
        vendor.public_page = page_settings.clean(raw)

    # The free blueprint, so the first steps are in the owner's day.
    started = False
    if pack["blueprint"] in BLUEPRINTS:
        started = await blueprint_service.start(db, vendor.id, pack["blueprint"])

    await db.commit()
    return {
        "pack": pack["key"],
        "created": created,
        "blueprint": pack["blueprint"] if started else None,
        "published": False,
        "is_draft": True,
        "note": (
            "Created as a draft. Your offers are switched off until you set a price "
            "and turn each one on; nothing appeared on your public page."
        ),
    }
