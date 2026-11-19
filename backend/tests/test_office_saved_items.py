"""Privacy-zone contract tests for Home Office saved items.

The important failures this prevents:
- a family member reading someone else's vault;
- a public Page leaking a private note;
- a member featuring an item publicly without the owner's authority.
"""

import pytest

from tests.test_v35_offers import _register

pytestmark = pytest.mark.asyncio

OFFICE = {"name": "Amina Home Office", "nature": "Household", "area": "Kondele, Kisumu",
          "hours_text": None, "contact_mode": "none"}


async def _office(client, headers):
    r = await client.post("/api/office/offices", headers=headers, json=OFFICE)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _join(client, owner_headers, office_id, member_headers, handle):
    r = await client.post(f"/api/office/offices/{office_id}/invites/account", headers=owner_headers,
                          json={"handle": handle, "role": "member"})
    assert r.status_code == 201, r.text
    r = await client.post(f"/api/office/offices/{office_id}/invites/respond", headers=member_headers,
                          json={"accept": True})
    assert r.status_code == 200, r.text


async def test_vault_is_private_to_the_person_who_saved_it(client):
    owner_handle, owner, _ = await _register(client, "vault_owner")
    member_handle, member, _ = await _register(client, "vault_member")
    office_id = await _office(client, owner)
    await _join(client, owner, office_id, member, member_handle)

    saved = await client.post(f"/api/office/offices/{office_id}/saved", headers=owner, json={
        "target_kind": "external", "target_label": "Private wellness order",
        "target_url": "https://example.com/private", "privacy": "vault_private",
        "private_note": "Do not show this to the family.",
    })
    assert saved.status_code == 201, saved.text
    assert saved.json()["item"]["privacy"] == "vault_private"
    assert saved.json()["item"]["private_note"]

    mine = await client.get(f"/api/office/offices/{office_id}/saved?scope=mine", headers=owner)
    assert mine.status_code == 200 and len(mine.json()["items"]) == 1
    assert mine.json()["counts"]["vault"] == 1

    family = await client.get(f"/api/office/offices/{office_id}/saved", headers=member)
    assert family.status_code == 200
    assert family.json()["items"] == []
    assert family.json()["counts"]["vault"] == 0

    forbidden = await client.patch(
        f"/api/office/offices/{office_id}/saved/{saved.json()['item']['id']}",
        headers=member, json={"privacy": "family_shared"},
    )
    assert forbidden.status_code == 403


async def test_family_shared_is_visible_to_members_but_public_is_owner_only(client):
    owner_handle, owner, _ = await _register(client, "share_owner")
    member_handle, member, _ = await _register(client, "share_member")
    stranger_handle, stranger, _ = await _register(client, "share_stranger")
    office_id = await _office(client, owner)
    await _join(client, owner, office_id, member, member_handle)

    shared = await client.post(f"/api/office/offices/{office_id}/saved", headers=member, json={
        "target_kind": "external", "target_label": "Gas delivery, Kondele",
        "target_url": "https://example.com/gas", "privacy": "family_shared",
        "private_note": "Call before 6pm.",
    })
    assert shared.status_code == 201, shared.text

    seen = await client.get(f"/api/office/offices/{office_id}/saved", headers=owner)
    assert [x["target_label"] for x in seen.json()["items"]] == ["Gas delivery, Kondele"]
    assert seen.json()["items"][0]["private_note"] == "Call before 6pm."

    member_public = await client.post(f"/api/office/offices/{office_id}/saved", headers=member, json={
        "target_kind": "external", "target_label": "Public pick", "privacy": "public_showcase",
    })
    assert member_public.status_code == 403

    public = await client.post(f"/api/office/offices/{office_id}/saved", headers=owner, json={
        "target_kind": "external", "target_label": "Trusted plumber",
        "target_url": "https://example.com/plumber", "privacy": "public_showcase",
        "private_note": "Owner-only note.",
    })
    assert public.status_code == 201, public.text

    # A private office has no public front door at all.
    assert (await client.get(f"/api/office/public/offices/{office_id}/saved")).status_code == 404
    await client.patch(f"/api/office/offices/{office_id}/visibility", headers=owner,
                       json={"visibility": "public"})
    opened = await client.get(f"/api/office/public/offices/{office_id}/saved")
    assert opened.status_code == 200
    assert [x["target_label"] for x in opened.json()["items"]] == ["Trusted plumber"]
    assert "Owner-only note." not in opened.text
    assert "private_note" not in opened.text

    # An outsider cannot read the office's saved board.
    assert (await client.get(f"/api/office/offices/{office_id}/saved", headers=stranger)).status_code == 403


async def test_default_is_vault_and_a_saved_vendor_gets_a_real_link(client):
    owner_handle, owner, _ = await _register(client, "vendor_saver")
    target_handle, target, target_id = await _register(client, "trusted_fundi")
    office_id = await _office(client, owner)

    saved = await client.post(f"/api/office/offices/{office_id}/saved", headers=owner, json={
        "target_kind": "vendor", "target_handle": target_handle,
    })
    assert saved.status_code == 201, saved.text
    item = saved.json()["item"]
    assert item["privacy"] == "vault_private"
    assert item["target_id"] == target_id
    assert item["target_url"] == f"/p/{target_handle}"
    assert item["target_label"]

    updated = await client.patch(f"/api/office/offices/{office_id}/saved/{item['id']}", headers=owner,
                                 json={"privacy": "family_shared", "private_note": "Good with gates."})
    assert updated.status_code == 200
    assert updated.json()["item"]["privacy"] == "family_shared"

    removed = await client.delete(f"/api/office/offices/{office_id}/saved/{item['id']}", headers=owner)
    assert removed.status_code == 204
    assert (await client.get(f"/api/office/offices/{office_id}/saved", headers=owner)).json()["items"] == []
