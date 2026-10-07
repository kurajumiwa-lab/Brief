# The marketplace map — why it hung, and what it is now

*Status: implemented (v2.7). Measurements below were taken against a seeded
7,640-place directory on one API worker with an embedded PostgreSQL 16.*

---

## 1. What was wrong

The map screen called `GET /api/surface/map`, which did this:

```sql
SELECT * FROM public_places WHERE status IN ('active','claimed');   -- 7,640 rows
```

…serialised all 7,640 of them into JSON, and then:

```js
places.forEach((place) => L.marker([place.lat, place.lng]).addTo(map));
```

Three separate costs stack up there, and only the first is visible in a
profiler:

| cost | on a laptop | on a mid-range Android |
|---|---|---|
| JSON payload (7,640 rows × ~180 B) | ~1.4 MB, ~200 ms | 1.4 MB on mobile data, seconds |
| 7,640 Leaflet markers = 7,640 DOM nodes | sluggish | **UI freeze** |
| 7,640 marker icons / popups / images | slow | memory pressure, tab death |

The most important sentence in that table is the middle one. Leaflet is not the
problem — a thousand DOM nodes each with transforms, event listeners and layout
is. And it is also the wrong product: a wall of identical pins tells a trader
nothing.

`/api/surface/map` has been **retired and deleted** — not capped, deleted.
Capping it would have left an endpoint whose only reason to exist is to hand
out the directory, and someone would call it again in six months. The search
hub's place tab now searches server-side (`mapAPI.viewport({scope:"network"})`)
and the map uses `/api/map/viewport`. The client method `surfaceAPI.map` is gone
too, so nothing can call it by accident.

---

## 2. What it does now

```
   phone: bbox + zoom + filters
              │
              ▼
   GET /api/map/viewport ──── indexed bbox range scan
              │                (public_places (lat, lng))
              ▼
   zoom < threshold?  ──yes──▶ SQL grid clusters: count, centroid,
              │                dominant category, 3 sample names
              no
              │
              ▼
   individual pins, capped at MAP_POINT_LIMIT, nearest-to-centre first
              │
              ▼
   ETag / 304 / Cache-Control · 60 s process cache
              │
              ▼
   ~20–200 objects → one <canvas>
```

### Progressive disclosure by zoom

| zoom | tier | what is drawn |
|---|---|---|
| 2–7 | `region` | country/region clusters — *"7.6K places" · "25 markets"* |
| 8–11 | `city` | city and market clusters — *Nairobi 1,240 · Kampala 840* |
| 12–14 | `market` | individual markets and vendors; places still clustered |
| 15+ | `shop` | individual businesses |

Each layer has its own threshold (`MAP_PLACES_POINT_ZOOM=15`,
`MAP_VENDORS_POINT_ZOOM=12`, `MAP_MARKETS_POINT_ZOOM=6`) because the datasets
differ in size by three orders of magnitude: 7,640 places, tens of vendors, 25
markets.

### The cluster grid is screen-sized and world-fixed

A cell is `MAP_CLUSTER_CELL_PX` (96) CSS pixels at the current zoom:

```
cell_lat = 96 × 360 / (256 × 2**zoom)
cell_lng = cell_lat / cos(centre_lat)        # keep cells square on screen
```

Because the grid is fixed in **world** coordinates rather than recomputed per
view, clusters do not jitter while panning — the same shop lands in the same
bubble as you drag past it.

### Endpoints

```
GET /api/map/config                    tiles, zoom thresholds, limits (one call)
GET /api/map/counts                    Markets 25 · Vendors 0 · Places 7.6K + facets
GET /api/map/viewport?bbox&zoom&kind&q&filter&category&scope&limit
GET /api/map/places/{id}               lazy detail, on tap
GET /api/map/vendors/{id}              lazy detail, on tap
GET /api/map/markets/{id}              lazy detail, on tap
```

`counts` reports what is really inside the rectangle (`count(*)`, not an
estimate), so a bubble labelled "1,240 places" is a fact. `truncated: true` says
the pins you can see are a slice, and of how many.

### Counters are filters

`Markets 25 · Vendors 0 · Places 7.6K` are chips. Tapping one sets
`kind=markets` and the server queries **only that dataset** — `viewport_totals`
does not even count the others. One filter on, one dataset read.

### Lazy details, no images

A tapped pin starts a second request for its phone, hours, address, source and
freshness. No photo is fetched on the map, ever: the directory has none, and a
map that pulls an image per pin is the bug we are fixing. When a vendor has
media of their own it belongs on their profile, not on a cluster of 300 bubbles.

### The client

* `preferCanvas: true` + `L.circleMarker` — pins are painted onto one canvas.
  Clusters are the only DOM markers, and only because they must show a number.
* `updateWhenIdle: true`, `updateWhenZooming: false`, `keepBuffer: 1` on the
  tile layer — tiles are requested when the pan stops, not every frame of it.
* `detectRetina: false` — retina tiles are 4× the bytes for a map read on a bus.
* Panning is **debounced 250 ms** and the previous request is **aborted**
  (`AbortController`); a request id stops a slow response from overwriting a
  newer one.
* On a dead connection the last successfully loaded screenful (our own data) is
  shown and labelled *"last loaded area"* — never invented pins.

---

## 3. Measurements (7,640 places, 25 markets, one worker)

```
z6   tier=region  clusters=2    pins=7    in-view=2,142   ~2 kB
z9   tier=city    clusters=5    pins=7    in-view=2,142   ~3 kB
z12  tier=market  clusters=52   pins=10   in-view=2,142  ~14 kB
z13  tier=market  clusters=148  pins=10   in-view=2,142  ~40 kB
z15  tier=shop    clusters=0    pins=210  in-view=2,142  ~50 kB   (cap 200/layer)
```

| | before | after |
|---|---|---|
| payload for one screen | ~1.4 MB | 2–50 kB |
| DOM nodes on the map | 7,640+ | 0–150 |
| pins held in memory | 7,640 | ≤ 200 per layer |
| viewport query (cold / warm) | n/a | ~17 ms / ~10 ms |
| repeat pan | n/a | 304, 0 bytes |

The count query the chips rely on, on the same seeded table:

```
Bitmap Index Scan on ix_public_places_mappable_lat_lng
  Index Cond: (lat >= … AND lat <= … AND lng >= … AND lng <= …)
  Execution Time: 0.839 ms
```

---

## 4. Spatial indexes: btree now, PostGIS when you need it

`alembic upgrade head` (revision `0011_map_viewport_indexes`) installs:

```sql
CREATE INDEX ix_public_places_lat_lng            ON public_places (lat, lng);
CREATE INDEX ix_public_places_mappable_lat_lng   ON public_places (lat, lng)
  WHERE status IN ('active','claimed');          -- partial: only drawable rows
CREATE INDEX ix_public_places_zone_mappable      ON public_places (zone_id) WHERE …;
CREATE INDEX ix_public_places_category           ON public_places (category) WHERE …;
CREATE INDEX ix_vendors_geo_lat_lng              ON vendors (geo_lat, geo_lng);
CREATE INDEX ix_market_zones_center              ON market_zones (center_lat, center_lng);
CREATE INDEX ix_stock_items_vendor_visible       ON stock_items (vendor_id)
  WHERE visible_to_network IS TRUE;
```

A bounding box is two range scans; a composite btree on `(lat, lng)` is exactly
the index for that, and Postgres combines it with the `status` filter on the
partial index. The DDL lives once in `backend/app/map_indexes.py` and is applied
by both `init_db()` (dev) and the migration (production), so the two paths
cannot drift — the pattern `app/db_triggers.py` already established.

**Why not require PostGIS?** Plenty of managed Postgres instances (including the
cheapest tiers) have no PostGIS, and a marketplace should not need an extension
to draw a rectangle. If you run PostGIS, you can have the GIST index too — it is
one command, and it becomes the better tool the moment you need polygon geometry
or `ST_DWithin` radius searches:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
ALTER TABLE public_places ADD COLUMN IF NOT EXISTS location geometry(Point, 4326);
UPDATE public_places
   SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
 WHERE location IS NULL;
CREATE INDEX places_location_idx ON public_places USING GIST (location);
-- then: WHERE ST_Intersects(location, ST_MakeEnvelope(:w,:s,:e,:n, 4326))
```

Keep it maintained with a trigger (`location := ST_SetSRID(ST_MakePoint(NEW.lng,
NEW.lat), 4326)` on insert/update) or write through a view. Nothing in the app
has to change: the query builders already emit a `WHERE` fragment per layer.

---

## 5. Tiles: MapTiler by default, everything else one setting away

The public OpenStreetMap tile server is community-funded, rate-limited, and its
[tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
explicitly prohibits bulk downloading and heavy use; the Foundation blocks
applications that cause excessive load. It is a fine development default and a
bad production dependency.

**Chosen backend: MapTiler** (`MAP_TILE_PROVIDER=maptiler`, or leave `auto` and
set `MAP_TILE_KEY`). Why this one:

* **OSM-derived**, so the directory and the basemap share a licence (ODbL) and
  the same attribution string is correct for both.
* **Raster tiles that drop straight into Leaflet** — no renderer swap, no
  MapLibre GL dependency, no style JSON to maintain.
* **Keyed, with a free tier and a global CDN**, so it scales from pilot to
  production without an infrastructure project.
* **A documented exit** — the tiles are OpenMapTiles/OSM schema, so moving to a
  self-hosted `tileserver-gl` later is a URL change, not a rewrite.

The provider is resolved server-side (`app/services/tile_providers.py`) and
served to the client by `/api/map/config`, together with the attribution its
licence requires. The phone never hardcodes a tile URL.

```
MAP_TILE_PROVIDER=auto     # maptiler when MAP_TILE_KEY is set, else osm (dev)
MAP_TILE_KEY=…             # fills {key} in the provider template
MAP_TILE_URL=…             # optional override: your own tile stack
MAP_TILE_ATTRIBUTION=…     # optional override: its licence credit
```

| provider | setting | notes |
|---|---|---|
| `osm` *(dev only)* | `MAP_TILE_PROVIDER=osm` | public OSM tiles — development |
| **`maptiler`** *(default)* | `MAP_TILE_PROVIDER=maptiler` + key | chosen: OSM-derived raster, free tier |
| `stadia` | `+ MAP_TILE_KEY` | OSM-derived, free for non-commercial/dev |
| `thunderforest` | `+ MAP_TILE_KEY` | OSM-derived, several styles |
| `custom` | `MAP_TILE_URL=…` | self-hosted `tileserver-gl` / `tegola` / Martin |
| **vector tiles** | future | the most efficient at this density, but needs a GL renderer (MapLibre) — see below |

Safety rails:

* A keyed provider with **no key** falls back to the dev tiles and is reported as
  `key_missing` with a `warning` — the client is never handed a URL that can only
  401.
* An **unknown** provider label degrades to `osm` (or `custom` when
  `MAP_TILE_URL` is set) instead of 500-ing the map.
* `{r}` (retina) placeholders are stripped: 4× the bytes for a map read on
  mobile data.
* `/api/ops/status` keeps reporting `tile_dev_only` / `tile_warning` until the
  dev backend is replaced.

**Vector tiles** are the better long-term answer at this density — the basemap
and the marketplace layers render together, so there are no per-marker DOM nodes
at all — but they need a GL renderer (MapLibre GL JS) rather than Leaflet's tile
layer. That is an engine swap, not a config change, so it is deliberately not in
this pass; the `custom` preset already points at whatever you serve.

Attribution is not optional: the directory rows are derived from OpenStreetMap
under the **ODbL**, which requires the credit wherever the data is shown. It is
served by `/api/map/config`, printed under the map, and repeated in every place
detail response.

---

## 6. Offline: what we cache, and what we refuse to

* **Cached:** the last few screenfuls of *our own* data (a handful of entries in
  `localStorage`, ≤6), shown with a *"last loaded area"* badge when a request
  fails. Small, honest, and labelled.
* **Not cached, ever:** map tiles. Bulk-downloading the public OSM tile servers
  is precisely what their policy forbids, so an offline *basemap* has to come
  from a licensed provider that permits it. The client also does not pre-fetch
  tiles for an area the user has not looked at.

---

## 7. Reproducing the scale

```bash
python backend/seed_demo.py         # vendors, stock, movements, deals
python backend/seed_map_demo.py     # 7,640 places clustered around 25 real markets
```

`seed_map_demo.py` writes **generated** rows (volume and shape, not provenance)
tagged `source='openstreetmap'` exactly like a real ingest row, so the UI treats
them as it treats live data: unverified until a vendor claims one.

---

## 8. What is deliberately *not* done

* **No client-side marker clustering library.** Clustering is a data problem;
  doing it server-side means the phone never downloads what it will collapse.
* **No photo pipeline on the map.** See §2.
* **No PostGIS requirement.** See §4.
* **No tile pre-fetching or offline tile packs.** See §6.
* **No background loading of the whole directory "to make search instant".**
  Search is a server-side query (`scope=network&q=…`), and the hook refuses to
  ask for the whole network without a search term of at least two characters.
