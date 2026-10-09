# The network-first map (v2.8)

**The non-negotiable product rule: a location appearing on the map does not
automatically make it part of the marketplace.**

The v2.7 map fixed *performance*: one screenful, server-side clustering, no
directory dumps. But it drew every layer as an equal citizen — 7,640 external
public-data places could visually outweigh the twenty vendors who actually
trade. A busy map that shows little business value is still the wrong product.
This brief is the commercial correction, scoped to the map surfaces only
(`backend/app/services/map_viewport.py`, `backend/app/routes/map.py`,
`frontend/src/pages/map/MapPage.jsx`, `frontend/src/components/map/*`).

## The three tiers

Every place row is in exactly one tier, and the tier travels with the data —
the client never guesses:

| Tier | Definition | Default treatment |
|---|---|---|
| `network` | claimed places; every vendor account; markets with registered suppliers | visible, full colour, ranked first |
| `external` | unclaimed public-data rows the source still confirms | hidden by default; muted when shown |
| `stale` | unclaimed rows the source has not confirmed for `MAP_PLACE_STALE_DAYS` (180d) | off the commercial map; counted; revalidated or archived |

Membership ground truth: `public_places.claimed_by_vendor_id IS NOT NULL`
(and `status = 'claimed'`). Vendors are network rows by definition — they are
accounts, not scraped facts.

## What each surface now does

- **Viewport** (`GET /api/map/viewport`): `external=hide|muted|only`.
  `hide` is the clean supplier-first map the client opens with; `muted` is the
  honest API default (everything fresh, flagged); `only` is the claim-sourcing
  audit view. Stale rows appear in no mode — `counts.stale` reports them.
- **Ranking**: place pins order network-first, then distance. Vendor pins rank
  by *current offers*: in-stock lines → verification → network score →
  distance. Markets rank working (registered suppliers) before unworked.
- **Counts**: always report the full tier split (`network` / `external` /
  `stale`, `vendors_with_offers`, `markets_networked`) whatever the caller
  asked to draw — a hidden directory is counted, never erased from the truth.
- **Client**: one toggle ("External · 7.5K") flips `hide` ↔ `muted`. External
  pins draw grey and translucent; clusters with any network row draw emerald.
  The list sorts marketplace-first with tier tags.
- **MapSheet**: states the relationship in words — "network", "external · not
  in the network", "no suppliers yet", "the source has not confirmed this
  place in N days" — and offers the matching actions: claim, confirm, report
  gone, be the first supplier.

## Staleness: revalidate, archive — never silently keep

Stale rows are already invisible on the map; the lifecycle stays honest:

1. **Revalidate** — a vendor standing in front of the place confirms it
   (`POST /api/map/places/{id}/report {"verdict":"confirmed"}`): freshness
   moves to now, the row re-enters the map as external. The next OSM ingest
   does the same whenever the source still lists it.
2. **Archive** — a vendor reports it gone, or the sweep
   (`POST /api/map/maintenance/sweep?archive=true`) retires rows quiet for
   `MAP_PLACE_ARCHIVE_DAYS` (365d). Archived ≠ deleted: provenance is kept,
   and the ingest restores the row the day the source lists it again.
3. **Claimed rows are never touched by any of this** — their vendor owns the
   truth about them.

## Deliberate non-goals

- No hard delete: ODbL provenance is worth keeping and disk is cheap.
- No auto-archive on a timer: the sweep is an explicit, capped, dry-run-first
  operation so one deploy cannot rewrite the directory.
- No changes outside map surfaces: markets screens, search and the surface
  feed keep their own contracts.
