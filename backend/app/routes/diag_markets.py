"""TEMPORARY diagnostic router — read-only, no /api prefix, removed after the
markets failure is fixed. Runs each market step in a try/except and returns
the exact traceback of the first failure, so the real runtime error is
visible without server logs."""

import traceback

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import func, select

from app.database import async_session
from app.models.market_locks import MarketMember, MarketZone
from app.models.vendor import Vendor
from app.services import market_patrons
from app.routes import markets as m
from app.routes.markets import market_data, DataRequest

router = APIRouter()


@router.get("/diag/markets")
async def diag_markets():
    from app.config import settings
    report = {"run_scheduler": settings.RUN_SCHEDULER}
    try:
        async with async_session() as db:
            # step 1: zones + country column
            try:
                zones = (await db.execute(select(MarketZone))).scalars().all()
                report["zones"] = len(zones)
                report["zone_sample"] = [
                    {"name": z.name, "country": z.country, "lat": z.center_lat, "radius": z.radius_km}
                    for z in zones[:3]
                ]
            except Exception:
                report["zones_error"] = traceback.format_exc()

            vendors = (await db.execute(select(Vendor).limit(3))).scalars().all()
            report["vendors"] = len(vendors)
            report["vendor_geo"] = [(v.business_name, v.geo_lat, v.geo_lng) for v in vendors]

            # step 2: _zone_out for a couple of zones
            for z in (zones if "zones" in report else [])[:2]:
                try:
                    out = await m._zone_out(db, z, with_patrons=True)
                    report[f"zone_out:{z.name}"] = {
                        "ok": True, "members": out["member_count"],
                        "patron_slots": out.get("patron_slots"),
                        "lead": (out.get("lead_patron") or {}).get("name"),
                    }
                except Exception:
                    report[f"zone_out:{z.name}"] = {"ok": False, "error": traceback.format_exc()}

            # step 3: the scan body (distance over all zones)
            try:
                if vendors and vendors[0].geo_lat is not None:
                    la, lo = vendors[0].geo_lat, vendors[0].geo_lng
                    scored = []
                    for z in zones:
                        d = m._dist_km(la, lo, z.center_lat, z.center_lng)
                        if d is not None and d <= 500:
                            scored.append((d, z.name))
                    report["scan_like"] = {"ok": True, "from": vendors[0].business_name, "found": len(scored)}
                else:
                    report["scan_like"] = {"ok": True, "skipped": "no vendor geo"}
            except Exception:
                report["scan_like"] = {"ok": False, "error": traceback.format_exc()}

            # step 4: onboarding body for the first vendor
            try:
                if vendors:
                    ob = await _onboarding_like(db, vendors[0])
                    report["onboarding_like"] = ob
            except Exception:
                report["onboarding_like"] = {"ok": False, "error": traceback.format_exc()}

            # step 5: market data body (2 zones)
            try:
                if zones:
                    data = await _market_data_like(db, vendors[0] if vendors else None, [z.id for z in zones[:2]])
                    report["data_like"] = data
            except Exception:
                report["data_like"] = {"ok": False, "error": traceback.format_exc()}

    except Exception:
        report["fatal"] = traceback.format_exc()
    return JSONResponse(report)


async def _onboarding_like(db, vendor):
    from app.routes.onboarding import onboarding as ob_route
    try:
        out = await ob_route(vendor=vendor, db=db)
        return {"ok": True, "steps": len(out["steps"]), "nearby": bool(out["nearby"]),
                "top_conn": len(out["my_page"]["top_connections"]),
                "stock_lines": out["my_page"]["stock_lines"]}
    except Exception:
        return {"ok": False, "error": traceback.format_exc()}


async def _market_data_like(db, vendor, zone_ids):
    try:
        out = await market_data(vendor=vendor, body=DataRequest(zone_ids=zone_ids), db=db)
        return {"ok": True, "selected": out["selected"],
                "blocks": [{ "name": x["name"], "data": x["data"]} for x in out["markets"]]}
    except Exception:
        return {"ok": False, "error": traceback.format_exc()}

