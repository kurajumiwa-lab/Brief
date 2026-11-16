"""Share cards for the two links that leave the app.

A WhatsApp crawler never runs the React app, so `/p/<handle>` and
`/invite/<shop>` need real HTML and a real image on the server. Everything on
these cards comes from a row: a region, a completed-trade count, a receipt
count. There is no "verified by KRA" tick, because no KRA lookup happens.

Images are drawn with Pillow and a system font. That keeps the loop at zero
recurring cost: no Cloudinary, no Satori service, no design asset pipeline.
"""

from __future__ import annotations

import io
import re
from datetime import datetime
from typing import Any, Optional

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.receipts import Receipt, ReceiptMerchant
from app.models.vendor import Vendor
from app.services import stock_engine

WIDTH, HEIGHT = 1200, 630

FOREST = (15, 61, 46)
FOREST_SOFT = (31, 82, 64)
MINT = (198, 232, 211)
WHITE = (255, 255, 255)
LIGHT = (246, 247, 244)
INK = (24, 32, 28)
INK_SOFT = (83, 96, 88)
GREEN = (14, 122, 75)
GREEN_DARK = (10, 91, 56)
AMBER = (193, 130, 26)

RANK_LABELS = {
    0: "Visitor",
    1: "Present",
    2: "Reachable",
    3: "Trading",
    4: "Trusted",
    5: "Confirmed",
}


def slugify(value: Any) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")
    return text[:80]


def _font(size: int) -> ImageFont.FreeTypeFont:
    """A real scalable face when Pillow has one, without vendoring a font file."""
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def _fit(size: int, text: str, max_width: int, floor: int = 28) -> ImageFont.FreeTypeFont:
    """Shrink a name until it fits one line. Truncation is handled separately."""
    while size > floor:
        font = _font(size)
        if _measure(text, font) <= max_width:
            return font
        size -= 4
    return _font(floor)


def _measure(text: str, font: ImageFont.FreeTypeFont) -> int:
    return int(font.getbbox(text)[2] - font.getbbox(text)[0])


def _wrap(text: str, font: ImageFont.FreeTypeFont, max_width: int, max_lines: int = 2) -> list[str]:
    words = str(text or "").split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if _measure(candidate, font) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
        current = word
        if len(lines) == max_lines - 1:
            break
    if current and len(lines) < max_lines:
        lines.append(current)
    if len(lines) == max_lines:
        used = " ".join(lines)
        if len(used.split()) < len(words):
            last = lines[-1]
            while last and _measure(f"{last}…", font) > max_width:
                last = last[:-1]
            lines[-1] = f"{last.rstrip()}…"
    return lines


def _initials(name: str) -> str:
    parts = [part for part in re.split(r"\s+", str(name or "").strip()) if part]
    return "".join(part[0].upper() for part in parts[:2]) or "HO"


def _place_parts(place: Optional[str]) -> tuple[str, str]:
    text = str(place or "").strip()
    if not text:
        return "", ""
    pieces = [piece.strip() for piece in text.split(",") if piece.strip()]
    if len(pieces) >= 2:
        return pieces[0], pieces[-1]
    return pieces[0], ""


def _jpeg(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    # 82 keeps a flat card well under WhatsApp's 300 KB ceiling (usually < 60 KB).
    image.save(buffer, format="JPEG", quality=82, optimize=True, progressive=True)
    return buffer.getvalue()


def _label(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, size: int, fill) -> None:
    draw.text(xy, text, font=_font(size), fill=fill)


def render_profile_card(card: dict) -> bytes:
    image = Image.new("RGB", (WIDTH, HEIGHT), FOREST)
    draw = ImageDraw.Draw(image)

    # A quiet second plane gives the flat card depth without an image pipeline.
    draw.rounded_rectangle((WIDTH - 470, -180, WIDTH + 150, 460), radius=220, fill=FOREST_SOFT)

    _label(draw, (80, 52), "HOME OFFICE", 22, MINT)
    _label(draw, (80, 82), "the digital connection layer for everyday trade", 20, (156, 193, 175))

    badge = f"{card['rank_label'].upper()} · LEVEL {card['level']} OF 5"
    badge_font = _font(21)
    badge_w = _measure(badge, badge_font) + 44
    draw.rounded_rectangle((WIDTH - 80 - badge_w, 50, WIDTH - 80, 96), radius=23, fill=(232, 246, 238))
    draw.text((WIDTH - 80 - badge_w + 22, 61), badge, font=badge_font, fill=FOREST)

    # Initials disc, never a fetched avatar: this response must stay cheap and
    # must not depend on a customer's media URL being reachable.
    disc = (WIDTH - 300, 170, WIDTH - 80, 390)
    draw.ellipse(disc, fill=(41, 101, 79), outline=(74, 132, 109), width=3)
    initials_font = _font(84)
    initials = _initials(card["name"])
    iw = _measure(initials, initials_font)
    draw.text((disc[0] + (220 - iw) / 2, disc[1] + 76), initials, font=initials_font, fill=WHITE)

    name_font = _font(78)
    name_lines = _wrap(card["name"], name_font, 760, max_lines=2)
    y = 172
    for line in name_lines:
        draw.text((80, y), line, font=name_font, fill=WHITE)
        y += 86

    if card["city"]:
        pill = f"{card['city'].upper()}" + (f" · {card['region'].upper()}" if card["region"] else "")
        pill_font = _font(23)
        pill_w = _measure(pill, pill_font) + 52
        draw.rounded_rectangle((80, y + 26, 80 + pill_w, y + 78), radius=26, fill=(41, 101, 79))
        draw.text((80 + 26, y + 38), pill, font=pill_font, fill=MINT)
        y += 92

    draw.line((80, 454, WIDTH - 80, 454), fill=(58, 112, 91), width=2)

    trades = int(card["trades"])
    if trades > 0:
        big = f"{trades:,}"
        draw.text((80, 480), big, font=_font(72), fill=WHITE)
        big_w = _measure(big, _font(72))
        draw.text((80 + big_w + 18, 505), "completed\ntrades", font=_font(24), fill=MINT, spacing=4)
    else:
        draw.text((80, 486), "New here", font=_font(52), fill=WHITE)
        draw.text((80, 552), "No completed trades yet", font=_font(24), fill=MINT)

    categories = str(card.get("categories") or "")
    if categories:
        cat_lines = _wrap(categories, _font(24), 430, max_lines=2)
        cy = 500
        for line in cat_lines:
            draw.text((WIDTH - 80 - _measure(line, _font(24)), cy), line, font=_font(24), fill=(210, 235, 221))
            cy += 34

    _label(draw, (80, 592), card["url_text"], 19, (132, 176, 157))
    return _jpeg(image)


def render_invite_card(card: dict) -> bytes:
    image = Image.new("RGB", (WIDTH, HEIGHT), LIGHT)
    draw = ImageDraw.Draw(image)

    draw.rectangle((0, 0, WIDTH, 178), fill=GREEN)
    draw.ellipse((72, 54, 140, 122), fill=WHITE)
    # A check is about the receipt record, not a payment or a KRA approval.
    draw.line(((91, 89), (103, 102), (124, 76)), fill=GREEN_DARK, width=8, joint="curve")
    draw.text((164, 55), card["banner"].upper(), font=_font(31), fill=WHITE)
    draw.text((164, 100), card["banner_note"], font=_font(21), fill=(205, 238, 219))
    draw.text((WIDTH - 250, 66), "homeoffice", font=_font(26), fill=WHITE)

    name_font = _fit(76, card["name"], 980, floor=44)
    name_lines = _wrap(card["name"], name_font, 980, max_lines=2)
    y = 226
    for line in name_lines:
        draw.text((80, y), line, font=name_font, fill=INK)
        y += 84

    if card["place"]:
        _label(draw, (80, y + 8), card["place"], 28, INK_SOFT)
        y += 54

    desc_lines = _wrap(card["description"], _font(27), 980, max_lines=2)
    cy = max(y + 18, 414)
    for line in desc_lines:
        draw.text((80, cy), line, font=_font(27), fill=INK_SOFT)
        cy += 38

    cta = "Tap to claim this shop  ·  Free"
    cta_font = _font(28)
    draw.rounded_rectangle((80, 516, 80 + _measure(cta, cta_font) + 72, 584), radius=34, fill=GREEN)
    draw.text((116, 534), cta, font=cta_font, fill=WHITE)

    url_font = _font(18)
    url = card["url_text"]
    while url and _measure(url, url_font) > 360:
        url = url[:-1]
    draw.text((WIDTH - 80 - _measure(url, url_font), 550), url, font=url_font, fill=(120, 132, 124))
    return _jpeg(image)


async def _level_for(db: AsyncSession, vendor: Vendor) -> int:
    """Mirror of the conservative part of the client ladder.

    The client ladder also counts device-local contact and institution claims.
    Those do not exist on the server, so the share card never claims a rung the
    server cannot prove. A page is Present; a public call route is Reachable;
    one completed trade is Trading; five with a 90%+ record is Trusted.
    """
    level = 1 if vendor.business_name and vendor.vendor_handle else 0
    contact = bool(vendor.phone_verified_at or (vendor.phone and vendor.allow_direct_calls))
    if level >= 1 and contact:
        level = 2
    trades = int(vendor.movements_completed or 0) + int(vendor.confirmed_trade_proofs or 0)
    if level >= 2 and trades >= 1:
        level = 3
    fulfilment = stock_engine.fulfillment_rate(vendor)
    if level >= 3 and trades >= 5 and (fulfilment is None or float(fulfilment) >= 0.9):
        level = 4
    return level


async def _offer_count(db: AsyncSession, vendor_id) -> int:
    from app.models.receipts import ReceiptOffer

    now = datetime.utcnow()
    return int(
        (
            await db.execute(
                select(func.count())
                .select_from(ReceiptOffer)
                .join(ReceiptMerchant, ReceiptOffer.merchant_id == ReceiptMerchant.id)
                .where(
                    ReceiptMerchant.claimed_by_vendor_id == vendor_id,
                    ReceiptMerchant.claim_status.in_(("verified", "probationary")),
                    ReceiptOffer.is_active.is_(True),
                    ReceiptOffer.starts_at <= now,
                    (ReceiptOffer.ends_at.is_(None)) | (ReceiptOffer.ends_at > now),
                )
            )
        ).scalar_one()
    )


async def profile_card(db: AsyncSession, handle: str, origin: str) -> Optional[dict]:
    vendor = (
        await db.execute(
            select(Vendor).where(Vendor.vendor_handle == str(handle or "").lstrip("@").lower())
        )
    ).scalar_one_or_none()
    if vendor is None:
        return None

    trades = int(vendor.movements_completed or 0) + int(vendor.confirmed_trade_proofs or 0)
    level = await _level_for(db, vendor)
    city, region = _place_parts(vendor.physical_location)
    categories = [
        str(value).replace("_", " ").strip().title()
        for value in list(vendor.business_categories or [])[:3]
        if str(value).strip()
    ]
    offers = await _offer_count(db, vendor.id)
    name = vendor.business_name or vendor.display_name or vendor.vendor_handle
    trade_text = f"{trades:,} completed trade{'s' if trades != 1 else ''}"
    if trades == 0:
        trade_text = "No completed trades yet"

    description = f"{trade_text} • {' & '.join(categories) if categories else 'Local trade'}. "
    if offers:
        description += f"{offers} active offer{'s' if offers != 1 else ''} on Home Office."
    else:
        description += "View the page on Home Office."

    where = city or region or ""
    title = f"{name} • {RANK_LABELS[level]} · Level {level} of 5"
    if where:
        title += f" in {where}"

    return {
        "name": name,
        "handle": vendor.vendor_handle,
        "level": level,
        "rank_label": RANK_LABELS[level],
        "trades": trades,
        "categories": " & ".join(categories),
        "city": city,
        "region": region,
        "title": title,
        "description": description,
        "url": f"{origin}/p/{vendor.vendor_handle}",
        "image_url": f"{origin}/og/p/{vendor.vendor_handle}.jpg",
        "url_text": f"{origin.replace('https://', '').replace('http://', '')}/p/{vendor.vendor_handle}",
    }


async def merchant_by_slug(db: AsyncSession, slug: str) -> Optional[ReceiptMerchant]:
    wanted = slugify(slug)
    if not wanted:
        return None
    direct = (
        await db.execute(
            select(ReceiptMerchant).where(func.upper(ReceiptMerchant.pin) == str(slug).upper())
        )
    ).scalar_one_or_none()
    if direct is not None:
        return direct
    # A readable invite URL is worth one bounded scan. Merchant names are short
    # and the unclaimed/pending set is small; if this grows, add a stored slug.
    rows = (
        await db.execute(
            select(ReceiptMerchant)
            .where(ReceiptMerchant.claim_status != "verified")
            .limit(5000)
        )
    ).scalars().all()
    for merchant in rows:
        if slugify(merchant.name) == wanted:
            return merchant
    return None


async def invite_card(db: AsyncSession, slug: str, origin: str) -> Optional[dict]:
    merchant = await merchant_by_slug(db, slug)
    if merchant is None:
        return None
    receipts = int(
        (
            await db.execute(
                select(func.count())
                .select_from(Receipt)
                .where(Receipt.merchant_id == merchant.id, Receipt.status == "verified")
            )
        ).scalar_one()
    )
    name = merchant.name or "This shop"
    place = str(merchant.region or "").replace("-", " ").title()
    if receipts:
        banner = f"{receipts} receipt{'s' if receipts != 1 else ''} on record"
        banner_note = "Customers scanned the eTIMS QR at this shop"
        title = f"{name} has {receipts} customer receipt{'s' if receipts != 1 else ''} waiting on Home Office"
        description = (
            f"Shoppers{(' in ' + place) if place else ''} have scanned receipts from this shop. "
            "Claim the page free to answer them and be found locally."
        )
    else:
        banner = "This shop is not on Home Office yet"
        banner_note = "A customer tried to log a trade here"
        title = f"{name} is not on Home Office yet"
        description = (
            "Claim the shop page free so customers can find you and confirm their receipts."
        )

    if merchant.claim_status == "pending":
        banner = "A shop claim is waiting for review"
        banner_note = "The owner has already asked to manage this page"
        title = f"{name} — claim waiting for review"
        description = "The shop owner has claimed this page. Review is pending; no second claim is needed."
    elif merchant.claim_status == "probationary":
        banner = "Probationary owner — trading now"
        banner_note = "Vouchers and one offer are unlocked; trade proofs wait for verification"
        title = f"{name} — probationary shop on Home Office"
        description = "The owner answered a test sale at the till. The shop can trade now; confirmation of trade proofs waits for verification."
    elif merchant.claim_status == "contested":
        banner = "Ownership is contested"
        banner_note = "New offers are frozen; vouchers already issued still work"
        title = f"{name} — ownership contest open"
        description = "Somebody with a receipt from this shop contested the claim. The current owner has 48 hours to answer."

    return {
        "name": name,
        "pin": merchant.pin,
        "slug": slug,
        "receipts": receipts,
        "claim_status": merchant.claim_status,
        "place": place,
        "banner": banner,
        "banner_note": banner_note,
        "title": title,
        "description": description,
        "url": f"{origin}/invite/{slug}",
        "image_url": f"{origin}/og/invite/{slug}.jpg",
        "url_text": f"{origin.replace('https://', '').replace('http://', '')}/invite/{slug}",
    }
