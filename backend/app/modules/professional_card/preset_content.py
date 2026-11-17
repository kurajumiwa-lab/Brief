"""Public, minimal preset content; never publish personal vouchers or rosters."""
from datetime import datetime
from sqlalchemy import select, or_
from app.models.events import Event
from app.models.stock import StockItem
from app.models.receipts import ReceiptMerchant, ReceiptOffer
from app.modules.ledger.models import LocalActivity
from app.services.discovery_visibility import active_window, scheduled_event_window
from app.services.event_payments import counts_for


async def content(db, vendor, preset, show_offers=True):
    now = datetime.utcnow()
    result = {'shops': [], 'catalog': [], 'offers': [], 'rounds': []}
    if preset == 'shop':
        shops = (await db.execute(select(ReceiptMerchant).where(
            ReceiptMerchant.claimed_by_vendor_id == vendor.id,
            ReceiptMerchant.claim_status.in_(['verified', 'probationary'])
        ).order_by(ReceiptMerchant.name).limit(20))).scalars().all()
        result['shops'] = [{'name': s.name, 'status': s.claim_status} for s in shops]
        if show_offers and shops:
            offers = (await db.execute(select(ReceiptOffer).where(
                ReceiptOffer.merchant_id.in_([s.id for s in shops]), ReceiptOffer.is_active.is_(True),
                ReceiptOffer.starts_at <= now, or_(ReceiptOffer.ends_at.is_(None), ReceiptOffer.ends_at > now)
            ).order_by(ReceiptOffer.ends_at.asc().nullslast(), ReceiptOffer.created_at.desc()).limit(20))).scalars().all()
            result['offers'] = [{'title': o.title, 'discount_kes': o.discount_kes, 'min_spend_kes': o.min_spend_kes, 'points_cost': o.points_cost} for o in offers]
        if show_offers:
            items = (await db.execute(select(StockItem).where(
                StockItem.vendor_id == vendor.id, StockItem.visible_to_network.is_(True), StockItem.quantity_available > 0
            ).order_by(StockItem.created_at.desc()).limit(20))).scalars().all()
            result['catalog'] = [{'id': str(i.id), 'name': i.name, 'price': i.unit_price, 'image': (i.images or [None])[0] if isinstance(i.images, list) else None} for i in items]
    elif preset == 'host':
        events = (await db.execute(select(Event).where(
            Event.organizer_id == vendor.id, Event.status.in_(['upcoming', 'active']),
            Event.group_id.is_(None), Event.vendor_list_id.is_(None),
            scheduled_event_window(now, Event.start_date)
        ).order_by(Event.start_date).limit(20))).scalars().all()
        counts = await counts_for(db, [e.id for e in events], now)
        for event in events:
            n = counts.get(event.id, {})
            result['rounds'].append({'id': str(event.id), 'title': event.title, 'starts_at': event.start_date.isoformat()+'Z',
                'meeting': event.meeting_point or event.location, 'joined': n.get('confirmed_count', 0),
                'capacity': max(0, int(event.max_vendors or 0)), 'url': f'/e/{event.slug or event.id}'})
        acts = (await db.execute(select(LocalActivity).where(
            LocalActivity.organizer_vendor_id == vendor.id, LocalActivity.posting_type == 'scheduled',
            LocalActivity.visibility == 'public', LocalActivity.lifecycle_status.not_in(['cancelled','expired','completed']),
            LocalActivity.starts_at.is_not(None),
            active_window(now, starts_at=LocalActivity.starts_at, expires_at=LocalActivity.expires_at)
        ).order_by(LocalActivity.starts_at).limit(20))).scalars().all()
        for act in acts:
            result['rounds'].append({'id':str(act.id), 'title':act.title, 'starts_at':act.starts_at.isoformat()+'Z',
                'meeting':act.area_name if act.location_scope != 'homestead_private' else None,
                'joined':act.spots_confirmed or 0, 'capacity':act.capacity or 0,
                'url':f'/activities/{act.id}'})
        result['rounds'].sort(key=lambda row: (row['starts_at'],row['id']))
        result['rounds'] = result['rounds'][:20]
    return result
