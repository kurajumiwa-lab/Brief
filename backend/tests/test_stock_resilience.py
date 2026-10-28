"""A shelf line that cannot be described must not take the shelf with it.

The failure this pins was a single `tags` value written as a JSON object
instead of a list. Pydantic refused it while building the response, the whole
`GET /api/stock/network-stock` call became a 500, and because that endpoint
lists *other vendors'* stock, one legacy row made the market look broken to
everyone with no way to see or fix it from the app.

Each test below writes a row the way an older release (or a POS connector, or
a restored backup) could have written it, then asks for the network shelf.
"""

import uuid

import pytest
from sqlalchemy import text

from app.database import engine
from app.models.stock import StockItem, StockSource
from app.models.vendor import Vendor
from app.routes.stock import stock_out


async def _register(client, prefix: str) -> dict:
    response = await client.post(
        "/api/auth/register",
        json={
            "business_name": f"{prefix} Traders",
            "vendor_handle": f"{prefix}{uuid.uuid4().hex[:8]}",
            "email": f"{uuid.uuid4().hex[:8]}@example.com",
            "password": "Correct-horse-9",
            "city": "Kisumu",
            "country": "Kenya",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _insert(client, vendor_id: str, name: str, **overrides) -> str:
    """Write a row the way a legacy writer would: raw SQL, no ORM defaults."""
    columns = {
        "id": str(uuid.uuid4()),
        "vendor_id": vendor_id,
        "name": name,
        "quantity_in_stock": 9,
        "quantity_reserved": 0,
        "quantity_available": 9,
        "unit_of_measure": "units",
        "min_order_quantity": 1,
        "source": "MANUAL_ENTRY",
        "visible_to_network": True,
    }
    columns.update(overrides)
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO stock_items (id, vendor_id, name, quantity_in_stock, "
                "quantity_reserved, quantity_available, unit_of_measure, "
                "min_order_quantity, source, visible_to_network, tags, images, "
                "bulk_discount_tiers, created_at, updated_at) VALUES "
                "(:id, :vendor_id, :name, :quantity_in_stock, :quantity_reserved, "
                ":quantity_available, :unit_of_measure, :min_order_quantity, :source, "
                ":visible_to_network, :tags, :images, :bulk_discount_tiers, now(), now())"
            ),
            {
                "tags": None,
                "images": None,
                "bulk_discount_tiers": None,
                **columns,
            },
        )
    return columns["id"]


# Writing JSONB needs SQL literals, not bind parameters, so a few shapes are
# inserted through a helper that pastes a jsonb expression.
async def _insert_raw(client, vendor_id: str, name: str, jsonb: str) -> None:
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO stock_items (id, vendor_id, name, quantity_in_stock, "
                "quantity_reserved, quantity_available, unit_of_measure, "
                "min_order_quantity, source, visible_to_network, tags, created_at, updated_at) "
                f"VALUES ('{uuid.uuid4()}', '{vendor_id}', '{name}', 9, 0, 9, 'units', 1, "
                f"'MANUAL_ENTRY', true, {jsonb}, now(), now())"
            )
        )


@pytest.mark.parametrize(
    "shape,jsonb",
    [
        ("object", "'{\"a\": 1}'::jsonb"),
        ("string", "'\"greens\"'::jsonb"),
        ("number", "'7'::jsonb"),
        ("nested", "'[[1, 2]]'::jsonb"),
    ],
)
async def test_one_unreadable_row_does_not_blank_the_network_shelf(client, shape, jsonb):
    buyer = await _register(client, "buyer")
    supplier = await _register(client, "supplier")
    headers = {"Authorization": f"Bearer {buyer['access_token']}"}

    await _insert_raw(client, supplier["vendor_id"], f"Poisoned {shape}", jsonb)
    await _insert(client, supplier["vendor_id"], "Healthy")

    # Scoped to this supplier: the suite shares one database, so an unscoped
    # shelf would answer with every other test's rows too.
    response = await client.get(
        "/api/stock/network-stock",
        headers=headers,
        params={"limit": 12, "vendor_handle": supplier["vendor_handle"]},
    )

    assert response.status_code == 200, response.text
    names = [row["name"] for row in response.json()]
    assert "Healthy" in names, "the readable stock must still be shown"
    assert f"Poisoned {shape}" in names, "the odd row is rendered, not dropped"


async def test_a_shelf_where_the_only_row_is_odd_still_answers(client):
    buyer = await _register(client, "buyer")
    supplier = await _register(client, "supplier")
    headers = {"Authorization": f"Bearer {buyer['access_token']}"}

    await _insert_raw(client, supplier["vendor_id"], "Only row", "'{\"a\": 1}'::jsonb")

    response = await client.get(
        "/api/stock/network-stock", headers=headers, params={"vendor_handle": supplier["vendor_handle"]}
    )

    assert response.status_code == 200, response.text
    rows = response.json()
    assert any(row["name"] == "Only row" for row in rows)
    # Every row that came back is a well-formed shelf line, whatever was stored.
    assert all(isinstance(row["tags"], list) for row in rows)


async def test_my_own_shelf_survives_the_same_row(client):
    supplier = await _register(client, "supplier")
    headers = {"Authorization": f"Bearer {supplier['access_token']}"}

    await _insert_raw(client, supplier["vendor_id"], "Mine", "'\"not-a-list\"'::jsonb")

    response = await client.get("/api/stock/my-stock", headers=headers)

    assert response.status_code == 200
    row = response.json()[0]
    assert row["tags"] == ["not-a-list"], "a string tag is kept, not discarded"


class _Item:
    """The shapes a row arrives in, without a database in the way."""

    def __init__(self, **overrides):
        defaults = dict(
            id=uuid.uuid4(),
            name="Tomatoes",
            sku=None,
            category="produce",
            subcategory=None,
            description=None,
            quantity_in_stock=10,
            quantity_reserved=0,
            quantity_available=10,
            unit_of_measure="crates",
            cost_price=None,
            wholesale_price=20.0,
            unit_price=30.0,
            min_order_quantity=1,
            bulk_discount_tiers=None,
            source=StockSource.MANUAL_ENTRY,
            visible_to_network=True,
            tags=None,
            images=None,
            last_pos_sync=None,
            updated_at=None,
            quality_status=None,
            spec_sheet_url=None,
            batch_number=None,
            origin_country=None,
            expiry_date=None,
            verified_by_vendor_id=None,
            verified_at=None,
        )
        defaults.update(overrides)
        self.__dict__.update(defaults)


class _Vendor:
    def __init__(self, **overrides):
        defaults = dict(
            id=uuid.uuid4(),
            vendor_handle="mama_mboga",
            business_name="Mboga",
            network_score=0.0,
            parasitism_index=0.0,
            is_patron=False,
            movements_completed=0,
            movements_cancelled=0,
        )
        defaults.update(overrides)
        self.__dict__.update(defaults)


def test_source_reads_as_a_string_whatever_the_row_stored():
    """`source` was the one field that assumed an Enum object. An enum member,
    the stored label and a plain string all mean the same thing."""
    assert stock_out(_Item(source=StockSource.POS_SYNC), _Vendor()).source == "pos_sync"
    assert stock_out(_Item(source="pos_sync"), _Vendor()).source == "pos_sync"
    assert stock_out(_Item(source=None), _Vendor()).source == "manual_entry"


def test_a_score_that_cannot_be_encoded_is_not_fatal():
    """NaN is a valid float8 but not valid JSON: it used to 500 the response."""
    cheap = stock_out(_Item(), _Vendor(network_score=float("nan")))
    assert cheap.vendor_network_score == 0.0
    infinite = stock_out(_Item(), _Vendor(parasitism_index=float("inf")))
    assert infinite.vendor_parasitism_index == 0.0


def test_missing_text_fields_get_a_readable_default():
    row = stock_out(_Item(name=None, unit_of_measure=None), _Vendor(business_name=None))
    assert row.name == "Stock item"
    assert row.unit_of_measure == "units"
    assert row.vendor_business == "A vendor"


def test_dates_render_whether_they_are_dates_or_strings():
    from datetime import datetime

    stamped = stock_out(_Item(updated_at=datetime(2026, 10, 28, 9, 30)), _Vendor())
    assert stamped.updated_at == "2026-10-28T09:30:00"
    already = stock_out(_Item(updated_at="2026-10-28T09:30:00"), _Vendor())
    assert already.updated_at == "2026-10-28T09:30:00"


def test_a_row_that_still_cannot_be_described_is_left_out_not_raised():
    from app.routes.stock import stock_out_many

    class _Broken:
        id = uuid.uuid4()

        def __getattr__(self, name):
            raise RuntimeError(f"unreadable column {name}")

    good_item, vendor = _Item(), _Vendor()
    out = stock_out_many([(good_item, vendor), (_Broken(), vendor)])

    assert len(out) == 1
    assert out[0].name == "Tomatoes"
