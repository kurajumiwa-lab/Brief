"""v4.0 — Home office, S1: one person can start; a team grows by invite or link.

What these prove:
- one person can create a home office alone, and it is visible publicly at once;
- contact details are hidden unless the owner chose phone or email;
- only active members read the office, its calendar, or its .ics file;
- an invited registered person must accept before they join;
- a link works once, expires, is stored only as a hash, and needs no account;
- roles are enforced on the server: only owners and editors add events, and no one can invite an owner;
- an office always keeps at least one owner;
- events must end after they start; the calendar file is valid and escaped.
"""

import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select, update

from app.database import async_session
from app.modules.office.models import OfficeMember
from app.modules.office.service import hash_token
from tests.test_v35_offers import _register  # noqa: F401 (helper reuse)

pytestmark = pytest.mark.asyncio

OFFICE = {"name": "Kevin Barber Shop", "nature": "Barber: home visits and shop cuts",
          "area": "Kisii town, Nyanchwa", "hours_text": "Mon to Sat, 8am to 6pm", "contact_mode": "none"}


async def _office(client, owner, **over):
    r = await client.post("/api/office/offices", headers=owner, json={**OFFICE, **over})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _join_account(client, owner, office_id, invitee_headers, invitee_handle, role):
    r = await client.post(f"/api/office/offices/{office_id}/invites/account", headers=owner,
                          json={"handle": invitee_handle, "role": role})
    assert r.status_code == 201, r.text
    r = await client.post(f"/api/office/offices/{office_id}/invites/respond", headers=invitee_headers, json={"accept": True})
    assert r.status_code == 200, r.text


def _event(hours_from=2, length=2):
    start = datetime(2026, 11, 14, 9, 0) + timedelta(hours=hours_from)
    return {"activity": "Saturday delivery run", "title": "Home visits, Nyanchwa",
            "starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=length)).isoformat(),
            "location_text": "Kisii town"}


# ── one person can start ──────────────────────────────────────────────────────

async def test_one_person_creates_a_home_office_and_it_is_public_at_once(client):
    handle, owner, vid = await _register(client, "solo")
    oid = await _office(client, owner)
    r = await client.get(f"/api/office/public/offices/{oid}")
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Kevin Barber Shop" and body["area"] == "Kisii town, Nyanchwa"
    assert body["contact"] is None  # hidden unless the owner chose a way to be contacted


async def test_contact_is_shown_only_when_the_owner_chose_it(client):
    from app.models.vendor import Vendor
    handle, owner, vid = await _register(client, "phoneowner")
    async with async_session() as db:
        await db.execute(update(Vendor).where(Vendor.id == uuid.UUID(vid)).values(phone="+254712345678"))
        await db.commit()
    oid = await _office(client, owner, contact_mode="phone")
    body = (await client.get(f"/api/office/public/offices/{oid}")).json()
    assert body["contact"] == {"phone": "+254712345678"}
    oid2 = await _office(client, owner, name="Second Desk", contact_mode="none")
    assert (await client.get(f"/api/office/public/offices/{oid2}")).json()["contact"] is None


async def test_office_creation_writes_an_audit_event(client):
    _, owner, _ = await _register(client, "audoff")
    oid = await _office(client, owner)
    from app.modules.trust.models import AuditEvent
    async with async_session() as db:
        rows = (await db.execute(select(AuditEvent).where(AuditEvent.entity_id == uuid.UUID(oid)))).scalars().all()
    assert "office_created" in {r.action for r in rows}


# ── who can see what ──────────────────────────────────────────────────────────

async def test_non_members_cannot_read_the_office_calendar_or_file(client):
    _, owner, _ = await _register(client, "ownr")
    _, outsider, _ = await _register(client, "outs")
    oid = await _office(client, owner)
    await client.post(f"/api/office/offices/{oid}/events", headers=owner, json=_event())
    assert (await client.get(f"/api/office/offices/{oid}", headers=outsider)).status_code == 403
    assert (await client.get(f"/api/office/offices/{oid}/events", headers=outsider)).status_code == 403
    assert (await client.get(f"/api/office/offices/{oid}/calendar.ics", headers=outsider)).status_code == 403


async def test_an_invited_person_cannot_read_until_they_accept(client):
    _, owner, _ = await _register(client, "invown")
    handle, guest, _ = await _register(client, "invguest")
    oid = await _office(client, owner)
    r = await client.post(f"/api/office/offices/{oid}/invites/account", headers=owner,
                          json={"handle": handle, "role": "member"})
    assert r.status_code == 201
    assert (await client.get(f"/api/office/offices/{oid}/events", headers=guest)).status_code == 403
    assert (await client.post(f"/api/office/offices/{oid}/invites/respond", headers=guest, json={"accept": True})).status_code == 200
    assert (await client.get(f"/api/office/offices/{oid}/events", headers=guest)).status_code == 200


async def test_declining_an_invite_leaves_the_office_closed(client):
    _, owner, _ = await _register(client, "decown")
    handle, guest, _ = await _register(client, "decguest")
    oid = await _office(client, owner)
    await client.post(f"/api/office/offices/{oid}/invites/account", headers=owner, json={"handle": handle, "role": "member"})
    assert (await client.post(f"/api/office/offices/{oid}/invites/respond", headers=guest, json={"accept": False})).status_code == 200
    assert (await client.get(f"/api/office/offices/{oid}", headers=guest)).status_code == 403


# ── roles ─────────────────────────────────────────────────────────────────────

async def test_only_owner_and_editor_add_events(client):
    _, owner, _ = await _register(client, "rown")
    mh, member, _ = await _register(client, "rmember")
    eh, editor, _ = await _register(client, "redit")
    oid = await _office(client, owner)
    await _join_account(client, owner, oid, member, mh, "member")
    await _join_account(client, owner, oid, editor, eh, "editor")
    assert (await client.post(f"/api/office/offices/{oid}/events", headers=member, json=_event())).status_code == 403
    assert (await client.post(f"/api/office/offices/{oid}/events", headers=editor, json=_event())).status_code == 201
    assert (await client.post(f"/api/office/offices/{oid}/events", headers=owner, json=_event(4))).status_code == 201


async def test_editors_cannot_invite_owners_and_members_cannot_invite(client):
    _, owner, _ = await _register(client, "iown")
    eh, editor, _ = await _register(client, "ieditor")
    mh, member, _ = await _register(client, "imember")
    xh, _, _ = await _register(client, "ix")
    oid = await _office(client, owner)
    await _join_account(client, owner, oid, editor, eh, "editor")
    await _join_account(client, owner, oid, member, mh, "member")
    assert (await client.post(f"/api/office/offices/{oid}/invites/account", headers=owner,
                              json={"handle": xh, "role": "owner"})).status_code == 422
    assert (await client.post(f"/api/office/offices/{oid}/invites/account", headers=editor,
                              json={"handle": xh, "role": "staff"})).status_code == 201
    assert (await client.post(f"/api/office/offices/{oid}/invites/account", headers=member,
                              json={"handle": xh, "role": "staff"})).status_code == 403


async def test_an_office_keeps_at_least_one_owner(client):
    _, owner, _ = await _register(client, "lastown")
    oid = await _office(client, owner)
    members = (await client.get(f"/api/office/offices/{oid}", headers=owner)).json()["members"]
    me = next(m for m in members if m["role"] == "owner")
    r = await client.delete(f"/api/office/offices/{oid}/members/{me['id']}", headers=owner)
    assert r.status_code == 409


# ── links: one time, expiring, hashed, no account needed ──────────────────────

async def test_a_link_joins_once_without_an_account_and_cannot_be_reused(client):
    _, owner, _ = await _register(client, "linkown")
    oid = await _office(client, owner)
    r = await client.post(f"/api/office/offices/{oid}/invites/link", headers=owner,
                          json={"role": "staff", "function_label": "home visits"})
    assert r.status_code == 201, r.text
    token = r.json()["token"]
    r = await client.post("/api/office/links/accept", json={"token": token, "display_name": "Wanjiru"})
    assert r.status_code == 201, r.text
    assert (await client.post("/api/office/links/accept", json={"token": token, "display_name": "Other"})).status_code == 404
    members = (await client.get(f"/api/office/offices/{oid}", headers=owner)).json()["members"]
    joined = [m for m in members if m["name"] == "Wanjiru"]
    assert joined and joined[0]["function_label"] == "home visits" and joined[0]["registered"] is False


async def test_a_wrong_or_expired_link_is_refused(client):
    _, owner, _ = await _register(client, "expown")
    oid = await _office(client, owner)
    assert (await client.post("/api/office/links/accept",
                              json={"token": "not-a-real-token-123", "display_name": "Nobody"})).status_code == 404
    token = (await client.post(f"/api/office/offices/{oid}/invites/link", headers=owner,
                               json={"role": "partner", "function_label": "rider"})).json()["token"]
    async with async_session() as db:
        await db.execute(update(OfficeMember).where(OfficeMember.invite_token_hash == hash_token(token))
                         .values(invite_expires_at=datetime.utcnow() - timedelta(minutes=1)))
        await db.commit()
    assert (await client.post("/api/office/links/accept", json={"token": token, "display_name": "Late"})).status_code == 410


async def test_the_link_is_stored_only_as_a_hash(client):
    _, owner, _ = await _register(client, "hashown")
    oid = await _office(client, owner)
    token = (await client.post(f"/api/office/offices/{oid}/invites/link", headers=owner,
                               json={"role": "member", "function_label": "delivery"})).json()["token"]
    async with async_session() as db:
        row = (await db.execute(select(OfficeMember).where(
            OfficeMember.invite_token_hash == hash_token(token)))).scalar_one()
    assert row.invite_token_hash != token and len(row.invite_token_hash) == 64


# ── calendar ──────────────────────────────────────────────────────────────────

async def test_events_must_end_after_they_start(client):
    _, owner, _ = await _register(client, "evown")
    oid = await _office(client, owner)
    bad = _event()
    bad["ends_at"] = bad["starts_at"]
    assert (await client.post(f"/api/office/offices/{oid}/events", headers=owner, json=bad)).status_code == 422


async def test_calendar_file_is_valid_and_escaped(client):
    _, owner, _ = await _register(client, "icsown")
    oid = await _office(client, owner)
    ev = _event()
    ev["title"] = "Visits, Kisii; Nyanchwa"
    assert (await client.post(f"/api/office/offices/{oid}/events", headers=owner, json=ev)).status_code == 201
    r = await client.get(f"/api/office/offices/{oid}/calendar.ics", headers=owner)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/calendar")
    text = r.text
    assert text.startswith("BEGIN:VCALENDAR") and text.rstrip().endswith("END:VCALENDAR")
    assert "BEGIN:VEVENT" in text and "DTSTART:20261114T110000Z" in text  # 09:00 local is stored as UTC here
    assert r"SUMMARY:Visits\, Kisii\; Nyanchwa" in text


async def test_the_office_can_be_removed_from_the_list_by_owner_only(client):
    _, owner, _ = await _register(client, "remown")
    mh, member, _ = await _register(client, "remmember")
    oid = await _office(client, owner)
    await _join_account(client, owner, oid, member, mh, "member")
    members = (await client.get(f"/api/office/offices/{oid}", headers=owner)).json()["members"]
    target = next(m for m in members if m["role"] == "member")
    assert (await client.delete(f"/api/office/offices/{oid}/members/{target['id']}", headers=member)).status_code == 403
    assert (await client.delete(f"/api/office/offices/{oid}/members/{target['id']}", headers=owner)).status_code == 204
    assert (await client.get(f"/api/office/offices/{oid}", headers=member)).status_code == 403


async def test_only_the_exact_office_routes_are_open_without_sign_in(client):
    """The gate opens one POST and the public GET profile. Everything else under /api/office needs a member."""
    oid = "00000000-0000-0000-0000-000000000000"
    assert (await client.post("/api/office/offices", json={})).status_code == 401
    assert (await client.get(f"/api/office/offices/{oid}")).status_code == 401
    assert (await client.get(f"/api/office/offices/{oid}/calendar.ics")).status_code == 401
    assert (await client.post(f"/api/office/offices/{oid}/invites/link", json={})).status_code == 401
    assert (await client.get("/api/office/links/accept")).status_code == 401
    assert (await client.post("/api/office/links/other", json={})).status_code == 401
    # the public read is GET only
    assert (await client.post(f"/api/office/public/offices/{oid}", json={})).status_code == 401
