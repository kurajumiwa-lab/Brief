# The location layer — pins, H3 cells and cached open data

**Schema:** `0080_location_hex` (`street_lobbies` pins + `geo_hex_cells`).
**Free inputs:** browser GPS / typed place, OpenStreetMap Overpass, Nominatim.
**No map SDK, no Places API, no tile bill.**

## The shape

One coordinate becomes three deterministic H3 strings:

| Resolution | Cell size | Product meaning |
|---|---|---|
| 9 | ~0.1 km² | street block, stage corner |
| 8 | ~0.7 km² | ward / estate |
| 7 | ~5 km² | town |

`app/services/h3_geo.py` is the only module that imports the open-source `h3`
package. Everything else compares strings or uses `grid_disk` to include the
six neighbours.

## How a pin gets in

The existing `/api/outside/location` flow is the source of truth:

1. `navigator.geolocation.getCurrentPosition` on an explicit **Use my
   location** tap;
2. a typed neighbourhood geocoded through the existing free Nominatim helper,
   **or** a pasted Google/WhatsApp map link whose `lat,lng` is read locally;
3. a fallback to the shop's own `geo_lat/geo_lng`;
4. `unset` — a supported state, not an error.

`/api/outside/location` now also returns `{h3: {r9, r8, r7}}`, so a client can
show the grid without a second request.

The street page adds the existing `LocationBar` rather than a second permission
prompt. A denied prompt costs a radius, not the page.

## How matching zooms

`GET /api/street/lobbies` resolves the viewer's point, then queries open tables
in the viewer's res-9/8/7 grid disks (plus unlocated rows and the viewer's own
table). The response names the level that actually had an active table:

```json
{
  "viewer": {"label": "Kondele", "source": "gps",
             "h3": {"r9": "...", "r8": "...", "r7": "..."}},
  "zoom": {"level": "street", "label": "street block", "ring": 1, "matched": 2,
           "note": "Expands street → ward → town only when the nearer ring has a table."}
}
```

Each card carries `distance_km`, `zoom_level` and inspectable
`match_reasons` such as `Same street cell`, `Same ward`, `Almost full`.
Coordinates are never serialised on a public card.

## The empty-state trace

`GET /api/street/context` returns named anchors around the pin:

- **transit** — matatu stages, bus stops, rail stops;
- **commerce** — markets, shops, pharmacies, fuel, banks/ATMs;
- **community** — schools, clinics, places of worship, public offices.

On a cache miss the server asks Overpass once for a 900 m circle, keeps the
named rows, and writes one `geo_hex_cells` snapshot. The next person in the same
res-9 cell gets:

```json
{
  "available": true,
  "label": "Kondele, Kisumu",
  "fixtures": [{"name": "Kondele Market", "kind": "commerce",
                "kind_label": "Market", "distance_m": 80}],
  "groups": {"transit": [], "commerce": [], "community": []},
  "prompts": [{"eyebrow": "Your anchor",
               "title": "80 m from Kondele Market",
               "body": "Use the market name in the table title..."}],
  "cache": {"cached": true, "source": "openstreetmap",
            "refreshed_at": "...", "cell": "..."},
  "attribution": "Data © OpenStreetMap contributors"
}
```

A failed attempt is cached as a failure (`attempted_at`, `last_error`) for a
short cooldown, not retried on every paint.

## Privacy and cost rules

- The public table card carries a distance and a zone, never `geo_lat/geo_lng`.
- The context is a cached snapshot, not a live census; the UI prints the OSM
  attribution.
- No paid map SDK, geocoder or messaging API is on the request path.
- The cache TTL is one day, the retry cooldown 30 minutes, the radius 900 m;
  all three are server settings (`GEO_HEX_*`).
- A missing pin returns `{available: false, reason: "Set a pin..."}`, not a
  guessed city.

## Wiring

- `StreetPage` renders `LocationBar` (GPS or typed) and a **Around your pin**
  card. The card lists the nearest anchors and Mtaa's first prompt.
- Home's static `StreetDoor` remains a door; it makes no location request and
  no ninth navigation tab.
