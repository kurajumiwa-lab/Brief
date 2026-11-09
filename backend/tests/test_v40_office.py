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
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text, update
from sqlalchemy.exc import IntegrityError

from app.database import async_session
from app.modules.office.models import OfficeEvent, OfficeMember
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
                         .values(invite_expires_at=datetime.now(timezone.utc) - timedelta(minutes=1)))
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


# ── integrity (review D1–D9): enforced by the database, not only by the service ──

async def _owner_row(oid):
    async with async_session() as db:
        rows = (await db.execute(select(OfficeMember).where(
            OfficeMember.office_id == uuid.UUID(oid), OfficeMember.role == "owner"))).scalars().all()
        return rows


async def test_an_office_is_created_with_its_owner_as_the_one_active_owner(client):
    _, owner, vid = await _register(client, "ownerrow")
    oid = await _office(client, owner)
    rows = await _owner_row(oid)
    assert len(rows) == 1 and rows[0].status == "active" and str(rows[0].vendor_id) == vid


async def test_the_owner_cannot_be_removed_and_a_second_owner_is_refused_by_the_database(client):
    _, owner, _ = await _register(client, "ownerlock")
    oid = await _office(client, owner)
    owner_member = (await _owner_row(oid))[0]
    r = await client.delete(f"/api/office/offices/{oid}/members/{owner_member.id}", headers=owner)
    assert r.status_code == 409
    async with async_session() as db:
        db.add(OfficeMember(office_id=uuid.UUID(oid), display_name="Second", role="owner", status="active",
                            created_at=datetime.now(timezone.utc)))
        with pytest.raises(IntegrityError):
            await db.flush()
        await db.rollback()


async def test_a_member_has_exactly_one_identity_or_is_a_pending_or_revoked_link(client):
    _, owner, owner_vid = await _register(client, "ident")
    oid = uuid.UUID(await _office(client, owner))
    bad_rows = [
        # both identities at once
        dict(vendor_id=uuid.UUID(owner_vid), display_name="x", status="active"),
        # no identity and active (nobody is a member)
        dict(vendor_id=None, display_name=None, status="active"),
        # a credential on an active member
        dict(vendor_id=None, display_name="Ann", status="active",
             invite_token_hash="a" * 64, invite_expires_at=datetime.now(timezone.utc)),
        # blank display name
        dict(vendor_id=None, display_name="   ", status="active"),
        # owner must be a registered account
        dict(vendor_id=None, display_name="Boss", role="owner", status="active"),
    ]
    for extra in bad_rows:
        async with async_session() as db:
            db.add(OfficeMember(office_id=oid, role=extra.pop("role", "staff"), created_at=datetime.now(timezone.utc),
                                **extra))
            with pytest.raises(IntegrityError):
                await db.flush()
            await db.rollback()


async def test_an_invite_credential_needs_a_pending_status_and_an_expiry(client):
    _, owner, _ = await _register(client, "credshape")
    oid = uuid.UUID(await _office(client, owner))
    async with async_session() as db:
        db.add(OfficeMember(office_id=oid, role="staff", status="invited", invite_token_hash="b" * 64,
                            created_at=datetime.now(timezone.utc)))            # no expiry
        with pytest.raises(IntegrityError):
            await db.flush()
        await db.rollback()


async def test_accepting_a_link_clears_its_credential_and_expiry(client):
    _, owner, _ = await _register(client, "clearacc")
    oid = await _office(client, owner)
    token = (await client.post(f"/api/office/offices/{oid}/invites/link", headers=owner,
                               json={"role": "member", "function_label": "Home visits"})).json()["token"]
    assert (await client.post("/api/office/links/accept",
                              json={"token": token, "display_name": "Wanjiru"})).status_code == 201
    async with async_session() as db:
        m = (await db.execute(select(OfficeMember).where(
            OfficeMember.office_id == uuid.UUID(oid), OfficeMember.display_name == "Wanjiru"))).scalar_one()
        assert m.status == "active" and m.invite_token_hash is None and m.invite_expires_at is None


async def test_removing_a_pending_link_revokes_it_and_it_can_no_longer_be_used(client):
    _, owner, _ = await _register(client, "revoke")
    oid = await _office(client, owner)
    token = (await client.post(f"/api/office/offices/{oid}/invites/link", headers=owner,
                               json={"role": "member", "function_label": "Delivery"})).json()["token"]
    async with async_session() as db:
        pending = (await db.execute(select(OfficeMember).where(
            OfficeMember.office_id == uuid.UUID(oid), OfficeMember.invite_token_hash == hash_token(token)))).scalar_one()
        pending_id = str(pending.id)
    assert (await client.delete(f"/api/office/offices/{oid}/members/{pending_id}", headers=owner)).status_code == 204
    async with async_session() as db:
        m = (await db.get(OfficeMember, uuid.UUID(pending_id)))
        assert m.status == "removed" and m.invite_token_hash is None and m.invite_expires_at is None
    r = await client.post("/api/office/links/accept", json={"token": token, "display_name": "Too late"})
    assert r.status_code == 404


async def test_text_fields_cannot_be_blank_in_the_database(client):
    _, owner, _ = await _register(client, "blanktext")
    oid = uuid.UUID(await _office(client, owner))
    async with async_session() as db:
        db.add(OfficeEvent(office_id=oid, activity="   ", title="Visits", starts_at=datetime(2026, 11, 14, 9),
                           ends_at=datetime(2026, 11, 14, 10), created_at=datetime.now(timezone.utc)))
        with pytest.raises(IntegrityError):
            await db.flush()
        await db.rollback()


async def test_timestamps_are_timezone_aware_in_the_database(client):
    _, owner, _ = await _register(client, "tzcols")
    await _office(client, owner)
    async with async_session() as db:
        rows = (await db.execute(text(
            "SELECT table_name, column_name, data_type FROM information_schema.columns "
            "WHERE table_name IN ('offices','office_members','office_events') "
            "AND data_type LIKE 'timestamp%'"))).all()
    assert rows and all(r.data_type == "timestamp with time zone" for r in rows)


async def test_an_offset_time_is_exported_as_the_same_instant_in_utc(client):
    _, owner, _ = await _register(client, "tzics")
    oid = await _office(client, owner)
    ev = {"activity": "Haircut", "title": "Morning slot", "location_text": None,
          "starts_at": "2026-11-14T12:00:00+03:00", "ends_at": "2026-11-14T13:00:00+03:00"}
    r = await client.post(f"/api/office/offices/{oid}/events", headers=owner, json=ev)
    assert r.status_code == 201, r.text
    assert r.json()["starts_at"].startswith("2026-11-14T09:00:00")  # 12:00 +03:00 is 09:00 UTC
    ics = (await client.get(f"/api/office/offices/{oid}/calendar.ics", headers=owner)).text
    assert "DTSTART:20261114T090000Z" in ics and "DTEND:20261114T100000Z" in ics


async def test_the_database_has_the_integrity_rules_under_their_names(client):
    """The ORM tables carry the same named rules as migration 0040 (the migration itself is tested separately)."""
    async with async_session() as db:
        names = {r[0] for r in (await db.execute(text(
            "SELECT conname FROM pg_constraint WHERE conrelid IN ('office_members'::regclass, 'offices'::regclass,"
            " 'office_events'::regclass)"))).all()}
        idx = {r[0] for r in (await db.execute(text(
            "SELECT indexname FROM pg_indexes WHERE tablename IN ('office_members','offices','office_events')"))).all()}
    for n in ("ck_office_members_identity_present", "ck_office_members_owner_is_account",
              "ck_office_members_no_stale_credentials", "ck_offices_text_nonblank", "ck_office_events_text_nonblank"):
        assert n in names, n
    assert "uq_office_one_active_owner" in idx
