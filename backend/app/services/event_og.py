"""Public event / group-sourcing cards. No private attendee or payment evidence is exposed."""
from uuid import UUID
from urllib.parse import urlsplit
import io

from PIL import Image, ImageDraw, ImageOps, UnidentifiedImageError
from sqlalchemy import select

from app.models.events import Event
from app.models.vendor import Vendor
from app.modules.ledger.models import LocalActivity
from app.services.event_payments import counts
from app.services.og_cards import WIDTH, HEIGHT, FOREST, WHITE, INK, INK_SOFT, AMBER, RANK_LABELS, _font, _wrap, _measure, _level_for
from app.services.storage import MEDIA_KEY, storage

# Identical stops and keyword order to frontend/src/lib/categoryArt.js.
PALETTES = [((15,61,46),(43,122,90),(215,241,226)), ((107,63,18),(184,121,43),(251,235,213)), ((30,58,95),(62,110,158),(219,235,250)), ((74,44,90),(126,84,151),(240,229,247)), ((76,42,30),(154,90,58),(248,230,220)), ((35,66,58),(79,127,92),(225,243,228)), ((90,31,46),(163,72,95),(251,226,232))]
KEYWORDS = [("grocery", "groceries", "bulk", "food", "market", "produce", "vegetable", "maize"), ("brunch", "party", "wedding", "celebration", "music", "event", "festival"), ("bike", "ride", "trip", "travel", "tour", "hike", "transport", "boda"), ("community", "chama", "group", "meet", "neighbour", "neighbor", "association"), ("repair", "fundi", "service", "fix", "maintenance", "plumber", "electrician"), ("learn", "class", "training", "session", "workshop", "school", "tuition"), ("health", "clinic", "pharmacy", "nurse", "doctor", "dawa", "hospital")]


def _price(value):
    if value is None:
        return "Price on request"
    return f"KSh {value:,.2f}".removesuffix(".00")


def _payment(method, number, account):
    names = {"TILL": "Buy Goods Till", "PAYBILL": "Paybill", "POCHI": "Pochi", "SEND_MONEY": "Send Money"}
    if method not in names or not number:
        return ""
    return f"{names[method]}: {number}" + (f" • Acc: {account}" if method == "PAYBILL" and account else "")


def _date(value):
    return f"{value.day} {value.strftime('%b %Y')}" if value else "Date to be announced"


async def share_card(db, slug, origin):
    # UUID links also cover events published through Outside before slugs existed.
    try:
        identifier = UUID(slug)
    except ValueError:
        identifier = None
    query = select(Event, Vendor).join(Vendor, Event.organizer_id == Vendor.id).where(Event.slug == slug)
    if identifier:
        query = select(Event, Vendor).join(Vendor, Event.organizer_id == Vendor.id).where((Event.slug == slug) | (Event.id == identifier))
    row = (await db.execute(query)).first()
    if row:
        ev, host = row
        # Membership-restricted events are not public share cards.
        if ev.group_id or ev.vendor_list_id or ev.status == "draft" or host.fraud_suspended_at:
            return None
        metrics = await counts(db, ev)
        confirmed, occupied, waiting, cap = metrics['confirmed_count'], metrics['occupied'], metrics['waitlist_count'], metrics['capacity']
        method, number, account = ev.payment_method, ev.payment_number, ev.payment_account
        title, price, date, departure = ev.title, ev.entry_fee, ev.start_date, ev.departure_time
        meeting, category, template = ev.meeting_point or ev.location, ev.event_type, ''
        kind, item_id, images, state = 'event', ev.id, ev.images or [], ev.status
        region = host.physical_location or ''
    elif identifier:
        row = (await db.execute(select(LocalActivity, Vendor).join(Vendor, LocalActivity.organizer_vendor_id == Vendor.id).where(
            LocalActivity.id == identifier, LocalActivity.inferred_template == 'group_sourcing', LocalActivity.visibility == 'public'
        ))).first()
        if not row:
            return None
        act, host = row
        if host.fraud_suspended_at:
            return None
        # These activities do not have the event payment/waitlist state machine.
        confirmed = occupied = act.spots_confirmed or 0
        waiting, cap = None, act.capacity or 0
        method = number = account = None
        title, price, date, departure = act.title, act.price_kes, act.starts_at, None
        meeting = act.area_name if act.location_scope != 'homestead_private' else None
        category, template = act.category or '', act.inferred_template
        kind, item_id, images, state = 'bulk_buy', act.id, act.media or [], act.lifecycle_status
        region = host.physical_location or ''
    else:
        return None
    level = await _level_for(db, host)
    payment = _payment(method, number, account)
    full = bool(cap and occupied >= cap)
    closed = state in ('cancelled', 'completed', 'expired')
    price_text = _price(price)
    if closed:
        meta_title = f"{title} • {state.title()}"
    elif full:
        meta_title = f"{title} • Full" + (f" ({waiting} on Waitlist)" if waiting is not None else '')
    else:
        meta_title = f"{title} • {price_text}" + (f" ({occupied}/{cap} Spots Filled)" if cap else '')
    details = _date(date) + (f" • {departure}" if departure else '')
    if meeting:
        details += f" • Meet: {meeting}"
    if payment:
        details += f". {payment}"
    details += ". Tap to view details and join on Home Office."
    palette_text = f"{category} {title} {template}".lower()
    palette = next((i for i, words in enumerate(KEYWORDS) if any(w in palette_text for w in words)), 1 if kind == 'event' else 0)
    parts = [part.strip() for part in region.split(',') if part.strip()]
    region = (parts[-1] if len(parts) > 1 else '') or 'HOME OFFICE'
    return dict(name=title, title=meta_title, description=details, url=f"{origin}/e/{slug}",
                image_url=f"{origin}/api/og/events/{slug}.jpg", kind=kind, id=str(item_id),
                confirmed=confirmed, occupied=occupied, capacity=cap, waiting=waiting, full=full,
                closed=closed, state=state, price=price_text, payment=payment, date=_date(date), departure=departure,
                meeting=meeting, region=region, handle=host.vendor_handle, level=level, rank=RANK_LABELS[level],
                palette=palette, images=images)


async def banner_bytes(images):
    # Read only our own validated storage keys, never user-supplied remote URLs.
    for item in images:
        url = item if isinstance(item, str) else item.get('url', '') if isinstance(item, dict) else ''
        path = urlsplit(url).path
        if not path.startswith('/static/'):
            continue
        key = path[len('/static/'):]
        if not MEDIA_KEY.fullmatch(key):
            continue
        try:
            found = await storage.read(key)
            if found and found[1].startswith('image/') and len(found[0]) <= 10 * 1024 * 1024:
                return found[0]
        except Exception:
            continue
    return None


def render_event_card(card, banner=None):
    image = Image.new('RGB', (WIDTH, HEIGHT), (246,247,244))
    draw = ImageDraw.Draw(image)
    start, end, ink = PALETTES[card['palette']]
    for y in range(190):
        t = y / 189
        draw.line((0,y,760,y), fill=tuple(round(a*(1-t)+b*t) for a,b in zip(start,end)))
    if banner:
        try:
            with Image.open(io.BytesIO(banner)) as photo:
                if photo.width * photo.height <= 25_000_000:
                    image.paste(ImageOps.fit(photo.convert('RGB'), (760,190)), (0,0))
        except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError):
            pass
    draw = ImageDraw.Draw(image)
    # Palette-specific line icon silhouettes mirror categoryArt's Lucide icons.
    p = card['palette']
    if p == 0:  # ShoppingBasket
        draw.line((664,63,724,63), fill=ink, width=4)
        draw.polygon([(669,63),(718,63),(710,100),(677,100)], outline=ink, width=4)
        draw.line((680,63,693,39,706,63), fill=ink, width=4)
    elif p == 1:  # CalendarDays
        draw.rounded_rectangle((665,42,723,101), radius=6, outline=ink, width=4)
        draw.line((665,59,723,59), fill=ink, width=4)
        draw.line((681,34,681,49), fill=ink, width=4)
        draw.line((706,34,706,49), fill=ink, width=4)
    elif p == 2:  # Bike
        draw.ellipse((660,74,684,98), outline=ink, width=4)
        draw.ellipse((708,74,732,98), outline=ink, width=4)
        draw.line((672,86,688,62,707,86,672,86,693,72,720,86), fill=ink, width=4)
    elif p == 3:  # Users
        draw.ellipse((681,37,703,59), outline=ink, width=4)
        draw.arc((667,63,717,105), 180, 360, fill=ink, width=4)
        draw.arc((705,47,724,68), 270, 90, fill=ink, width=4)
    elif p == 4:  # Wrench
        draw.line((668,100,709,59), fill=ink, width=7)
        draw.arc((699,36,727,64), 25, 300, fill=ink, width=4)
    elif p == 5:  # GraduationCap
        draw.polygon([(659,57),(694,39),(729,57),(694,75)], outline=ink, width=4)
        draw.line((673,65,673,84,694,94,715,84,715,65), fill=ink, width=4)
    else:  # HeartPulse
        draw.line((663,71,678,71,685,54,694,91,702,66,708,71,725,71), fill=ink, width=4)
    badge = f"{card['region'].upper()} • {'EVENT' if card['kind'] == 'event' else 'BULK BUY'}"
    draw.rounded_rectangle((42,46, min(620, 85 + _measure(badge, _font(20))), 88), radius=20, fill=FOREST)
    draw.text((62,54), badge, font=_font(20), fill=WHITE)
    for i, line in enumerate(_wrap(card['name'], _font(48), 675, max_lines=2)):
        draw.text((42,218+i*59), line, font=_font(48), fill=INK)
    date = card['date'] + (f" • {card['departure']}" if card['departure'] else '')
    draw.text((42,365), date, font=_font(26), fill=INK_SOFT)
    for i, line in enumerate(_wrap('Meet: ' + (card['meeting'] or 'To be announced'), _font(24), 670, 2)):
        draw.text((42,408+i*30), line, font=_font(24), fill=INK_SOFT)
    draw.text((42,527), f"Hosted by /p/{card['handle']}", font=_font(23), fill=FOREST)
    draw.text((42,559), f"Level {card['level']} • {card['rank']}", font=_font(21), fill=INK_SOFT)
    draw.rounded_rectangle((785,38,1165,592), radius=28, fill=WHITE)
    draw.text((815,78), 'PRICE', font=_font(20), fill=INK_SOFT)
    for i, line in enumerate(_wrap(card['price'], _font(43), 310, 2)):
        draw.text((815,113+i*50), line, font=_font(43), fill=FOREST)
    draw.rounded_rectangle((810,235,1140,330), radius=18, fill=(230,244,235))
    for i, line in enumerate(_wrap(card['payment'] or 'Payment details in app', _font(22), 285, 3)):
        draw.text((827,246+i*26), line, font=_font(22), fill=FOREST)
    if card['closed']:
        status = card['state'].title()
    elif card['full']:
        status = 'Waitlist open' if card['waiting'] is not None else 'Full'
    else:
        status = f"{card['confirmed']} / {card['capacity']} confirmed" if card['capacity'] else f"{card['confirmed']} confirmed"
    for i, line in enumerate(_wrap(status, _font(26), 310, 2)):
        draw.text((815,385+i*32), line, font=_font(26), fill=AMBER if card['full'] else FOREST)
    if card['full'] and card['waiting'] is not None:
        draw.text((815,451), f"{card['waiting']} waiting", font=_font(21), fill=INK_SOFT)
    if card['capacity']:
        draw.rounded_rectangle((815,493,1135,507), radius=7, fill=(226,232,227))
        width = round(320 * min(1, card['occupied'] / card['capacity']))
        if width:
            draw.rounded_rectangle((815,493,815+width,507), radius=7, fill=AMBER if card['full'] else FOREST)
    # Guarantee the requested limit, including photo banners.
    for quality in (82, 68, 52, 35, 20):
        out = io.BytesIO()
        image.save(out, 'JPEG', quality=quality, optimize=True, progressive=True)
        if out.tell() < 150_000:
            return out.getvalue()
    return render_event_card(card) if banner else out.getvalue()
