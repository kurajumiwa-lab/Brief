"""Post-trade ratings and data-based discovery (Phase 7, PR 102).

Checks: off by default (404); a client rates a completed trade and it becomes final; a client
cannot rate early or twice; a supplier records only failed/fraud, with no stars; strangers see
nothing; a received stock movement works the same way; the scoring is pure and honest; front
doors reorder by data only when the flag is on, and distance stays a true number.
"""

import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import update

from app.config import settings
from app.database import async_session
from app.models.stock import StockItem, StockMovement
from app.models.vendor import Vendor
from app.modules.professional_card import service as card_service
from app.modules.ratings import scoring
from app.modules.ratings import service as ratings_service
from app.modules.schedule.models import Appointment, AvailabilityRule, BookableService
from tests.test_nearby_front_doors import HERE, NEAR, _doors, _offer, _place, _register

pytestmark = pytest.mark.asyncio


@pytest.fixture
def gate_on(monkeypatch):
    monkeypatch.setattr(settings, "POST_TRADE_RATING_GATE_ENABLED", True)


@pytest.fixture
def ranking_on(monkeypatch):
    monkeypatch.setattr(settings, "DATA_DISCOVERY_RANKING_ENABLED", True)


async def _appointment(supplier_id, client_id, status):
    async with async_session() as db:
        svc = BookableService(vendor_id=uuid.UUID(supplier_id), name="Home visit",
                              duration_minutes=30, price_kes=500, is_active=True)
        db.add(svc)
        await db.flush()
        start = datetime.utcnow() - timedelta(days=1)
        appt = Appointment(
            vendor_id=uuid.UUID(supplier_id), service_id=svc.id,
            client_vendor_id=uuid.UUID(client_id) if client_id else None,
            client_name="Achieng", starts_at=start, ends_at=start + timedelta(minutes=30), status=status,
        )
        db.add(appt)
        await db.commit()
        return str(appt.id)


async def _movement(supplier_id, buyer_id, status):
    async with async_session() as db:
        item = StockItem(vendor_id=uuid.UUID(supplier_id), name="Maize", category="produce",
                         quantity_in_stock=10, quantity_available=10, unit_of_measure="kg",
                         unit_price=50.0, visible_to_network=True)
        db.add(item)
        await db.flush()
        mv = StockMovement(stock_item_id=item.id, from_vendor_id=uuid.UUID(supplier_id),
                           to_vendor_id=uuid.UUID(buyer_id), quantity=2, status=status,
                           movement_type="sourcing")
        db.add(mv)
        await db.commit()
        return str(mv.id)


async def _post(client, h, **body):
    return await client.post("/api/post-trade-ratings", headers=h, json=body)


async def test_off_by_default_every_route_is_404(client):
    _, hs = await _register(client, "ptr_off")
    r = await _post(client, hs, subject_kind="appointment", subject_id=str(uuid.uuid4()),
                    outcome="completed", stars=5)
    assert r.status_code == 404
    r = await client.get("/api/post-trade-ratings/status", headers=hs,
                         params={"subject_kind": "appointment", "subject_id": str(uuid.uuid4())})
    assert r.status_code == 404


async def test_client_rates_completed_appointment_and_it_becomes_final(client, gate_on):
    sup, hs = await _register(client, "ptr_sup1")
    cli, hc = await _register(client, "ptr_cli1")
    appt = await _appointment(sup, cli, "completed")

    before = await client.get("/api/post-trade-ratings/status", headers=hc,
                              params={"subject_kind": "appointment", "subject_id": appt})
    assert before.json()["final"] is False
    assert before.json()["can_rate_as"] == "client"

    r = await _post(client, hc, subject_kind="appointment", subject_id=appt, outcome="completed", stars=4)
    assert r.status_code == 201, r.text
    assert r.json()["final"] is True

    after = await client.get("/api/post-trade-ratings/status", headers=hs,
                             params={"subject_kind": "appointment", "subject_id": appt})
    body = after.json()
    assert body["final"] is True and body["my_role"] == "supplier"
    assert body["ratings"][0]["stars"] == 4


async def test_client_cannot_rate_before_completion_or_twice(client, gate_on):
    sup, _ = await _register(client, "ptr_sup2")
    cli, hc = await _register(client, "ptr_cli2")
    appt = await _appointment(sup, cli, "confirmed")
    r = await _post(client, hc, subject_kind="appointment", subject_id=appt, outcome="completed", stars=5)
    assert r.status_code == 409

    done = await _appointment(sup, cli, "completed")
    assert (await _post(client, hc, subject_kind="appointment", subject_id=done,
                        outcome="completed", stars=5)).status_code == 201
    again = await _post(client, hc, subject_kind="appointment", subject_id=done,
                        outcome="completed", stars=2)
    assert again.status_code == 409


async def test_supplier_records_fraud_only_without_stars(client, gate_on):
    sup, hs = await _register(client, "ptr_sup3")
    cli, _ = await _register(client, "ptr_cli3")
    appt = await _appointment(sup, cli, "no_show")
    starred = await _post(client, hs, subject_kind="appointment", subject_id=appt, outcome="fraud", stars=1)
    assert starred.status_code == 422
    ok = await _post(client, hs, subject_kind="appointment", subject_id=appt, outcome="fraud")
    assert ok.status_code == 201, ok.text
    assert ok.json()["rater_role"] == "supplier"


async def test_supplier_cannot_give_a_star_rating(client, gate_on):
    sup, hs = await _register(client, "ptr_sup4")
    cli, _ = await _register(client, "ptr_cli4")
    done = await _appointment(sup, cli, "completed")
    r = await _post(client, hs, subject_kind="appointment", subject_id=done, outcome="completed", stars=5)
    assert r.status_code == 422


async def test_strangers_see_nothing(client, gate_on):
    sup, _ = await _register(client, "ptr_sup5")
    cli, _ = await _register(client, "ptr_cli5")
    other, ho = await _register(client, "ptr_other5")
    appt = await _appointment(sup, cli, "completed")
    r = await _post(client, ho, subject_kind="appointment", subject_id=appt, outcome="completed", stars=5)
    assert r.status_code == 404
    s = await client.get("/api/post-trade-ratings/status", headers=ho,
                         params={"subject_kind": "appointment", "subject_id": appt})
    assert s.status_code == 404


async def test_received_stock_movement_is_rated_by_the_buyer(client, gate_on):
    sup, _ = await _register(client, "ptr_sup6")
    buyer, hb = await _register(client, "ptr_buy6")
    early = await _movement(sup, buyer, "shipped")
    assert (await _post(client, hb, subject_kind="movement", subject_id=early,
                        outcome="completed", stars=5)).status_code == 409
    done = await _movement(sup, buyer, "received")
    r = await _post(client, hb, subject_kind="movement", subject_id=done, outcome="completed", stars=5)
    assert r.status_code == 201, r.text


async def test_unknown_trade_and_bad_values_are_refused(client, gate_on):
    _, h = await _register(client, "ptr_bad7")
    r = await _post(client, h, subject_kind="appointment", subject_id=str(uuid.uuid4()),
                    outcome="completed", stars=5)
    assert r.status_code == 404
    r = await _post(client, h, subject_kind="order", subject_id=str(uuid.uuid4()), outcome="completed", stars=5)
    assert r.status_code == 422


def test_completeness_counts_real_pillars_only():
    empty = scoring.completeness({})
    assert empty == 0.0
    full = scoring.completeness({"has_hours": True, "offer_kinds": 3, "has_titles": True,
                                 "rated": 5, "avg_stars": 5.0})
    assert full == 1.0
    partial = scoring.completeness({"has_hours": True, "offer_kinds": 1})
    assert 0 < partial < full


def test_rank_keeps_distance_true_and_favours_data_within_reach():
    # Data counts for more than nearness, but nearness still matters for ties.
    rich_far = scoring.rank_score(1.0, 2.5, 3)
    bare_near = scoring.rank_score(0.0, 0.1, 3)
    assert rich_far > bare_near
    assert scoring.rank_score(0.5, 0.5, 3) > scoring.rank_score(0.5, 2.5, 3)
    assert scoring.rank_score(0.5, 9.0, 3) == scoring.rank_score(0.5, 3.0, 3)  # beyond the radius, nearness is zero


async def test_front_doors_order_by_data_only_when_flag_on(client, monkeypatch):
    me, hme = await _register(client, "ptr_me8")
    await _place(me, *HERE)

    bare, _ = await _register(client, "ptr_bare8")       # closer, offers, no hours, no ratings
    await _place(bare, *NEAR)
    await _offer(bare, goods=1)

    rich, _ = await _register(client, "ptr_rich8")       # further, with hours and two kinds
    await _place(rich, -0.0995, 34.7700)
    await _offer(rich, goods=2, services=1)
    async with async_session() as db:
        db.add(AvailabilityRule(vendor_id=uuid.UUID(rich), weekday=1, start_minute=540, end_minute=1020))
        await db.commit()

    monkeypatch.setattr(settings, "DATA_DISCOVERY_RANKING_ENABLED", False)
    off = [d["id"] for d in (await _doors(client, hme, radius_km=3))["front_doors"]]
    assert off.index(bare) < off.index(rich)              # distance order, as before

    monkeypatch.setattr(settings, "DATA_DISCOVERY_RANKING_ENABLED", True)
    on_body = await _doors(client, hme, radius_km=3)
    on = [d["id"] for d in on_body["front_doors"]]
    assert on.index(rich) < on.index(bare)
    by_id = {d["id"]: d for d in on_body["front_doors"]}
    assert by_id[rich]["data_completeness"] > by_id[bare]["data_completeness"]
    assert by_id[bare]["distance_km"] < by_id[rich]["distance_km"]  # distance still shown truthfully


# ---- Conditions for merge (review of PR 103) ---------------------------------------------

async def test_a_business_cannot_rate_its_own_booking(client, gate_on):
    sup, hs = await _register(client, "ptr_self9")
    own = await _appointment(sup, sup, "completed")          # supplier is also the client
    r = await _post(client, hs, subject_kind="appointment", subject_id=own, outcome="completed", stars=5)
    assert r.status_code == 403
    s = await client.get("/api/post-trade-ratings/status", headers=hs,
                         params={"subject_kind": "appointment", "subject_id": own})
    assert s.json()["can_rate_as"] is None
    assert "own booking" in s.json()["blocked_reason"]


async def test_nobody_rates_a_trade_with_a_business_sharing_their_number(client, gate_on):
    sup, _ = await _register(client, "ptr_sup10")
    cli, hc = await _register(client, "ptr_cli10")
    async with async_session() as db:
        await db.execute(update(Vendor).where(Vendor.id == uuid.UUID(sup)).values(phone="+254 712 345 678"))
        await db.execute(update(Vendor).where(Vendor.id == uuid.UUID(cli)).values(phone="0712345678"))
        await db.commit()
    appt = await _appointment(sup, cli, "completed")
    r = await _post(client, hc, subject_kind="appointment", subject_id=appt, outcome="completed", stars=5)
    assert r.status_code == 403
    assert "contact number" in r.json()["detail"]


def test_a_rating_moves_rank_only_after_three_clients():
    assert scoring.rating_part(1, 5.0) == 0.0
    assert scoring.rating_part(2, 5.0) == 0.0
    assert scoring.rating_part(3, 5.0) > 0.0


async def test_supplier_average_withheld_below_the_floor_and_counts_distinct_clients(client, gate_on):
    sup, _ = await _register(client, "ptr_sup11")
    clients = [await _register(client, f"ptr_c11_{i}") for i in range(3)]

    # Two clients: the count shows, the average does not.
    for cid, h in clients[:2]:
        appt = await _appointment(sup, cid, "completed")
        assert (await _post(client, h, subject_kind="appointment", subject_id=appt,
                            outcome="completed", stars=5)).status_code == 201
    async with async_session() as db:
        st = await ratings_service.supplier_stats(db, [uuid.UUID(sup)])
    assert st[uuid.UUID(sup)] == {"rated": 2, "avg_stars": None}

    # The same client rating again on a second trade does not add a second voice.
    cid, h = clients[0]
    again = await _appointment(sup, cid, "completed")
    assert (await _post(client, h, subject_kind="appointment", subject_id=again,
                        outcome="completed", stars=1)).status_code == 201
    async with async_session() as db:
        st = await ratings_service.supplier_stats(db, [uuid.UUID(sup)])
    assert st[uuid.UUID(sup)]["rated"] == 2

    # A third distinct client reaches the floor and the average appears.
    cid, h = clients[2]
    appt = await _appointment(sup, cid, "completed")
    assert (await _post(client, h, subject_kind="appointment", subject_id=appt,
                        outcome="completed", stars=4)).status_code == 201
    async with async_session() as db:
        st = await ratings_service.supplier_stats(db, [uuid.UUID(sup)])
    assert st[uuid.UUID(sup)]["rated"] == 3
    assert st[uuid.UUID(sup)]["avg_stars"] == round((1 + 5 + 4) / 3, 2)  # latest per client: 1, 5, 4


async def test_unrated_trades_never_change_the_completed_count(client, gate_on):
    sup, _ = await _register(client, "ptr_sup12")
    cli, _ = await _register(client, "ptr_cli12")
    await _appointment(sup, cli, "completed")                 # completed, no rating at all
    async with async_session() as db:
        card = await card_service.card_for_vendor(db, uuid.UUID(sup))
    assert card["completed_appointments"] >= 1                 # counted, rated or not
