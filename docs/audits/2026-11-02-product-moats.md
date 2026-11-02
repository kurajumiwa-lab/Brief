# Product moat audit — existing features (2026-11-02)

**Scope.** An audit of what the codebase already does for four possible moats. It is
not a feature request. Nothing was built or changed in the product for this audit.
Each finding names the file or route that proves it, so it can be checked.

**Method.** A read-only review of models, routes, services and frontend pages on
branch `arena/420feb42-brief`. No production data was accessed, so volumes and
live usage are **not** measured here. Where a claim depends on live data, it says so.

**Status key**

- **Operational** — built, wired end to end, and producing data a user or operator sees.
- **Partial** — the mechanism exists, but a link is missing, optional, or not measured.
- **Gap** — named in the strategy but not found in the code.

---

## Summary

| Moat | Status | Strongest existing asset | Biggest weakness |
|---|---|---|---|
| 1. Two-sided network density | **Partial, leaning operational** | Market zones with active-shelf counts; supplier quotes and MOQs; vendor-to-vendor connections with a mutual-benefit index | No per-cluster measure of repeat connections; zone seeding not verified |
| 2. Habituation | **Partial** | Morning Brief, stock movements, POS push sync, voice notes in chat | Cannot log offline; no installable app; no client event store, so daily use is only partly measured |
| 3. Reputation / peer capital | **Partial, strong evidence layer** | Evidence-backed claims with expiry; patron-verified stock batches; append-only Biashara score; delivery performance record | No peer endorsement; reviews exist only for vendor lists; reputation is not a visible portable record |
| 4. Proprietary directory & sourcing data | **Partial** | Structured market price observations from intake; price-position analytics over the network's shelves; supplier quotes | Photo reading (OCR) is optional and not installed by default; OpenStreetMap places are public data, not a moat on their own |

---

## 1. Two-sided network density (local liquidity)

**What exists**

- **Geographic communities.** `MarketZone` (`app/models/market_locks.py`) groups vendors
  by place, with centre, radius and city. Vendors join with `MarketMember`. Routes:
  `GET /api/markets`, `POST /{zone_id}/join`, `GET /{zone_id}/activity`, `GET /{zone_id}/shelf`.
- **Activity, not registration.** `app/services/market_activity.py` deliberately
  headlines **active** vendors (visible stock above zero) rather than members. This is
  already the right measure for a density moat.
- **Two-sided structure.** Vendors have `StockItem`s and source from each other.
  `app/services/vendor_network.py` suggests *complementary* vendors (what you stock
  matches what I source). `vendor_connections` stores a `parasitism_index` for each pair.
- **Group buying clusters.** `LockWindow`, `LockCluster`, `LockPick`, `SupplierMOQ`,
  `SupplierQuote` (`app/models/market_locks.py`). Buyers pool orders against a supplier
  minimum. This is the clearest cross-side liquidity mechanism in the product.
- **Geography defaults.** Enterprise workspaces default to region "Kisumu"
  (`alembic/versions/0017_enterprise_workspaces.py`). Early job content refers to Kisumu
  (`0015_business_standing.py`).

**Gaps**

- The density figures (active per zone) exist, but a "repeat connections per cluster"
  figure does not. That is the number that would show whether a cluster is getting
  denser over time.
- Whether the market zones are seeded with real local markets could not be confirmed
  from the code. The check belongs on the live database.

**Measure now:** active vendors per zone (already computed); members per zone; connections
per vendor (from `vendor_connections`); shelf categories covered per zone.

---

## 2. Low-friction habituation

**What exists**

- **Daily entry point.** `app/modules/brief/` builds a deterministic Morning Brief from the
  vendor's own records, with an explicit "nothing needs you" state. Frontend:
  `frontend/src/pages/brief/MorningBriefPage.jsx`. This is the strongest habit hook found.
- **Passive capture.** POS connections (`app/services/pos_sync.py`) pull or receive shelf
  rows automatically, so the shelf stays current without retyping. Stock movements
  (`app/models/stock.py`, `StockMovement`) record each change.
- **Voice.** Chat supports voice messages (`message_type = "voice"`,
  `frontend/src/components/chat/VoiceNote.jsx`). Voice uploads are stored.
- **Quick bulk entry.** `POST /stock/add`, `POST /stock/bulk-import`.
- **Partial offline.** `frontend/src/lib/offline.js` caches the Morning Brief and receipts
  for read-only viewing, labelled with their age. It is explicitly *not* a sync engine.

**Gaps**

- **No offline writes.** A vendor cannot log a sale or stock change without a connection,
  which is the main habit-breaker on a weak mobile signal.
- **No installable app.** `frontend/public` has no web app manifest and no service worker
  was found. Users cannot add it to their home screen as an app.
- **No client event store.** The measurement module says so itself
  (`app/modules/measurement/service.py`, "There is no client event store"). Daily and
  weekly usage can only be inferred from server records, so the habit moat cannot yet be
  measured directly.
- **Three-tap actions** were not identified as a named flow in the code. The quick
  actions above are the nearest equivalent.

**Measure now:** active days per vendor (exists in `measurement/service.py`);
movements per vendor per week; Morning Brief opens (not recorded).

---

## 3. Reputation & peer-voting capital

**What exists**

- **Evidence-backed claims.** `app/modules/standing/` lets a vendor claim a business fact
  (for example a tax certificate), attach evidence, have it verified, and see it expire
  or be reviewed. `catalog.py` states the rule: *a claim is evidence, never a verdict*.
- **Patron verification of stock.** `POST /stock/{id}/patron-verify` — a market patron
  verifies a specific batch. Verification drops if the batch changes
  (`app/routes/stock.py`). This is peer verification with teeth.
- **Append-only Biashara score.** `BiasharaScoreEvent` (`app/models/governance.py`),
  written by `app/services/biashara.py` for paid picks, repaid or defaulted peer loans,
  and settled or defaulted cost-plus advances. Every point has a reference and an
  explanation. Rule rows are seeded in `0005_governance.py`.
- **Delivery performance record.** `VendorPerformance` (on-time delivery, fulfilment,
  returns, disputes, response time, reliability score) feeds the reliability term in
  discovery ranking (`app/services/discovery.py`, "reputation" weight).
- **Reviews with provenance.** `VendorListReview` carries `verified_member` (only members
  of a list may review it) and `helpful_count`.
- **Passport.** The standing module produces a per-business passport with its own
  disclaimer.

**Gaps**

- **No peer endorsement.** The code search found no "endorse" or "vouch" feature for
  one vendor to vouch for another. Social reactions exist but are per post, not per
  person.
- **Reviews are limited to vendor lists.** Ratings of a *vendor's* service or of a
  completed trade do not exist as a visible record.
- **Reputation is deliberately not a single score.** `standing/service.py` refuses to
  compute one. That is a defensible product choice, but it means the moat is an
  **evidence record**, not a number people can compare. The strengthening work should
  build on the evidence (history, repeat verification, completed trades), not add a
  score.

**Measure now:** verified claims per vendor; patron verifications per market; helpful
votes on reviews; Biashara events per vendor.

---

## 4. Proprietary directory & sourcing data

**What exists**

- **Structured price observations.** `app/modules/intake/` turns seller advertising
  (photos or pasted text) into `MarketObservation` rows: product, price, unit, market,
  wholesale flag, confidence, and a status (`suggested`, then decided by a person). This
  is the strongest proprietary-data asset: local prices that cannot be scraped from
  anywhere else. Routes: `POST /intake/batches`, `GET /market-data/summary`,
  `GET /market-data/observations`.
- **Network price position.** `app/services/analytics_service.py` compares a vendor's
  price with the average of network shelves in the same category. Only stock marked
  visible to the network counts.
- **Supplier records.** Supplier quotes, MOQs, lock products, POS connections.
- **Directory.** Vendor profiles with verification state, business categories and
  location; ranked discovery.
- **Public places.** `PublicPlace` rows from OpenStreetMap, with the required attribution.

**Gaps**

- **Photo reading is optional.** OCR needs a separate install (`requirements-ocr.txt`).
  Without it, prices must be typed or pasted, which limits how fast the dataset grows.
- **OpenStreetMap places are not a moat.** Anyone can ingest the same open data. Only
  the vendor-claimed and price-history layers are unique to Brief.
- **The value depends on continuous intake.** A price archive is only defensible if it
  is collected over months. How much has been collected so far could not be checked.

**Measure now:** unique business records; supplier-to-buyer links; observations per
market per month (from `market_observations`); number of price-position views.

---

## Priority (by builder's order)

1. **Proprietary data — strengthen the archive.** Collect prices continuously and make
   the time series visible. It is the hardest moat for a competitor to copy, and it
   already exists.
2. **Network density — measure clusters.** Add the repeat-connection count per zone.
   Density is already partly measured.
3. **Habituation — measure, then remove friction.** Add a client event record for daily
   use, then consider offline writes. Without measurement the habit moat cannot be
   proven.
4. **Reputation — extend the evidence.** Build on verified claims and patron verification.
   Avoid a single score, which the standing module deliberately refuses.

## What this audit did not cover

- Live data volumes, retention and revenue. These need the production database.
- Frontend usability, screenshots and the three-tap flow.
- Any change to the live site. None was made.
