"""Privacy & household location controls for the Local Activity Ledger.

Core guarantees (§8, §10.4, implementation guardrails):
  1. Public household/homestead activities expose approximate area coordinates
     only (`round(coord, 2)` ≈ 1.1 km grid), never exact house/gate pins.
  2. `private_directions` on an activity is ONLY visible to:
       - the organizer who wrote it, OR
       - a participant with an ACTIVE confirmed booking (`agreed`, `in_progress`,
         `organizer_completed`, `participant_completed`) where
         `share_private_directions=True`.
     The moment a booking transitions to `completed` or `cancelled`, temporary
     access to `private_directions` automatically closes so the reusable record
     preserves household privacy.
  3. `private_stop_directions` on a travelling-artisan round request is ONLY
     visible to the household that wrote it and (while shortlisted/active) the
     round's artisan — never to other households on the same round, and
     automatically redacted again once the stop is completed.
"""

from typing import Iterable, Optional
from uuid import UUID

from app.modules.ledger.models import ActivityBooking, ActivityResponse, LocalActivity

ACTIVE_DIRECTION_BOOKING_STATUSES = {
    "agreed",
    "in_progress",
    "organizer_completed",
    "participant_completed",
}


def public_coordinates(
    lat: Optional[float],
    lng: Optional[float],
    geo_precision: str,
    authorized_exact: bool = False,
) -> tuple[Optional[float], Optional[float]]:
    if lat is None or lng is None or geo_precision == "none":
        return None, None
    if geo_precision == "exact" or (geo_precision == "exact_for_confirmed" and authorized_exact):
        return float(lat), float(lng)
    # Approximate (~1.1 km grid) protects homesteads and residential gates.
    return round(float(lat), 2), round(float(lng), 2)


def can_view_private_directions(
    activity: LocalActivity,
    viewer_id: Optional[UUID],
    bookings: Iterable[ActivityBooking] = (),
) -> bool:
    if viewer_id is None:
        return False
    if activity.organizer_vendor_id == viewer_id:
        return True
    for b in bookings:
        if (
            b.participant_vendor_id == viewer_id
            and bool(b.share_private_directions)
            and b.status in ACTIVE_DIRECTION_BOOKING_STATUSES
        ):
            return True
    return False


def can_view_stop_directions(
    response: ActivityResponse,
    activity: LocalActivity,
    viewer_id: Optional[UUID],
    booking: Optional[ActivityBooking] = None,
) -> bool:
    if viewer_id is None:
        return False
    if response.responder_vendor_id == viewer_id:
        return True
    if activity.organizer_vendor_id == viewer_id:
        if booking is not None:
            # Once the stop is completed or cancelled, household gate details
            # are redacted from the artisan's ongoing view as well.
            return booking.status in ACTIVE_DIRECTION_BOOKING_STATUSES
        return response.status in ("submitted", "shortlisted", "accepted")
    return False


__all__ = [
    "ACTIVE_DIRECTION_BOOKING_STATUSES",
    "public_coordinates",
    "can_view_private_directions",
    "can_view_stop_directions",
]
