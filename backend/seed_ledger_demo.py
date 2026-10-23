"""
Seed Local Activity Ledger demo scenarios through the public API.

    ./.venv/bin/python seed_ledger_demo.py                 # http://localhost:8000
    BASE_URL=http://localhost:8000 ./.venv/bin/python seed_ledger_demo.py

Idempotent: accounts are registered once (then logged in), activities are
looked up by title before creation, and responses / bookings / feedback are
skipped when they already exist.

Demo scenarios (password for all: Brief-demo-2026)
  Kisii      @moraa_home (household) → fence repair Wanted → quotes from
             @juma_fencing & @peter_timber → non-custodial booking → agreed
             change → mutual completion → reusable record + saved relationship
             + fractional Boma Rhodes group-order pledges (2.5t + 3.75t / 10t)
  Muthaiga   @kamau_cobbler travelling round → private household stops from
             @muthaiga_home_a / @muthaiga_home_b → ordered stops 1 & 2
  Kisii      @kisii_resource_centre supervised youth opportunity → youth
             application → guardian consent confirmed → booking agreed
  Kisumu     @achieng_learning community learning session → enrolment → booking
  Home shelf @kiamunyi_home kienyeji eggs visible only to saved contacts
"""

import os
import sys
from datetime import datetime, timedelta

import httpx

BASE = os.environ.get("BASE_URL", "http://localhost:8000").rstrip("/") + "/api"
PASSWORD = os.environ.get("SEED_PASSWORD", "Brief-demo-2026")
DOMAIN = "brief-demo.co.ke"

ACCOUNTS = {
    # Kisii fence lifecycle
    "moraa_home": dict(display_name="Moraa Household · Nyanchwa", account_kind="household",
                       business_categories=["repairs", "homestead"], physical_location="Nyanchwa, Kisii",
                       geo=(-0.68174, 34.76681)),
    "juma_fencing": dict(display_name="Juma Fencing Fundi", account_kind="artisan",
                         business_categories=["repairs", "fencing"], physical_location="Kisii Town",
                         geo=(-0.68400, 34.77000)),
    "peter_timber": dict(display_name="Peter Timber & Fence", account_kind="artisan",
                         business_categories=["repairs", "fencing", "timber"], physical_location="Suneka, Kisii",
                         geo=(-0.69000, 34.77500)),
    # Kisii group fodder + youth
    "bosongo_dairy": dict(display_name="Bosongo Dairy Homestead", account_kind="household",
                          business_categories=["agriculture", "dairy"], physical_location="Bosongo, Kisii",
                          geo=(-0.67500, 34.76000)),
    "nyaboke_farm": dict(display_name="Nyaboke Farm", account_kind="household",
                         business_categories=["agriculture"], physical_location="Nyanchwa, Kisii",
                         geo=(-0.68300, 34.76400)),
    "ombati_home": dict(display_name="Ombati Homestead", account_kind="household",
                        business_categories=["agriculture"], physical_location="Suneka, Kisii",
                        geo=(-0.68800, 34.77200)),
    "kisii_resource_centre": dict(display_name="Kisii Community Resource Centre", account_kind="institution",
                                  business_categories=["learning", "youth"], physical_location="Kisii Town",
                                  geo=(-0.68000, 34.76800)),
    "brian_student": dict(display_name="Brian (Student)", account_kind="person",
                          business_categories=["learning"], physical_location="Nyanchwa, Kisii",
                          geo=(-0.68250, 34.76550)),
    # Muthaiga cobbler round
    "kamau_cobbler": dict(display_name="Mzee Kamau Cobbler", account_kind="artisan",
                          business_categories=["cobbler", "repairs", "leather"], physical_location="Muthaiga, Nairobi",
                          geo=(-1.25284, 36.82917)),
    "muthaiga_home_a": dict(display_name="Muthaiga Home A (Tchui Rd)", account_kind="household",
                            business_categories=["household"], physical_location="Old Muthaiga, Nairobi",
                            geo=(-1.25400, 36.82800)),
    "muthaiga_home_b": dict(display_name="Muthaiga Home B (Naivasha Ave)", account_kind="household",
                            business_categories=["household"], physical_location="Muthaiga North, Nairobi",
                            geo=(-1.25100, 36.83100)),
    # Kisumu learning + home shelf
    "achieng_learning": dict(display_name="Achieng Kitchen-Garden Learning", account_kind="institution",
                             business_categories=["learning", "agriculture"], physical_location="Kondele, Kisumu",
                             geo=(-0.08500, 34.77400)),
    "kiamunyi_home": dict(display_name="Kiamunyi Homestead", account_kind="household",
                          business_categories=["poultry", "eggs"], physical_location="Kiamunyi, Kisumu",
                          geo=(-0.08700, 34.77200)),
    "trusted_neighbour": dict(display_name="Trusted Neighbour · Kiamunyi", account_kind="person",
                              business_categories=["neighbour"], physical_location="Kiamunyi, Kisumu",
                              geo=(-0.08720, 34.77220)),
}


class Client:
    def __init__(self):
        self.http = httpx.Client(base_url=BASE, timeout=30)
        self.tokens = {}
        self.ids = {}

    def auth(self, handle):
        return {"Authorization": f"Bearer {self.tokens[handle]}"}

    def call(self, handle, method, path, ok=(200, 201), **kw):
        r = self.http.request(method, path, headers=self.auth(handle) if handle else None, **kw)
        if r.status_code not in ok:
            raise SystemExit(f"{method} {path} as @{handle}: {r.status_code} {r.text[:400]}")
        return r.json() if r.content else None

    def soft(self, handle, method, path, **kw):
        """Tolerate 400/409 (already seeded)."""
        r = self.http.request(method, path, headers=self.auth(handle) if handle else None, **kw)
        if r.status_code in (200, 201):
            return r.json() if r.content else None
        if r.status_code in (400, 409, 422):
            return None
        raise SystemExit(f"{method} {path} as @{handle}: {r.status_code} {r.text[:400]}")


def step(msg):
    print(f"  · {msg}")


def ensure_account(c: Client, handle: str, info: dict):
    payload = {
        "display_name": info["display_name"],
        "business_name": info["display_name"],
        "account_kind": info["account_kind"],
        "vendor_handle": handle,
        "email": f"{handle}@{DOMAIN}",
        "password": PASSWORD,
        "business_categories": info.get("business_categories", []),
        "physical_location": info.get("physical_location"),
        "hide_exact_location": info["account_kind"] in ("person", "household"),
    }
    # Login first on re-runs: one auth call per account instead of a failed
    # register + login pair, which would trip the auth rate limiter (20/min)
    # with 14 demo accounts. A first run simply falls through to register.
    r = c.http.post("/auth/login", data={"username": f"@{handle}", "password": PASSWORD})
    if r.status_code != 200:
        r = c.http.post("/auth/register", json=payload)
    if r.status_code not in (200, 201):
        raise SystemExit(f"register/login @{handle}: {r.status_code} {r.text[:300]}")
    tok = r.json()
    c.tokens[handle] = tok["access_token"]
    c.ids[handle] = tok["vendor_id"]
    if info.get("geo"):
        c.call(handle, "PUT", "/vendors/me", json={"geo_lat": info["geo"][0], "geo_lng": info["geo"][1]})


def find_my_activity(c: Client, handle: str, title: str):
    data = c.call(handle, "GET", "/ledger/activities", params={"mine_only": True, "limit": 50})
    for item in data.get("items", []):
        if item.get("title") == title:
            return item
    return None


def ensure_activity(c: Client, handle: str, payload: dict):
    existing = find_my_activity(c, handle, payload["title"])
    if existing:
        return existing
    created = c.call(handle, "POST", "/ledger/activities", json=payload)
    step(f"@{handle} published [{created['posting_type']}/{created['inferred_template']}] {payload['title']}")
    return created


def detail(c: Client, handle: str, activity_id: str):
    return c.call(handle, "GET", f"/ledger/activities/{activity_id}")


def response_of(activity_detail: dict, responder_id: str):
    for r in activity_detail.get("responses", []):
        if (r.get("responder") or {}).get("id") == responder_id:
            return r
    return None


def booking_with(activity_detail: dict, participant_id: str):
    for b in activity_detail.get("bookings", []):
        parties = {(b.get("organizer") or {}).get("id"), (b.get("participant") or {}).get("id")}
        if participant_id in parties:
            return b
    return None


def main():
    c = Client()
    print(f"Seeding Local Activity Ledger scenarios at {BASE}")

    for handle, info in ACCOUNTS.items():
        ensure_account(c, handle, info)
    step(f"{len(ACCOUNTS)} inclusive accounts (person/household/artisan/institution)")

    # ── Kisii: fence repair full lifecycle ─────────────────────────────────
    c.soft("juma_fencing", "POST", "/ledger/watches", json={
        "label": "Kisii fencing & repairs",
        "posting_types": ["wanted"], "categories": ["repairs"],
        "area_name": "Kisii", "radius_km": 15,
    })
    fence = ensure_activity(c, "moraa_home", {
        "posting_type": "wanted",
        "title": "Fence repair needed on Saturday",
        "body": "Fence repair needed on Saturday. Approximately 20 metres of timber fence along the compound edge. Please quote.",
        "area_name": "Nyanchwa, Kisii",
        "geo_lat": -0.68174, "geo_lng": 34.76681,
        "private_directions": "Gate 4 behind Nyanchwa Primary, green kei-apple hedge",
        "scope_measure": "20 metres", "preferred_window": "Saturday 8am–2pm",
    })
    fence_id = fence["id"]
    c.soft("juma_fencing", "POST", f"/ledger/activities/{fence_id}/responses", json={
        "quoted_price_kes": 8500, "availability_window": "Saturday 8:00am",
        "proposed_completion_time": "Same day by 3:00pm",
        "relevant_experience": "12 cedar & barbed-wire homestead fences around Kisii",
        "note": "Includes treated posts realignment and wire tensioning.",
    })
    c.soft("peter_timber", "POST", f"/ledger/activities/{fence_id}/responses", json={
        "quoted_price_kes": 9800, "availability_window": "Saturday 10:00am",
        "proposed_completion_time": "Sunday noon", "note": "Labour plus nails included.",
    })
    d = detail(c, "moraa_home", fence_id)
    juma_resp = response_of(d, c.ids["juma_fencing"])
    bk = booking_with(d, c.ids["juma_fencing"])
    if not bk and juma_resp:
        bk = c.call("moraa_home", "POST", f"/ledger/activities/{fence_id}/bookings", json={
            "response_id": juma_resp["id"], "settlement_method": "direct_mpesa",
            "agreed_price_kes": 8500, "share_private_directions": True,
        })
        step("Kisii fence: non-custodial booking agreed (direct_mpesa)")
    if bk:
        bk_id = bk["id"]
        c.soft("moraa_home", "POST", f"/ledger/bookings/{bk_id}/changes", json={
            "summary": "Added replacement of broken wooden gate latch (+KSh 700)", "revised_price_kes": 9200,
        })
        c.soft("moraa_home", "POST", f"/ledger/bookings/{bk_id}/confirm-completion",
               json={"note": "Fence taut and latch fitted nicely"})
        c.soft("juma_fencing", "POST", f"/ledger/bookings/{bk_id}/confirm-completion",
               json={"note": "Paid directly via M-Pesa, thank you"})
        c.soft("moraa_home", "POST", f"/ledger/bookings/{bk_id}/feedback", json={
            "outcome": "completed_with_changes", "would_repeat": True,
            "tags": ["arrived_on_time", "quality_work"], "note": "Clear quote and solid cedar posts.",
        })
        c.soft("moraa_home", "POST", "/ledger/relationships", json={
            "target_vendor_id": c.ids["juma_fencing"], "relationship_kind": "artisan",
            "label": "Trusted fencing fundi", "categories": ["repairs", "fencing"],
        })
        step(f"Kisii fence: completed → reusable record /activities/{fence_id}")

    # ── Kisii: fractional agricultural group sourcing ──────────────────────
    group = ensure_activity(c, "bosongo_dairy", {
        "posting_type": "opportunity",
        "title": "Group order: Boma Rhodes hay & dairy fodder",
        "body": "Pooling a bulk order of cattle fodder to share transport from Nakuru to Kisii. Pledge your fractional share.",
        "target_quantity": 10.0, "unit": "tonnes", "estimated_unit_price_kes": 14000,
        "dropoff_area": "Nyanchwa junction", "area_name": "Kisii",
    })
    c.soft("nyaboke_farm", "POST", f"/ledger/activities/{group['id']}/responses",
           json={"quantity": 2.5, "unit": "tonnes", "note": "2.5 tonnes for our four Friesians"})
    c.soft("ombati_home", "POST", f"/ledger/activities/{group['id']}/responses",
           json={"quantity": 3.75, "unit": "tonnes", "note": "3.75 tonnes, will collect at Nyanchwa"})
    step(f"Kisii fodder pool: 6.25 / 10 tonnes pledged /activities/{group['id']}")

    # ── Muthaiga: travelling cobbler round with private ordered stops ──────
    round_dt = (datetime.utcnow() + timedelta(days=3)).replace(hour=9, minute=0, second=0, microsecond=0)
    rnd = ensure_activity(c, "kamau_cobbler", {
        "posting_type": "scheduled",
        "title": "Thursday Muthaiga Cobbler Round",
        "body": "Regular cobbler round across Old Muthaiga and Muthaiga North — household stops for shoe and leather repair.",
        "starts_at": round_dt.isoformat(), "capacity": 6, "area_name": "Muthaiga, Nairobi",
        "route_corridor": "Limuru Rd -> Tchui Rd -> Naivasha Ave",
        "services_offered": "Sole stitching, heel tips, leather polish & bag zips",
    })
    rnd_id = rnd["id"]
    s1 = c.soft("muthaiga_home_a", "POST", f"/ledger/activities/{rnd_id}/responses", json={
        "availability_window": "9:30–10:15am", "note": "3 pairs of school shoes + 1 leather satchel",
        "private_stop_directions": "Tchui Rd Gate 14, ask for Mama Shiro",
    })
    s2 = c.soft("muthaiga_home_b", "POST", f"/ledger/activities/{rnd_id}/responses", json={
        "availability_window": "11:00–11:45am", "note": "2 pairs of boots for re-soling",
        "private_stop_directions": "Naivasha Ave Plot 8, brown wooden gate",
    })
    d = detail(c, "kamau_cobbler", rnd_id)
    for handle in ("muthaiga_home_a", "muthaiga_home_b"):
        resp = response_of(d, c.ids[handle])
        if resp and not booking_with(d, c.ids[handle]):
            bk = c.call("kamau_cobbler", "POST", f"/ledger/activities/{rnd_id}/bookings", json={
                "response_id": resp["id"],
                "settlement_method": "direct_mpesa" if handle.endswith("_a") else "direct_cash",
            })
            step(f"Muthaiga round: stop #{bk.get('stop_sequence')} booked for @{handle}")
            d = detail(c, "kamau_cobbler", rnd_id)
    step(f"Muthaiga cobbler round: /activities/{rnd_id}")

    # ── Kisii: supervised youth opportunity with guardian consent gate ──────
    day_dt = (datetime.utcnow() + timedelta(days=2)).replace(hour=10, minute=0, second=0, microsecond=0)
    youth = ensure_activity(c, "kisii_resource_centre", {
        "posting_type": "opportunity",
        "title": "Supervised holiday tree-nursery task",
        "body": "Morning indigenous seedling potting & record keeping for 16–17s during school holidays, supervised on site.",
        "starts_at": day_dt.isoformat(), "price_kes": 800, "area_name": "Kisii Town",
        "age_band": "16_17_supervised", "permitted_domain": "garden_help",
        "supervisor_name": "Grace Nyaboke", "supervisor_role": "Extension Educator",
    })
    youth_id = youth["id"]
    c.soft("brian_student", "POST", f"/ledger/activities/{youth_id}/responses", json={
        "note": "Form 3 agriculture club member, keen to learn seedling care",
        "guardian_name_and_contact": "Mary Kwamboka (Mother) · +254712345678",
    })
    d = detail(c, "kisii_resource_centre", youth_id)
    y_resp = response_of(d, c.ids["brian_student"])
    if y_resp and y_resp.get("guardian_consent_status") == "pending":
        c.call("kisii_resource_centre", "POST", f"/ledger/responses/{y_resp['id']}/guardian-consent",
               json={"consent_status": "confirmed", "note": "Confirmed by phone with parent Mary Kwamboka"})
        step("Youth opportunity: guardian consent confirmed")
    d = detail(c, "kisii_resource_centre", youth_id)
    y_resp = response_of(d, c.ids["brian_student"])
    if y_resp and not booking_with(d, c.ids["brian_student"]):
        c.call("kisii_resource_centre", "POST", f"/ledger/activities/{youth_id}/bookings",
               json={"response_id": y_resp["id"], "settlement_method": "direct_mpesa"})
        step(f"Youth opportunity: booking agreed after consent /activities/{youth_id}")

    # ── Kisumu: community learning ──────────────────────────────────────────
    learn_dt = (datetime.utcnow() + timedelta(days=4)).replace(hour=10, minute=0, second=0, microsecond=0)
    learn = ensure_activity(c, "achieng_learning", {
        "posting_type": "scheduled",
        "title": "Kondele Kitchen-Garden Learning Session",
        "body": "Hands-on holiday learning session: sack gardens, compost, and seedling care for neighbours and older students.",
        "starts_at": learn_dt.isoformat(), "capacity": 15, "price_kes": 0,
        "area_name": "Kondele, Kisumu",
        "subject_or_skill": "Kitchen gardening & compost", "learner_group": "all_ages",
        "host_background": "Community agriculture trainer", "materials_note": "Notebook; seedlings provided",
    })
    c.soft("trusted_neighbour", "POST", f"/ledger/activities/{learn['id']}/responses",
           json={"note": "Joining with my daughter, keen on sack gardening"})
    step(f"Kisumu learning: /activities/{learn['id']}")

    # ── Home Storefront (saved-contacts audience) ──────────────────────────
    c.soft("kiamunyi_home", "POST", "/ledger/relationships", json={
        "target_vendor_id": c.ids["trusted_neighbour"], "relationship_kind": "household",
        "label": "Next-door neighbour",
    })
    c.call("kiamunyi_home", "PUT", "/ledger/home-storefront", json={
        "enabled": True, "title": "Kiamunyi Orchard Shelf", "visiting_hours": "Sat 4pm–6pm",
        "audience": "saved_contacts", "share_directions_only_when_booked": True,
    })
    eggs = ensure_activity(c, "kiamunyi_home", {
        "posting_type": "available",
        "title": "3 trays of kienyeji eggs",
        "body": "Fresh kienyeji eggs from our homestead flock, collect Saturday afternoon.",
        "price_kes": 450, "use_home_storefront": True, "area_name": "Kiamunyi, Kisumu",
    })
    step(f"Home shelf (saved contacts only): /activities/{eggs['id']}")

    print(f"Done. Ledger demo accounts use password: {PASSWORD} (emails @{{handle}}@{DOMAIN})")
    print("Try: @moraa_home (Kisii fence record) · @kamau_cobbler (Muthaiga round) · @kisii_resource_centre (youth)")


if __name__ == "__main__":
    try:
        main()
    except httpx.ConnectError:
        print(f"Cannot reach {BASE} — start the API first (./.venv/bin/python run_dev.py).", file=sys.stderr)
        sys.exit(1)
