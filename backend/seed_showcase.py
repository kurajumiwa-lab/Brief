"""Seed a page that looks like a working business — photos, offers, selected work.

    python seed_showcase.py                        # against http://localhost:8000
    BASE_URL=https://brief.example.com python seed_showcase.py

Why this exists
-------------------------------------------------------------------------------
A new page is a name, a town and one line of About. That is enough to *have* a
page and not enough to *read* one: a stranger cannot tell whether the trade is
real, what it costs, or what the finished job looks like. This script fills the
three surfaces a page is judged on, using only the public API — so it is also a
check that the API can actually do it:

    gallery_items   eight photographs, filed under the chips a visitor filters by
    work_items      three selected-work cards: the job, the result, the year
    offerings       services, goods and a rental, with prices and units

Everything is created through the same endpoints the owner's own screen calls,
and nothing is invented that the page cannot show: a photo is uploaded through
`/api/files/upload`, a price is a price the API accepted.

Idempotent: existing photos and cards are left alone, and an offering whose
title is already on the account is skipped. Run it as often as you like.

Demo accounts (password `Brief-demo-2026`, email `{handle}@brief-demo.co.ke`):
    @glow_cleaning   the full showcase — a house and office cleaning service
    @mama_mboga      fresh produce: goods offers, a boda rental, a market photo
    @boda_express    delivery service and a courier's route photos
"""

import os
import sys
from pathlib import Path

import httpx

BASE = os.environ.get("BASE_URL", "http://localhost:8000").rstrip("/") + "/api"
PASSWORD = os.environ.get("SEED_PASSWORD", "Brief-demo-2026")
DOMAIN = "brief-demo.co.ke"

# The photographs live with the frontend because a preview page uses the same
# files; the seed uploads them so the stored URL is a served one, not a path
# that only works in one deployment.
PHOTO_DIR = Path(__file__).resolve().parent.parent / "frontend" / "public" / "photos"


VENDORS = {
    "glow_cleaning": dict(
        business_name="Glow Cleaning Services",
        business_categories=["cleaning", "home services"],
        business_description=(
            "Deep cleaning for homes and offices across Kisumu. Our own supplies, our own "
            "team, and a written checklist for every visit — so you know what was done."
        ),
        physical_location="Milimani, Kisumu",
        phone="+254798176630",
    ),
}

# handle → the page as it should read.
SHOWCASE = {
    "glow_cleaning": dict(
        photos=[
            ("cleaner-blue.jpg", "Our team, and the supplies we bring", "team"),
            ("deep-clean-livingroom.jpg", "Deep clean — sitting room, Milimani", "work"),
            ("before-tidy.jpg", "Before: the morning after a family gathering", "before-after"),
            ("kitchen-team.jpg", "Kitchen detail, done twice over", "work"),
            ("cleaner-headband.jpg", "Every visit uses our own products", "team"),
            ("premises.jpg", "Our base in Kisumu — supplies, restocked weekly", "premises"),
            ("site-top.jpg", "Offices after hours, three evenings a week", "work"),
            ("cleaning-poster.jpg", "What a deep clean covers", "other"),
            ("site-team.jpg", "The crew you will actually meet", "team"),
        ],
        work=[
            dict(title="Deep clean — 3-bedroom, Milimani",
                 summary="Kitchen, two bathrooms, windows and balcony. Four hours, one team.",
                 outcome="Handed back the same afternoon",
                 discipline="Residential cleaning", year="2026"),
            dict(title="Office contract — 3 evenings a week",
                 summary="Two cleaners after hours for a 14-desk office on the Kenyatta road.",
                 outcome="Nine months without a missed evening",
                 discipline="Commercial cleaning", year="2026"),
            dict(title="Move-out clean before handover",
                 summary="Empty house cleaned top to bottom so the deposit was returned in full.",
                 outcome="Deposit returned in full",
                 discipline="Move-out cleaning", year="2025"),
        ],
        offerings=[
            dict(kind="service", title="Deep clean — 3-bedroom house",
                 description="Floors, kitchen, two bathrooms, windows and balcony. Own supplies and equipment.",
                 price=3500, price_unit="per visit", price_mode="fixed", duration_minutes=240,
                 service_radius_km=15, domain="other_services", photos=["deep-clean-livingroom.jpg"]),
            dict(kind="service", title="Office cleaning, weekly contract",
                 description="Two cleaners, three evenings a week. Consumables included and restocked monthly.",
                 price=18000, price_unit="per month", price_mode="negotiable", duration_minutes=480,
                 service_radius_km=25, domain="other_services", photos=["site-top.jpg"]),
            dict(kind="service", title="Move-in / move-out clean",
                 description="Empty-house clean before handover. Priced after a short look at the space.",
                 price_mode="ask_me", duration_minutes=240, service_radius_km=20,
                 domain="other_services", photos=[]),
            dict(kind="goods", title="Cleaning starter pack",
                 description="Two sprays, gloves, microfibre cloths and a scrub brush. Delivered in Kisumu.",
                 price=1450, price_unit="per pack", price_mode="fixed", quantity=24,
                 photos=["cleaner-headband.jpg"]),
            dict(kind="tool", title="Wet-and-dry vacuum for hire",
                 description="16-litre machine with hose and floor head. Day rate, collected or delivered.",
                 price=1200, price_unit="per day", price_mode="fixed", category="equipment",
                 service_radius_km=10, photos=["cleaning-poster.jpg"]),
        ],
    ),
}


class Client:
    def __init__(self):
        self.http = httpx.Client(base_url=BASE, timeout=60)
        self.tokens: dict[str, str] = {}
        self.uploads: dict[str, str] = {}

    def headers(self, handle):
        return {"Authorization": f"Bearer {self.tokens[handle]}"}

    def call(self, handle, method, path, ok=(200, 201), **kw):
        r = self.http.request(method, path, headers=self.headers(handle) if handle else None, **kw)
        if r.status_code not in ok:
            raise SystemExit(f"{method} {path} as @{handle}: {r.status_code} {r.text[:300]}")
        return r.json() if r.content else None

    def soft(self, handle, method, path, **kw):
        r = self.http.request(method, path, headers=self.headers(handle) if handle else None, **kw)
        return r.json() if r.status_code in (200, 201) and r.content else None


def step(message):
    print(f"  · {message}")


def ensure_account(c, handle, info):
    r = c.http.post("/auth/register", json={
        "vendor_handle": handle, "email": f"{handle}@{DOMAIN}", "password": PASSWORD, **info,
    })
    if r.status_code == 201:
        step(f"registered @{handle}")
    elif r.status_code == 400:
        r = c.http.post("/auth/login", data={"username": f"@{handle}", "password": PASSWORD})
        if r.status_code != 200:
            raise SystemExit(f"login @{handle}: {r.status_code} {r.text[:300]}")
        step(f"logged in @{handle}")
    else:
        raise SystemExit(f"register @{handle}: {r.status_code} {r.text[:300]}")
    c.tokens[handle] = r.json()["access_token"]


def upload(c, handle, filename):
    """One photo, stored by the API. Returns the URL the page will show."""
    if filename in c.uploads:
        return c.uploads[filename]
    path = PHOTO_DIR / filename
    if not path.exists():
        raise SystemExit(f"missing photo {path} — the seed expects the files in frontend/public/photos")
    with path.open("rb") as fh:
        r = c.http.post("/files/upload", headers=c.headers(handle),
                        files={"file": (filename, fh, "image/jpeg")})
    if r.status_code not in (200, 201):
        raise SystemExit(f"upload {filename}: {r.status_code} {r.text[:200]}")
    url = r.json()["url"]
    c.uploads[filename] = url
    return url


def seed_gallery(c, handle, photos):
    """The board is one list, so it is written in one call — and only if empty."""
    current = c.call(handle, "GET", f"/vendors/{handle}")
    if current.get("gallery_items"):
        step(f"@{handle} already has {len(current['gallery_items'])} photos")
        return
    items = [
        {"image_url": upload(c, handle, filename), "caption": caption, "tag": tag}
        for filename, caption, tag in photos
    ]
    c.call(handle, "PUT", "/vendors/me/profile", json={"gallery_items": items})
    step(f"@{handle}: {len(items)} photos on the board")


def seed_work(c, handle, work):
    current = c.call(handle, "GET", f"/vendors/{handle}")
    if current.get("work_items"):
        step(f"@{handle} already has {len(current['work_items'])} work cards")
        return
    cards = []
    for index, card in enumerate(work):
        entry = dict(card)
        if index < 2:
            entry["image_url"] = upload(c, handle, ("cleaning-site.jpg", "cleaner-blue.jpg")[index])
        cards.append(entry)
    c.call(handle, "PUT", "/vendors/me/profile", json={"work_items": cards})
    step(f"@{handle}: {len(cards)} selected-work cards")


def seed_offerings(c, handle, offerings):
    """Create only what is not already there, by title. A price is never guessed."""
    mine = (c.call(handle, "GET", "/offerings/mine") or {}).get("items", [])
    have = {(item["kind"], (item["title"] or "").strip().lower()) for item in mine}
    created = 0
    for spec in offerings:
        spec = dict(spec)
        if (spec["kind"], spec["title"].lower()) in have:
            continue
        spec["photos"] = [upload(c, handle, name) for name in spec.get("photos", [])]
        c.call(handle, "POST", "/offerings", json=spec)
        created += 1
    step(f"@{handle}: {created} new offers ({len(offerings)} in the fixture)")


def main():
    c = Client()
    print(f"Seeding the showcase at {BASE}")

    for handle, info in VENDORS.items():
        ensure_account(c, handle, info)
        spec = SHOWCASE[handle]
        seed_gallery(c, handle, spec["photos"])
        seed_work(c, handle, spec["work"])
        seed_offerings(c, handle, spec["offerings"])

    handle = "glow_cleaning"
    public = c.call(handle, "GET", f"/vendors/{handle}")
    offers = c.call(None, "GET", f"/offerings/of/{handle}")
    print(
        f"Done. `/p/{handle}` has {len(public.get('gallery_items', []))} photos, "
        f"{len(public.get('work_items', []))} work cards and "
        f"{len(offers.get('items', []))} live offers. Password: {PASSWORD}"
    )


if __name__ == "__main__":
    try:
        main()
    except httpx.ConnectError:
        print(f"Cannot reach {BASE} — start the API first (python dev_local.py).", file=sys.stderr)
        sys.exit(1)
