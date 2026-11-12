"""Credential rules. The routes only parse and call these functions.

- A provider adds and removes their own credentials. Nothing they add is ever verified.
- Only an operator moves a credential to verified or rejected, and the operator is recorded.
- The public sees a credential only while it is self_declared or verified. Registration numbers
  are kept to the owner and operators: a self-declared number is not shown to strangers.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.credential import PUBLIC_STATUSES, REVIEW_QUEUE_STATUSES, VendorCredential

MAX_PER_VENDOR = 10


class CredentialError(Exception):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.status = status


def _clean(value, label: str, limit: int) -> str:
    text = (value or "").strip()
    if not text:
        raise CredentialError(f"Give {label}.")
    if len(text) > limit:
        raise CredentialError(f"{label[0].upper() + label[1:]} must be {limit} characters or fewer.")
    return text


def _owner_view(c: VendorCredential) -> dict:
    return {
        "id": str(c.id),
        "issuing_body": c.issuing_body,
        "registration_number": c.registration_number,
        "title": c.title,
        "status": c.status,
        "verified_at": c.verified_at.isoformat() if c.verified_at else None,
        "rejection_reason": c.rejection_reason,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def public_view(c: VendorCredential) -> dict:
    """What a stranger may see: no registration number, no verifier identity."""
    return {
        "issuing_body": c.issuing_body,
        "title": c.title,
        "status": c.status,
        "verified_at": c.verified_at.isoformat() if c.verified_at else None,
    }


async def add(db: AsyncSession, vendor_id: uuid.UUID, data: dict) -> dict:
    issuing_body = _clean(data.get("issuing_body"), "the issuing body", 150)
    registration_number = _clean(data.get("registration_number"), "the registration number", 100)
    title = _clean(data.get("title"), "a title", 150)
    count = (await db.execute(
        select(func.count()).select_from(VendorCredential).where(VendorCredential.vendor_id == vendor_id)
    )).scalar_one()
    if count >= MAX_PER_VENDOR:
        raise CredentialError(f"You can list up to {MAX_PER_VENDOR} credentials.")
    now = datetime.utcnow()
    row = VendorCredential(
        vendor_id=vendor_id, issuing_body=issuing_body, registration_number=registration_number,
        title=title, status="self_declared", created_at=now, updated_at=now,
    )
    db.add(row)
    await db.commit()
    return _owner_view(row)


async def mine(db: AsyncSession, vendor_id: uuid.UUID) -> list:
    rows = (await db.execute(
        select(VendorCredential).where(VendorCredential.vendor_id == vendor_id)
        .order_by(VendorCredential.created_at)
    )).scalars().all()
    return [_owner_view(r) for r in rows]


async def remove(db: AsyncSession, vendor_id: uuid.UUID, credential_id: uuid.UUID) -> None:
    row = (await db.execute(
        select(VendorCredential).where(VendorCredential.id == credential_id, VendorCredential.vendor_id == vendor_id)
    )).scalar_one_or_none()
    if row is None:
        raise CredentialError("That credential was not found.", 404)
    await db.delete(row)
    await db.commit()


async def public_for_vendors(db: AsyncSession, vendor_ids: list) -> dict:
    """{vendor_id: [public credential views]} for many people, in one query."""
    out: dict = {vid: [] for vid in vendor_ids}
    if not vendor_ids:
        return out
    rows = (await db.execute(
        select(VendorCredential).where(
            VendorCredential.vendor_id.in_(vendor_ids),
            VendorCredential.status.in_(PUBLIC_STATUSES),
        ).order_by(VendorCredential.created_at)
    )).scalars().all()
    for r in rows:
        out[r.vendor_id].append(public_view(r))
    return out


async def public_for_handle_vendor(db: AsyncSession, vendor_id: uuid.UUID) -> list:
    return (await public_for_vendors(db, [vendor_id])).get(vendor_id, [])


async def review_queue(db: AsyncSession) -> list:
    rows = (await db.execute(
        select(VendorCredential).where(VendorCredential.status.in_(REVIEW_QUEUE_STATUSES))
        .order_by(VendorCredential.created_at)
    )).scalars().all()
    return [_owner_view(r) for r in rows]


async def _decidable(db: AsyncSession, credential_id: uuid.UUID) -> VendorCredential:
    row = await db.get(VendorCredential, credential_id)
    if row is None:
        raise CredentialError("That credential was not found.", 404)
    if row.status not in REVIEW_QUEUE_STATUSES:
        raise CredentialError(f"This credential is already {row.status.replace('_', ' ')}.", 409)
    return row


async def verify(db: AsyncSession, operator_vendor_id: uuid.UUID, credential_id: uuid.UUID) -> dict:
    row = await _decidable(db, credential_id)
    now = datetime.utcnow()
    row.status = "verified"
    row.verified_at = now
    row.verified_by_vendor_id = operator_vendor_id
    row.rejection_reason = None
    row.updated_at = now
    await db.commit()
    return _owner_view(row)


async def reject(db: AsyncSession, operator_vendor_id: uuid.UUID, credential_id: uuid.UUID,
                 reason: Optional[str]) -> dict:
    row = await _decidable(db, credential_id)
    now = datetime.utcnow()
    row.status = "rejected"
    row.verified_at = None
    row.verified_by_vendor_id = operator_vendor_id
    row.rejection_reason = (reason or "").strip() or "Could not be confirmed."
    row.updated_at = now
    await db.commit()
    return _owner_view(row)
