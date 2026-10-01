"""Custody ledger writes (v2.5) — the one place money gets accounted.

Rules, in the order they matter:

1. **No ledger entry without a confirmed PSP reference.** Every row carries
   the PSP payment/payout/transfer id that proves the money actually moved.
   If the webhook is late, the ledger stays put — we never credit on hope.
2. **Append-only.** The service only ever INSERTs; a Postgres trigger
   (`trg_custody_ledger_append_only`, see alembic 0006 and
   ``app.db_triggers``) refuses UPDATE/DELETE at the database level.
   Corrections are new ``reversal`` rows linked via ``reversal_of``.
3. **Consistent running balances.** Writes for one sub-account are
   serialised with a transaction-scoped advisory lock, and
   ``running_balance_ksh`` is always the previous max + signed amount.
"""

import logging
import uuid
from datetime import date
from typing import Optional

from sqlalchemy import case, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.payments import CustodyLedgerEntry

log = logging.getLogger("brief.custody")


class CustodyError(Exception):
    """Raised for custody-rule violations before anything is written."""


async def write_ledger_entry(
    db: AsyncSession,
    *,
    psp_sub_account: str,
    transaction_type: str,
    amount_ksh: int,
    direction: str,
    psp_reference: str,
    vendor_id: Optional[uuid.UUID] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[uuid.UUID] = None,
    intent_id: Optional[uuid.UUID] = None,
    approved_by: Optional[uuid.UUID] = None,
    approved_by_2: Optional[uuid.UUID] = None,
    reversal_of: Optional[uuid.UUID] = None,
    notes: Optional[str] = None,
    provider: Optional[str] = None,
    mpesa_receipt: Optional[str] = None,
) -> CustodyLedgerEntry:
    """Insert one append-only ledger row and return it with its running
    balance computed. The caller owns the surrounding transaction."""
    if not psp_reference:
        raise CustodyError("Refusing ledger entry without a confirmed PSP reference")
    if direction not in ("credit", "debit"):
        raise CustodyError(f"direction must be credit|debit, got {direction!r}")
    if amount_ksh <= 0:
        raise CustodyError("amount_ksh must be positive; direction says which way it goes")

    # Serialise writers per sub-account (transaction-scoped), then compute the
    # new balance from the same SUM the rest of the platform uses — never from
    # MAX(running_balance), which is not the current balance when it dips.
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:sub))"), {"sub": psp_sub_account})

    current = await sub_balance(db, psp_sub_account)
    running = current + (amount_ksh if direction == "credit" else -amount_ksh)
    if running < 0:
        raise CustodyError(
            f"Ledger write would drive {psp_sub_account} negative "
            f"({row or 0} − {amount_ksh}); PSP must hold at least this much")

    entry = CustodyLedgerEntry(
        ledger_date=date.today(),
        vendor_id=vendor_id,
        psp_sub_account=psp_sub_account,
        transaction_type=transaction_type,
        amount_ksh=amount_ksh,
        direction=direction,
        running_balance_ksh=running,
        psp_reference=psp_reference,
        mpesa_receipt=mpesa_receipt,
        provider=provider,
        entity_type=entity_type,
        entity_id=entity_id,
        intent_id=intent_id,
        approved_by=approved_by,
        approved_by_2=approved_by_2,
        reversal_of=reversal_of,
        notes=notes,
    )
    db.add(entry)
    await db.flush()
    return entry


async def sub_balance(db: AsyncSession, psp_sub_account: str) -> int:
    """The ledger balance of one sub-account (0 when it has no entries)."""
    signed = case(
        (CustodyLedgerEntry.direction == "credit", CustodyLedgerEntry.amount_ksh),
        else_=-CustodyLedgerEntry.amount_ksh,
    )
    row = (await db.execute(
        select(func.coalesce(func.sum(signed), 0)).where(
            CustodyLedgerEntry.psp_sub_account == psp_sub_account)
    )).scalar_one()
    return int(row or 0)


async def all_sub_balances(db: AsyncSession) -> dict[str, int]:
    signed = case(
        (CustodyLedgerEntry.direction == "credit", CustodyLedgerEntry.amount_ksh),
        else_=-CustodyLedgerEntry.amount_ksh,
    )
    rows = (await db.execute(
        select(CustodyLedgerEntry.psp_sub_account, func.sum(signed)).group_by(
            CustodyLedgerEntry.psp_sub_account)
    )).all()
    return {sub: int(total or 0) for sub, total in rows}


def chama_wallet_for(chama_id: uuid.UUID) -> str:
    """The segregated PSP sub-account name for one chama."""
    return f"CHAMA_{chama_id}"
