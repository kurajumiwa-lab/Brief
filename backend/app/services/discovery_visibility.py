"""Common discovery predicates. Direct links and personal history are separate."""
from datetime import timedelta
from sqlalchemy import and_, func, or_


def active_window(now, *, starts_at=None, expires_at=None):
    conditions = []
    if expires_at is not None:
        conditions.append(or_(expires_at.is_(None), expires_at > now))
    if starts_at is not None:
        conditions.append(or_(starts_at.is_(None), starts_at >= now - timedelta(hours=6)))
    return and_(*conditions)


def scheduled_event_window(now, start):
    # start + 6h > now; the actual end time remains available for logistics.
    return start > now - timedelta(hours=6)


def discoverable(vendor):
    # Absent key means legacy/default ON. This setting controls discovery, not
    # a deliberately shared profile, booking history, or direct links.
    return func.coalesce(vendor.public_page['discoverable'].as_boolean(), True).is_(True)
