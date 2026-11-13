"""Ecosystem integrations (P4). Records facts that come from outside systems, with provenance.

P4.1  The fallback ladder lives here, once:  API -> authenticated export -> attested upload -> manual.
      Every recorded fact names its method. A method with no connected adapter is refused, and the
      response names the next rung that is available. No adapter is connected yet, so 'api' is always refused.
P4.2  eTIMS status, KRA PIN / tax compliance and BRS company record (CR12) are recorded with source and
      timestamp. A failed attempt is recorded as 'failed'. The platform never softens a failure.
P4.4  Official e-GP links are returned as links only. Nothing is re-hosted or re-submitted.

The platform is not a system of record. A fact here is a claim with provenance, not a certificate.
"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.external_fact import FACT_METHODS, ExternalFact

LADDER = ("api", "export", "attested_upload", "manual")

# Adapters that talk to an outside system. None is connected yet, so the API rung is always refused.
ADAPTERS: dict = {}

FACT_KINDS = {
    "etims_status": {"label": "eTIMS status", "source": "KRA eTIMS"},
    "kra_pin_tcc": {"label": "KRA PIN and tax compliance certificate", "source": "KRA iTax"},
    "brs_cr12": {"label": "Company record (CR12)", "source": "BRS"},
}

# Official e-GP entry points. Taken from public guides; the owner should confirm them before launch.
EGP_LINKS = [
    {"label": "e-GP Kenya (procurement lifecycle)", "url": "https://egpkenya.go.ke"},
    {"label": "PPIP, Public Procurement Information Portal (tenders)", "url": "https://tenders.go.ke"},
]

REVIEW_DAYS = 365
REFERENCE_MAX = 200
NOTE_MAX = 500


class IntegrationError(Exception):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.message = message
        self.status = status


def next_rung(method: str):
    """The rung after `method` on the ladder, or None if it is the last."""
    i = LADDER.index(method)
    return LADDER[i + 1] if i + 1 < len(LADDER) else None


def available_methods() -> list:
    """Rungs a business can use today. 'api' only appears once an adapter is connected."""
    return [m for m in LADDER if m != "api" or ADAPTERS]


def _text(value, label: str, limit: int, *, required: bool = False):
    if value is None or not str(value).strip():
        if required:
            raise IntegrationError(f"Enter {label}.")
        return None
    s = str(value).strip()
    if len(s) > limit:
        raise IntegrationError(f"{label[0].upper() + label[1:]} is too long (max {limit} characters).")
    return s


def _view(f: ExternalFact) -> dict:
    now = datetime.utcnow()
    return {
        "id": str(f.id),
        "fact_kind": f.fact_kind,
        "label": FACT_KINDS.get(f.fact_kind, {}).get("label", f.fact_kind),
        "state": f.state,
        "method": f.method,
        "source_system": f.source_system,
        "reference": f.reference,
        "note": f.note,
        "fetched_at": f.fetched_at.isoformat(),
        "reviewed_at": f.reviewed_at.isoformat() if f.reviewed_at else None,
        "next_review_at": f.next_review_at.isoformat() if f.next_review_at else None,
        "review_due": bool(f.next_review_at and f.next_review_at < now),
    }


async def record(db: AsyncSession, vendor_id: uuid.UUID, data: dict) -> dict:
    kind = data.get("fact_kind")
    if kind not in FACT_KINDS:
        raise IntegrationError("Choose a fact to record.")
    method = data.get("method")
    if method not in FACT_METHODS:
        raise IntegrationError("Choose how the fact was obtained.")

    if method == "api" and kind not in ADAPTERS:
        raise IntegrationError(
            f"No API connection exists for {FACT_KINDS[kind]['label']}. Use an export or an attested upload instead.",
            409,
        )

    outcome = data.get("outcome", "ok")
    if outcome not in ("ok", "failed"):
        raise IntegrationError("Outcome must be ok or failed.")
    note = _text(data.get("note"), "a note", NOTE_MAX)
    if outcome == "failed" and not note:
        raise IntegrationError("Say what went wrong when an attempt failed.")

    fetched_at = data.get("fetched_at") or datetime.utcnow()
    if isinstance(fetched_at, str):
        try:
            fetched_at = datetime.fromisoformat(fetched_at.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError as exc:
            raise IntegrationError("The date the fact was fetched is not valid.") from exc
    if fetched_at > datetime.utcnow() + timedelta(minutes=5):
        raise IntegrationError("The date the fact was fetched cannot be in the future.")

    row = ExternalFact(
        vendor_id=vendor_id,
        fact_kind=kind,
        state="failed" if outcome == "failed" else "declared",
        method=method,
        source_system=FACT_KINDS[kind]["source"],
        reference=_text(data.get("reference"), "a reference", REFERENCE_MAX),
        note=note,
        fetched_at=fetched_at,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    out = _view(row)
    out["fallback"] = next_rung(method) if outcome == "failed" else None
    return out


async def mine(db: AsyncSession, vendor_id: uuid.UUID) -> dict:
    rows = (await db.execute(
        select(ExternalFact).where(ExternalFact.vendor_id == vendor_id).order_by(ExternalFact.created_at.desc())
    )).scalars().all()
    return {
        "facts": [_view(r) for r in rows],
        "kinds": [{"value": k, "label": v["label"]} for k, v in FACT_KINDS.items()],
        "methods": available_methods(),
        "ladder": list(LADDER),
    }


async def verify(db: AsyncSession, fact_id: uuid.UUID, reviewer_id: uuid.UUID, next_review_at=None) -> dict:
    row = await db.get(ExternalFact, fact_id)
    if row is None:
        raise IntegrationError("That fact was not found.", 404)
    if row.state != "declared":
        raise IntegrationError("Only a declared fact can be verified.", 409)
    now = datetime.utcnow()
    if next_review_at is None:
        next_review_at = now + timedelta(days=REVIEW_DAYS)
    elif isinstance(next_review_at, str):
        try:
            next_review_at = datetime.fromisoformat(next_review_at.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError as exc:
            raise IntegrationError("The next review date is not valid.") from exc
    if next_review_at <= now:
        raise IntegrationError("The next review date must be in the future.")
    row.state = "verified"
    row.reviewer_vendor_id = reviewer_id
    row.reviewed_at = now
    row.next_review_at = next_review_at
    await db.commit()
    await db.refresh(row)
    return _view(row)


async def review_queue(db: AsyncSession) -> list:
    rows = (await db.execute(
        select(ExternalFact).where(ExternalFact.state == "declared").order_by(ExternalFact.created_at)
    )).scalars().all()
    return [{**_view(r), "vendor_id": str(r.vendor_id)} for r in rows]


def links() -> list:
    return [dict(l) for l in EGP_LINKS]
