"""Atomic profile handle namespace shared by signup and handle changes."""
import re
from datetime import datetime, timedelta
from sqlalchemy import select, text
from fastapi import HTTPException
from app.models.vendor import Vendor, ProfileHandleRedirect

RESERVED = frozenset('admin api app auth create discover e explore home inbox invite login logout p receipts regions settings signup support trades you'.split())
PATTERN = re.compile(r'^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$')


def valid_new_handle(raw):
    value = raw.strip().lower()
    if not PATTERN.fullmatch(value) or '--' in value:
        raise HTTPException(422, 'Use 1–30 lowercase letters, digits and single hyphens; start and end with a letter or digit.')
    if value in RESERVED:
        raise HTTPException(422, 'This handle is reserved')
    return value


async def lock_namespace(db):
    # Cross-table uniqueness: both signup and changes take the same lock before
    # checking either current handles or aliases, including concurrent reclaim.
    await db.execute(text('SELECT pg_advisory_xact_lock(83215065)'))


async def resolve_alias(db, handle):
    row = (await db.execute(select(Vendor.vendor_handle).join(ProfileHandleRedirect, ProfileHandleRedirect.vendor_id == Vendor.id).where(
        ProfileHandleRedirect.old_handle == handle.lower().lstrip('@'), Vendor.fraud_suspended_at.is_(None),
        ~Vendor.vendor_handle.like('closed\\_%', escape='\\')
    ))).scalar_one_or_none()
    return row


async def change_handle(db, vendor_id, raw):
    handle = valid_new_handle(raw)
    await lock_namespace(db)
    vendor = await db.get(Vendor, vendor_id, with_for_update=True)
    if handle == vendor.vendor_handle:
        return vendor
    now = datetime.utcnow()
    if vendor.handle_changed_at and vendor.handle_changed_at > now - timedelta(days=30):
        raise HTTPException(429, 'HANDLE_COOLDOWN_ACTIVE')
    if (await db.execute(select(Vendor.id).where(Vendor.vendor_handle == handle))).scalar_one_or_none():
        raise HTTPException(409, 'HANDLE_TAKEN')
    alias = await db.get(ProfileHandleRedirect, handle)
    if alias and alias.vendor_id != vendor.id:
        raise HTTPException(409, 'HANDLE_TAKEN')
    if alias:
        await db.delete(alias)
        await db.flush()
    db.add(ProfileHandleRedirect(old_handle=vendor.vendor_handle, vendor_id=vendor.id, created_at=now))
    vendor.vendor_handle = handle
    vendor.handle_changed_at = now
    await db.commit()
    return vendor
