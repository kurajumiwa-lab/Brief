"""The shelf manifest — shelf names are configuration, not code.

The brief asks for shelves whose "names and availability are configurable
rather than hardcoded into the entire application". Before this, the shelf
titles lived in `frontend/src/config/homeShelves.js` and the app could not
change them without a deploy.

A shelf is declared here as data:

    key          stable id the client caches and the tests assert on
    title        what the shelf is called, in words a person uses
    subtitle     one line of context
    kinds        which content kinds feed it (see feed.KIND_TO_SOURCE)
    scope        how wide it looks: "near" (≤3 km), "town" (≤15 km),
                 "wide" (no distance cut), "any"
    layout       how the client draws it: "row" (carousel) or "grid"
    card         which card renderer the client resolves by name
    see_all      the door into the module's own screen
    empty_state  what to say when there is nothing — including the intentional
                 ones, where an empty shelf teaches you how to participate
    min_items    hide below this many (0 = keep the empty state on purpose)

The client asks for this list (`GET /api/outside/shelves`) and renders
whatever comes back. Adding a shelf is now a data change in one file, not a
new component.
"""

from typing import Optional

# Discovery radii, in km. Named after the product's three bands so a shelf can
# say "this is a nearby shelf" without carrying a number around.
SCOPE_RADIUS = {"near": 3.0, "town": 15.0, "wide": None, "any": None}


def _shelf(key, title, subtitle, kinds, scope="town", card="notice", see_all=None,
           layout="row", empty_state=None, min_items=1, boost=None) -> dict:
    return {
        "key": key,
        "title": title,
        "subtitle": subtitle,
        "kinds": list(kinds),
        "scope": scope,
        "radius_km": SCOPE_RADIUS.get(scope),
        "layout": layout,
        "card": card,
        "see_all": see_all or {},
        "empty_state": empty_state,
        "min_items": int(min_items),
        "boost": boost,
    }


# ── the default manifest ──────────────────────────────────────────────────────
# Order is the order the client shows them. Every one of these is a *browsing
# surface* over records that already exist — none is a mini-application, and
# none has its own onboarding or publishing flow. Creation is one place:
# /create.
DEFAULT_SHELVES: list = [
    _shelf(
        key="happening_around_you",
        title="Happening around you",
        subtitle="Available goods, wanted repairs, scheduled rounds and opportunities nearby",
        kinds=["available", "wanted", "scheduled", "post", "event", "opportunity"],
        scope="near", card="notice",
        see_all={"to": "/explore?scope=near", "label": "See everything nearby"},
        empty_state={
            "title": "Nothing is happening within 3 km yet",
            "body": "You can widen the radius, or be the first to post something.",
            "action": {"label": "Post an activity", "to": "/create"},
        },
        min_items=0,   # an intentional empty state: it teaches the door
    ),
    _shelf(
        key="available_nearby",
        title="Available from neighbours & homesteads",
        subtitle="Surplus produce, fodder, tools to borrow and local collection points",
        kinds=["available", "listing", "rental"],
        scope="town", card="product",
        see_all={"to": "/explore?kind=available", "label": "All available"},
    ),
    _shelf(
        key="wanted_and_repairs",
        title="Wanted & local repairs",
        subtitle="Households and neighbours looking for artisans, fodder, goods or help",
        kinds=["wanted", "opportunity"],
        scope="town", card="opportunity",
        see_all={"to": "/explore?kind=wanted", "label": "All wanted"},
    ),
    _shelf(
        key="scheduled_rounds_and_sessions",
        title="Scheduled rounds & learning",
        subtitle="Travelling artisan rounds, community learning sessions and weekend visits",
        kinds=["scheduled", "event"],
        scope="town", card="event",
        see_all={"to": "/explore?kind=scheduled", "label": "All scheduled"},
    ),
    _shelf(
        key="this_weekend",
        title="This weekend",
        subtitle="Events and gatherings starting in the next few days",
        kinds=["event"],
        scope="town", card="event",
        see_all={"to": "/explore?kind=event&when=weekend", "label": "All events"},
        empty_state={
            "title": "No events this weekend",
            "body": "A house party, a hike or a meetup takes about a minute to set up.",
            "action": {"label": "Plan an event", "to": "/create?type=event"},
        },
        min_items=0,
    ),
    _shelf(
        key="nearby_communities",
        title="Communities near you",
        subtitle="Groups of people who share a place, an interest or an activity",
        kinds=["community"],
        scope="town", card="community",
        see_all={"to": "/explore?kind=community", "label": "Browse communities"},
    ),
    _shelf(
        key="trips_and_adventures",
        title="Trips and adventures",
        subtitle="Outings people are organising, with seats still open",
        kinds=["event"],
        scope="wide", card="event",
        see_all={"to": "/explore?kind=event&category=trip", "label": "All trips"},
        min_items=1,
    ),
    _shelf(
        key="local_services",
        title="Local services",
        subtitle="People who can move, fix, store or deliver things",
        kinds=["service"],
        scope="town", card="service",
        see_all={"to": "/explore?kind=service", "label": "All services"},
    ),
    _shelf(
        key="things_offered",
        title="Things people are offering",
        subtitle="Listings and rentals from people around you — priced or not",
        kinds=["listing", "rental"],
        scope="town", card="product",
        see_all={"to": "/explore?kind=listing", "label": "Browse all"},
    ),
    _shelf(
        key="help_wanted",
        title="Help wanted nearby",
        subtitle="Requests for help, goods, rides and company — money optional",
        kinds=["opportunity"],
        scope="town", card="opportunity",
        see_all={"to": "/explore?kind=opportunity", "label": "All requests"},
        empty_state={
            "title": "Nobody is asking for anything yet",
            "body": "If you need a hand, a ride or a recommendation, say so.",
            "action": {"label": "Ask for help", "to": "/create?type=opportunity"},
        },
        min_items=0,
    ),
    _shelf(
        key="recommended_for_you",
        title="Recommended for you",
        subtitle="Chosen for your interests, your connections and how fresh it is",
        kinds=["post", "event", "community", "collection", "opportunity"],
        scope="wide", card="notice",
        see_all={"to": "/explore", "label": "Open Explore"},
    ),
    _shelf(
        key="recently_active",
        title="Recently active",
        subtitle="What was written in the last day, nearest first",
        kinds=["post", "event", "listing", "opportunity", "community"],
        scope="any", card="notice",
        see_all={"to": "/explore?sort=recent", "label": "Newest first"},
    ),
]


def manifest(shelf_keys: Optional[list] = None) -> dict:
    """The manifest a client renders from.

    `shelf_keys` narrows it (a screen can ask for three shelves); an unknown
    key is ignored rather than an error, so a stale client keeps working.
    """
    shelves = DEFAULT_SHELVES
    if shelf_keys:
        wanted = {str(k) for k in shelf_keys}
        shelves = [s for s in shelves if s["key"] in wanted]
    return {
        "shelves": shelves,
        "scopes": {
            "near": {"label": "Nearby", "radius_km": 3.0,
                     "description": "Immediate neighbourhood updates and nearby activities."},
            "town": {"label": "Around town", "radius_km": 15.0,
                     "description": "More services, events, communities and opportunities."},
            "wide": {"label": "Further out", "radius_km": None,
                     "description": "Trips, specialised goods and communities worth travelling for."},
        },
        "posting_types": ["available", "wanted", "scheduled", "opportunity"],
        "content_types": ["post", "event", "listing", "community", "collection", "opportunity"],
        "create_path": "/create",
    }


__all__ = ["manifest", "DEFAULT_SHELVES", "SCOPE_RADIUS"]
