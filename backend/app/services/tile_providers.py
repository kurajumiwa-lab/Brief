"""Tile backends — one setting, no frontend release, no licence surprises.

The public OpenStreetMap tile server (`tile.openstreetmap.org`) is run by the
OSMF on donated hardware. Its
[tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
requires caching and a valid User-Agent, caps heavy use, and **prohibits bulk
downloading** — the Foundation blocks applications that cause excessive load.
It is a generous development default and a bad production dependency.

So the backend is chosen here, in one setting, and served to the client by
`GET /api/map/config` along with the attribution that licence requires. The
phone never hardcodes a tile URL, which means:

* swapping providers is a deploy-time change, not a release;
* the ODbL credit can never drift from the tiles actually being drawn;
* a provider that needs a key is never handed to the client empty.

Chosen default: **MapTiler** (`provider=maptiler`, or `auto` + `MAP_TILE_KEY`).
It is OSM-derived, serves raster tiles that drop straight into Leaflet with no
renderer change, has a free tier, a global CDN, and a documented self-host
migration (OpenMapTiles + `tileserver-gl`) once tile volume makes hosting your
own cheaper than paying per 1,000 requests. The alternatives below are one
setting away — the point of this module is that none of them is a rewrite.

Placeholders in a URL template: `{z}` `{x}` `{y}` `{s}` (subdomain) `{r}`
(retina suffix, rendered as "" — see `docs/briefs/map-performance.md` §5) and
`{key}`.
"""

from dataclasses import dataclass
from typing import Dict, List, Optional

# The dev default, and the fallback whenever a keyed provider has no key.
OSM_DEVO_ONLY_NOTE = (
    "Public OpenStreetMap tiles are community-funded, rate-limited and "
    "forbid bulk downloading. Fine for development, not a production "
    "backend — set MAP_TILE_PROVIDER (and MAP_TILE_KEY) before launch."
)


@dataclass(frozen=True)
class TileProvider:
    key: str
    label: str
    url: str
    attribution: str
    subdomains: str = ""
    min_zoom: int = 2
    max_zoom: int = 19
    requires_key: bool = False
    kind: str = "raster"          # raster | vector
    dev_only: bool = False
    note: str = ""

    def resolved_url(self, api_key: str = "") -> str:
        """Fill `{key}` — and drop `{r}` (we do not fetch retina tiles: 4× the
        bytes for a map read on mobile data)."""
        url = self.url
        if "{key}" in url:
            url = url.replace("{key}", api_key or "")
        return url.replace("{r}", "")

    def as_config(self, api_key: str = "") -> Dict[str, object]:
        missing = self.requires_key and not api_key
        return {
            "provider": self.key,
            "label": self.label,
            "url": self.resolved_url(api_key),
            "attribution": self.attribution,
            "subdomains": self.subdomains,
            "min_zoom": self.min_zoom,
            "max_zoom": self.max_zoom,
            "kind": self.kind,
            "requires_key": self.requires_key,
            "key_missing": missing,
            "dev_only": self.dev_only,
            "note": self.note,
        }


PROVIDERS: Dict[str, TileProvider] = {
    # ── development ─────────────────────────────────────────────────────────
    "osm": TileProvider(
        key="osm",
        label="OpenStreetMap (public tile server)",
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL)',
        dev_only=True,
        note=OSM_DEVO_ONLY_NOTE,
    ),

    # ── chosen production default: OSM-derived, raster, keyed ───────────────
    "maptiler": TileProvider(
        key="maptiler",
        label="MapTiler (OSM-derived)",
        url="https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key={key}",
        attribution=(
            '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noreferrer">&copy; MapTiler</a> '
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL)'
        ),
        max_zoom=19,
        requires_key=True,
        note="OSM-derived raster tiles. Free tier; self-host with OpenMapTiles + tileserver-gl when volume makes it cheaper.",
    ),

    # ── alternatives, one setting away ──────────────────────────────────────
    "stadia": TileProvider(
        key="stadia",
        label="Stadia Maps (OSM-derived)",
        url="https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}{r}.png?api_key={key}",
        attribution=(
            '&copy; <a href="https://www.stadiamaps.com/" target="_blank" rel="noreferrer">Stadia Maps</a> '
            '&copy; <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> '
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL)'
        ),
        max_zoom=20,
        requires_key=True,
        note="OSM-derived; free for non-commercial and registered development use.",
    ),
    "thunderforest": TileProvider(
        key="thunderforest",
        label="Thunderforest (OSM-derived)",
        url="https://tile.thunderforest.com/atlas/{z}/{x}/{y}.png?apikey={key}",
        attribution=(
            '&copy; <a href="https://www.thunderforest.com/" target="_blank" rel="noreferrer">Thunderforest</a> '
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL)'
        ),
        max_zoom=19,
        requires_key=True,
        note="OSM-derived, several styles; keyed, metered.",
    ),
    "custom": TileProvider(
        key="custom",
        label="Self-hosted / custom",
        # Overridden by MAP_TILE_URL when set; this is the placeholder that makes
        # "point it at your own tileserver-gl" a single variable.
        url="http://localhost:8080/styles/basic-preview/{z}/{x}/{y}.png",
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL)',
        note="Your own tile stack (tileserver-gl, tegola, Martin). Set MAP_TILE_URL and MAP_TILE_ATTRIBUTION.",
    ),
}


def available() -> List[Dict[str, object]]:
    return [{"value": p.key, "label": p.label, "requires_key": p.requires_key,
             "kind": p.kind, "dev_only": p.dev_only} for p in PROVIDERS.values()]


def resolve(
    provider: str,
    api_key: str = "",
    url_override: str = "",
    attribution_override: str = "",
) -> TileProvider:
    """`provider` → a usable TileProvider.

    `auto` picks MapTiler when a key is configured and the public OSM server
    otherwise, so a fresh checkout works with no signup and a production deploy
    is one variable away. A keyed provider without a key falls back to OSM and
    is reported as `key_missing` by `/api/map/config` — the client is never
    handed a URL that can only 401.
    """
    key = (provider or "auto").strip().lower()

    if key in ("", "auto"):
        key = "maptiler" if api_key else "osm"

    chosen = PROVIDERS.get(key)
    if chosen is None:
        # Unknown label: treat it as a custom backend rather than 500-ing the map.
        chosen = PROVIDERS["custom"] if url_override else PROVIDERS["osm"]
    elif chosen.requires_key and not api_key and not url_override:
        chosen = PROVIDERS["osm"]

    if url_override:
        chosen = TileProvider(
            key=chosen.key,
            label=chosen.label if chosen.key != "custom" else "Self-hosted / custom",
            url=url_override,
            attribution=attribution_override or chosen.attribution,
            subdomains=chosen.subdomains,
            min_zoom=chosen.min_zoom,
            max_zoom=chosen.max_zoom,
            requires_key=False,
            kind=chosen.kind,
            dev_only=False,
            note=attribution_override and chosen.note or chosen.note,
        )
    return chosen


def tile_config(
    provider: str,
    api_key: str = "",
    url_override: str = "",
    attribution_override: str = "",
    min_zoom: Optional[int] = None,
    max_zoom: Optional[int] = None,
) -> Dict[str, object]:
    """The `/api/map/config` payload for the tiles — resolved, never empty."""
    resolved = resolve(provider, api_key, url_override, attribution_override)
    out = resolved.as_config(api_key)
    # `key_missing` describes what was ASKED for, not what we fell back to —
    # otherwise a fallback hides the misconfiguration it was meant to report.
    requested = PROVIDERS.get((provider or "auto").strip().lower())
    out["key_missing"] = bool(
        requested and requested.requires_key and not api_key and not url_override
    )
    out["requested_provider"] = requested.key if requested else (provider or "auto")
    if min_zoom is not None and min_zoom != PROVIDERS["osm"].min_zoom:
        out["min_zoom"] = min_zoom
    if max_zoom is not None and max_zoom != resolved.max_zoom:
        out["max_zoom"] = max_zoom
    if out["key_missing"]:
        out["warning"] = (
            f"{requested.label} needs MAP_TILE_KEY — serving the development "
            f"tiles instead."
        )
    elif resolved.dev_only:
        out["warning"] = OSM_DEVO_ONLY_NOTE
    elif resolved.requires_key and not api_key:
        out["warning"] = f"{resolved.label} needs MAP_TILE_KEY."
    return out
