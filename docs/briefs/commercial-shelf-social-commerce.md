# Commercial Shelf — Social Commerce Layer (v3.2)

## What you're describing is interesting because it's not just a social network for salespeople. It's a social commerce layer built around offers, savings, and coordinated buying, where salespeople and groups become the distribution network.

Think of Twitter/X-style posting, but with a dedicated shelf where posts become actionable commercial opportunities.

### 1. The concept: a commercial shelf inside a social network

**The social feed** — People and businesses publish short posts, articles, recommendations, product discoveries, and offers. Posts spread through followers, reposts, and discussions, like X.

**The commercial shelf** — A selected post can be marked with a price, a discount, or expected savings. Users can save it, share it, express buying interest, or take action on the offer.

**The group-buying layer** — Families, schools, neighborhood groups, local businesses, and enterprise teams combine demand to negotiate better prices or coordinate purchases.

This harnesses existing services without replacing them:
- Stock Room (stock_items) → commercial posts can link to stock
- Collective sourcing → commercial posts can convert to collective requests when target met
- Vendor Groups → group-buying happens inside existing groups
- Market Locks / Runs → aggregated demand model already exists
- Chat → coordination happens in existing chat rooms

### 2. Not a conventional marketplace

A conventional marketplace starts with products and listings. This starts with people sharing useful information, then selected posts become commercial opportunities.

Example post (from seed):

```
Local electronics supplier · Commercial post · Kisumu
We can supply 20 laptops to schools, training centers, and small businesses.
Group orders welcome.

Individual price: KSh 55,000
Group price: KSh 49,000
Savings: KSh 6,000 per laptop (11% less if supplier confirms)

12 interested buyers · [Join group interest]
```

Single post serves: content, advertising, lead generation, group coordination, transaction.

### 3. Where the moat comes from

The feed itself is easy to copy. The moat is:

| Potential moat | Why it matters | How we build it |
|---|---|---|
| **Salesperson distribution** | Growing network who consistently bring buyers | CommercialShare tracks shares, referrals, commission. Salespeople earn when they generate sales. |
| **Group-demand data** | Knowing what families, schools, companies want, in what quantities, at what prices | CommercialInterest aggregates quantity + location + category |
| **Verified savings** | History of genuine offers, actual prices, savings delivered | Savings calculated from stated prices, stored, shown in shelf |
| **Repeat buying relationships** | Buyers and sellers return because previous purchases worked | Interest → confirmed → movement → score (existing parasitism engine) |
| **Local demand density** | Enough buyers/suppliers in one area to make group deals practical | Location field, nearby filtering, market zones |

Strongest moat = distribution + aggregated demand. Salespeople bring offers; communities aggregate purchasing power; suppliers compete for access to that demand.

### 4. Implementation — harnessing, not replacing

#### Backend (v3.2)

**New models** `backend/app/models/commercial.py`:
- `CommercialPost` — social post that can be commercial, group_buy, deal, savings. Carries individual_price, group_price, savings, target_quantity, min_group_size, commission_rate, location, tags, linked stock_item_id / collective_id / group_id.
- `CommercialInterest` — group-buying interest (vendor_id, post_id, quantity, status, referred_by)
- `CommercialSave` — bookmark
- `CommercialShare` — distribution tracking: who shared, channel, clicks, conversions, commission_earned

**Migration** `0021_commercial_shelf.py` — enums commercialposttype, commercialpoststatus, intereststatus + 4 tables.

**Routes** `backend/app/routes/commercial.py`:
- `POST /posts` — create (regular or commercial)
- `GET /feed` — social feed with filters: commercial_only, group_buy_only, category, location, search, saved_only
- `GET /shelf` — curated offers for home (prioritized by savings %, interest count)
- `GET /posts/{id}` — detail + view count
- `PUT /posts/{id}`, `DELETE` — owner only
- `POST /posts/{id}/save`, `DELETE` — bookmark
- `POST /posts/{id}/share` — record share, return referral_code + share_url, commission info
- `POST /posts/{id}/interest` — join group buy (with quantity, notes, referred_by handle), updates post counters, tracks referral conversion + commission
- `GET /posts/{id}/interests` — list interested buyers + progress %
- `POST /posts/{id}/convert-to-collective` — harness existing CollectiveSourcingRequest when target met
- `GET /stats` — salesperson analytics: posts_created, interests_received, shares_made, conversions, commission_earned, moat_metrics
- `GET /categories` — top categories

**Integration points**:
- `news.py` now includes commercial posts (kind=commercial) — appears in Market News
- `main.py` registers `/api/commercial`
- `models/__init__.py` exports new models
- Notification on new interest (uses existing notification_service)

#### Frontend (v3.2)

**API** `lib/api.js`:
- `commercialAPI` — feed, shelf, get, create, update, remove, save, unsave, share, shares, joinInterest, leaveInterest, interests, convertToCollective, myPosts, mySaves, myInterests, stats, categories

**Components** `components/commercial/`:
- `PriceComparison.jsx` — individual vs group price, savings badge
- `GroupBuyProgress.jsx` — progress bar, remaining to unlock
- `CommercialPostCard.jsx` — full card: header, content, pricing shelf, group-buy progress, images, actions (save, share, join)
- `CommercialShelf.jsx` — horizontal shelf for home, fetches `/commercial/shelf`, hides when empty (no placeholder products)
- `CreateCommercialPost.jsx` — dialog: post type (regular, commercial, group_buy, deal, savings), title, content, pricing, target qty, commission rate (distribution moat)

**Home integration**:
- `config/homeShelves.js` — new shelf key=commercial, group=discovery, card=commercial, load() calls commercialAPI.shelf
- `components/home/cards/CommercialCard.jsx` — card for home carousel (emerald tint, price comparison, progress)
- `components/home/cards/index.jsx` — register commercial renderer
- `pages/home/HomeHub.jsx` — adds <CommercialShelf> above HomeFeed for prominence + via shelves system

**Page** `pages/commercial/CommercialFeed.jsx`:
- Twitter/X-style feed + commercial shelf
- Header explains moat + stats (distribution, demand, commission)
- Search + filters: all, offers, group buys, savings, saved
- CommercialShelf curated section
- Post cards with save/share/join actions
- Single post view `/commercial/:id` with interests list
- Create button → CreateCommercialPost dialog

**Navigation** `config/navigation.js`:
- DISCOVERY_SHORTCUTS: Goods, People, Services, Equipment, Deals, Rentals (Deals = commercial)
- BROWSE_NAV: adds Deals & group buys
- BROWSE_ROOTS: includes /commercial, /deals, /offers
- SECTION_GROUPS: Commerce section with Commercial shelf + Group buys

**News** `pages/news/News.jsx`:
- New filter commercial (PiggyBank icon)
- New template CommercialCard showing individual vs group price, savings, interested count

**Tests**:
- All 19 test files updated to mock commercialAPI
- homeFeed.test.jsx updated for new shortcuts
- navigation.test.jsx updated for new browse nav + secondary groups
- homeSurfaces.test.jsx updated for shortcuts
- All 173 tests pass

### 5. How it improves services without replacing older ones

| Existing service | How commercial shelf harnesses it |
|---|---|
| Stock Room | Post can link to stock_item_id; price from stock can seed offer; sourcing still via /source |
| Collective sourcing | When group-buy hits target, POST /convert-to-collective creates CollectiveSourcingRequest in existing group |
| Vendor Groups | Group-buy interests can be scoped to a group; group_id links post to group |
| Market Locks / Runs | Same aggregation logic: ceil(MOQ × 0.85) → group price; uses same demand summing |
| Chat | Coordination happens in existing deal/group rooms; share_target can be a chat room |
| Tools / Rentals | Could be commercial posts for rentals (future) |
| Events | Commercial posts can promote market days |
| News | Commercial posts appear in market news feed |
| Discovery | Commercial posts contribute to group-demand data for discovery ranking (future) |

Nothing was deleted. Every v2 URL still resolves. Commercial shelf is additive.

### 6. The business model decision

The implementation supports all three directions, but makes **D — combined social, distribution, and group-buying infrastructure** the strongest:

- **Distribution network** — salespeople share offers via CommercialShare, referral_code tracks who brought buyer, commission_rate incentivizes sharing. Stats show distribution_reach, conversion_rate.
- **Collective-buying network** — CommercialInterest aggregates quantity, GroupBuyProgress shows progress to target, convert-to-collective harnesses existing collective module.
- **Social discovery** — regular posts remain regular; only selected posts get price/savings fields. Feed is Twitter/X-style, shelf is structured.

Who generates demand initially? **Both consumers and organizations, with local communities connecting them** — location field, nearby filtering, group_id scoping.

### 7. Demo data

`backend/seed_commercial.py` seeds 5 posts:
- 20 laptops for schools — KSh 55k → 49k, 11% savings, 5 buyers min, 5% commission
- Kitenge bulk — 1,200 → 1,020, 15% savings, 100 target, 7% commission
- Fresh produce group — 2,700 → 2,400, 11% savings, schools & hotels
- Gas cylinders group interest — 8,200 → 7,500
- School uniforms weekend deal — 800 → 640, 20% off, 6% commission

Run after `seed_demo.py`:
```bash
cd backend && python seed_commercial.py
```

### 8. Future enhancements

- Convert commercial post to OrderTransaction when group price confirmed
- Add to analytics: commercial shelf performance, savings delivered, repeat rate
- Add chat room auto-creation for group buys (like collective)
- Add map pins for commercial offers (like stock)
- Add enterprise workspace: company can have branded commercial shelf
- Add verification: patron can vouch for commercial offer (like stock quality)
- Add halal compliance: halal_sharia vendors gated from interest products

### 9. Files changed

Backend:
- `backend/app/models/commercial.py` (new)
- `backend/app/models/__init__.py`
- `backend/alembic/versions/0021_commercial_shelf.py` (new)
- `backend/app/routes/commercial.py` (new)
- `backend/app/routes/news.py`
- `backend/app/main.py`
- `backend/seed_commercial.py` (new)

Frontend:
- `frontend/src/lib/api.js`
- `frontend/src/components/commercial/*` (5 new files)
- `frontend/src/components/home/cards/CommercialCard.jsx` (new)
- `frontend/src/components/home/cards/index.jsx`
- `frontend/src/config/homeShelves.js`
- `frontend/src/config/navigation.js`
- `frontend/src/pages/home/HomeHub.jsx`
- `frontend/src/pages/commercial/CommercialFeed.jsx` (new)
- `frontend/src/pages/news/News.jsx`
- `frontend/src/App.jsx`
- `frontend/src/test/*` (all 19 files updated for mocks + expectations)

Build:
- `frontend/dist` rebuilt — CommercialFeed chunk 31.3kB
- All 173 frontend tests pass
- All 3 migration tests pass
