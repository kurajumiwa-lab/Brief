"""The rules behind a receipt reward, kept out of the HTTP layer.

Three things live here and nowhere else:

  · **Parsing.** A QR is untrusted text. The server reads the same shapes the
    phone does (KRA link, DigiTax link, JSON, `key=value`) and records only what
    the code actually carried. It never invents a total.
  · **Valuation.** Points depend on the amount, how old the receipt is, and how
    much evidence the code carried. The server computes this; a client cannot
    post "points: 500".
  · **Redemption codes.** A voucher's four digits are derived from a server-only
    seed and the current minute, so the code on a screenshot stops working.

There is deliberately no KRA network call and no money movement in this module.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qsl, unquote, urlparse

from app.config import settings

#: Full value inside the shop, then a falling share. Mirrors the phone's ladder;
#: the server is authoritative so a clock change on a device cannot mint points.
FRESHNESS = (
    (15, 1.0, "fresh"),
    (60, 0.7, "hour"),
    (60 * 24, 0.4, "day"),
    (60 * 24 * 7, 0.15, "week"),
    (math.inf, 0.0, "expired"),
)

KEY_ALIASES = {
    "invoice": (
        "controlunitinvoicenumber", "controlunitinvoiceno", "cuin", "invoicenumber",
        "invoiceno", "invoice", "receiptnumber", "receiptno", "receipt", "billnumber",
        "controlnumber", "transactionnumber",
    ),
    "pin": ("tradersystempin", "merchantpin", "businesspin", "krapin", "pin", "supplierpin"),
    "merchant": (
        "merchantname", "tradename", "businessname", "tradername", "sellername",
        "suppliername", "shopname", "merchant",
    ),
    "total": (
        "totalamount", "totalgrossamount", "grosstotal", "grandtotal", "receipttotal",
        "total", "amount", "amountpaid",
    ),
    "issued_at": (
        "issuedat", "issueddate", "invoicedate", "transactiondate", "purchasedate",
        "date", "timestamp", "datetime", "time",
    ),
    "tax": ("taxamount", "totaltax", "vat", "vatamount"),
    "token": ("data", "token", "signature", "verify", "verification", "code"),
}

PIN_RE = re.compile(r"^[AP]\d{9}[A-Z]$")


def norm_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def clean_region(value: Any) -> str | None:
    """A region is a short slug, not a free-text address. Keep grouping stable."""
    text = clean_text(value).lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text[:80] or None


def is_valid_pin(value: Any) -> bool:
    return bool(PIN_RE.match(clean_text(value).upper()))


def parse_amount(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        cleaned = re.sub(r"(?i)kes|ksh|shs?", "", str(value))
        cleaned = re.sub(r"[,\s]", "", cleaned)
        cleaned = re.sub(r"[^\d.-]", "", cleaned)
        try:
            number = float(cleaned)
        except ValueError:
            return None
    if not math.isfinite(number) or number <= 0:
        return None
    return int(round(number))


def parse_date(value: Any) -> datetime | None:
    text = clean_text(value)
    if not text:
        return None
    candidate = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        parsed = None
    if parsed is None:
        match = re.match(
            r"^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})"
            r"(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$",
            text,
        )
        if not match:
            return None
        day, month, year, hour, minute, second = match.groups()
        try:
            parsed = datetime(int(year), int(month), int(day),
                              int(hour or 0), int(minute or 0), int(second or 0))
        except ValueError:
            return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _to_map(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    return {
        norm_key(key): val
        for key, val in value.items()
        if not isinstance(val, (dict, list))
    }


def _from_url(raw: str) -> tuple[dict[str, Any], str, str] | None:
    try:
        parsed = urlparse(raw)
    except ValueError:
        return None
    if not parsed.scheme or not parsed.netloc:
        return None
    mapping: dict[str, Any] = {}
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        mapping[norm_key(key)] = value
    if "?" in parsed.fragment:
        for key, value in parse_qsl(parsed.fragment.split("?", 1)[1], keep_blank_values=True):
            mapping[norm_key(key)] = value
    return mapping, parsed.path, raw


def _from_key_value(raw: str) -> dict[str, Any]:
    mapping: dict[str, Any] = {}
    for pair in re.split(r"[&;|]", raw):
        if "=" not in pair:
            continue
        key, _, value = pair.partition("=")
        if not key:
            continue
        mapping[norm_key(key)] = unquote(value)
    return mapping


def _pick(mapping: dict[str, Any], aliases: tuple[str, ...]) -> Any:
    for alias in aliases:
        value = mapping.get(norm_key(alias))
        if value is not None and clean_text(value) != "":
            return value
    return None


def parse_receipt_payload(raw: Any) -> dict[str, Any]:
    """Read a QR payload into the same shape the phone uses.

    Returns `{ok, receipt, missing}` or `{ok: False, error}`. `verified` means the
    code carried a merchant PIN, an invoice number and a total — not that KRA was
    contacted.
    """
    text = clean_text(raw)
    if not text:
        return {"ok": False, "error": "There is nothing to read yet."}

    mapping: dict[str, Any] = {}
    verification_url: str | None = None
    path = ""

    if text.startswith("{") or text.startswith("["):
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return {"ok": False, "error": "That QR code is not valid JSON."}
        value = parsed[0] if isinstance(parsed, list) and parsed else parsed
        mapping = _to_map(value)
    elif re.match(r"^https?://", text, re.I):
        from_url = _from_url(text)
        if from_url is None:
            return {"ok": False, "error": "That link could not be read."}
        mapping, path, verification_url = from_url
    elif "=" in text:
        mapping = _from_key_value(text)
    else:
        return {
            "ok": False,
            "error": "That code is not a receipt. Point the camera at the QR printed on the receipt.",
        }

    invoice = clean_text(_pick(mapping, KEY_ALIASES["invoice"]))
    pin = clean_text(_pick(mapping, KEY_ALIASES["pin"])).upper()

    # DigiTax: https://etims.ke/r/<business_id>/<trader_invoice_number>
    if not invoice and path:
        digi = re.match(r"^/r/[^/]+/([^/]+)", path)
        if digi:
            invoice = unquote(digi.group(1))

    total = parse_amount(_pick(mapping, KEY_ALIASES["total"]))
    tax = parse_amount(_pick(mapping, KEY_ALIASES["tax"]))
    issued_at = parse_date(_pick(mapping, KEY_ALIASES["issued_at"]))
    token = clean_text(_pick(mapping, KEY_ALIASES["token"]))

    # KRA's own link carries Data=<KRA PIN><branch><signature> as one opaque
    # string. The PIN is the only field recoverable without a server call.
    if not pin and token:
        kra = re.match(r"^([APap]\d{9}[A-Za-z])", token)
        if kra:
            pin = kra.group(1).upper()

    if not invoice and not pin and total is None and not verification_url:
        return {
            "ok": False,
            "error": "This code does not contain receipt details. Use the receipt's own QR code.",
        }

    return {
        "ok": True,
        "receipt": {
            "invoice": invoice,
            "pin": pin,
            "merchant": clean_text(_pick(mapping, KEY_ALIASES["merchant"])),
            "total": total,
            "tax": tax,
            "issued_at": issued_at,
            "verification_url": verification_url,
            "token": token,
            "verified": bool(invoice and pin and total is not None),
            "source": "qr_link" if verification_url else "qr",
        },
        "missing": [
            label for label, present in (
                ("invoice", bool(invoice)),
                ("merchant_pin", bool(pin)),
                ("total", total is not None),
            ) if not present
        ],
    }


def receipt_key(receipt: dict[str, Any]) -> str:
    pin = clean_text(receipt.get("pin")).upper()
    invoice = clean_text(receipt.get("invoice"))
    if pin and invoice:
        return f"{pin}:{invoice}"
    token = clean_text(receipt.get("token"))
    if token:
        return f"token:{token}"
    url = clean_text(receipt.get("verification_url"))
    if url:
        return f"url:{url}"
    return ""


def receipt_value(total: Any, issued_at: datetime | None, scanned_at: datetime) -> dict[str, Any]:
    """Amount, age and freshness → points. The ladder is server-authoritative."""
    amount = parse_amount(total)
    if amount is None:
        return {"base": 0, "multiplier": 0.0, "points": 0, "freshness": "expired", "age_minutes": None}

    base = max(1, amount // 50)
    if issued_at is not None:
        age_minutes = max(0.0, (scanned_at - issued_at).total_seconds() / 60)
        freshness = next((key for limit, _, key in FRESHNESS if age_minutes <= limit), "expired")
        multiplier = next(mult for limit, mult, key in FRESHNESS if key == freshness)
    else:
        age_minutes = None
        freshness = "undated"
        multiplier = 0.5

    points = int(math.floor(base * multiplier + 0.5))
    return {
        "base": base,
        "multiplier": multiplier,
        "points": max(0, points),
        "freshness": freshness,
        "age_minutes": age_minutes,
    }


def voucher_code(voucher_id: Any, seed: str, at: datetime, window_seconds: int = 60) -> str:
    """A four-digit code that is only valid for one minute.

    HMAC rather than `random()`: the merchant's phone can check the same minute
    on the server, and the seed never leaves it.
    """
    window = int(at.replace(tzinfo=timezone.utc).timestamp()) // window_seconds
    message = f"{voucher_id}:{seed}:{window}".encode()
    digest = hmac.new(settings.SECRET_KEY.encode(), message, hashlib.sha256).digest()
    return f"{int.from_bytes(digest[:4], 'big') % 10000:04d}"


def voucher_code_matches(
    voucher_id: Any, seed: str, code: str, at: datetime, window_seconds: int = 60,
) -> bool:
    """Accept the current window and the one before it.

    A code can expire while a cashier is typing it. Accepting one previous window
    is a tolerance for that, not a licence to reuse yesterday's screenshot.
    """
    submitted = re.sub(r"\D", "", clean_text(code))
    if len(submitted) != 4:
        return False
    current = int(at.replace(tzinfo=timezone.utc).timestamp()) // window_seconds
    for offset in (0, -1):
        window_dt = datetime.fromtimestamp((current + offset) * window_seconds, tz=timezone.utc).replace(tzinfo=None)
        if hmac.compare_digest(voucher_code(voucher_id, seed, window_dt, window_seconds), submitted):
            return True
    return False
