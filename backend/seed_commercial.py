"""
Seed commercial shelf — demo data for social commerce layer.

Harnesses existing vendors, stock, groups without replacing them.

Run:
  cd backend && python seed_commercial.py  # BASE_URL env for remote
"""
import os
import asyncio
import httpx

BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")
API = f"{BASE_URL}/api"

# Vendors from seed_demo.py
VENDORS = [
    {"handle": "mama_mboga", "email": "mama_mboga@brief-demo.co.ke", "password": "Brief-demo-2026"},
    {"handle": "kibanda_kitchen", "email": "kibanda_kitchen@brief-demo.co.ke", "password": "Brief-demo-2026"},
    {"handle": "gikomba_textiles", "email": "gikomba_textiles@brief-demo.co.ke", "password": "Brief-demo-2026"},
]

POSTS = [
    {
        "vendor": "mama_mboga",
        "title": "20 laptops for schools — group order welcome",
        "content": "We can supply 20 laptops to schools, training centers, and small businesses in Kisumu. Group orders welcome — combine demand to unlock better pricing. Genuine stock, warranty included, delivery in 3 days.\n\nIdeal for: schools, colleges, cyber cafes, small businesses.\nContact for spec sheet.",
        "post_type": "group_buy",
        "individual_price": 55000,
        "group_price": 49000,
        "target_quantity": 20,
        "min_group_size": 5,
        "category": "electronics",
        "location": "Kisumu",
        "tags": ["laptops", "schools", "bulk", "Kisumu"],
        "commission_rate": 5,
    },
    {
        "vendor": "gikomba_textiles",
        "title": "Kitenge bulk — save 15% on 100+ pieces",
        "content": "Verified kitenge 6-yard, patron-verified quality. Individual price KSh 1,200. Group price KSh 1,020 for 100+ pieces.\n\nWe have 600 pieces available. Perfect for tailors, market women, and uniform suppliers.",
        "post_type": "commercial",
        "individual_price": 1200,
        "group_price": 1020,
        "target_quantity": 100,
        "min_group_size": 3,
        "category": "textiles",
        "location": "Nairobi, Gikomba",
        "tags": ["kitenge", "textiles", "bulk", "Gikomba"],
        "commission_rate": 7,
    },
    {
        "vendor": "mama_mboga",
        "title": "Fresh produce — schools & hotels group buying",
        "content": "Families, schools, and hotels can combine demand for tomatoes, sukuma wiki, and onions. We aggregate orders every Monday and Thursday.\n\nGroup buys get 11% savings and free delivery within 10km of Kibuye Market.",
        "post_type": "savings",
        "individual_price": 2700,
        "group_price": 2400,
        "target_quantity": 50,
        "min_group_size": 8,
        "category": "groceries",
        "location": "Kisumu, Kibuye",
        "tags": ["groceries", "schools", "hotels", "group-buy"],
        "commission_rate": 3,
    },
    {
        "vendor": "kibanda_kitchen",
        "title": "Looking for 10 gas cylinders — group interest?",
        "content": "Our eatery and 3 neighboring kibandas need 10 gas cylinders (13kg). Anyone else need one? If we hit 10, supplier quoted KSh 7,500 vs KSh 8,200 individual.\n\nJoin interest if you need a cylinder this week in Kisumu.",
        "post_type": "group_buy",
        "individual_price": 8200,
        "group_price": 7500,
        "target_quantity": 10,
        "min_group_size": 4,
        "category": "household",
        "location": "Kisumu",
        "tags": ["gas", "household", "Kisumu"],
        "commission_rate": 0,
    },
    {
        "vendor": "gikomba_textiles",
        "title": "Weekend deal: School uniforms fabric — 20% off",
        "content": "Limited weekend deal on school uniform fabric. First 20 buyers get extra 5% off if they share this offer.\n\nSalespeople: share and earn 6% commission on each sale you bring.",
        "post_type": "deal",
        "individual_price": 800,
        "group_price": 640,
        "category": "textiles",
        "location": "Nairobi",
        "tags": ["uniforms", "deal", "weekend"],
        "commission_rate": 6,
    },
]

async def login(client, email, password):
    form = {"username": email, "password": password}
    r = await client.post(f"{API}/auth/login", data=form)
    r.raise_for_status()
    return r.json()["access_token"]

async def main():
    async with httpx.AsyncClient(timeout=30) as client:
        tokens = {}
        for v in VENDORS:
            try:
                token = await login(client, v["email"], v["password"])
                tokens[v["handle"]] = token
                print(f"✓ Logged in {v['handle']}")
            except Exception as e:
                print(f"✗ Login failed {v['handle']}: {e}")

        for post in POSTS:
            handle = post.pop("vendor")
            token = tokens.get(handle)
            if not token:
                print(f"Skip post {post['title'][:40]} — no token for {handle}")
                continue
            try:
                r = await client.post(f"{API}/commercial/posts", json=post, headers={"Authorization": f"Bearer {token}"})
                r.raise_for_status()
                data = r.json()
                savings = data.get("savings_amount")
                pct = data.get("savings_percentage")
                print(f"✓ Posted: {data['title'][:50]} — KES {data.get('individual_price')} → {data.get('group_price')} (save {savings} · {pct}%)")
            except Exception as e:
                print(f"✗ Failed post {post['title'][:40]}: {e} {getattr(e, 'response', None) and e.response.text[:200]}")

        # Show shelf
        try:
            # Use first vendor token
            tok = next(iter(tokens.values()))
            r = await client.get(f"{API}/commercial/shelf?limit=12", headers={"Authorization": f"Bearer {tok}"})
            r.raise_for_status()
            shelf = r.json()
            print(f"\n✓ Commercial shelf: {len(shelf.get('shelf', []))} offers")
            if shelf.get("total_savings_potential"):
                print(f"  Total potential savings: KES {shelf['total_savings_potential']}")
        except Exception as e:
            print(f"Shelf fetch failed: {e}")

if __name__ == "__main__":
    asyncio.run(main())
