"""Outside — location-aware social discovery, layered over the existing network.

The module is deliberately thin. It owns four tables (see `models.py`) and reads
everything else through the adapters in `feed.py`, so there is no second
database, no sync job and no shadow copy of events, listings or communities.

Public interface:

    from app.modules.outside import router, feed, publish, shelves, ranking
    publish.publish(db, vendor, payload)          # one creation path, six types
    feed.build_feed(db, viewer, ...)              # one ranked, paged contract
    shelves.manifest()                            # shelf names as configuration
    ranking.score_item(item, RankContext(...))    # pure, unit-testable
"""

from app.modules.outside import feed, models, publish, ranking, router, shelves  # noqa: F401

__all__ = ["feed", "models", "publish", "ranking", "router", "shelves"]
