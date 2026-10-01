"""Digital chamas (v2.5, Layer 2) — table banking services.

A chama pools member deposits into one PSP sub-account and lends to members
by peer vote. The platform provides the ledger, coordination and trust
infrastructure — not the capital.

Money paths (all through the PSP abstraction + custody ledger):

  deposit    vendor → PSP collect → CHAMA_<id>        (chama_pool_in)
  loan       CHAMA_<id> → PSP disburse → borrower     (chama_loan_out)
  repayment  borrower → PSP collect → CHAMA_<id>      (chama_repayment_in)
  dividend   CHAMA_<id> → PSP disburse → members      (chama_dividend_out)

Dividends distribute the pool's net interest
(Σ repayments in − Σ loans out − Σ dividends out), proportionally to each
member's total deposit share, largest-remainder so the integers are exact.
"""

import logging
import math
import uuid
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.chamas import Chama, ChamaDeposit, ChamaDividend, ChamaLoan, ChamaLoanVote, ChamaMember
from app.models.groups import GroupMembership
from app.models.notification import NotificationType
from app.models.vendor import Vendor
from app.services import biashara, custody, psp_client
from app.services.custody import chama_wallet_for
from app.services.disbursements import DisbursementError, request_disbursement
from app.services.governance import add_audit_event
from app.services.notification_service import create_notification, notify_many
from app.services.payments import PaymentError, create_collection_intent, start_collection

log = logging.getLogger("brief.chamas")


class ChamaError(Exception):
    pass


# Halal pool models (v2.6): the pool lends at cost — zero interest.
#  - qard_hasan:        interest-free peer loans; a flat admin fee (PSP costs)
#                       is netted from each payout.
#  - musharakah_trade:  same zero-interest lending; members also remit realised
#                       joint-venture profits to the pool (dividend base).
#  - murabaha_credit:   cost-plus advances funded from the pool.
# Dividends for these pools come from fees + remitted profits, never interest.
HALAL_POOL_MODELS = ("qard_hasan", "musharakah_trade", "murabaha_credit")

MODEL_TYPES = ("conventional_interest",) + HALAL_POOL_MODELS


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def get_chama_or_404(db: AsyncSession, chama_id: uuid.UUID) -> Chama:
    chama = await db.get(Chama, chama_id)
    if chama is None:
        raise HTTPException(404, "Chama not found")
    return chama


async def get_membership(db: AsyncSession, chama_id: uuid.UUID, vendor_id: uuid.UUID) -> Optional[ChamaMember]:
    return (await db.execute(select(ChamaMember).where(
        ChamaMember.chama_id == chama_id, ChamaMember.vendor_id == vendor_id,
    ).with_for_update())).scalar_one_or_none()


async def require_membership(db: AsyncSession, chama: Chama, vendor: Vendor) -> ChamaMember:
    membership = await get_membership(db, chama.id, vendor.id)
    if membership is None:
        raise HTTPException(403, "You are not a member of this chama")
    return membership


async def is_group_member(db: AsyncSession, group_id: uuid.UUID, vendor_id: uuid.UUID) -> bool:
    return (await db.execute(select(GroupMembership.id).where(
        GroupMembership.group_id == group_id,
        GroupMembership.vendor_id == vendor_id,
        GroupMembership.is_active.is_(True),
    ).limit(1))).scalar_one_or_none() is not None


async def member_count(db: AsyncSession, chama_id: uuid.UUID) -> int:
    return int((await db.execute(
        select(func.count(ChamaMember.id)).where(ChamaMember.chama_id == chama_id)
    )).scalar_one() or 0)


async def pool_balance(db: AsyncSession, chama: Chama) -> int:
    if not chama.psp_sub_account:
        return 0
    return await custody.sub_balance(db, chama.psp_sub_account)


def current_cycle(chama: Chama, now: datetime | None = None) -> int:
    """Cycle number: 1 before activation, then advances every cycle_days."""
    if chama.status != "active" or not chama.active_at:
        return 1
    now = now or datetime.utcnow()
    days = max(0, (now - chama.active_at).days)
    return 1 + days // int(chama.cycle_days)


async def total_deposits(db: AsyncSession, chama_id: uuid.UUID, vendor_id: Optional[uuid.UUID] = None) -> int:
    stmt = select(func.coalesce(func.sum(ChamaDeposit.amount_ksh), 0)).where(
        ChamaDeposit.chama_id == chama_id)
    if vendor_id is not None:
        stmt = stmt.where(ChamaDeposit.vendor_id == vendor_id)
    return int((await db.execute(stmt)).scalar_one() or 0)


def loan_quorum(chama: Chama, members: int) -> int:
    """Approvals needed = ceil(approval_rate × eligible voters). The borrower
    does not vote on their own loan, so eligible = members − 1."""
    eligible = max(0, members - 1)
    if eligible == 0:
        return 1
    return max(1, math.ceil(float(chama.approval_rate) * eligible))


async def _chama_wallet(db: AsyncSession, chama: Chama) -> str:
    """The pool wallet, created on first use if activation predates it."""
    sub = chama.psp_sub_account or chama_wallet_for(chama.id)
    psp = psp_client.get_psp_client()
    await psp.create_wallet(sub)
    return sub


# ---------------------------------------------------------------------------
# Formation & membership
# ---------------------------------------------------------------------------

async def create_chama(db: AsyncSession, vendor: Vendor, *, name: str, description: str,
                       scope: str, group_id: Optional[uuid.UUID], zone_id: Optional[uuid.UUID],
                       model_type: str,
                       min_deposit_ksh: int, max_loan_ksh: int, interest_rate: float,
                       cycle_days: int, approval_rate: float,
                       min_members: int, max_members: int) -> Chama:
    name = (name or "").strip()
    if len(name) < 3:
        raise HTTPException(400, "Chama name is too short")
    if min_members > max_members:
        raise HTTPException(400, "Minimum members cannot exceed maximum")
    if min_deposit_ksh <= 0 or max_loan_ksh <= 0:
        raise HTTPException(400, "Deposit and loan limits must be positive")
    model_type = (model_type or "conventional_interest").strip()
    if model_type not in MODEL_TYPES:
        raise HTTPException(400,
                            f"Model must be one of: {', '.join(MODEL_TYPES)}")
    if model_type in HALAL_POOL_MODELS:
        interest_rate = 0.0  # Riba is structurally out; the column stays >= 0
    else:
        if not 0 < float(interest_rate) <= 0.50:
            raise HTTPException(400, "Interest rate must be between 0 and 50% per cycle")
    if cycle_days < 3 or cycle_days > 90:
        raise HTTPException(400, "Cycle must be 3–90 days")
    if not 0 < float(approval_rate) <= 1:
        raise HTTPException(400, "Approval rate must be between 0 and 1")
    if max_members > settings.CHAMA_MAX_MEMBERS:
        raise HTTPException(400, f"A chama can have at most {settings.CHAMA_MAX_MEMBERS} members")

    if scope == "group":
        if group_id is None:
            raise HTTPException(400, "A group chama needs its group")
        if not await is_group_member(db, group_id, vendor.id):
            raise HTTPException(403, "You must be a member of the group to form its chama")
    elif scope != "open":
        raise HTTPException(400, "Scope must be 'group' or 'open'")

    exists = (await db.execute(select(Chama.id).where(Chama.name == name))).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "A chama with that name already exists")

    chama = Chama(
        name=name, description=(description or "").strip() or None,
        scope=scope, group_id=group_id, zone_id=zone_id,
        created_by_vendor_id=vendor.id,
        model_type=model_type,
        min_deposit_ksh=int(min_deposit_ksh), max_loan_ksh=int(max_loan_ksh),
        interest_rate=f"{float(interest_rate):.4f}", cycle_days=int(cycle_days),
        approval_rate=f"{float(approval_rate):.3f}",
        min_members=int(min_members), max_members=int(max_members),
        status="forming",
    )
    db.add(chama)
    await db.flush()
    db.add(ChamaMember(chama_id=chama.id, vendor_id=vendor.id, role="chair"))
    add_audit_event(
        db, actor_type="vendor", actor_id=vendor.id, action="chama_created",
        entity_type="chama", entity_id=chama.id,
        new_state={"name": chama.name, "scope": scope, "model_type": model_type,
                   "status": "forming"},
    )
    await db.flush()
    return chama


async def join_chama(db: AsyncSession, chama: Chama, vendor: Vendor) -> ChamaMember:
    if chama.status not in ("forming", "active"):
        raise HTTPException(400, f"This chama is {chama.status}")
    if await get_membership(db, chama.id, vendor.id):
        raise HTTPException(400, "You are already a member")
    if vendor.finance_mode == "halal_sharia" and chama.model_type == "conventional_interest":
        raise HTTPException(400, "This chama lends with interest; your Halal finance "
                                 "mode only allows interest-free (Qard/Musharakah) chamas")
    if chama.scope == "group" and not await is_group_member(db, chama.group_id, vendor.id):
        raise HTTPException(403, "Only members of the linked group can join this chama")
    count = await member_count(db, chama.id)
    if count >= int(chama.max_members):
        raise HTTPException(400, "This chama is full")

    db.add(ChamaMember(chama_id=chama.id, vendor_id=vendor.id, role="member"))
    await db.flush()
    count += 1
    log.info("chama %s: %s joined (%d/%d)", chama.id, vendor.vendor_handle, count, chama.max_members)

    if chama.status == "forming" and count >= int(chama.min_members):
        await _activate(db, chama)
    return (await db.execute(select(ChamaMember).where(
        ChamaMember.chama_id == chama.id, ChamaMember.vendor_id == vendor.id,
    ))).scalar_one()


async def _activate(db: AsyncSession, chama: Chama) -> None:
    """A forming chama reaches its minimum: open the pool wallet, go active."""
    now = datetime.utcnow()
    chama.status = "active"
    chama.active_at = now
    chama.psp_sub_account = chama_wallet_for(chama.id)
    try:
        await psp_client.get_psp_client().create_wallet(chama.psp_sub_account)
    except psp_client.PSPError as exc:  # pragma: no cover - mock never fails
        log.error("chama %s wallet creation failed: %s", chama.id, exc)
    add_audit_event(
        db, actor_type="system", actor_id=None, action="chama_activated",
        entity_type="chama", entity_id=chama.id,
        new_state={"status": "active", "psp_sub_account": chama.psp_sub_account},
    )
    member_ids = (await db.execute(select(ChamaMember.vendor_id).where(
        ChamaMember.chama_id == chama.id))).scalars().all()
    await notify_many(
        db, member_ids, NotificationType.CHAMA_UPDATE,
        f"{chama.name} is now active",
        "The pool wallet is open. Start depositing — loans unlock once the pool has money.",
        data={"chama_id": str(chama.id)},
    )


async def set_role(db: AsyncSession, chama: Chama, actor: Vendor, vendor_id: uuid.UUID, role: str) -> None:
    membership = await require_membership(db, chama, actor)
    if membership.role != "chair":
        raise HTTPException(403, "Only the chair can assign roles")
    if role not in ("member", "chair", "treasurer"):
        raise HTTPException(400, "Role must be member, chair or treasurer")
    target = await get_membership(db, chama.id, vendor_id)
    if target is None:
        raise HTTPException(404, "That vendor is not a member")
    if target.role == "chair" and role != "chair":
        chairs = (await db.execute(select(ChamaMember).where(
            ChamaMember.chama_id == chama.id, ChamaMember.role == "chair",
        ))).scalars().all()
        if len(chairs) <= 1:
            raise HTTPException(400, "A chama needs at least one chair")
    target.role = role
    add_audit_event(
        db, actor_type="vendor", actor_id=actor.id, action="chama_role_changed",
        entity_type="chama", entity_id=chama.id,
        previous_state={"vendor_id": str(vendor_id), "role": "see member"}, new_state={"role": role},
    )


async def dissolve_chama(db: AsyncSession, chama: Chama, actor: Vendor) -> None:
    membership = await require_membership(db, chama, actor)
    if membership.role != "chair":
        raise HTTPException(403, "Only the chair can dissolve the chama")
    open_loans = (await db.execute(select(ChamaLoan.id).where(
        ChamaLoan.chama_id == chama.id,
        ChamaLoan.status.in_(("pending_vote", "approved", "disbursing", "disbursed")),
    ).limit(1))).scalar_one_or_none()
    if open_loans:
        raise HTTPException(409, "Open loans must be settled before dissolving")
    chama.status = "dissolved"
    add_audit_event(
        db, actor_type="vendor", actor_id=actor.id, action="chama_dissolved",
        entity_type="chama", entity_id=chama.id,
    )


# ---------------------------------------------------------------------------
# Deposits
# ---------------------------------------------------------------------------

async def deposit(db: AsyncSession, chama: Chama, vendor: Vendor, amount_ksh: int,
                  provider: Optional[str] = None) -> dict:
    await require_membership(db, chama, vendor)
    if chama.status != "active":
        raise HTTPException(400, "The pool is not open yet (chama still forming)")
    amount_ksh = int(amount_ksh)
    if amount_ksh < int(chama.min_deposit_ksh):
        raise HTTPException(400, f"Minimum deposit is KSh {int(chama.min_deposit_ksh):,}")
    balance = await pool_balance(db, chama)
    if balance + amount_ksh > settings.CHAMA_MAX_POOL_KSH:
        raise HTTPException(400, "The pool cap would be exceeded")

    intent = await create_collection_intent(
        db, vendor,
        entity_type="chama_deposit",
        entity_id=uuid.uuid4(),  # the deposit row is created when the money lands
        amount_ksh=amount_ksh,
        target_psp_sub=chama.psp_sub_account or await _chama_wallet(db, chama),
        provider=provider,
    )
    await start_collection(db, intent)
    return {"intent_id": str(intent.id), "status": intent.status, "amount_ksh": intent.amount_ksh}


async def on_deposit_completed(db: AsyncSession, intent) -> None:
    """Webhook hook: the money is in the pool — record the deposit."""
    chama_id = uuid.UUID(intent.target_psp_sub.removeprefix("CHAMA_"))
    chama = await db.get(Chama, chama_id)
    if chama is None:
        log.error("deposit webhook for unknown chama sub %s", intent.target_psp_sub)
        return
    deposit_row = ChamaDeposit(
        chama_id=chama.id,
        vendor_id=intent.vendor_id,
        amount_ksh=intent.amount_ksh,
        cycle_number=current_cycle(chama),
        intent_id=intent.id,
    )
    db.add(deposit_row)
    await db.flush()
    await create_notification(
        db, intent.vendor_id, NotificationType.CHAMA_UPDATE,
        f"Deposit confirmed: KSh {intent.amount_ksh:,}",
        f"{chama.name} pool balance: KSh {await pool_balance(db, chama):,}",
        data={"chama_id": str(chama.id)},
    )


# ---------------------------------------------------------------------------
# Loans (peer vote → disbursement)
# ---------------------------------------------------------------------------

async def apply_for_loan(db: AsyncSession, chama: Chama, vendor: Vendor, amount_ksh: int,
                         purpose: str) -> ChamaLoan:
    await require_membership(db, chama, vendor)
    if chama.status != "active":
        raise HTTPException(400, "The pool is not open yet")
    if vendor.finance_mode == "halal_sharia" and chama.model_type == "conventional_interest":
        raise HTTPException(400, "This chama lends with interest; your Halal finance "
                                 "mode cannot borrow on interest terms")
    amount_ksh = int(amount_ksh)
    if amount_ksh < int(chama.min_deposit_ksh):
        raise HTTPException(400, f"Minimum loan is KSh {int(chama.min_deposit_ksh):,}")
    balance = await pool_balance(db, chama)
    cap = min(int(chama.max_loan_ksh), balance)
    if amount_ksh > cap:
        raise HTTPException(400,
                            f"Maximum is KSh {cap:,} (pool KSh {balance:,}, limit KSh {int(chama.max_loan_ksh):,})")

    open_loan = (await db.execute(select(ChamaLoan.id).where(
        ChamaLoan.chama_id == chama.id, ChamaLoan.borrower_id == vendor.id,
        ChamaLoan.status.in_(("pending_vote", "approved", "disbursing", "disbursed")),
    ).limit(1))).scalar_one_or_none()
    if open_loan:
        raise HTTPException(409, "You already have an open loan in this chama")
    defaulted = (await db.execute(select(ChamaLoan.id).where(
        ChamaLoan.chama_id == chama.id, ChamaLoan.borrower_id == vendor.id,
        ChamaLoan.status == "defaulted",
    ).limit(1))).scalar_one_or_none()
    if defaulted:
        raise HTTPException(403, "You have a defaulted loan in this chama; repay it through the chair first")

    if chama.model_type in HALAL_POOL_MODELS:
        interest = 0  # no Riba
        fee = int(settings.CHAMA_QARD_ADMIN_FEE_KSH)
        if amount_ksh <= fee:
            raise HTTPException(400,
                                f"Loan must exceed the KSh {fee:,} admin fee (the fee is netted from the payout)")
    else:
        interest = int(round(amount_ksh * float(chama.interest_rate)))
        fee = 0
    cycle = current_cycle(chama)
    loan = ChamaLoan(
        chama_id=chama.id, borrower_id=vendor.id,
        amount_ksh=amount_ksh, interest_ksh=interest, fee_ksh=fee,
        total_due_ksh=amount_ksh + interest,
        purpose=(purpose or "").strip()[:400] or None,
        cycle_issued=cycle, cycle_due=cycle + 1, status="pending_vote",
    )
    db.add(loan)
    await db.flush()
    add_audit_event(
        db, actor_type="vendor", actor_id=vendor.id, action="chama_loan_requested",
        entity_type="chama_loan", entity_id=loan.id,
        new_state={"chama_id": str(chama.id), "amount_ksh": amount_ksh,
                   "total_due_ksh": loan.total_due_ksh, "cycle_issued": cycle},
    )

    score = await biashara.vendor_score(db, vendor.id)
    members = (await db.execute(select(ChamaMember).where(
        ChamaMember.chama_id == chama.id, ChamaMember.vendor_id != vendor.id,
    ))).scalars().all()
    quorum = loan_quorum(chama, await member_count(db, chama.id))
    await notify_many(
        db, (m.vendor_id for m in members), NotificationType.CHAMA_UPDATE,
        f"{vendor.business_name} needs a KSh {amount_ksh:,} loan",
        f"Biashara Score {score} · due cycle {cycle + 1} · {quorum} approvals needed. Vote on {chama.name}.",
        sender_id=vendor.id, data={"chama_id": str(chama.id), "loan_id": str(loan.id)},
    )
    return loan


async def vote_on_loan(db: AsyncSession, chama: Chama, loan: ChamaLoan, voter: Vendor,
                       vote: str) -> dict:
    if vote not in ("approve", "decline"):
        raise HTTPException(400, "Vote must be 'approve' or 'decline'")
    membership = await require_membership(db, chama, voter)
    if loan.chama_id != chama.id:
        raise HTTPException(404, "Loan not found")
    if loan.status != "pending_vote":
        raise HTTPException(400, f"This loan is {loan.status}")
    if loan.borrower_id == voter.id:
        raise HTTPException(403, "You cannot vote on your own loan")
    if (await db.execute(select(ChamaLoanVote.id).where(
        ChamaLoanVote.loan_id == loan.id, ChamaLoanVote.voter_id == voter.id,
    ))).scalar_one_or_none():
        raise HTTPException(400, "You already voted on this loan")

    db.add(ChamaLoanVote(loan_id=loan.id, voter_id=voter.id, vote=vote))
    await db.flush()

    approvals = int((await db.execute(select(func.count(ChamaLoanVote.id)).where(
        ChamaLoanVote.loan_id == loan.id, ChamaLoanVote.vote == "approve",
    ))).scalar_one() or 0)
    members = await member_count(db, chama.id)
    quorum = loan_quorum(chama, members)

    if approvals >= quorum:
        loan.status = "approved"
        loan.decided_at = datetime.utcnow()
        await db.flush()
        add_audit_event(
            db, actor_type="vendor", actor_id=voter.id, action="chama_loan_approved",
            entity_type="chama_loan", entity_id=loan.id,
            new_state={"approvals": approvals, "quorum": quorum, "status": "approved"},
        )
        await create_notification(
            db, loan.borrower_id, NotificationType.CHAMA_UPDATE,
            f"Loan approved: KSh {loan.amount_ksh:,}",
            f"{approvals}/{quorum} members approved. The payout is being prepared.",
            sender_id=voter.id, data={"chama_id": str(chama.id), "loan_id": str(loan.id)},
        )
        await _disburse_approved_loan(db, chama, loan)
    else:
        # Not enough yes votes yet; an early supermajority of declines also ends it.
        declines = int((await db.execute(select(func.count(ChamaLoanVote.id)).where(
            ChamaLoanVote.loan_id == loan.id, ChamaLoanVote.vote == "decline",
        ))).scalar_one() or 0)
        if declines >= members - 1:  # everyone else declined
            loan.status = "declined"
            loan.decided_at = datetime.utcnow()
            await db.flush()
            await create_notification(
                db, loan.borrower_id, NotificationType.CHAMA_UPDATE,
                "Loan declined", "The pool did not approve this loan. Try a smaller amount.",
                sender_id=voter.id, data={"chama_id": str(chama.id), "loan_id": str(loan.id)},
            )
    return {"status": loan.status, "approvals": approvals, "quorum_needed": quorum,
            "members": members}


async def _disburse_approved_loan(db: AsyncSession, chama: Chama, loan: ChamaLoan) -> None:
    """Move the principal out of the pool (dual approval above the line)."""
    balance = await pool_balance(db, chama)
    if balance < loan.amount_ksh:
        # Two loans approved in the same window outran the pool.
        loan.status = "declined"
        loan.decided_at = datetime.utcnow()
        await db.flush()
        await create_notification(
            db, loan.borrower_id, NotificationType.CHAMA_UPDATE,
            "Loan not funded",
            f"The pool balance (KSh {balance:,}) is below the approved amount. Try again once repayments land.",
            data={"chama_id": str(chama.id), "loan_id": str(loan.id)},
        )
        return

    borrower = await db.get(Vendor, loan.borrower_id)
    # Halal pools: the flat admin fee is netted from the payout (disclosed at
    # application). The borrower repays the full principal; the fee stays in
    # the pool as cost-recovery, not interest.
    payout = loan.amount_ksh - loan.fee_ksh
    if payout <= 0:  # defensive: apply_for_loan already enforces amount > fee
        loan.status = "declined"
        loan.decided_at = datetime.utcnow()
        await db.flush()
        await create_notification(
            db, loan.borrower_id, NotificationType.CHAMA_UPDATE,
            "Loan not funded",
            "The loan does not cover the pool's admin fee. Try a larger amount.",
            data={"chama_id": str(chama.id), "loan_id": str(loan.id)},
        )
        return
    chairs = (await db.execute(select(ChamaMember).where(
        ChamaMember.chama_id == chama.id, ChamaMember.role == "chair",
    ).limit(1))).scalars().all()
    requestor = chairs[0].vendor_id if chairs else loan.borrower_id
    try:
        disbursement = await request_disbursement(
            db, entity_type="chama_loan", entity_id=loan.id,
            recipient_phone=borrower.phone or "", amount_ksh=payout,
            source_psp_sub=chama.psp_sub_account or await _chama_wallet(db, chama),
            requestor_id=requestor, recipient_name=borrower.business_name,
            narrative=f"{chama.name} loan (cycle {loan.cycle_issued})",
        )
    except (DisbursementError, PaymentError) as exc:
        loan.status = "approved"  # retryable via retry endpoint
        await db.flush()
        await create_notification(
            db, loan.borrower_id, NotificationType.CHAMA_UPDATE,
            "Loan payout could not be started", str(exc)[:300],
            data={"chama_id": str(chama.id), "loan_id": str(loan.id)},
        )
        return

    loan.disbursement_id = disbursement.id
    if disbursement.status == "failed":
        loan.status = "approved"
    else:
        loan.status = "disbursing"
    await db.flush()


async def retry_loan_disbursement(db: AsyncSession, chama: Chama, loan: ChamaLoan, actor: Vendor) -> None:
    membership = await require_membership(db, chama, actor)
    if membership.role not in ("chair", "treasurer"):
        raise HTTPException(403, "Only the chair or treasurer can retry a payout")
    if loan.status != "approved":
        raise HTTPException(400, "Only an approved (unfunded) loan can be retried")
    await _disburse_approved_loan(db, chama, loan)


async def on_loan_disbursed(db: AsyncSession, disbursement) -> None:
    """Webhook hook: the borrower has the money."""
    loan = await db.get(ChamaLoan, disbursement.entity_id)
    if loan is None or loan.status == "disbursed":
        return
    loan.status = "disbursed"
    loan.disbursed_at = datetime.utcnow()
    await db.flush()
    chama = await db.get(Chama, loan.chama_id)
    if loan.fee_ksh > 0:
        detail = (f"You received KSh {loan.amount_ksh - loan.fee_ksh:,} (KSh {loan.fee_ksh:,} "
                  f"admin fee withheld). Repay the full principal KSh {loan.total_due_ksh:,} "
                  f"by cycle {loan.cycle_due} — no interest.")
    else:
        detail = (f"Repay KSh {loan.total_due_ksh:,} by cycle {loan.cycle_due} "
                  f"(interest KSh {loan.interest_ksh:,} goes to the pool).")
    await create_notification(
        db, loan.borrower_id, NotificationType.CHAMA_UPDATE,
        f"Loan disbursed: KSh {loan.amount_ksh:,}",
        detail,
        data={"chama_id": str(loan.chama_id), "loan_id": str(loan.id)},
    )
    if chama:
        member_ids = (await db.execute(select(ChamaMember.vendor_id).where(
            ChamaMember.chama_id == chama.id, ChamaMember.vendor_id != loan.borrower_id,
        ))).scalars().all()
        await notify_many(
            db, member_ids, NotificationType.CHAMA_UPDATE,
            f"KSh {loan.amount_ksh:,} loan disbursed from {chama.name}",
            "Your principal is now working for the pool's interest.",
            data={"chama_id": str(chama.id), "loan_id": str(loan.id)},
        )


async def on_loan_disbursement_failed(db: AsyncSession, disbursement) -> None:
    loan = await db.get(ChamaLoan, disbursement.entity_id)
    if loan is None or loan.status != "disbursing":
        return
    loan.status = "approved"  # back to retryable
    await db.flush()
    await create_notification(
        db, loan.borrower_id, NotificationType.CHAMA_UPDATE,
        "Loan payout failed",
        f"{disbursement.failure_reason or 'The payout was rejected.'} The chair or treasurer can retry.",
        data={"chama_id": str(loan.chama_id), "loan_id": str(loan.id)},
    )


async def repay_loan(db: AsyncSession, chama: Chama, loan: ChamaLoan, vendor: Vendor) -> dict:
    await require_membership(db, chama, vendor)
    if loan.chama_id != chama.id or loan.borrower_id != vendor.id:
        raise HTTPException(404, "Loan not found")
    if loan.status != "disbursed":
        raise HTTPException(400, f"Only a disbursed loan can be repaid (it is {loan.status})")
    intent = await create_collection_intent(
        db, vendor,
        entity_type="chama_loan_repayment",
        entity_id=loan.id,
        amount_ksh=int(loan.total_due_ksh),
        target_psp_sub=chama.psp_sub_account or await _chama_wallet(db, chama),
    )
    loan.repayment_intent_id = intent.id
    await db.commit()  # FK reference lands before the PSP's webhook can
    await start_collection(db, intent)
    return {"intent_id": str(intent.id), "status": intent.status,
            "amount_ksh": intent.amount_ksh, "due_cycle": loan.cycle_due}


async def on_repayment_completed(db: AsyncSession, intent) -> None:
    """Webhook hook: repayment is back in the pool."""
    loan = await db.get(ChamaLoan, intent.entity_id)
    if loan is None or loan.status == "repaid":
        return
    loan.status = "repaid"
    loan.repaid_at = datetime.utcnow()
    await db.flush()
    await biashara.record_biashara_event(
        db, loan.borrower_id, "chama_loan_repaid",
        reference=f"chama_loan:{loan.id}",
        explanation=f"Repaid KSh {loan.total_due_ksh:,} to the {loan.chama_id} pool on schedule.",
    )
    chama = await db.get(Chama, loan.chama_id)
    if chama:
        member_ids = (await db.execute(select(ChamaMember.vendor_id).where(
            ChamaMember.chama_id == chama.id, ChamaMember.vendor_id != loan.borrower_id,
        ))).scalars().all()
        await notify_many(
            db, member_ids, NotificationType.CHAMA_UPDATE,
            f"KSh {loan.total_due_ksh:,} repaid to {chama.name}",
            f"KSh {loan.interest_ksh:,} interest added to the pool for all members.",
            data={"chama_id": str(chama.id), "loan_id": str(loan.id)},
        )


async def mark_loan_defaulted(db: AsyncSession, chama: Chama, loan: ChamaLoan, actor: Vendor) -> None:
    membership = await require_membership(db, chama, actor)
    if membership.role not in ("chair", "treasurer"):
        raise HTTPException(403, "Only the chair or treasurer can mark a default")
    if loan.chama_id != chama.id:
        raise HTTPException(404, "Loan not found")
    if loan.status != "disbursed":
        raise HTTPException(400, f"Only a disbursed loan can default (it is {loan.status})")
    loan.status = "defaulted"
    await db.flush()
    add_audit_event(
        db, actor_type="vendor", actor_id=actor.id, action="chama_loan_defaulted",
        entity_type="chama_loan", entity_id=loan.id,
        previous_state={"status": "disbursed"}, new_state={"status": "defaulted"},
    )
    await biashara.record_biashara_event(
        db, loan.borrower_id, "chama_loan_defaulted",
        reference=f"chama_loan:{loan.id}",
        explanation=f"Loan of KSh {loan.amount_ksh:,} in {chama.name} marked defaulted by the chair.",
    )
    await create_notification(
        db, loan.borrower_id, NotificationType.CHAMA_UPDATE,
        "Loan marked defaulted",
        f"The chair marked your KSh {loan.amount_ksh:,} loan defaulted. Meet with them to resolve it.",
        sender_id=actor.id, data={"chama_id": str(chama.id), "loan_id": str(loan.id)},
    )


# ---------------------------------------------------------------------------
# Dividends (distribute the pool's net interest)
# ---------------------------------------------------------------------------

async def pool_interest_from_ledger(db: AsyncSession, sub_account: str) -> int:
    from app.models.payments import CustodyLedgerEntry

    total_in = (await db.execute(
        select(func.coalesce(func.sum(CustodyLedgerEntry.amount_ksh), 0)).where(
            CustodyLedgerEntry.psp_sub_account == sub_account,
            CustodyLedgerEntry.transaction_type == "chama_repayment_in",
        ))).scalar_one()
    total_out_loans = (await db.execute(
        select(func.coalesce(func.sum(CustodyLedgerEntry.amount_ksh), 0)).where(
            CustodyLedgerEntry.psp_sub_account == sub_account,
            CustodyLedgerEntry.transaction_type == "chama_loan_out",
        ))).scalar_one()
    total_dividends = (await db.execute(
        select(func.coalesce(func.sum(CustodyLedgerEntry.amount_ksh), 0)).where(
            CustodyLedgerEntry.psp_sub_account == sub_account,
            CustodyLedgerEntry.transaction_type == "chama_dividend_out",
        ))).scalar_one()
    return int(total_in or 0) - int(total_out_loans or 0) - int(total_dividends or 0)


async def pool_distributable(db: AsyncSession, chama: Chama) -> int:
    """What may be paid out as dividends.

    Conventional pools: the pool's net interest (ledger formula).
    Halal pools: the same formula — which for zero-interest loans nets the
    admin fees already collected with repayments, minus fees netted into
    payouts that are still outstanding (not yet earned) — plus any
    musharakah profits members have remitted to the pool. Never interest.
    """
    sub = chama.psp_sub_account
    if not sub:
        return 0
    base = await pool_interest_from_ledger(db, sub)
    if chama.model_type == "conventional_interest":
        return base
    from app.models.payments import CustodyLedgerEntry

    outstanding_fee = int((await db.execute(
        select(func.coalesce(func.sum(ChamaLoan.fee_ksh), 0)).where(
            ChamaLoan.chama_id == chama.id,
            ChamaLoan.status.in_(("approved", "disbursing", "disbursed")),
        ))).scalar_one() or 0)
    profits = int((await db.execute(
        select(func.coalesce(func.sum(CustodyLedgerEntry.amount_ksh), 0)).where(
            CustodyLedgerEntry.psp_sub_account == sub,
            CustodyLedgerEntry.transaction_type == "chama_pool_in",
            CustodyLedgerEntry.entity_type == "musharakah_profit",
        ))).scalar_one() or 0)
    return base - outstanding_fee + profits


def largest_remainder(total: int, weights: list[tuple[uuid.UUID, int]]) -> dict[uuid.UUID, int]:
    """Split integer `total` across (id, weight) pairs, exact to the shilling."""
    weight_sum = sum(w for _, w in weights)
    if weight_sum <= 0 or total <= 0:
        return {vid: 0 for vid, _ in weights}
    raw = [(vid, total * w / weight_sum) for vid, w in weights]
    floors = {vid: int(math.floor(v)) for vid, v in raw}
    remainder = total - sum(floors.values())
    # Give the leftover shillings to the biggest fractional parts.
    by_fraction = sorted(raw, key=lambda item: (item[1] - math.floor(item[1])), reverse=True)
    for i in range(remainder):
        floors[by_fraction[i % len(by_fraction)][0]] += 1
    return floors


async def distribute_dividends(db: AsyncSession, chama: Chama, actor: Vendor) -> dict:
    membership = await require_membership(db, chama, actor)
    if membership.role != "chair":
        raise HTTPException(403, "Only the chair can distribute dividends")
    if chama.status != "active":
        raise HTTPException(400, "The chama is not active")
    sub = chama.psp_sub_account
    if not sub:
        raise HTTPException(400, "The pool wallet is not open")
    disbursing = (await db.execute(select(ChamaLoan.id).where(
        ChamaLoan.chama_id == chama.id, ChamaLoan.status == "disbursing",
    ).limit(1))).scalar_one_or_none()
    if disbursing:
        raise HTTPException(409, "A loan payout is in flight; wait for it to settle")

    distributable = await pool_distributable(db, chama)
    if distributable <= 0:
        if chama.model_type == "conventional_interest":
            raise HTTPException(400, "No distributable interest yet (pool has not earned interest)")
        raise HTTPException(400, "No distributable surplus yet (no fees realised or profits remitted)")

    members = (await db.execute(select(ChamaMember).where(
        ChamaMember.chama_id == chama.id))).scalars().all()
    deposits: list[tuple[uuid.UUID, int]] = []
    for m in members:
        total = await total_deposits(db, chama.id, m.vendor_id)
        if total > 0:
            deposits.append((m.vendor_id, total))
    if not deposits:
        raise HTTPException(400, "No member deposits to distribute against")

    shares = largest_remainder(distributable, deposits)
    cycle_from = (chama.last_dividend_cycle or 0) + 1
    cycle_to = current_cycle(chama)
    paid = 0
    for vendor_id, amount in shares.items():
        if amount <= 0:
            continue
        dividend = ChamaDividend(
            chama_id=chama.id, vendor_id=vendor_id,
            period_cycle_from=cycle_from, period_cycle_to=cycle_to,
            amount_ksh=amount, status="declared",
        )
        db.add(dividend)
        await db.flush()
        vendor = await db.get(Vendor, vendor_id)
        try:
            disbursement = await request_disbursement(
                db, entity_type="chama_dividend", entity_id=dividend.id,
                recipient_phone=vendor.phone or "", amount_ksh=amount,
                source_psp_sub=sub, requestor_id=actor.id,
                recipient_name=vendor.business_name,
                narrative=f"{chama.name} dividend (cycles {cycle_from}–{cycle_to})",
            )
            dividend.disbursement_id = disbursement.id
            if disbursement.status in ("queued", "completed"):
                paid += 1
        except (DisbursementError, PaymentError) as exc:
            dividend.status = "failed"
            dividend.failure_reason = str(exc)[:400]
            await db.flush()
        await db.flush()

    chama.last_dividend_cycle = cycle_to
    add_audit_event(
        db, actor_type="vendor", actor_id=actor.id, action="chama_dividends_declared",
        entity_type="chama", entity_id=chama.id,
        new_state={"distributable_ksh": distributable, "members_paid": paid,
                   "period": f"{cycle_from}-{cycle_to}", "model_type": chama.model_type},
    )
    basis = "interest" if chama.model_type == "conventional_interest" else "fees and profits"
    await create_notification(
        db, actor.id, NotificationType.CHAMA_UPDATE,
        f"Dividends declared: KSh {distributable:,}",
        f"Cycles {cycle_from}–{cycle_to} {basis} distributed across {paid} members.",
        data={"chama_id": str(chama.id)},
    )
    return {"distributable_ksh": distributable, "members_paid": paid,
            "period": {"from": cycle_from, "to": cycle_to}}


async def retry_dividend(db: AsyncSession, chama: Chama, dividend: ChamaDividend, actor: Vendor) -> None:
    membership = await require_membership(db, chama, actor)
    if membership.role not in ("chair", "treasurer"):
        raise HTTPException(403, "Only the chair or treasurer can retry a dividend")
    if dividend.chama_id != chama.id:
        raise HTTPException(404, "Dividend not found")
    if dividend.status == "paid":
        return
    vendor = await db.get(Vendor, dividend.vendor_id)
    disbursement = await request_disbursement(
        db, entity_type="chama_dividend", entity_id=dividend.id,
        recipient_phone=vendor.phone or "", amount_ksh=dividend.amount_ksh,
        source_psp_sub=chama.psp_sub_account or "", requestor_id=actor.id,
        recipient_name=vendor.business_name,
        narrative=f"{chama.name} dividend retry",
    )
    dividend.disbursement_id = disbursement.id
    if disbursement.status == "failed":
        dividend.status = "failed"
        dividend.failure_reason = disbursement.failure_reason
    else:
        dividend.status = "declared"
        dividend.failure_reason = None
    await db.flush()


async def on_dividend_paid(db: AsyncSession, disbursement) -> None:
    dividend = await db.get(ChamaDividend, disbursement.entity_id)
    if dividend is None or dividend.status == "paid":
        return
    dividend.status = "paid"
    dividend.paid_at = datetime.utcnow()
    dividend.failure_reason = None
    await db.flush()
    await create_notification(
        db, dividend.vendor_id, NotificationType.CHAMA_UPDATE,
        f"Dividend paid: KSh {dividend.amount_ksh:,}",
        f"Cycles {dividend.period_cycle_from}–{dividend.period_cycle_to} of the pool's interest.",
        data={"chama_id": str(dividend.chama_id), "dividend_id": str(dividend.id)},
    )


async def on_dividend_failed(db: AsyncSession, disbursement) -> None:
    dividend = await db.get(ChamaDividend, disbursement.entity_id)
    if dividend is None or dividend.status == "paid":
        return
    dividend.status = "failed"
    dividend.failure_reason = (disbursement.failure_reason or "Payout failed")[:400]
    await db.flush()


async def contribute_profit(db: AsyncSession, chama: Chama, vendor: Vendor, amount_ksh: int,
                            note: Optional[str] = None) -> dict:
    """A member remits realised joint-venture (musharakah) profit to the pool
    via PSP collection. The money is real — the ledger stays reconcilable —
    and it becomes part of the distributable surplus for Halal pools."""
    await require_membership(db, chama, vendor)
    if chama.status != "active":
        raise HTTPException(400, "The pool is not open yet")
    if chama.model_type == "conventional_interest":
        raise HTTPException(400, "Joint-venture profit remittance is for Halal "
                                 "(musharakah) pools")
    amount_ksh = int(amount_ksh)
    if amount_ksh < 100:
        raise HTTPException(400, "Minimum profit remittance is KSh 100")
    if amount_ksh > 1_000_000:
        raise HTTPException(400, "Maximum profit remittance is KSh 1,000,000")
    intent = await create_collection_intent(
        db, vendor,
        entity_type="musharakah_profit",
        entity_id=uuid.uuid4(),
        amount_ksh=amount_ksh,
        target_psp_sub=chama.psp_sub_account or await _chama_wallet(db, chama),
    )
    await start_collection(db, intent)
    return {"intent_id": str(intent.id), "status": intent.status, "amount_ksh": amount_ksh}


async def on_profit_received(db: AsyncSession, intent) -> None:
    """Webhook hook: remitted musharakah profit is in the pool."""
    if not intent.target_psp_sub.startswith("CHAMA_"):
        log.error("musharakah_profit webhook for non-chama sub %s", intent.target_psp_sub)
        return
    chama_id = uuid.UUID(intent.target_psp_sub.removeprefix("CHAMA_"))
    chama = await db.get(Chama, chama_id)
    if chama is None:
        return
    member_ids = (await db.execute(select(ChamaMember.vendor_id).where(
        ChamaMember.chama_id == chama.id, ChamaMember.vendor_id != intent.vendor_id,
    ))).scalars().all()
    await notify_many(
        db, member_ids, NotificationType.CHAMA_UPDATE,
        f"KSh {intent.amount_ksh:,} joint-venture profit in {chama.name}",
        "Remitted to the pool — it joins the distributable surplus.",
        data={"chama_id": str(chama.id)},
    )


async def flag_overdue_loans(db: AsyncSession) -> int:
    """Worker job: disbursed loans past their due cycle are defaulted."""
    now = datetime.utcnow()
    loans = (await db.execute(select(ChamaLoan).where(
        ChamaLoan.status == "disbursed",
    ).with_for_update())).scalars().all()
    flagged = 0
    for loan in loans:
        chama = await db.get(Chama, loan.chama_id)
        if chama is None or chama.status != "active":
            continue
        if current_cycle(chama, now) > loan.cycle_due:
            loan.status = "defaulted"
            await db.flush()
            add_audit_event(
                db, actor_type="system", actor_id=None, action="chama_loan_overdue_defaulted",
                entity_type="chama_loan", entity_id=loan.id,
                previous_state={"status": "disbursed"},
                new_state={"status": "defaulted", "cycle_due": loan.cycle_due,
                           "current_cycle": current_cycle(chama, now)},
            )
            await biashara.record_biashara_event(
                db, loan.borrower_id, "chama_loan_defaulted",
                reference=f"chama_loan:{loan.id}",
                explanation=f"KSh {loan.amount_ksh:,} loan in {chama.name} passed its due cycle without repayment.",
            )
            await create_notification(
                db, loan.borrower_id, NotificationType.CHAMA_UPDATE,
                "Loan is now defaulted",
                f"It passed cycle {loan.cycle_due} without repayment. Meet the chair to resolve it.",
                data={"chama_id": str(chama.id), "loan_id": str(loan.id)},
            )
            flagged += 1
    return flagged
