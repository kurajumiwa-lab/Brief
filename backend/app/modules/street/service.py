"""The calendar, the tables and the story guide.

Three deterministic surfaces, one rule between them: **Brief introduces, the
people close.** Nothing here books a slot, sends a message, or touches money.

  · The calendar is a rule, not a campaign. A season is a quarter; a script is
    a weekday and an hour. Both can be recomputed from the clock, so a missed
    cron pass does not mean a missed Monday.
  · A table is a row with an expiry. The host states one need, one zone, a
    few tags and how long the table stays open. Contact is released only to a
    person who joins; the public list carries a match reason, never a number.
  · The guide reads what the person has actually done (profile, stock, weekly
    rhythm, tables, completed trades) and offers the next small chapter. It
    does not rank people by spend.
"""

from __future__ import annotations

import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional
from urllib.parse import quote
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import NotificationType
from app.models.stock import StockItem
from app.models.vendor import Vendor
from app.modules.outside.models import OutsideDiscoveryPref
from app.modules.pulse import service as pulse_service
from app.modules.routines.models import RecurringRoutine
from app.modules.routines.service import next_occurrence, weekly_label
from app.modules.street.models import (
    HANDOFF_CHANNELS, INTENT_LABELS, INTENTS, StreetBroadcast, StreetLobby,
    StreetLobbyMember,
)
from app.services import h3_geo, hex_context
from app.services.notification_service import create_notification
from app.services.routing import haversine_km

NAIROBI = ZoneInfo("Africa/Nairobi")

# ── calendar ─────────────────────────────────────────────────────────────────
# Four economic seasons. They reset on the quarter, which is long enough for a
# table to fill and short enough that a slow month does not define the year.
SEASONS = (
    {
        "key": "restock_reset", "label": "Restock & Reset", "months": (1, 2, 3),
        "chapter": "Season 1", "accent": "#1F7A66",
        "focus": "First-quarter stock, school opening and fresh leads.",
        "prompt": "Put one thing on the shelf that people will need this month. "
                  "Then ask one nearby business what they are short of.",
        "tags": ("restock", "school", "new-year"),
    },
    {
        "key": "long_rains_build", "label": "Long Rains Build", "months": (4, 5, 6),
        "chapter": "Season 2", "accent": "#5265E8",
        "focus": "Indoor work, pooled delivery runs and mid-year contracts.",
        "prompt": "The rain changes the route. Open a table for a shared delivery "
                  "or a service that works indoors.",
        "tags": ("delivery", "services", "contracts"),
    },
    {
        "key": "chamaa_term", "label": "Chamaa & Term Time", "months": (7, 8, 9),
        "chapter": "Season 3", "accent": "#D97706",
        "focus": "Term-two stock, group buying and chamaa settlement.",
        "prompt": "A group that already meets is a market. Put a co-buy on the "
                  "table before the next sitting.",
        "tags": ("co-buy", "chamaa", "school"),
    },
    {
        "key": "festive_push", "label": "Festive Market Push", "months": (10, 11, 12),
        "chapter": "Season 4", "accent": "#E8552F",
        "focus": "End-year gifting, hospitality, events and last-mile runs.",
        "prompt": "The street is busiest when it is specific. Name the item, "
                  "the zone and the hour — not 'deals available'.",
        "tags": ("festive", "events", "hospitality"),
    },
)

# One script per weekday. The hour is local EAT, so it reads the same in Kisumu
# and Mombasa. A script is a prompt, never an automatic post.
SCRIPTS = (
    {
        "key": "monday_declare", "weekday": 0, "hour": 7, "minute": 0,
        "label": "Declare the week", "zone_label": "Monday · 07:00",
        "title": "What are you putting on the shelf this week?",
        "detail": "Say what you have, what you need, or the one job you will finish. "
                  "A clear Monday makes Wednesday's match possible.",
        "cta": "Publish what you have", "href": "/create",
    },
    {
        "key": "wednesday_match", "weekday": 2, "hour": 12, "minute": 0,
        "label": "Match day", "zone_label": "Wednesday · 12:00",
        "title": "Two people need the same thing. Are you one of them?",
        "detail": "Open a two-hour table for a co-buy, a source, a delivery or a quick job.",
        "cta": "Open a table", "href": "/street?open=1",
    },
    {
        "key": "thursday_pool", "weekday": 3, "hour": 16, "minute": 0,
        "label": "Pool the run", "zone_label": "Thursday · 16:00",
        "title": "Tomorrow's run is cheaper with one more stop.",
        "detail": "Pool transport or split a delivery before the Friday market moves.",
        "cta": "Find a run", "href": "/logistics",
    },
    {
        "key": "friday_board", "weekday": 4, "hour": 15, "minute": 0,
        "label": "Set the weekend board", "zone_label": "Friday · 15:00",
        "title": "Put the weekend where people can see it.",
        "detail": "Post the meet-up, the event table or the Saturday service while "
                  "people are still planning.",
        "cta": "Post the weekend", "href": "/events",
    },
    {
        "key": "saturday_market", "weekday": 5, "hour": 6, "minute": 30,
        "label": "Market run", "zone_label": "Saturday · 06:30",
        "title": "The market is already moving. Who is on the same route?",
        "detail": "Take one look at the live tables and the region feed before you set off.",
        "cta": "See what is live", "href": "/regions",
    },
    {
        "key": "sunday_close", "weekday": 6, "hour": 18, "minute": 0,
        "label": "Close the week", "zone_label": "Sunday · 18:00",
        "title": "Close the loop before the week closes you.",
        "detail": "Confirm what moved, note what did not, and leave one clear promise for Monday.",
        "cta": "Check the record", "href": "/orders/records",
    },
)
PHONE_RE = re.compile(r"^254[17]\d{8}$")
TELEGRAM_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{4,31}$")


class StreetError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: Optional[datetime] = None) -> datetime:
    moment = value or now_utc()
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _local(value: Optional[datetime] = None) -> datetime:
    return _aware(value).astimezone(NAIROBI)


def _iso(value: Optional[datetime]) -> Optional[str]:
    return _aware(value).isoformat() if value else None


def _point(lat: Optional[float], lng: Optional[float], *, label: Optional[str] = None,
           source: str = "request") -> Optional[dict]:
    if not h3_geo.valid_point(lat, lng):
        return None
    info = h3_geo.describe(float(lat), float(lng))
    return {
        "lat": float(lat),
        "lng": float(lng),
        "label": label,
        "source": source,
        **info,
    }


async def viewer_point(db: AsyncSession, vendor: Vendor) -> Optional[dict]:
    """Where this person is looking.

    The discovery preference wins because the person set it deliberately, then
    the shop's own coordinates. A missing point is a supported state: tables
    still match on zone text, and the UI asks for a pin.
    """
    prefs = (await db.execute(
        select(OutsideDiscoveryPref).where(OutsideDiscoveryPref.vendor_id == vendor.id)
    )).scalar_one_or_none()
    if prefs is not None and h3_geo.valid_point(prefs.geo_lat, prefs.geo_lng):
        return _point(prefs.geo_lat, prefs.geo_lng, label=prefs.label,
                      source=prefs.source or "manual")
    if h3_geo.valid_point(vendor.geo_lat, vendor.geo_lng):
        return _point(vendor.geo_lat, vendor.geo_lng, label=vendor.physical_location,
                      source="vendor_profile")
    return None


def _viewer_out(point: Optional[dict]) -> Optional[dict]:
    if not point:
        return None
    return {
        "label": point.get("label"),
        "source": point.get("source"),
        "h3": {"r9": point["h3_r9"], "r8": point["h3_r8"], "r7": point["h3_r7"]},
    }


def _level_for(lobby: StreetLobby, point: Optional[dict]) -> str:
    if not point or not lobby.h3_r9:
        return "unlocated"
    if lobby.h3_r9 in point["rings"]["r9"]:
        return "street"
    if lobby.h3_r8 in point["rings"]["r8"]:
        return "ward"
    if lobby.h3_r7 in point["rings"]["r7"]:
        return "town"
    return "region"


def _add_months(year: int, month: int, delta: int) -> tuple[int, int]:
    index = year * 12 + (month - 1) + delta
    return index // 12, index % 12 + 1


def season_for(now: Optional[datetime] = None) -> dict:
    """The current quarter, in local time, with the next reset date."""
    local = _local(now)
    quarter = (local.month - 1) // 3
    start_month = quarter * 3 + 1
    end_year, end_month = _add_months(local.year, start_month, 3)
    start = datetime(local.year, start_month, 1, tzinfo=NAIROBI)
    end = datetime(end_year, end_month, 1, tzinfo=NAIROBI) - timedelta(seconds=1)
    total_days = max(1, (end.date() - start.date()).days + 1)
    day_number = min(total_days, max(1, (local.date() - start.date()).days + 1))
    season = next(s for s in SEASONS if local.month in s["months"])
    return {
        "key": season["key"],
        "label": season["label"],
        "chapter": season["chapter"],
        "focus": season["focus"],
        "prompt": season["prompt"],
        "tags": list(season["tags"]),
        "accent": season["accent"],
        "starts_at": start.isoformat(),
        "ends_at": end.isoformat(),
        "days_left": max(0, (end.date() - local.date()).days + 1),
        "week": min(13, (day_number - 1) // 7 + 1),
        "progress_pct": round(100 * day_number / total_days, 1),
        "reset_note": "The season changes with the quarter. Points are a guide to "
                      "what you finished, never a price for visibility.",
    }


def _script_occurrence(script: dict, local: datetime, *, next_only: bool = False) -> datetime:
    day_delta = (int(script["weekday"]) - local.weekday()) % 7
    candidate = datetime(
        local.year, local.month, local.day, int(script["hour"]), int(script["minute"]),
        tzinfo=NAIROBI,
    ) + timedelta(days=day_delta)
    if next_only and candidate <= local:
        candidate += timedelta(days=7)
    return candidate


def _script_state(script: dict, local: datetime) -> tuple[str, datetime]:
    at = _script_occurrence(script, local)
    if local.date() != at.date():
        return ("upcoming", at)
    if local < at:
        return ("upcoming", at)
    if local <= at + timedelta(hours=3):
        return ("live", at)
    return ("done", at)


def today_script(now: Optional[datetime] = None) -> Optional[dict]:
    local = _local(now)
    script = next((s for s in SCRIPTS if s["weekday"] == local.weekday()), None)
    if script is None:
        return None
    state, at = _script_state(script, local)
    return {**script, "state": state, "at": at.isoformat()}


def upcoming_scripts(now: Optional[datetime] = None, limit: int = 6) -> list[dict]:
    local = _local(now)
    rows = []
    for script in SCRIPTS:
        at = _script_occurrence(script, local, next_only=True)
        rows.append((at, script))
    rows.sort(key=lambda row: row[0])
    return [
        {**script, "at": at.isoformat(), "state": "upcoming"}
        for at, script in rows[:max(1, min(limit, 12))]
    ]


def _broadcast_out(row: StreetBroadcast) -> dict:
    return {
        "script_key": row.script_key,
        "run_date": row.run_date.isoformat(),
        "season_key": row.season_key,
        "title": row.title,
        "detail": row.detail,
        "href": row.href,
        "published_at": _iso(row.published_at),
    }


async def publish_due(db: AsyncSession, now: Optional[datetime] = None) -> int:
    """Stamp each weekday script once, while its live window is open.

    Idempotent by `(script_key, run_date)`: a restart, a second worker or a
    duplicate pass cannot publish the same Monday twice. A missed pass does not
    hide the prompt — the deterministic calendar still shows it as scheduled.
    """
    local = _local(now)
    season = season_for(local)
    published = 0
    for script in SCRIPTS:
        state, _ = _script_state(script, local)
        if state != "live":
            continue
        row = (await db.execute(
            pg_insert(StreetBroadcast)
            .values(
                script_key=script["key"],
                run_date=local.date(),
                season_key=season["key"],
                title=script["title"],
                detail=script["detail"],
                href=script["href"],
                published_at=_aware(now),
            )
            .on_conflict_do_nothing(constraint="uq_street_broadcast_day")
            .returning(StreetBroadcast.id)
        )).scalar_one_or_none()
        if row:
            published += 1
    return published


async def _broadcasts_today(db: AsyncSession, local: datetime) -> list[StreetBroadcast]:
    return (await db.execute(
        select(StreetBroadcast)
        .where(StreetBroadcast.run_date == local.date())
        .order_by(StreetBroadcast.published_at.asc())
    )).scalars().all()


async def _my_timetable(db: AsyncSession, vendor: Vendor, now: datetime) -> list[dict]:
    rows = (await db.execute(
        select(RecurringRoutine)
        .where(RecurringRoutine.owner_user_id == vendor.id, RecurringRoutine.is_active.is_(True))
        .order_by(RecurringRoutine.day_of_week.asc(), RecurringRoutine.start_time_local.asc())
        .limit(20)
    )).scalars().all()
    out = []
    for routine in rows:
        at = next_occurrence(now, routine.day_of_week, routine.start_time_local)
        out.append({
            "id": str(routine.id),
            "title": routine.title,
            "kind": routine.kind,
            "town": routine.town,
            "recurrence_label": weekly_label(routine.day_of_week),
            "next_at": at.isoformat(),
            "next_label": at.strftime("%a · %H:%M"),
        })
    out.sort(key=lambda row: row["next_at"])
    return out


async def calendar(db: AsyncSession, vendor: Vendor, now: Optional[datetime] = None) -> dict:
    moment = _aware(now)
    local = _local(moment)
    broadcasts = await _broadcasts_today(db, local)
    by_key = {row.script_key: row for row in broadcasts}
    today = today_script(moment)
    if today:
        stamped = by_key.get(today["key"])
        today["broadcast_at"] = _iso(stamped.published_at) if stamped else None
        today["official"] = bool(stamped)
    return {
        "now": local.isoformat(),
        "timezone": "Africa/Nairobi",
        "season": season_for(moment),
        "today": today,
        "upcoming": upcoming_scripts(moment, limit=6),
        "timetable": await _my_timetable(db, vendor, moment),
        "pulse": pulse_service.pulse(moment),
        "broadcasts": [_broadcast_out(row) for row in broadcasts],
        "note": "A script is a prompt, not an automatic post. No message is sent "
                "on your behalf; the broadcast stamp only records that the "
                "scheduled slot opened.",
    }


# ── handoff ──────────────────────────────────────────────────────────────────

def _normalise_phone(value: str) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    if digits.startswith("0"):
        digits = "254" + digits[1:]
    if not PHONE_RE.fullmatch(digits):
        raise StreetError("Enter a Kenyan WhatsApp number, for example 0712 345 678.", 422)
    return digits


def _normalise_telegram(value: str) -> str:
    handle = str(value or "").strip().lstrip("@")
    if not TELEGRAM_RE.fullmatch(handle):
        raise StreetError("Enter a Telegram username with 5–32 letters, numbers or underscores.", 422)
    return handle


def _clean_tags(tags: Optional[Iterable[str]]) -> list[str]:
    if tags is None:
        return []
    if not isinstance(tags, (list, tuple)):
        raise StreetError("Tags must be a list.", 422)
    cleaned: list[str] = []
    for raw in tags:
        tag = " ".join(str(raw or "").strip().lower().split())[:24]
        if tag and tag not in cleaned:
            cleaned.append(tag)
    if len(cleaned) > 8:
        raise StreetError("Add up to eight tags.", 422)
    return cleaned


def _handoff(lobby: StreetLobby, host: Vendor, guest: Optional[Vendor]) -> dict:
    code = lobby.verification_code
    guest_name = (guest.business_name or guest.vendor_handle) if guest else "someone"
    text = (
        f"Brief table {code}: {lobby.title}. {lobby.zone}. "
        f"{guest_name} matched with you on Brief. Reply with {code} so you both "
        f"know it is the same table."
    )
    if lobby.handoff_channel == "whatsapp":
        phone = _normalise_phone(lobby.handoff_target)
        url = f"https://wa.me/{phone}?text={quote(text)}"
        label = "Open WhatsApp"
    else:
        handle = _normalise_telegram(lobby.handoff_target)
        url = f"https://t.me/{handle}"
        label = "Open Telegram"
    return {
        "channel": lobby.handoff_channel,
        "label": label,
        "url": url,
        "code": code,
        "share_text": text,
        "note": "Brief does not send this message or hold any payment. The code "
                "only confirms you are both at the same table.",
    }


# ── lobbies ──────────────────────────────────────────────────────────────────

def _host_out(host: Vendor) -> dict:
    return {
        "handle": host.vendor_handle,
        "business": host.business_name,
        "verified": bool(host.is_verified),
        "account_kind": getattr(host, "account_kind", None) or "business",
    }


def _viewer_terms(vendor: Optional[Vendor]) -> set[str]:
    return {
        str(item).strip().lower() for item in (getattr(vendor, "business_categories", None) or [])
        if str(item).strip()
    }


def _match(lobby: StreetLobby, vendor: Optional[Vendor], point: Optional[dict] = None,
           now: Optional[datetime] = None) -> tuple[int, list[str], Optional[float]]:
    if vendor is None:
        return 0, [], None
    if lobby.host_vendor_id == vendor.id:
        return 100, ["Your table"], None
    score = 35
    reasons: list[str] = []
    distance = None
    if point and lobby.h3_r9:
        distance = haversine_km(
            {"lat": point["lat"], "lng": point["lng"]},
            {"lat": lobby.geo_lat, "lng": lobby.geo_lng},
        )
        level = _level_for(lobby, point)
        if level == "street":
            score += 32
            reasons.append("Same street cell")
        elif level == "ward":
            score += 20
            reasons.append("Same ward")
        elif level == "town":
            score += 10
            reasons.append("Same town")
        if distance is not None and distance <= 2:
            reasons.append(f"{distance:.1f} km away")
    viewer_zone = " ".join(str(getattr(vendor, "physical_location", "") or "").split()).lower()
    zone = " ".join(str(lobby.zone or "").split()).lower()
    if zone and viewer_zone and (zone in viewer_zone or viewer_zone in zone):
        score += 30
        if "Same zone" not in reasons:
            reasons.append("Same zone")
    overlap = sorted(_viewer_terms(vendor) & {str(t).lower() for t in (lobby.tags or [])})
    if overlap:
        score += min(24, len(overlap) * 8)
        reasons.append("Matches " + ", ".join(overlap[:2]))
    remaining = max(0, int(lobby.seats or 0) - int(lobby.joined_count or 0))
    if remaining <= 2:
        score += 5
        if "Almost full" not in reasons:
            reasons.append("Almost full")
    moment = _aware(now)
    if lobby.expires_at and (_aware(lobby.expires_at) - moment).total_seconds() <= 3600:
        score += 3
        if "Closes soon" not in reasons:
            reasons.append("Closes soon")
    return min(99, score), reasons, distance


def _lobby_out(
    lobby: StreetLobby,
    host: Vendor,
    viewer: Optional[Vendor],
    *,
    joined: bool = False,
    include_handoff: bool = False,
    include_code: bool = False,
    now: Optional[datetime] = None,
    point: Optional[dict] = None,
) -> dict:
    moment = _aware(now)
    remaining = max(0, int(lobby.seats or 0) - int(lobby.joined_count or 0))
    expired = bool(lobby.expires_at and _aware(lobby.expires_at) <= moment)
    status = "expired" if expired and lobby.status == "open" else lobby.status
    score, reasons, distance = _match(lobby, viewer, point, moment)
    is_mine = bool(viewer and lobby.host_vendor_id == viewer.id)
    return {
        "id": str(lobby.id),
        "title": lobby.title,
        "intent": lobby.intent,
        "intent_label": INTENT_LABELS.get(lobby.intent, lobby.intent),
        "details": lobby.details,
        "zone": lobby.zone,
        "tags": list(lobby.tags or []),
        "seats": int(lobby.seats or 0),
        "joined_count": int(lobby.joined_count or 0),
        "remaining": remaining,
        "status": status,
        "opens_at": _iso(lobby.opens_at),
        "expires_at": _iso(lobby.expires_at),
        "minutes_left": max(0, int((_aware(lobby.expires_at) - moment).total_seconds() // 60))
        if lobby.expires_at else 0,
        "host": _host_out(host),
        "is_mine": is_mine,
        "joined": joined,
        "can_join": bool(viewer and not is_mine and joined is False
                         and status == "open" and remaining > 0),
        "match_score": score,
        "match_reasons": reasons,
        "distance_km": round(distance, 2) if distance is not None else None,
        "zoom_level": _level_for(lobby, point),
        "contact_hidden": not include_handoff,
        "verification_code": lobby.verification_code if include_code else None,
    }


async def expire_due(db: AsyncSession, now: Optional[datetime] = None) -> int:
    """Close every table whose window has passed and return how many moved."""
    moment = _aware(now)
    rows = (await db.execute(
        update(StreetLobby)
        .where(StreetLobby.status == "open", StreetLobby.expires_at <= moment)
        .values(status="expired")
        .returning(StreetLobby.id)
    )).scalars().all()
    return len(rows)


async def _expire_if_needed(db: AsyncSession, now: datetime) -> None:
    await expire_due(db, now)
    await db.flush()


async def _memberships(db: AsyncSession, vendor_id: uuid.UUID,
                        lobby_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    if not lobby_ids:
        return set()
    rows = (await db.execute(
        select(StreetLobbyMember.lobby_id).where(
            StreetLobbyMember.vendor_id == vendor_id,
            StreetLobbyMember.lobby_id.in_(lobby_ids),
        )
    )).scalars().all()
    return set(rows)


async def _rows_for_point(db: AsyncSession, moment: datetime, vendor: Vendor,
                          point: Optional[dict]) -> list:
    """Open tables in the viewer's H3 rings, then fall back to the town rail.

    The SQL predicate is the expansion: street cells first, then wards, then
    towns, plus unlocated rows and the viewer's own table. If even that is empty
    the whole open rail is the fallback, which is what keeps a new town usable.
    """
    base = (
        select(StreetLobby, Vendor)
        .join(Vendor, Vendor.id == StreetLobby.host_vendor_id)
        .where(StreetLobby.status == "open", StreetLobby.expires_at > moment)
        .order_by(StreetLobby.created_at.desc())
        .limit(120)
    )
    if point is None:
        return (await db.execute(base)).all()
    local = or_(
        StreetLobby.h3_r9.in_(list(point["rings"]["r9"])),
        StreetLobby.h3_r8.in_(list(point["rings"]["r8"])),
        StreetLobby.h3_r7.in_(list(point["rings"]["r7"])),
        StreetLobby.h3_r9.is_(None),
        StreetLobby.host_vendor_id == vendor.id,
    )
    rows = (await db.execute(base.where(local))).all()
    return rows if rows else (await db.execute(base)).all()


async def list_lobbies(
    db: AsyncSession,
    vendor: Vendor,
    *,
    intent: Optional[str] = None,
    zone: Optional[str] = None,
    tag: Optional[str] = None,
    limit: int = 24,
    now: Optional[datetime] = None,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    point: Optional[dict] = None,
) -> dict:
    moment = _aware(now)
    await _expire_if_needed(db, moment)
    if intent and intent not in INTENTS:
        raise StreetError("Choose co-buy, source, delivery, a quick job or a meet-up.", 422)
    if point is None:
        point = _point(lat, lng) or await viewer_point(db, vendor)
    rows = await _rows_for_point(db, moment, vendor, point)
    wanted_zone = " ".join(str(zone or "").split()).lower()
    wanted_tag = str(tag or "").strip().lower()
    memberships = await _memberships(db, vendor.id, [lobby.id for lobby, _ in rows])
    items = []
    for lobby, host in rows:
        if intent and lobby.intent != intent:
            continue
        if wanted_zone and wanted_zone not in " ".join(str(lobby.zone or "").split()).lower():
            continue
        if wanted_tag and wanted_tag not in {str(t).lower() for t in (lobby.tags or [])}:
            continue
        is_mine = lobby.host_vendor_id == vendor.id
        items.append(_lobby_out(
            lobby, host, vendor, joined=lobby.id in memberships,
            include_handoff=is_mine, include_code=is_mine, now=moment, point=point,
        ))
    # A person's own table stays visible, then the strongest local match, then
    # whatever closes first. Nothing is promoted by spend.
    items.sort(key=lambda row: (
        0 if row["is_mine"] else 1,
        -row["match_score"],
        row["minutes_left"],
    ))
    level = "text"
    matched = 0
    if point is not None:
        for candidate in ("street", "ward", "town"):
            hits = [row for row in items if not row["is_mine"] and row["zoom_level"] == candidate]
            if hits:
                level = candidate
                matched = len(hits)
                break
        else:
            level = "region"
        keep = {level, "unlocated"}
        items = [row for row in items if row["is_mine"] or row["zoom_level"] in keep]
    label = {
        "street": "street block", "ward": "ward or estate", "town": "town",
        "region": "wider area", "text": "zone text",
    }[level]
    return {
        "lobbies": items[:max(1, min(limit, 50))],
        "counts": {
            "open": sum(1 for row in items if row["status"] == "open"),
            "matching": sum(1 for row in items if not row["is_mine"] and row["can_join"]),
            "joined": sum(1 for row in items if row["joined"]),
        },
        "filters": {"intent": intent, "zone": zone or None, "tag": tag or None},
        "viewer": _viewer_out(point),
        "zoom": {
            "level": level,
            "label": label,
            "h3": ({"r9": point["h3_r9"], "r8": point["h3_r8"], "r7": point["h3_r7"]}
                   if point else None),
            "ring": 1 if point else 0,
            "matched": matched if level != "region" else len(items),
            "note": ("Expands street → ward → town only when the nearer ring has a table."
                     if point else "Set a pin to rank tables by distance."),
        },
        "note": "A table is an introduction with an expiry. Brief publishes no "
                "phone number here; contact is released only to a person who joins.",
    }


def _clean_duration(value: int) -> int:
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        raise StreetError("Choose how long the table stays open.", 422)
    if not 15 <= minutes <= 480:
        raise StreetError("A table stays open for 15 minutes to 8 hours.", 422)
    return minutes


def _clean_target(channel: str, target: str) -> str:
    if channel == "whatsapp":
        return _normalise_phone(target)
    return _normalise_telegram(target)


async def create_lobby(
    db: AsyncSession,
    vendor: Vendor,
    *,
    title: str,
    intent: str,
    zone: str,
    details: Optional[str],
    tags: Optional[Iterable[str]],
    seats: int,
    duration_minutes: int,
    handoff_channel: str,
    handoff_target: str,
    geo_lat: Optional[float] = None,
    geo_lng: Optional[float] = None,
    now: Optional[datetime] = None,
) -> dict:
    title = " ".join(str(title or "").split())
    if not 4 <= len(title) <= 140:
        raise StreetError("Give the table a title of 4 to 140 characters.", 422)
    intent = str(intent or "").strip().lower()
    if intent not in INTENTS:
        raise StreetError("Choose co-buy, source, delivery, a quick job or a meet-up.", 422)
    zone = " ".join(str(zone or "").split())
    if not 2 <= len(zone) <= 80:
        raise StreetError("Name the zone or street where people will meet.", 422)
    details = " ".join(str(details or "").split())
    if len(details) > 1200:
        raise StreetError("Keep the details under 1,200 characters.", 422)
    try:
        seats = int(seats)
    except (TypeError, ValueError):
        raise StreetError("Choose how many people the table holds.", 422)
    if not 2 <= seats <= 50:
        raise StreetError("A table holds 2 to 50 people, including you.", 422)
    channel = str(handoff_channel or "").strip().lower()
    if channel not in HANDOFF_CHANNELS:
        raise StreetError("Choose WhatsApp or Telegram for the handoff.", 422)
    target = _clean_target(channel, handoff_target)
    if (geo_lat is None) != (geo_lng is None):
        raise StreetError("Send both geo_lat and geo_lng, or neither.", 422)
    if geo_lat is not None and not h3_geo.valid_point(geo_lat, geo_lng):
        raise StreetError("That pin is outside the map.", 422)
    point = _point(geo_lat, geo_lng, label=zone) if geo_lat is not None else None
    if point is None:
        point = await viewer_point(db, vendor)
    moment = _aware(now)
    lobby = StreetLobby(
        host_vendor_id=vendor.id,
        title=title,
        intent=intent,
        details=details or None,
        zone=zone,
        tags=_clean_tags(tags),
        geo_lat=point["lat"] if point else None,
        geo_lng=point["lng"] if point else None,
        h3_r9=point["h3_r9"] if point else None,
        h3_r8=point["h3_r8"] if point else None,
        h3_r7=point["h3_r7"] if point else None,
        seats=seats,
        joined_count=1,
        status="open",
        handoff_channel=channel,
        handoff_target=target,
        verification_code=secrets.token_hex(3).upper(),
        opens_at=moment,
        expires_at=moment + timedelta(minutes=_clean_duration(duration_minutes)),
        created_at=moment,
    )
    db.add(lobby)
    await db.flush()
    return {
        "lobby": _lobby_out(lobby, vendor, vendor, joined=True, include_handoff=True,
                            include_code=True, now=moment, point=point),
        "note": "Your table is open until the time shown. Brief will not send the "
                "handoff for you.",
    }


async def _lobby_and_host(db: AsyncSession, lobby_id: uuid.UUID) -> tuple[StreetLobby, Vendor]:
    row = (await db.execute(
        select(StreetLobby, Vendor)
        .join(Vendor, Vendor.id == StreetLobby.host_vendor_id)
        .where(StreetLobby.id == lobby_id)
    )).first()
    if row is None:
        raise StreetError("That table was not found.", 404)
    return row[0], row[1]


async def join_lobby(db: AsyncSession, vendor: Vendor, lobby_id: uuid.UUID,
                     now: Optional[datetime] = None) -> dict:
    moment = _aware(now)
    lobby, host = await _lobby_and_host(db, lobby_id)
    if lobby.host_vendor_id == vendor.id:
        raise StreetError("You are already hosting this table.", 409)
    if lobby.status != "open" or _aware(lobby.expires_at) <= moment:
        raise StreetError("This table has closed. Open one of your own, or pick another.", 409)

    existing = (await db.execute(
        select(StreetLobbyMember).where(
            StreetLobbyMember.lobby_id == lobby.id,
            StreetLobbyMember.vendor_id == vendor.id,
        )
    )).scalar_one_or_none()
    if existing is not None:
        return {
            "joined": True,
            "already": True,
            "lobby": _lobby_out(lobby, host, vendor, joined=True, now=moment),
            "handoff": _handoff(lobby, host, vendor),
        }

    member_id = (await db.execute(
        pg_insert(StreetLobbyMember)
        .values(id=uuid.uuid4(), lobby_id=lobby.id, vendor_id=vendor.id, joined_at=moment)
        .on_conflict_do_nothing(constraint="uq_street_lobby_member")
        .returning(StreetLobbyMember.id)
    )).scalar_one_or_none()
    if member_id is None:
        existing = (await db.execute(
            select(StreetLobbyMember).where(
                StreetLobbyMember.lobby_id == lobby.id,
                StreetLobbyMember.vendor_id == vendor.id,
            )
        )).scalar_one_or_none()
        if existing is not None:
            return {
                "joined": True,
                "already": True,
                "lobby": _lobby_out(lobby, host, vendor, joined=True, now=moment),
                "handoff": _handoff(lobby, host, vendor),
            }
        raise StreetError("That table changed while you were joining. Try again.", 409)

    row = (await db.execute(
        update(StreetLobby)
        .where(
            StreetLobby.id == lobby.id,
            StreetLobby.status == "open",
            StreetLobby.expires_at > moment,
            StreetLobby.joined_count < StreetLobby.seats,
        )
        .values(joined_count=StreetLobby.joined_count + 1)
        .returning(StreetLobby.id)
    )).first()
    if row is None:
        await db.execute(StreetLobbyMember.__table__.delete().where(StreetLobbyMember.id == member_id))
        raise StreetError("That last seat went while you were tapping. Pick another table.", 409)

    await db.refresh(lobby)
    await create_notification(
        db,
        host.id,
        NotificationType.OPPORTUNITY_MATCH,
        "Someone joined your table",
        f"{vendor.business_name or vendor.vendor_handle} joined “{lobby.title}”. "
        f"Use code {lobby.verification_code} in the handoff.",
        sender_id=vendor.id,
        data={"kind": "street_lobby", "lobby_id": str(lobby.id)},
    )
    return {
        "joined": True,
        "already": False,
        "lobby": _lobby_out(lobby, host, vendor, joined=True, now=moment),
        "handoff": _handoff(lobby, host, vendor),
    }


async def leave_lobby(db: AsyncSession, vendor: Vendor, lobby_id: uuid.UUID) -> dict:
    lobby, host = await _lobby_and_host(db, lobby_id)
    if lobby.host_vendor_id == vendor.id:
        raise StreetError("Close the table instead of leaving it.", 409)
    deleted = (await db.execute(
        StreetLobbyMember.__table__.delete()
        .where(StreetLobbyMember.lobby_id == lobby.id, StreetLobbyMember.vendor_id == vendor.id)
        .returning(StreetLobbyMember.id)
    )).scalar_one_or_none()
    if deleted is not None:
        await db.execute(
            update(StreetLobby)
            .where(StreetLobby.id == lobby.id, StreetLobby.joined_count > 1)
            .values(joined_count=StreetLobby.joined_count - 1)
        )
        await db.refresh(lobby)
    return {
        "joined": False,
        "lobby": _lobby_out(lobby, host, vendor, joined=False),
    }


async def close_lobby(db: AsyncSession, vendor: Vendor, lobby_id: uuid.UUID) -> dict:
    lobby, host = await _lobby_and_host(db, lobby_id)
    if lobby.host_vendor_id != vendor.id:
        raise StreetError("Only the host can close this table.", 403)
    if lobby.status == "open":
        lobby.status = "closed"
        await db.flush()
    return {"lobby": _lobby_out(lobby, host, vendor, joined=True, include_handoff=True,
                                include_code=True)}


async def my_lobbies(db: AsyncSession, vendor: Vendor,
                     now: Optional[datetime] = None) -> dict:
    moment = _aware(now)
    await _expire_if_needed(db, moment)
    hosted = (await db.execute(
        select(StreetLobby, Vendor)
        .join(Vendor, Vendor.id == StreetLobby.host_vendor_id)
        .where(StreetLobby.host_vendor_id == vendor.id)
        .order_by(StreetLobby.created_at.desc())
        .limit(50)
    )).all()
    joined = (await db.execute(
        select(StreetLobby, Vendor)
        .join(StreetLobbyMember, StreetLobbyMember.lobby_id == StreetLobby.id)
        .join(Vendor, Vendor.id == StreetLobby.host_vendor_id)
        .where(StreetLobbyMember.vendor_id == vendor.id)
        .order_by(StreetLobby.created_at.desc())
        .limit(50)
    )).all()
    rows = []
    for lobby, host in hosted:
        out = _lobby_out(lobby, host, vendor, joined=True, include_handoff=True,
                         include_code=True, now=moment)
        rows.append({**out, "role": "host"})
    for lobby, host in joined:
        out = _lobby_out(lobby, host, vendor, joined=True, include_handoff=True, now=moment)
        rows.append({**out, "role": "guest", "handoff": _handoff(lobby, host, vendor)})
    rows.sort(key=lambda row: row["expires_at"] or "", reverse=True)
    return {"lobbies": rows, "note": "Closing a table leaves the record; it does not "
                                     "delete what people already agreed."}


# ── story guide ──────────────────────────────────────────────────────────────

async def _count(db: AsyncSession, model, *where) -> int:
    return int((await db.execute(select(func.count()).select_from(model).where(*where))).scalar_one())


async def guide(db: AsyncSession, vendor: Vendor, now: Optional[datetime] = None) -> dict:
    moment = _aware(now)
    local = _local(moment)
    season = season_for(moment)
    script = today_script(moment)
    profile_done = bool(
        (vendor.business_description or "").strip()
        and (vendor.physical_location or "").strip()
        and (vendor.vendor_handle or "").strip()
    )
    has_shelf = await _count(db, StockItem, StockItem.vendor_id == vendor.id) > 0
    routines = await _count(db, RecurringRoutine, RecurringRoutine.owner_user_id == vendor.id,
                            RecurringRoutine.is_active.is_(True))
    hosted = await _count(db, StreetLobby, StreetLobby.host_vendor_id == vendor.id)
    joined = await _count(db, StreetLobbyMember, StreetLobbyMember.vendor_id == vendor.id)
    open_near = await _count(
        db, StreetLobby,
        StreetLobby.status == "open", StreetLobby.expires_at > moment,
        StreetLobby.host_vendor_id != vendor.id,
    )
    completed_trades = int(getattr(vendor, "movements_completed", 0) or 0) + int(
        getattr(vendor, "confirmed_trade_proofs", 0) or 0
    )
    chapters = [
        {
            "key": "street_presence", "chapter": "Chapter 1", "title": "Show your street",
            "body": "A description, a physical place and your handle. People need to know "
                    "who they are meeting before they open a table.",
            "done": profile_done, "href": "/you/page", "cta": "Finish the page",
        },
        {
            "key": "first_shelf", "chapter": "Chapter 2", "title": "Put one thing on the shelf",
            "body": "A real item with a real quantity. The first shelf makes you findable.",
            "done": has_shelf, "href": "/stock", "cta": "Add stock",
        },
        {
            "key": "weekly_rhythm", "chapter": "Chapter 3", "title": "Set a weekly rhythm",
            "body": "A market day, a clinic or a co-buy round that repeats. Reliability "
                    "beats another one-off post.",
            "done": routines > 0, "href": "/routines", "cta": "Create a routine",
        },
        {
            "key": "open_a_table", "chapter": "Chapter 4", "title": "Open your first table",
            "body": "Name one need, one zone and one hour. A table is an introduction, "
                    "not a promise of money.",
            "done": hosted > 0 or joined > 0, "href": "/street?open=1", "cta": "Open a table",
        },
        {
            "key": "first_handshake", "chapter": "Chapter 5", "title": "Make one handshake",
            "body": "One completed movement, confirmed by both sides. That is the record "
                    "the next person reads.",
            "done": completed_trades > 0, "href": "/orders/records", "cta": "See the record",
        },
    ]
    for chapter in chapters:
        chapter["progress"] = 100 if chapter["done"] else 0
    done_count = sum(1 for chapter in chapters if chapter["done"])
    next_chapter = next((chapter for chapter in chapters if not chapter["done"]), None)
    actions = []
    if not profile_done:
        actions.append({
            "kind": "chapter", "eyebrow": "Finish the front door",
            "title": "Give people enough to recognise you",
            "detail": "Add a description to your page and the place you actually trade from.",
            "cta": "Finish the page", "href": "/you/page",
        })
    if not has_shelf:
        actions.append({
            "kind": "chapter", "eyebrow": "Start the shelf",
            "title": "A table needs something to talk about",
            "detail": "Publish one item with a quantity. It can be a service or a single batch.",
            "cta": "Add what you have", "href": "/stock",
        })
    if routines == 0:
        actions.append({
            "kind": "chapter", "eyebrow": "Make it repeatable",
            "title": "Put one weekly slot on the calendar",
            "detail": "A repeatable market day or service is easier to join than a moving target.",
            "cta": "Set a routine", "href": "/routines",
        })
    if open_near:
        actions.append({
            "kind": "table", "eyebrow": "Live now",
            "title": f"{open_near} table{'s' if open_near != 1 else ''} open now",
            "detail": "See the zone, the need and the time left. Join only if it fits.",
            "cta": "See open tables", "href": "/street",
        })
    if hosted == 0:
        actions.append({
            "kind": "table", "eyebrow": "Two-hour window",
            "title": "Open a table for one clear need",
            "detail": "A co-buy, a rider, a source or a meet-up. It expires by itself.",
            "cta": "Open a table", "href": "/street?open=1",
        })
    if script and script["state"] != "done":
        actions.append({
            "kind": "script", "eyebrow": script["zone_label"],
            "title": script["title"], "detail": script["detail"],
            "cta": script["cta"], "href": script["href"],
        })
    actions = actions[:4]
    if local.hour < 12:
        line = "Morning. One clear move beats a full feed."
    elif local.hour < 17:
        line = "Afternoon. The street is matching; keep it to one table."
    else:
        line = "Evening. Close one loop and leave the next one obvious."
    return {
        "season": season,
        "persona": {"name": "Mtaa", "role": "Your street guide", "line": line},
        "today_script": script,
        "chapters": chapters,
        "completed": done_count,
        "total": len(chapters),
        "progress_pct": round(100 * done_count / len(chapters)),
        "level": 1 + done_count // 2,
        "season_points": done_count * 20 + min(hosted + joined, 5) * 3 + routines * 5,
        "next_chapter": next_chapter,
        "next_actions": actions,
        "note": "Chapters are a record of what you have done, not a ranking. "
                "Spending money never moves them.",
    }


async def context(
    db: AsyncSession,
    vendor: Vendor,
    *,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    refresh: bool = False,
) -> dict:
    """Free open-data anchors around the viewer's H3 block.

    A request may carry an explicit pin; otherwise the saved discovery point,
    then the shop's own coordinates, are used. No pin is a supported answer —
    the page asks for one instead of guessing a city.
    """
    point = None
    if lat is not None or lng is not None:
        if not h3_geo.valid_point(lat, lng):
            raise StreetError("Send both geo_lat and geo_lng inside the map bounds.", 422)
        point = _point(lat, lng, label="Your pin")
    if point is None:
        point = await viewer_point(db, vendor)
    if point is None:
        return hex_context.unavailable()
    return await hex_context.get_context(
        db, point["lat"], point["lng"], label=point.get("label"), refresh=refresh,
    )


async def now_payload(db: AsyncSession, vendor: Vendor, now: Optional[datetime] = None) -> dict:
    moment = _aware(now)
    point = await viewer_point(db, vendor)
    return {
        "server_time": _local(moment).isoformat(),
        "viewer": _viewer_out(point),
        "calendar": await calendar(db, vendor, moment),
        "guide": await guide(db, vendor, moment),
        "lobbies": await list_lobbies(db, vendor, limit=6, now=moment, point=point),
    }
