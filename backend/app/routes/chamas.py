"""Digital chamas (v2.5, Layer 2) — table banking API.

Formation (from a group-buy cluster or open), membership, deposits, peer-vote
loans, repayments and dividend distribution. All money moves through the PSP
abstraction and the custody ledger; these endpoints orchestrate the business
rules on top.
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.chamas import Chama, ChamaDividend, ChamaLoan, ChamaLoanVote, ChamaMember
from app.models.groups import VendorGroup
from app.models.market_locks import MarketZone
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services import biashara, chamas as chama_service, custody
from app.services.payments import PaymentError

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ChamaCreate(BaseModel):
    model_config = {"protected_namespaces": ()}

    name: str = Field(min_length=3, max_length=160)
    description: Optional[str] = Field(None, max_length=1000)
    scope: str = Field("group", pattern="^(group|open)$")
    group_id: Optional[uuid.UUID] = None
    zone_id: Optional[uuid.UUID] = None
    # v2.6 halal-trade: 'conventional_interest' (default) or the zero-interest
    # Halal pools 'qard_hasan' | 'musharakah_trade' | 'murabaha_credit'.
    model_type: str = Field(
        "conventional_interest",
        pattern="^(conventional_interest|qard_hasan|musharakah_trade|murabaha_credit)$",
    )
    min_deposit_ksh: int = Field(500, ge=50, le=100_000)
    max_loan_ksh: int = Field(10_000, ge=500, le=5_000_000)
    interest_rate: float = Field(0.05, gt=0, le=0.5)   # per cycle
    cycle_days: int = Field(7, ge=3, le=90)
    approval_rate: float = Field(0.7, gt=0, le=1)
    min_members: int = Field(5, ge=3, le=30)
    max_members: int = Field(30, ge=3, le=100)


class AmountIn(BaseModel):
    amount_ksh: int = Field(gt=0, le=5_000_000)
    provider: Optional[str] = Field(None, pattern="^(MPESA|AIRTEL|TKASH|CARD|BANK)$")


class LoanRequest(BaseModel):
    amount_ksh: int = Field(gt=0, le=5_000_000)
    purpose: Optional[str] = Field(None, max_length=400)


class VoteIn(BaseModel):
    vote: str = Field(pattern="^(approve|decline)$")


class RoleIn(BaseModel):
    vendor_id: uuid.UUID
    role: str = Field(pattern="^(member|chair|treasurer)$")


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------

async def _member_out(db: AsyncSession, chama: Chama, membership: ChamaMember) -> dict:
    vendor = await db.get(Vendor, membership.vendor_id)
    total = await chama_service.total_deposits(db, chama.id, membership.vendor_id)
    return {
        "vendor_id": str(membership.vendor_id),
        "vendor_handle": vendor.vendor_handle if vendor else None,
        "business_name": vendor.business_name if vendor else None,
        "role": membership.role,
        "total_deposits_ksh": total,
        "joined_at": membership.joined_at.isoformat() if membership.joined_at else None,
    }


async def _loan_out(db: AsyncSession, loan: ChamaLoan, vendor: Vendor, *, with_votes: bool = False) -> dict:
    borrower = await db.get(Vendor, loan.borrower_id)
    out = {
        "id": str(loan.id),
        "borrower_id": str(loan.borrower_id),
        "borrower_handle": borrower.vendor_handle if borrower else None,
        "borrower_name": borrower.business_name if borrower else None,
        "amount_ksh": loan.amount_ksh,
        "interest_ksh": loan.interest_ksh,
        "fee_ksh": loan.fee_ksh,
        "total_due_ksh": loan.total_due_ksh,
        "purpose": loan.purpose,
        "cycle_issued": loan.cycle_issued,
        "cycle_due": loan.cycle_due,
        "status": loan.status,
        "disbursement_id": str(loan.disbursement_id) if loan.disbursement_id else None,
        "repayment_intent_id": str(loan.repayment_intent_id) if loan.repayment_intent_id else None,
        "created_at": loan.created_at.isoformat() if loan.created_at else None,
        "decided_at": loan.decided_at.isoformat() if loan.decided_at else None,
        "disbursed_at": loan.disbursed_at.isoformat() if loan.disbursed_at else None,
        "repaid_at": loan.repaid_at.isoformat() if loan.repaid_at else None,
    }
    if with_votes:
        votes = (await db.execute(select(ChamaLoanVote).where(
            ChamaLoanVote.loan_id == loan.id))).scalars().all()
        out["approvals"] = sum(1 for v in votes if v.vote == "approve")
        out["declines"] = sum(1 for v in votes if v.vote == "decline")
        out["my_vote"] = next((v.vote for v in votes if v.voter_id == vendor.id), None)
    return out


async def _chama_summary(db: AsyncSession, chama: Chama, vendor: Vendor) -> dict:
    zone = await db.get(MarketZone, chama.zone_id) if chama.zone_id else None
    memberships = (await db.execute(select(ChamaMember).where(
        ChamaMember.chama_id == chama.id
    ).order_by(ChamaMember.joined_at))).scalars().all()
    my = next((m for m in memberships if m.vendor_id == vendor.id), None)
    pool = await chama_service.pool_balance(db, chama)
    pending = (await db.execute(select(ChamaLoan).where(
        ChamaLoan.chama_id == chama.id, ChamaLoan.status == "pending_vote",
    ).order_by(ChamaLoan.created_at))).scalars().all()
    my_loans = (await db.execute(select(ChamaLoan).where(
        ChamaLoan.chama_id == chama.id, ChamaLoan.borrower_id == vendor.id,
    ).order_by(ChamaLoan.created_at.desc()).limit(20))).scalars().all()
    my_dividends = (await db.execute(
        select(ChamaDividend).where(
            ChamaDividend.chama_id == chama.id,
            ChamaDividend.vendor_id == vendor.id,
            ChamaDividend.status == "paid",
        )
    )).scalars().all()
    score = await biashara.vendor_score(db, vendor.id)

    return {
        "id": str(chama.id),
        "name": chama.name,
        "description": chama.description,
        "scope": chama.scope,
        "group_id": str(chama.group_id) if chama.group_id else None,
        "zone": None if zone is None else {"id": str(zone.id), "name": zone.name},
        "created_by_vendor_id": str(chama.created_by_vendor_id) if chama.created_by_vendor_id else None,
        "model_type": chama.model_type,
        "terms": {
            "min_deposit_ksh": int(chama.min_deposit_ksh),
            "max_loan_ksh": int(chama.max_loan_ksh),
            "interest_rate": float(chama.interest_rate),
            "qard_admin_fee_ksh": int(settings.CHAMA_QARD_ADMIN_FEE_KSH)
            if chama.model_type in chama_service.HALAL_POOL_MODELS else 0,
            "cycle_days": int(chama.cycle_days),
            "approval_rate": float(chama.approval_rate),
            "min_members": int(chama.min_members),
            "max_members": int(chama.max_members),
        },
        "status": chama.status,
        "active_at": chama.active_at.isoformat() if chama.active_at else None,
        "pool_balance_ksh": pool,
        "current_cycle": chama_service.current_cycle(chama),
        "last_dividend_cycle": chama.last_dividend_cycle,
        "my": None if my is None else {
            "role": my.role,
            "total_deposits_ksh": await chama_service.total_deposits(db, chama.id, vendor.id),
            "total_dividends_ksh": int(sum(d.amount_ksh for d in my_dividends)),
            "biashara_score": score,
        },
        "members": [await _member_out(db, chama, m) for m in memberships],
        "pending_loans": [
            {**await _loan_out(db, loan, vendor, with_votes=True),
             "quorum_needed": chama_service.loan_quorum(chama, len(memberships))}
            for loan in pending
        ],
        "my_loans": [await _loan_out(db, loan, vendor) for loan in my_loans],
    }


# ---------------------------------------------------------------------------
# Formation & membership
# ---------------------------------------------------------------------------

@router.post("", status_code=201)
async def create_chama(
    data: ChamaCreate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    if data.scope == "group" and data.group_id:
        group = await db.get(VendorGroup, data.group_id)
        if group is None:
            raise HTTPException(404, "Group not found")
    if data.zone_id:
        zone = await db.get(MarketZone, data.zone_id)
        if zone is None:
            raise HTTPException(404, "Market zone not found")
    try:
        chama = await chama_service.create_chama(
            db, vendor,
            name=data.name, description=data.description or "",
            scope=data.scope, group_id=data.group_id, zone_id=data.zone_id,
            model_type=data.model_type,
            min_deposit_ksh=data.min_deposit_ksh, max_loan_ksh=data.max_loan_ksh,
            interest_rate=data.interest_rate, cycle_days=data.cycle_days,
            approval_rate=data.approval_rate, min_members=data.min_members,
            max_members=data.max_members,
        )
    except PaymentError as exc:
        raise HTTPException(400, str(exc))
    await db.commit()
    return await _chama_summary(db, chama, vendor)


@router.get("/mine")
async def my_chamas(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    memberships = (await db.execute(select(ChamaMember).where(
        ChamaMember.vendor_id == vendor.id))).scalars().all()
    out = []
    for membership in memberships:
        chama = await db.get(Chama, membership.chama_id)
        if chama is None:
            continue
        summary = await _chama_summary(db, chama, vendor)
        out.append(summary)
    return out


@router.get("/browse")
async def browse_chamas(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    """Open chamas plus chamas of groups you belong to."""
    from app.models.groups import GroupMembership
    from sqlalchemy import or_

    my_groups = (await db.execute(select(GroupMembership.group_id).where(
        GroupMembership.vendor_id == vendor.id, GroupMembership.is_active.is_(True),
    ))).scalars().all()
    stmt = select(Chama).where(Chama.status.in_(("forming", "active")))
    stmt = stmt.where(or_(Chama.scope == "open", Chama.group_id.in_(my_groups or [uuid.uuid4()])))
    chamas_ = (await db.execute(stmt.order_by(Chama.created_at.desc()).limit(50))).scalars().all()
    return [{
        "id": str(c.id), "name": c.name, "description": c.description, "scope": c.scope,
        "group_id": str(c.group_id) if c.group_id else None,
        "status": c.status,
        "members": await chama_service.member_count(db, c.id),
        "min_members": int(c.min_members),
        "max_loan_ksh": int(c.max_loan_ksh),
        "interest_rate": float(c.interest_rate),
        "cycle_days": int(c.cycle_days),
        "created_at": c.created_at.isoformat() if c.created_at else None,
    } for c in chamas_]


@router.get("/{chama_id}")
async def get_chama(
    chama_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    chama = await chama_service.get_chama_or_404(db, chama_id)
    if not await chama_service.get_membership(db, chama.id, vendor.id):
        raise HTTPException(403, "Only members can see this chama")
    return await _chama_summary(db, chama, vendor)


@router.post("/{chama_id}/join")
async def join_chama(
    chama_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    chama = await chama_service.get_chama_or_404(db, chama_id)
    await chama_service.join_chama(db, chama, vendor)
    await db.commit()
    return await _chama_summary(db, chama, vendor)


@router.post("/{chama_id}/roles")
async def set_member_role(
    chama_id: uuid.UUID,
    data: RoleIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    chama = await chama_service.get_chama_or_404(db, chama_id)
    await chama_service.set_role(db, chama, vendor, data.vendor_id, data.role)
    await db.commit()
    return await _chama_summary(db, chama, vendor)


@router.post("/{chama_id}/dissolve")
async def dissolve_chama(
    chama_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    chama = await chama_service.get_chama_or_404(db, chama_id)
    await chama_service.dissolve_chama(db, chama, vendor)
    await db.commit()
    return {"id": str(chama.id), "status": chama.status}


# ---------------------------------------------------------------------------
# Deposits
# ---------------------------------------------------------------------------

@router.post("/{chama_id}/deposits", status_code=201)
async def make_deposit(
    chama_id: uuid.UUID,
    data: AmountIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Start a deposit: the PSP shows the vendor a payment prompt (M-Pesa PIN).
    The money counts — and the pool balance rises — only when the PSP's
    payment.completed webhook lands."""
    chama = await chama_service.get_chama_or_404(db, chama_id)
    try:
        return await chama_service.deposit(db, chama, vendor, data.amount_ksh, data.provider)
    except PaymentError as exc:
        raise HTTPException(400, str(exc))


@router.get("/{chama_id}/deposits")
async def my_deposits(
    chama_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    from app.models.chamas import ChamaDeposit

    chama = await chama_service.get_chama_or_404(db, chama_id)
    await chama_service.require_membership(db, chama, vendor)
    rows = (await db.execute(select(ChamaDeposit).where(
        ChamaDeposit.chama_id == chama.id, ChamaDeposit.vendor_id == vendor.id,
    ).order_by(ChamaDeposit.created_at.desc()).limit(200))).scalars().all()
    return [{
        "id": str(d.id), "amount_ksh": d.amount_ksh, "cycle_number": d.cycle_number,
        "created_at": d.created_at.isoformat() if d.created_at else None,
    } for d in rows]


# ---------------------------------------------------------------------------
# Loans
# ---------------------------------------------------------------------------

@router.post("/{chama_id}/loans", status_code=201)
async def apply_for_loan(
    chama_id: uuid.UUID,
    data: LoanRequest,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    chama = await chama_service.get_chama_or_404(db, chama_id)
    loan = await chama_service.apply_for_loan(db, chama, vendor, data.amount_ksh, data.purpose or "")
    await db.commit()
    return await _loan_out(db, loan, vendor, with_votes=True)


@router.get("/{chama_id}/loans")
async def list_loans(
    chama_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    chama = await chama_service.get_chama_or_404(db, chama_id)
    await chama_service.require_membership(db, chama, vendor)
    recent = (await db.execute(select(ChamaLoan).where(
        ChamaLoan.chama_id == chama.id, ChamaLoan.status != "pending_vote",
    ).order_by(ChamaLoan.created_at.desc()).limit(50))).scalars().all()
    pending = (await db.execute(select(ChamaLoan).where(
        ChamaLoan.chama_id == chama.id, ChamaLoan.status == "pending_vote",
    ).order_by(ChamaLoan.created_at))).scalars().all()
    return {
        "pending": [await _loan_out(db, l, vendor, with_votes=True) for l in pending],
        "recent": [await _loan_out(db, l, vendor) for l in recent],
    }


@router.post("/loans/{loan_id}/vote")
async def vote_on_loan(
    loan_id: uuid.UUID,
    data: VoteIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    loan = await db.get(ChamaLoan, loan_id, with_for_update=True)
    if loan is None:
        raise HTTPException(404, "Loan not found")
    chama = await db.get(Chama, loan.chama_id)
    result = await chama_service.vote_on_loan(db, chama, loan, vendor, data.vote)
    await db.commit()
    return result


@router.post("/loans/{loan_id}/repay", status_code=201)
async def repay_loan(
    loan_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    loan = await db.get(ChamaLoan, loan_id, with_for_update=True)
    if loan is None:
        raise HTTPException(404, "Loan not found")
    chama = await db.get(Chama, loan.chama_id)
    try:
        return await chama_service.repay_loan(db, chama, loan, vendor)
    except PaymentError as exc:
        raise HTTPException(400, str(exc))


@router.post("/loans/{loan_id}/retry-disbursement")
async def retry_loan_disbursement(
    loan_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    loan = await db.get(ChamaLoan, loan_id, with_for_update=True)
    if loan is None:
        raise HTTPException(404, "Loan not found")
    chama = await db.get(Chama, loan.chama_id)
    await chama_service.retry_loan_disbursement(db, chama, loan, vendor)
    await db.commit()
    return {"id": str(loan.id), "status": loan.status}


@router.post("/loans/{loan_id}/default")
async def mark_loan_defaulted(
    loan_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    loan = await db.get(ChamaLoan, loan_id, with_for_update=True)
    if loan is None:
        raise HTTPException(404, "Loan not found")
    chama = await db.get(Chama, loan.chama_id)
    await chama_service.mark_loan_defaulted(db, chama, loan, vendor)
    await db.commit()
    return {"id": str(loan.id), "status": loan.status}


# ---------------------------------------------------------------------------
# Dividends
# ---------------------------------------------------------------------------

@router.post("/{chama_id}/dividends", status_code=201)
async def distribute_dividends(
    chama_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Chair distributes the pool's net interest, proportional to deposit share."""
    chama = await chama_service.get_chama_or_404(db, chama_id)
    result = await chama_service.distribute_dividends(db, chama, vendor)
    await db.commit()
    return result


@router.get("/{chama_id}/dividends")
async def my_dividends(
    chama_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    chama = await chama_service.get_chama_or_404(db, chama_id)
    await chama_service.require_membership(db, chama, vendor)
    rows = (await db.execute(select(ChamaDividend).where(
        ChamaDividend.chama_id == chama.id, ChamaDividend.vendor_id == vendor.id,
    ).order_by(ChamaDividend.declared_at.desc()).limit(100))).scalars().all()
    return [{
        "id": str(d.id), "amount_ksh": d.amount_ksh,
        "period": {"from": d.period_cycle_from, "to": d.period_cycle_to},
        "status": d.status, "failure_reason": d.failure_reason,
        "paid_at": d.paid_at.isoformat() if d.paid_at else None,
    } for d in rows]


@router.post("/dividends/{dividend_id}/retry")
async def retry_dividend(
    dividend_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    dividend = await db.get(ChamaDividend, dividend_id, with_for_update=True)
    if dividend is None:
        raise HTTPException(404, "Dividend not found")
    chama = await db.get(Chama, dividend.chama_id)
    await chama_service.retry_dividend(db, chama, dividend, vendor)
    await db.commit()
    return {"id": str(dividend.id), "status": dividend.status}


# ---------------------------------------------------------------------------
# Pool ledger (members can audit the pool)
# ---------------------------------------------------------------------------

class ProfitIn(BaseModel):
    amount_ksh: int = Field(ge=100, le=1_000_000)
    note: Optional[str] = Field(None, max_length=400)


@router.post("/{chama_id}/profit", status_code=201)
async def contribute_profit(
    chama_id: uuid.UUID,
    data: ProfitIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Remit realised joint-venture (musharakah) profit to a Halal pool."""
    chama = await db.get(Chama, chama_id)
    if chama is None:
        raise HTTPException(404, "Chama not found")
    try:
        result = await chama_service.contribute_profit(
            db, chama, vendor, data.amount_ksh, data.note,
        )
    except PaymentError as exc:
        raise HTTPException(400, str(exc))
    await db.commit()
    return result


@router.get("/{chama_id}/ledger")
async def chama_ledger(
    chama_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
    limit: int = 100,
):
    from app.models.payments import CustodyLedgerEntry

    chama = await chama_service.get_chama_or_404(db, chama_id)
    await chama_service.require_membership(db, chama, vendor)
    if not chama.psp_sub_account:
        return {"entries": [], "pool_balance_ksh": 0}
    rows = (await db.execute(
        select(CustodyLedgerEntry).where(
            CustodyLedgerEntry.psp_sub_account == chama.psp_sub_account,
        ).order_by(CustodyLedgerEntry.created_at.desc(), CustodyLedgerEntry.id.desc()).limit(limit)
    )).scalars().all()
    return {
        "pool_balance_ksh": await custody.sub_balance(db, chama.psp_sub_account),
        "entries": [{
            "id": str(r.id), "transaction_type": r.transaction_type,
            "amount_ksh": r.amount_ksh, "direction": r.direction,
            "running_balance_ksh": r.running_balance_ksh,
            "vendor_id": str(r.vendor_id) if r.vendor_id else None,
            "psp_reference": r.psp_reference,
            "notes": r.notes,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in rows],
    }
