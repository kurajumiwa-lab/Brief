"""P2 backend presentation labels: user-facing text says "Business", the contract does not change.

What is checked here:
  * the user-facing strings changed in this PR come back through the real API;
  * the contract is unchanged: route paths, JSON property names, enum values and
    the internal "vendor" identifiers still exist and still work;
  * a static guard stops new user-facing "Vendor ..." error text from creeping back
    into the modules this change touched.

Out of scope on purpose (see the PR description): governance and voting copy,
the "Vendor World" brand, money/finance module messages, and docstrings.
"""

import re
import uuid
from pathlib import Path

import pytest

from app.main import app
from app.models.chat import ChatRoomType

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"
BACKEND = Path(__file__).resolve().parents[1]


async def _register(client, handle: str) -> tuple[dict, dict]:
    suffix = uuid.uuid4().hex[:6]
    r = await client.post("/api/auth/register", json={
        "business_name": handle.replace("_", " ").title(), "vendor_handle": f"{handle}_{suffix}",
        "email": f"{handle}_{suffix}@example.com", "password": PASSWORD,
        "business_categories": ["textiles"], "physical_location": "Nairobi",
    })
    assert r.status_code == 201, r.text
    tok = r.json()
    return tok, {"Authorization": f"Bearer {tok['access_token']}"}


# --- user-facing text ------------------------------------------------------------------

async def test_missing_list_says_business_list(client):
    _, headers = await _register(client, "termlist")
    r = await client.get(f"/api/vendor-lists/{uuid.uuid4()}/members", headers=headers)
    assert r.status_code == 404
    assert r.json()["detail"] == "Business list not found"


async def test_missing_business_performance_says_business(client):
    _, headers = await _register(client, "termmetrics")
    r = await client.get("/api/vendors/no_such_handle_zz/performance", headers=headers)
    assert r.status_code == 404
    assert r.json()["detail"] == "Business not found"


# --- contract stays the same ------------------------------------------------------------

async def test_registration_keeps_vendor_property_names(client):
    tok, headers = await _register(client, "termkeys")
    # JSON property names are part of the contract and must not be renamed.
    assert "vendor_id" in tok and "vendor_handle" in tok
    assert tok["vendor_id"] and tok["vendor_handle"]
    me = await client.get("/api/vendors/me", headers=headers)
    assert me.status_code == 200, me.text
    assert me.json()["vendor_handle"] == tok["vendor_handle"]


def test_enum_values_unchanged():
    # Enum values and their stored strings are data, not copy.
    assert ChatRoomType.VENDOR_LIST.value == "vendor_list"


def test_route_paths_unchanged():
    paths = set(app.openapi()["paths"])
    assert "/api/vendors/{handle}/performance" in paths
    assert any(p.startswith("/api/vendor-lists/") for p in paths)
    assert any(p.startswith("/api/groups") for p in paths)


def test_openapi_tags_use_business_terms():
    spec = app.openapi()
    tags = {t for p in spec["paths"].values() for op in p.values() if isinstance(op, dict)
            for t in op.get("tags", [])}
    for expected in ("Businesses", "Business Lists", "Business Groups", "Business Tools", "Business List Reviews"):
        assert expected in tags, expected
    for old in ("Vendors", "Vendor Lists", "Vendor Groups", "Vendor Tools", "Vendor List Reviews"):
        assert old not in tags, old


# --- static guard ----------------------------------------------------------------------

GUARDED_FILES = [
    "app/routes/vendor_lists.py", "app/routes/groups.py", "app/routes/events.py", "app/routes/reviews.py",
    "app/routes/analytics.py", "app/routes/chat.py", "app/routes/map.py", "app/routes/vendors.py",
    "app/routes/governance.py", "app/routes/tools.py", "app/routes/market_locks.py", "app/routes/news.py",
    "app/routes/surface.py", "app/routes/stock.py", "app/services/discovery.py",
    "app/services/market_activity.py", "app/modules/growth/rules.py", "app/modules/measurement/service.py",
]
# Patterns that must not appear in a user-facing string literal in the guarded files.
FORBIDDEN = re.compile(
    r"(HTTPException\(\s*\d+,\s*f?\"[^\"]*Vendor|\"A vendor\"|Vendor list (is full|not found)|"
    r"Vendor (not found|approved)|\"Products vendors|\"[^\"]*trades with vendors|\"a vendor list\")"
)


def test_no_vendor_error_text_in_guarded_modules():
    offenders = []
    for rel in GUARDED_FILES:
        text = (BACKEND / rel).read_text(encoding="utf-8")
        for m in FORBIDDEN.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            offenders.append(f"{rel}:{line}: {m.group(0)}")
    assert not offenders, "user-facing 'vendor' text returned: " + "; ".join(offenders)
