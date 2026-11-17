"""Zero-API M-Pesa confirmation parser (spec §2).

A pasted M-Pesa SMS is *user-declared evidence*, never Daraja proof. This
module extracts the structured fields a host needs to decide in one tap —
the 10-character confirmation code, the amount, and whether the host's
Till/recipient name appears in the text — and scores the note's risk so the
host sees warnings instead of a blind green tick.

No network call, no Daraja credentials, no cost. The global UNIQUE index on
`event_registrations.mpesa_code` is what stops the same code being pasted
twice; this parser only reads.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

# M-Pesa confirmation codes are 10 uppercase alphanumerics (e.g. UKG8X2Y4Z1).
MPESA_CODE_RE = re.compile(r"\b([A-Z0-9]{10})\b")
MPESA_AMOUNT_RE = re.compile(r"Ksh\s?([\d,]+(?:\.\d{2})?)", re.IGNORECASE)


@dataclass
class ParsedMpesaNote:
    code: Optional[str]
    amount: Optional[float]
    recipient_matched: bool
    # Risk scoring (spec §2 title: "Risk-Scored Note, Not Blind Proof").
    # `warnings` are human sentences for the host's Inbox row; `risk_level`
    # is one of "low" | "medium" | "high" for the client's badge colour.
    warnings: list[str] = field(default_factory=list)
    risk_level: str = "low"
    amount_matches_price: bool = False
    amount_is_partial: bool = False


def parse_mpesa_sms(
    raw_text: str,
    expected_recipient: str = "",
    expected_amount: Optional[float] = None,
) -> ParsedMpesaNote:
    """Parse a pasted M-Pesa confirmation SMS.

    `expected_recipient` is the event's `payment_recipient_name` (falling
    back to the organiser's business name). `expected_amount` is the ticket
    price, used only to flag partial deposits — never to refuse the note.
    """
    text = (raw_text or "").strip()
    code_match = MPESA_CODE_RE.search(text.upper())
    amount_match = MPESA_AMOUNT_RE.search(text)

    code = code_match.group(1) if code_match else None
    amount = float(amount_match.group(1).replace(",", "")) if amount_match else None

    # Fuzzy check that the organiser's Till/recipient name appears in the SMS.
    # Every token longer than 2 chars must appear; a one-token name still
    # has to appear. An empty expected name can never "match".
    recipient_tokens = [t.lower() for t in (expected_recipient or "").split() if len(t) > 2]
    text_lower = text.lower()
    recipient_matched = (
        all(tok in text_lower for tok in recipient_tokens) if recipient_tokens else False
    )

    warnings: list[str] = []
    if not code:
        warnings.append("No 10-character M-Pesa code found in that text.")
    if amount is None:
        warnings.append("No KSh amount found in that text.")
    if expected_recipient and not recipient_matched:
        warnings.append(
            f"Recipient name ({expected_recipient}) does not appear in the SMS."
        )

    amount_matches_price = False
    amount_is_partial = False
    if amount is not None and expected_amount is not None and float(expected_amount) > 0:
        if amount == float(expected_amount):
            amount_matches_price = True
        elif amount < float(expected_amount):
            amount_is_partial = True
            warnings.append(
                f"Amount KSh {amount:,.0f} is below the KSh {float(expected_amount):,.0f} ticket — may be a partial deposit."
            )
        else:
            warnings.append(
                f"Amount KSh {amount:,.0f} exceeds the KSh {float(expected_amount):,.0f} ticket."
            )

    if not code:
        risk_level = "high"
    elif amount is None or not recipient_matched or amount_is_partial:
        risk_level = "medium"
    else:
        risk_level = "low"

    return ParsedMpesaNote(
        code=code,
        amount=amount,
        recipient_matched=recipient_matched,
        warnings=warnings,
        risk_level=risk_level,
        amount_matches_price=amount_matches_price,
        amount_is_partial=amount_is_partial,
    )
