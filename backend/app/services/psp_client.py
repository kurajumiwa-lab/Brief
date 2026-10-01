"""PSP client — the payment abstraction layer (v2.5).

The PSP (IntaSend, Flutterwave, …) holds all custody float in segregated
sub-accounts and owns the telco integration. This app talks to exactly four
verbs — collect, disburse, refund, internal transfer — plus read-only wallet
queries, and receives ONE signed webhook per terminal event. No tokens, no
polling, no telco error codes.

Providers:
  * ``mock`` — in-process PSP with in-memory wallets. Default for dev, tests
    and the demo. Webhooks are delivered in-process (HMAC-signed, exactly like
    the real thing) so the full intent → webhook → ledger path runs end to end.
  * ``intasend`` — real PSP (``PSP_PROVIDER=intasend`` + keys). The client maps
    the same four verbs onto IntaSend's endpoints; webhooks arrive over HTTP at
    ``POST /api/payments/webhook``.

The mock's wallets are in-memory on purpose: the append-only ledger is the
source of truth and the daily reconciliation is what proves the two agree.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import re
import time
import uuid
from typing import Awaitable, Callable, Optional

from app.config import settings

log = logging.getLogger("brief.psp")


class PSPError(Exception):
    """The PSP rejected the call (bad wallet, unconfigured provider, …)."""


# ---------------------------------------------------------------------------
# Webhook plumbing
# ---------------------------------------------------------------------------

# Registered at import time by services.payments. Signature over the raw body
# with PSP_WEBHOOK_SECRET (HMAC-SHA256, hex), header X-Webhook-Signature.
WebhookSink = Callable[[dict], Awaitable[None]]
_webhook_sink: Optional[WebhookSink] = None


def register_webhook_sink(sink: WebhookSink) -> None:
    global _webhook_sink
    _webhook_sink = sink


def sign_webhook(payload: bytes) -> str:
    return hmac.new(settings.PSP_WEBHOOK_SECRET.encode(), payload, hashlib.sha256).hexdigest()


def verify_webhook_signature(payload: bytes, signature: Optional[str]) -> bool:
    if not signature:
        return False
    return hmac.compare_digest(sign_webhook(payload), signature.strip().lower())


async def dispatch_webhook(event: dict) -> bool:
    """Deliver one terminal event to the app. Real providers do this over
    HTTP (and retry on failure); the mock does it in-process. Returns
    whether the sink applied the event (False → the sender may retry)."""
    if _webhook_sink is None:  # pragma: no cover - sink is registered on import
        log.error("webhook %s dropped: no sink registered", event.get("type"))
        return False
    try:
        return bool(await _webhook_sink(event))
    except Exception:  # pragma: no cover - defensive
        log.exception("webhook sink failed for %s", event.get("type"))
        return False


# ---------------------------------------------------------------------------
# The four verbs (plus wallet reads)
# ---------------------------------------------------------------------------

class PSPClient:
    """The interface every provider implements. All amounts are integer KSh."""

    provider_name = "abstract"

    async def collect(self, *, phone: str, amount: int, provider: str,
                      api_ref: str, wallet: str, narrative: str = "") -> dict:
        """Pull ``amount`` from ``phone``'s wallet into custody ``wallet``.
        Returns ``{"payment_id": …, "status": "pending"}``. Terminal state
        arrives as a ``payment.completed`` / ``payment.failed`` webhook."""
        raise NotImplementedError

    async def disburse(self, *, phone: str, amount: int, provider: str,
                       api_ref: str, wallet: str, narrative: str = "") -> dict:
        """Send ``amount`` from custody ``wallet`` to ``phone``'s wallet.
        Terminal state arrives as ``payout.completed`` / ``payout.failed``."""
        raise NotImplementedError

    async def refund(self, *, psp_payment_id: str, amount: int,
                     api_ref: str, reason: str = "") -> dict:
        """Return funds to the original payer. Terminal state arrives as
        ``refund.completed``. (v2.5 flows use dispute disbursements instead.)"""
        raise NotImplementedError

    async def internal_transfer(self, *, from_wallet: str, to_wallet: str,
                                amount: int, api_ref: str) -> dict:
        """Move funds between custody sub-accounts. Synchronous from the app's
        point of view — no webhook, no telco involvement."""
        raise NotImplementedError

    async def create_wallet(self, wallet: str) -> None:
        raise NotImplementedError

    async def get_wallet_balance(self, wallet: str) -> int:
        raise NotImplementedError

    async def list_wallets(self) -> list[str]:
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Mock provider
# ---------------------------------------------------------------------------

class MockPSPClient(PSPClient):
    """In-process PSP. In-memory wallets; deterministic ids; HMAC-signed
    in-process webhook delivery with a flushable task queue (tests call
    ``await flush()``; dev gets delivery on the next loop iteration)."""

    provider_name = "mock"

    STATIC_WALLETS = ("ESCROW_PICK_HEDGING", "DISPUTE_HOLD", "PLATFORM_FEES",
                      "NETWORK_BENEFIT_POOL", "SACCO_SAVINGS", "SACCO_LENDING")

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._wallets: dict[str, int] = {}
        self._collections: dict[str, dict] = {}   # api_ref → record
        self._payouts: dict[str, dict] = {}
        self._seq = 0
        self._pending_tasks: set[asyncio.Task] = set()
        self._paused_events: list[dict] = []
        # Failure injection for tests: set True → next call of that kind fails.
        self.fail_next_collect = False
        self.fail_next_disburse = False
        # When True (tests), events are held back until flush() — so a test can
        # observe the window where an intent/disbursement is still in flight.
        self.paused = False

    # -- wallet bookkeeping -------------------------------------------------
    def _wallet(self, name: str) -> int:
        return self._wallets.setdefault(name, 0)

    def _next_id(self, prefix: str) -> str:
        self._seq += 1
        return f"{prefix}-{self._seq:06d}-{uuid.uuid4().hex[:6]}"

    def reset(self) -> None:
        """Wipe state between tests."""
        self._wallets = {}
        self._collections = {}
        self._payouts = {}
        self._seq = 0
        self.fail_next_collect = False
        self.fail_next_disburse = False
        self._paused_events = []
        self.paused = False

    async def create_wallet(self, wallet: str) -> None:
        self._wallet(wallet)

    async def get_wallet_balance(self, wallet: str) -> int:
        return self._wallet(wallet)

    async def list_wallets(self) -> list[str]:
        # Static sub-accounts plus any dynamic (chama) wallets created.
        return sorted(set(self.STATIC_WALLETS) | set(self._wallets))

    # -- webhook delivery ----------------------------------------------------
    def _schedule(self, event: dict) -> None:
        if self.paused:
            self._paused_events.append(event)
            return
        self._deliver(event)

    def _deliver(self, event: dict) -> None:
        async def _run() -> None:
            # A real PSP retries delivery when the app can't apply the event
            # yet (e.g. its row isn't committed when the in-process webhook
            # fires). Mirror that: bounded retries with a short backoff.
            for _ in range(10):
                if await dispatch_webhook(event):
                    return
                await asyncio.sleep(0.03)
            log.error("webhook %s (%s) not processed after retries",
                      event.get("type"), event.get("api_ref"))

        task = asyncio.get_running_loop().create_task(_run())
        self._pending_tasks.add(task)
        task.add_done_callback(self._pending_tasks.discard)

    async def flush(self, timeout: float = 5.0) -> None:
        """Wait for all in-flight webhook deliveries (tests)."""
        if self._paused_events:
            for event in self._paused_events:
                self._deliver(event)
            self._paused_events = []
        deadline = time.monotonic() + timeout
        while self._pending_tasks and time.monotonic() < deadline:
            await asyncio.wait(set(self._pending_tasks), timeout=0.05)
        if self._pending_tasks:  # pragma: no cover - shouldn't happen
            await asyncio.wait(set(self._pending_tasks), timeout=timeout)

    # -- verbs ---------------------------------------------------------------
    async def collect(self, *, phone: str, amount: int, provider: str,
                      api_ref: str, wallet: str, narrative: str = "") -> dict:
        async with self._lock:
            if self.fail_next_collect:
                self.fail_next_collect = False
                payment_id = self._next_id("MOCKPAY")
                self._schedule({
                    "type": "payment.failed", "id": payment_id, "api_ref": api_ref,
                    "amount": amount, "failure_reason": "Injected failure (test)",
                })
                return {"payment_id": payment_id, "status": "pending"}
            payment_id = self._next_id("MOCKPAY")
            self._wallets[wallet] = self._wallet(wallet) + amount
            self._collections[api_ref] = {
                "payment_id": payment_id, "phone": phone, "amount": amount,
                "provider": provider, "wallet": wallet,
            }
        self._schedule({
            "type": "payment.completed", "id": payment_id, "api_ref": api_ref,
            "amount": amount, "phone_number": phone, "provider": provider,
            "mpesa_receipt": payment_id.replace("MOCKPAY", "SHJ")[:12],
        })
        return {"payment_id": payment_id, "status": "pending"}

    async def disburse(self, *, phone: str, amount: int, provider: str,
                       api_ref: str, wallet: str, narrative: str = "") -> dict:
        async with self._lock:
            if self.fail_next_disburse:
                self.fail_next_disburse = False
                payout_id = self._next_id("MOCKOUT")
                self._schedule({
                    "type": "payout.failed", "id": payout_id, "api_ref": api_ref,
                    "amount": amount, "failure_reason": "Injected failure (test)",
                })
                return {"payout_id": payout_id, "status": "pending"}
            payout_id = self._next_id("MOCKOUT")
            if self._wallet(wallet) < amount:
                self._schedule({
                    "type": "payout.failed", "id": payout_id, "api_ref": api_ref,
                    "amount": amount, "failure_reason": "Insufficient wallet balance",
                })
                return {"payout_id": payout_id, "status": "pending"}
            self._wallets[wallet] = self._wallet(wallet) - amount
            self._payouts[api_ref] = {
                "payout_id": payout_id, "phone": phone, "amount": amount, "wallet": wallet,
            }
        self._schedule({
            "type": "payout.completed", "id": payout_id, "api_ref": api_ref,
            "amount": amount, "phone_number": phone, "provider": provider,
        })
        return {"payout_id": payout_id, "status": "pending"}

    async def refund(self, *, psp_payment_id: str, amount: int,
                     api_ref: str, reason: str = "") -> dict:
        async with self._lock:
            record = next((r for r in self._collections.values()
                           if r["payment_id"] == psp_payment_id), None)
            if record is None:
                raise PSPError("No such collection to refund")
            if self._wallet(record["wallet"]) < amount:
                raise PSPError("Insufficient balance to refund")
            self._wallets[record["wallet"]] = self._wallet(record["wallet"]) - amount
        refund_id = self._next_id("MOCKRFND")
        self._schedule({"type": "refund.completed", "id": refund_id,
                        "api_ref": api_ref, "amount": amount,
                        "phone_number": record["phone"]})
        return {"refund_id": refund_id, "status": "pending"}

    async def internal_transfer(self, *, from_wallet: str, to_wallet: str,
                                amount: int, api_ref: str) -> dict:
        async with self._lock:
            if self._wallet(from_wallet) < amount:
                raise PSPError(f"Insufficient balance in {from_wallet} to transfer {amount}")
            self._wallets[from_wallet] = self._wallet(from_wallet) - amount
            self._wallets[to_wallet] = self._wallet(to_wallet) + amount
        return {"transfer_id": self._next_id("MOCKXFER"), "status": "complete"}


# ---------------------------------------------------------------------------
# IntaSend provider (real PSP)
# ---------------------------------------------------------------------------

class IntaSendClient(PSPClient):
    """Maps the four verbs onto IntaSend's hosted-wallet API. Webhooks arrive
    over HTTP at POST /api/payments/webhook and are signed with the same
    HMAC-SHA256 secret as the mock, so the app cannot tell the difference."""

    provider_name = "intasend"
    DEFAULT_BASE = "https://payment.intasend.com/api/v1"

    def __init__(self) -> None:
        if not settings.PSP_API_KEY or not settings.PSP_API_SECRET:
            raise PSPError("PSP_PROVIDER=intasend requires PSP_API_KEY and PSP_API_SECRET")
        self._base = (settings.PSP_BASE_URL or self.DEFAULT_BASE).rstrip("/")
        self._headers = {
            "Authorization": f"Bearer {settings.PSP_API_KEY}",
            "Content-Type": "application/json",
        }
        self._ref_index: dict[str, str] = {}  # api_ref → psp id (refunds need it)

    async def _post(self, path: str, payload: dict) -> dict:
        import httpx

        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.post(f"{self._base}{path}", json=payload, headers=self._headers)
        if resp.status_code >= 400:
            raise PSPError(f"IntaSend {path} → {resp.status_code}: {resp.text[:200]}")
        data = resp.json()
        if isinstance(data, dict) and data.get("status") == "FAILED":
            raise PSPError(f"IntaSend {path} failed: {data.get('error_message', '')}")
        return data

    async def collect(self, *, phone: str, amount: int, provider: str,
                      api_ref: str, wallet: str, narrative: str = "") -> dict:
        data = await self._post("/checkout/mpesa-pay/", {
            "amount": amount, "currency": "KES", "phone_number": phone,
            "provider": provider, "account": wallet,
            "narrative": (narrative or api_ref)[:100],
            "api_ref": api_ref,
            # "host" (for card redirects) is configured on the PSP side.
        })
        payment_id = str(data.get("id") or "")
        self._ref_index[api_ref] = payment_id
        return {"payment_id": payment_id, "status": "pending"}

    async def disburse(self, *, phone: str, amount: int, provider: str,
                       api_ref: str, wallet: str, narrative: str = "") -> dict:
        data = await self._post("/payouts/mobile-money/", {
            "account": wallet, "amount": amount, "currency": "KES",
            "provider": provider, "phone_number": phone,
            "narrative": (narrative or api_ref)[:100], "api_ref": api_ref,
        })
        payout_id = str(data.get("id") or "")
        self._ref_index[api_ref] = payout_id
        return {"payout_id": payout_id, "status": "pending"}

    async def refund(self, *, psp_payment_id: str, amount: int,
                     api_ref: str, reason: str = "") -> dict:
        data = await self._post(f"/transactions/{psp_payment_id}/refund/", {
            "amount": amount, "narrative": (reason or api_ref)[:100], "api_ref": api_ref,
        })
        return {"refund_id": str(data.get("id") or ""), "status": "pending"}

    async def internal_transfer(self, *, from_wallet: str, to_wallet: str,
                                amount: int, api_ref: str) -> dict:
        await self._post("/wallets/transfer/", {
            "from_wallet": from_wallet, "to_wallet": to_wallet,
            "amount": amount, "currency": "KES", "api_ref": api_ref,
        })
        return {"transfer_id": api_ref, "status": "complete"}

    async def create_wallet(self, wallet: str) -> None:
        try:
            await self._post("/wallets/", {"name": wallet, "currency": "KES"})
        except PSPError as exc:
            if "already" not in str(exc).lower():
                raise

    async def get_wallet_balance(self, wallet: str) -> int:
        import httpx

        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.get(f"{self._base}/wallets/{wallet}/balance/",
                                  headers=self._headers)
        if resp.status_code >= 400:
            return 0
        data = resp.json()
        return int(data.get("balance", 0))

    async def list_wallets(self) -> list[str]:
        import httpx

        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.get(f"{self._base}/wallets/", headers=self._headers)
        if resp.status_code >= 400:
            return list(MockPSPClient.STATIC_WALLETS)
        data = resp.json()
        items = data if isinstance(data, list) else data.get("wallets", [])
        return [w.get("name") for w in items if w.get("name")]


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

_provider: Optional[PSPClient] = None


def get_psp_client() -> PSPClient:
    global _provider
    if _provider is None:
        provider = (settings.PSP_PROVIDER or "mock").strip().lower()
        if provider == "mock":
            _provider = MockPSPClient()
        elif provider == "intasend":
            _provider = IntaSendClient()
        else:
            raise PSPError(f"Unknown PSP_PROVIDER '{provider}' (use mock | intasend)")
    return _provider


def mock_psp() -> MockPSPClient:
    """Test/dev handle for the mock provider (raises if a real one is set)."""
    client = get_psp_client()
    if not isinstance(client, MockPSPClient):
        raise PSPError("mock_psp() requires PSP_PROVIDER=mock")
    return client


# ---------------------------------------------------------------------------
# Multi-telco detection (free with the PSP abstraction)
# ---------------------------------------------------------------------------

_TELCO_PREFIXES = (
    ("MPESA", ("71", "72", "74", "75", "79")),
    ("AIRTEL", ("733", "738", "739", "10")),
    ("TKASH", ("77", "11")),
)


def detect_provider(phone: str) -> str:
    """Map a 254-prefixed phone number to its telco (default M-Pesa)."""
    digits = re.sub(r"\D", "", phone or "")
    if digits.startswith("254"):
        digits = digits[3:]
    for provider, prefixes in _TELCO_PREFIXES:
        if any(digits.startswith(prefix) for prefix in prefixes):
            return provider
    return "MPESA"
