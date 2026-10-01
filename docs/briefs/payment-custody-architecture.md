# M-Pesa + PSP Fund Custody Architecture

> **Provenance.** Complete build specification for the money layer of Brief_,
> captured verbatim from the planning conversation of 2026-10-01 in its two
> iterations. **Iteration 2 ("Payment Architecture Without Daraja", the
> PSP-as-abstraction model) is the chosen architecture** and is what v2.5
> implements. Iteration 1 (Daraja direct + IntaSend escrow) is preserved below
> as reference — its custody chain, sub-account split, ledger rules,
> reconciliation engine and dual-approval engine carry over unchanged; only the
> telco integration layer differs.
>
> **Implementation mapping (v2.5):**
>
> | Spec element | Code |
> |---|---|
> | PSP abstraction (collect / disburse / refund / webhook) | `backend/app/services/psp_client.py` (`PSPClient` ABC, `MockPSPClient` default, `IntaSendClient` stub) |
> | Segregated sub-accounts | `ESCROW_PICK_HEDGING`, `DISPUTE_HOLD`, `PLATFORM_FEES` static; `CHAMA_<uuid>` per active chama (`chama.psp_sub_account`) |
> | `payment_intents` | `models/payments.py::PaymentIntent` |
> | `custody_ledger` (append-only) | `models/payments.py::CustodyLedgerEntry` + Postgres trigger `trg_custody_ledger_append_only` + INSERT-only service `services/custody.py` |
> | `disbursements` + dual approval | `models/payments.py::Disbursement`, `services/disbursements.py` (threshold `DUAL_APPROVAL_THRESHOLD_KSH`) |
> | `reconciliation_runs` + orphan check | `services/reconciliation.py`, nightly at `DAILY_RECONCILIATION_HOUR_UTC` (01:00 EAT) + `POST /api/payments/reconciliation/run` |
> | `dispute_holds` | `models/payments.py::DisputeHold` |
> | Webhook with HMAC signature + idempotency | `POST /api/payments/webhook` (`routes/payments.py`) |
> | Pick-hedging escrow state machine | `services/lock_settlement.py` + `POST /api/locks/clusters/{id}/pay|settle|dispute` |
> | AML / limit guardrails | `services/payments.py::validate_transaction` (`PAYMENT_LIMITS`) |
> | Chama pool custody (Layer 2) | `models/chamas.py`, `services/chamas.py` — single `custody_ledger`, no separate `chama_ledger` |
> | Sacco custody (Layer 3) | Deferred; `SACCO_SAVINGS` / `SACCO_LENDING` slots into the same sub-account/ledger machinery |

---

# Iteration 1 — M-Pesa + PSP Fund Custody Architecture (Complete Build Spec, Licensed Entity)

## 0. Architectural Premise

You hold the license. The platform is the **authorized operator**. Funds never touch your company's operating bank account. Every shilling flows through a **segregated custody chain**:

```
VENDOR M-PESA WALLET
        │
        ▼ (STK Push / C2B)
┌──────────────────────────┐
│   SAFARICOM M-PESA       │
│   (Telco Settlement)     │
└──────────┬───────────────┘
           │ (Daraja API → PSP Settlement Account)
           ▼
┌──────────────────────────┐
│   LICENSED PSP           │
│   (IntaSend / Kopokopo / │
│    Cellulant / DPO)      │
│                          │
│   ┌──────────────────┐   │
│   │ CUSTODY ACCOUNTS │   │
│   │                  │   │
│   │ • Escrow Pool    │   │
│   │ • Chama Pool A   │   │
│   │ • Chama Pool B   │   │
│   │ • Sacco Savings  │   │
│   │ • Sacco Lending  │   │
│   │ • Dispute Hold   │   │
│   │ • Platform Fees  │   │
│   └──────────────────┘   │
└──────────┬───────────────┘
           │ (B2C / B2B Disbursement)
           ▼
SUPPLIER M-PESA WALLET  /  VENDOR M-PESA WALLET  /  GUARANTOR REFUND
```

**Non-negotiable rules:**
1. Platform operating account ≠ custody account. Ever.
2. PSP holds all float. You hold the ledger.
3. Every internal ledger entry maps to a PSP transaction reference.
4. Daily automated reconciliation between your ledger and PSP statement.
5. No disbursement without dual approval above KSh 10,000.

---

## 1. PSP Selection & Integration Model

### 1.1 Recommended PSP Partners (Kenya, CBK-Licensed)

| PSP | Strength | Escrow Support | API Quality | Fees |
|---|---|---|---|---|
| **IntaSend** | Best developer docs, sandbox, escrow primitives | Native escrow API | Excellent | 1.5% collection, 1% disbursement |
| **Kopokopo** | Strong merchant focus, Till integration | Manual escrow via sub-accounts | Good | 1.5% collection |
| **Cellulant (Tingg)** | Pan-African, enterprise-grade | Sub-wallet architecture | Moderate | Negotiable at volume |
| **DPO / Network International** | Card + mobile money | Limited escrow | Moderate | 2%+ |

**Recommendation for v1:** IntaSend. Their escrow API is purpose-built for marketplace settlement, their sandbox is reliable, and their compliance team understands cooperative structures.

### 1.2 PSP Account Architecture

Request the PSP to create **segregated virtual sub-accounts** under your master merchant account:

```
Master Merchant: YOUR_COOP_SACCO_LTD (PSP Master)
├── SUB-001: ESCROW_PICK_HEDGING     (Pick hedging settlement)
├── SUB-002: CHAMA_POOL_TEMPLATE     (Cloned per chama)
├── SUB-003: SACCO_SAVINGS           (Member deposits)
├── SUB-004: SACCO_LENDING           (Loan disbursement pool)
├── SUB-005: DISPUTE_HOLD            (Frozen funds during disputes)
├── SUB-006: PLATFORM_FEES           (Your revenue — only account you can withdraw from)
└── SUB-007: NETWORK_BENEFIT_POOL    (Vendor credits/benefits)
```

Each sub-account has its own balance, statement, and access controls. The PSP enforces that funds in SUB-001 through SUB-005 **cannot be withdrawn to your operating account** — only disbursed to vendor/supplier M-Pesa wallets per your API instructions.

---

## 2. M-Pesa Daraja Integration (Safaricom)

> Superseded by Iteration 2 for v1; retained because the callback/ledger
> discipline here (idempotency, "never write a ledger entry without a confirmed
> reference", atomic intent+ledger transaction) is what the PSP webhook handler
> re-implements.

### 2.1 API Endpoints You Use

| Flow | Daraja API | Direction | Use Case |
|---|---|---|---|
| **STK Push** | `/mpesa/stkpush/v1/processrequest` | Platform → Vendor phone | "Pay KSh 2,600 for your tomato lock" |
| **C2B Register** | `/mpesa/c2b/v1/registerurl` | Safaricom → Your server | Receive vendor push payments to Till |
| **C2B Validate** | `/mpesa/c2b/v1/validate` | Safaricom → Your server | Validate incoming payment before accepting |
| **C2B Confirm** | `/mpesa/c2b/v1/confirm` | Safaricom → Your server | Confirm payment received |
| **B2C** | `/mpesa/b2c/v1/paymentrequest` | Platform → Vendor wallet | Loan disbursement, refund, dividend |
| **B2B** | `/mpesa/b2b/v1/paymentrequest` | Platform → Supplier Till | Bulk settlement to supplier |
| **Transaction Status** | `/mpesa/transactionstatus/v1/query` | Platform → Safaricom | Check if a stuck transaction completed |
| **Account Balance** | `/mpesa/accountbalance/v1/query` | Platform → Safaricom | Check Till balance (reconciliation) |

### 2.2 Authentication

```python
import base64
from datetime import datetime
import requests

class DarajaClient:
    def __init__(self, consumer_key, consumer_secret, env="sandbox"):
        self.consumer_key = consumer_key
        self.consumer_secret = consumer_secret
        self.base_url = (
            "https://sandbox.safaricom.co.ke" if env == "sandbox"
            else "https://api.safaricom.co.ke"
        )
        self.shortcode = "174379"  # Your Paybill/Till
        self.passkey = "your_passkey"
        self.token = None

    def authenticate(self):
        credentials = base64.b64encode(
            f"{self.consumer_key}:{self.consumer_secret}".encode()
        ).decode()
        resp = requests.get(
            f"{self.base_url}/oauth/v1/generate?grant_type=client_credentials",
            headers={"Authorization": f"Basic {credentials}"}
        )
        self.token = resp.json()["access_token"]
        return self.token

    def _headers(self):
        if not self.token:
            self.authenticate()
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }
```

### 2.3 STK Push (Primary Collection Method)

This is how you pull money from a vendor's M-Pesa wallet for pick hedging deposits, chama contributions, and sacco savings.

```python
def stk_push(self, phone, amount, account_ref, transaction_desc):
    """
    Triggers M-Pesa PIN prompt on vendor's phone.
    phone: '254712345678' (no + sign)
    amount: integer in KSh
    account_ref: internal reference (e.g., 'PICK-42-VENDOR-7')
    """
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    password = base64.b64encode(
        f"{self.shortcode}{self.passkey}{timestamp}".encode()
    ).decode()

    payload = {
        "BusinessShortCode": self.shortcode,
        "Password": password,
        "Timestamp": timestamp,
        "TransactionType": "CustomerPayBillOnline",
        "Amount": amount,
        "PartyA": phone,
        "PartyB": self.shortcode,
        "PhoneNumber": phone,
        "CallBackURL": "https://yourdomain.com/api/v1/payments/daraja/callback",
        "AccountReference": account_ref[:12],  # Daraja 12-char limit
        "TransactionDesc": transaction_desc[:13]
    }

    resp = requests.post(
        f"{self.base_url}/mpesa/stkpush/v1/processrequest",
        json=payload,
        headers=self._headers()
    )
    data = resp.json()

    # data["CheckoutRequestID"] is your tracking handle
    return {
        "checkout_request_id": data.get("CheckoutRequestID"),
        "merchant_request_id": data.get("MerchantRequestID"),
        "response_code": data.get("ResponseCode")
    }
```

### 2.4 B2C Disbursement (Payouts)

Used for loan disbursements, refunds, dividends, and price shield credits.

```python
def b2c_disburse(self, phone, amount, occasion, remarks):
    """
    Sends money FROM your Till TO vendor's M-Pesa wallet.
    Requires B2C operator credentials (separate from STK).
    """
    payload = {
        "InitiatorName": "your_b2c_initiator",
        "SecurityCredential": self._encrypt_credential("your_initiator_password"),
        "CommandID": "BusinessPayment",  # or "SalaryPayment", "PromotionPayment"
        "Amount": amount,
        "PartyA": self.shortcode,
        "PartyB": phone,
        "Remarks": remarks[:100],
        "QueueTimeOutURL": "https://yourdomain.com/api/v1/payments/daraja/timeout",
        "ResultURL": "https://yourdomain.com/api/v1/payments/daraja/b2c/result",
        "Occasion": occasion[:100]
    }

    resp = requests.post(
        f"{self.base_url}/mpesa/b2c/v1/paymentrequest",
        json=payload,
        headers=self._headers()
    )
    return resp.json()
```

### 2.5 Callback Handler (The Critical Piece)

Every STK Push and B2C triggers an async callback to your server. **This is where your ledger gets written.** If you miss a callback, your ledger drifts from reality.

```python
from flask import Flask, request, jsonify
import hmac, hashlib

app = Flask(__name__)

@app.route("/api/v1/payments/daraja/callback", methods=["POST"])
def daraja_stk_callback():
    """
    Receives STK Push result from Safaricom.
    This endpoint MUST respond with 200 within 5 seconds
    or Safaricom will retry (and you'll get duplicates).
    """
    data = request.json
    body = data.get("Body", {})
    stk = body.get("stkCallback", {})

    checkout_id = stk.get("CheckoutRequestID")
    result_code = stk.get("ResultCode")  # 0 = success, 1032 = cancelled, etc.
    result_desc = stk.get("ResultDesc")

    # Idempotency: check if we already processed this checkout_id
    if is_already_processed(checkout_id):
        return jsonify({"ResultCode": 0, "ResultDesc": "Already processed"})

    if result_code == 0:
        # SUCCESS — extract M-Pesa receipt and phone
        metadata = stk.get("CallbackMetadata", {}).get("Item", [])
        mpesa_receipt = None
        phone = None
        amount = None

        for item in metadata:
            if item["Name"] == "MpesaReceiptNumber":
                mpesa_receipt = item["Value"]
            elif item["Name"] == "PhoneNumber":
                phone = str(item["Value"])
            elif item["Name"] == "Amount":
                amount = int(item["Value"])

        # CRITICAL: Write to ledger inside a database transaction
        process_successful_payment(
            checkout_id=checkout_id,
            mpesa_receipt=mpesa_receipt,
            phone=phone,
            amount_ksh=amount
        )
    else:
        # FAILED — vendor cancelled, insufficient funds, timeout
        process_failed_payment(
            checkout_id=checkout_id,
            result_code=result_code,
            result_desc=result_desc
        )

    # ALWAYS return 200 to Safaricom
    return jsonify({"ResultCode": 0, "ResultDesc": "Accepted"})


def process_successful_payment(checkout_id, mpesa_receipt, phone, amount_ksh):
    """
    Atomic database transaction: update payment record + write ledger entry.
    """
    with db.transaction():
        # 1. Find the pending payment by checkout_id
        payment = Payment.select().where(
            Payment.checkout_request_id == checkout_id,
            Payment.status == "pending"
        ).first()

        if not payment:
            log_error(f"Orphan callback: {checkout_id}")
            return

        # 2. Update payment status
        payment.status = "completed"
        payment.mpesa_receipt = mpesa_receipt
        payment.completed_at = datetime.now()
        payment.save()

        # 3. Route funds to correct PSP sub-account
        route_to_psp_subaccount(
            psp_sub=payment.target_sub_account,
            amount_ksh=amount_ksh,
            reference=mpesa_receipt
        )

        # 4. Write append-only ledger entry
        LedgerEntry.create(
            entity_type=payment.entity_type,     # 'pick', 'chama_deposit', 'sacco_savings'
            entity_id=payment.entity_id,
            vendor_id=payment.vendor_id,
            transaction_type="credit_in",
            amount_ksh=amount_ksh,
            mpesa_receipt=mpesa_receipt,
            psp_reference=payment.psp_reference,
            checkout_request_id=checkout_id,
            status="settled"
        )

        # 5. Trigger downstream action based on entity type
        if payment.entity_type == "pick":
            confirm_pick_deposit(payment.entity_id)
        elif payment.entity_type == "chama_deposit":
            confirm_chama_deposit(payment.entity_id)
        elif payment.entity_type == "sacco_savings":
            confirm_sacco_deposit(payment.entity_id)
```

---

## 3. PSP Escrow Integration (IntaSend Example)

### 3.1 PSP API Client

```python
class IntaSendClient:
    def __init__(self, api_key, api_secret, env="sandbox"):
        self.api_key = api_key
        self.api_secret = api_secret
        self.base_url = (
            "https://sandbox.intasend.com/api/v1" if env == "sandbox"
            else "https://payment.intasend.com/api/v1"
        )

    def create_escrow_transaction(self, sub_account, amount, description, metadata):
        """
        Move funds from collection pool to escrow sub-account.
        """
        payload = {
            "wallet_id": sub_account,
            "amount": amount,
            "currency": "KES",
            "description": description,
            "metadata": metadata  # JSON: {"pick_id": "uuid", "vendor_id": "uuid"}
        }
        resp = requests.post(
            f"{self.base_url}/wallets/escrow/",
            json=payload,
            auth=(self.api_key, self.api_secret)
        )
        return resp.json()

    def release_escrow(self, escrow_id, beneficiary_phone, amount):
        """
        Release escrowed funds to supplier/vendor M-Pesa.
        """
        payload = {
            "escrow_id": escrow_id,
            "beneficiary": beneficiary_phone,
            "amount": amount,
            "channel": "MPESA"
        }
        resp = requests.post(
            f"{self.base_url}/wallets/escrow/release/",
            json=payload,
            auth=(self.api_key, self.api_secret)
        )
        return resp.json()

    def refund_escrow(self, escrow_id, vendor_phone, amount):
        """
        Refund escrowed funds back to vendor (e.g., supplier no-show).
        """
        payload = {
            "escrow_id": escrow_id,
            "beneficiary": vendor_phone,
            "amount": amount,
            "channel": "MPESA"
        }
        resp = requests.post(
            f"{self.base_url}/wallets/escrow/refund/",
            json=payload,
            auth=(self.api_key, self.api_secret)
        )
        return resp.json()

    def get_wallet_balance(self, wallet_id):
        resp = requests.get(
            f"{self.base_url}/wallets/{wallet_id}/balance/",
            auth=(self.api_key, self.api_secret)
        )
        return resp.json()
```

---

## 4. Complete Database Schema (Payments & Custody)

```sql
-- ============================================================
-- PAYMENT INTENTS (Created BEFORE money moves)
-- ============================================================
CREATE TABLE payment_intents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id           UUID REFERENCES vendors(id) NOT NULL,
    entity_type         TEXT NOT NULL
                        CHECK (entity_type IN (
                            'pick_deposit',
                            'pick_full_payment',
                            'chama_deposit',
                            'chama_loan_repayment',
                            'sacco_savings',
                            'sacco_loan_repayment',
                            'pool_ride_share'
                        )),
    entity_id           UUID NOT NULL,           -- FK to picks, chama_deposits, sacco_loans, etc.
    amount_ksh          INT NOT NULL,
    target_psp_sub      TEXT NOT NULL,           -- 'ESCROW_PICK', 'CHAMA_001', 'SACCO_SAVINGS'
    daraja_checkout_id  TEXT,                    -- From STK Push response
    mpesa_receipt       TEXT,                    -- From callback (e.g., 'SHJ3XXXXXX')
    psp_reference       TEXT,                    -- From PSP confirmation
    status              TEXT NOT NULL DEFAULT 'created'
                        CHECK (status IN (
                            'created',          -- Intent created, STK not yet sent
                            'stk_sent',         -- STK Push sent to vendor phone
                            'stk_accepted',     -- Vendor entered PIN
                            'stk_rejected',     -- Vendor cancelled or wrong PIN
                            'stk_timeout',      -- Vendor didn't respond in 60s
                            'completed',        -- Funds received and routed to PSP sub
                            'failed',           -- Terminal failure
                            'refunded'          -- Funds returned to vendor
                        )),
    failure_reason      TEXT,
    retry_count         INT DEFAULT 0,
    max_retries         INT DEFAULT 2,
    created_at          TIMESTAMPTZ DEFAULT now(),
    completed_at        TIMESTAMPTZ
);

CREATE INDEX idx_payment_intents_vendor ON payment_intents(vendor_id);
CREATE INDEX idx_payment_intents_entity ON payment_intents(entity_type, entity_id);
CREATE INDEX idx_payment_intents_checkout ON payment_intents(daraja_checkout_id);

-- ============================================================
-- APPEND-ONLY LEDGER (The Source of Truth)
-- ============================================================
CREATE TABLE custody_ledger (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ledger_date         DATE NOT NULL DEFAULT CURRENT_DATE,
    vendor_id           UUID REFERENCES vendors(id),
    psp_sub_account     TEXT NOT NULL,
    transaction_type    TEXT NOT NULL
                        CHECK (transaction_type IN (
                            'collection_in',     -- Vendor paid via M-Pesa
                            'escrow_lock',       -- Funds locked for pick
                            'escrow_release',    -- Funds released to supplier
                            'escrow_refund',     -- Funds returned to vendor
                            'chama_pool_in',     -- Chama deposit
                            'chama_loan_out',    -- Chama loan disbursed
                            'chama_repayment_in',-- Chama loan repaid
                            'chama_dividend_out',-- Chama interest distributed
                            'sacco_deposit_in',  -- Sacco savings
                            'sacco_loan_out',    -- Sacco loan disbursed
                            'sacco_repayment_in',-- Sacco loan repaid
                            'sacco_dividend_out',-- Sacco annual dividend
                            'fee_deducted',      -- Platform fee taken
                            'dispute_freeze',    -- Funds frozen during dispute
                            'dispute_release',   -- Dispute resolved, funds released
                            'reversal'           -- Correction of erroneous entry
                        )),
    amount_ksh          INT NOT NULL,            -- Always positive; type indicates direction
    direction           TEXT NOT NULL
                        CHECK (direction IN ('credit', 'debit')),
    running_balance_ksh INT NOT NULL,            -- Balance of this sub-account after this entry
    mpesa_receipt       TEXT,
    psp_reference       TEXT,
    daraja_checkout_id  TEXT,
    entity_type         TEXT,
    entity_id           UUID,
    approved_by         UUID,                    -- For dual-approval disbursements
    approved_by_2       UUID,                    -- Second approver
    reversal_of         UUID REFERENCES custody_ledger(id),  -- If this reverses a prior entry
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT now()
);

-- CRITICAL: No UPDATE or DELETE allowed on this table.
-- Grant only INSERT and SELECT to the application role.
REVOKE UPDATE, DELETE ON custody_ledger FROM app_role;

CREATE INDEX idx_ledger_vendor ON custody_ledger(vendor_id, ledger_date);
CREATE INDEX idx_ledger_psp_sub ON custody_ledger(psp_sub_account, ledger_date);
CREATE INDEX idx_ledger_entity ON custody_ledger(entity_type, entity_id);

-- ============================================================
-- DISBURSEMENTS (Money OUT to vendors/suppliers)
-- ============================================================
CREATE TABLE disbursements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type         TEXT NOT NULL
                        CHECK (entity_type IN (
                            'pick_settlement',    -- Pay supplier after delivery
                            'pick_refund',        -- Refund vendor (supplier no-show)
                            'chama_loan',         -- Disburse chama loan to borrower
                            'chama_dividend',     -- Pay chama interest to members
                            'sacco_loan',         -- Disburse sacco loan
                            'sacco_dividend',     -- Annual sacco dividend
                            'sacco_withdrawal',   -- Member savings withdrawal
                            'price_shield_credit',-- Price protection refund
                            'network_benefit',    -- Network benefit pool payout
                            'pool_ride_transporter' -- Pay transporter
                        )),
    entity_id           UUID NOT NULL,
    recipient_phone     TEXT NOT NULL,           -- M-Pesa number
    recipient_name      TEXT,
    amount_ksh          INT NOT NULL,
    source_psp_sub      TEXT NOT NULL,           -- Which sub-account funds come from
    daraja_conversation_id TEXT,                 -- From B2C response
    daraja_originator_id TEXT,
    status              TEXT NOT NULL DEFAULT 'pending_approval'
                        CHECK (status IN (
                            'pending_approval',   -- Waiting for dual approval
                            'approved',           -- Both approvers signed
                            'queued',             -- Sent to Daraja B2C queue
                            'completed',          -- B2C callback confirmed
                            'failed',             -- B2C failed (invalid number, etc.)
                            'reversed'            -- Manual reversal
                        )),
    approver_1          UUID,
    approver_1_at       TIMESTAMPTZ,
    approver_2          UUID,                    -- Required if amount > 10,000
    approver_2_at       TIMESTAMPTZ,
    failure_reason      TEXT,
    created_at          TIMESTAMPTZ DEFAULT now(),
    completed_at        TIMESTAMPTZ
);

-- ============================================================
-- RECONCILIATION (Daily PSP ↔ Ledger Matching)
-- ============================================================
CREATE TABLE reconciliation_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date            DATE NOT NULL,
    psp_sub_account     TEXT NOT NULL,
    psp_statement_balance INT NOT NULL,          -- From PSP API
    ledger_balance      INT NOT NULL,            -- From custody_ledger SUM
    variance_ksh        INT NOT NULL,            -- psp - ledger
    status              TEXT DEFAULT 'pending'
                        CHECK (status IN ('pending', 'matched', 'variance_found', 'resolved')),
    variance_explanation TEXT,
    resolved_by         UUID,
    created_at          TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- DISPUTE HOLD (Frozen Funds)
-- ============================================================
CREATE TABLE dispute_holds (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_ledger_id  UUID REFERENCES custody_ledger(id),
    entity_type         TEXT NOT NULL,
    entity_id           UUID NOT NULL,
    vendor_id           UUID REFERENCES vendors(id),
    amount_ksh          INT NOT NULL,
    reason              TEXT NOT NULL,
    status              TEXT DEFAULT 'frozen'
                        CHECK (status IN ('frozen', 'released_to_vendor', 'released_to_supplier', 'escalated')),
    resolved_by         UUID,
    resolution_note     TEXT,
    created_at          TIMESTAMPTZ DEFAULT now(),
    resolved_at         TIMESTAMPTZ
);
```

> **v2.5 notes:** the entity-type check lists keep the Layer-3 values
> (`sacco_*`, `pool_ride_share`, `price_shield_credit`, `network_benefit`) reserved
> for future layers; v2.5 populates the `pick_*` and `chama_*` ones. The
> `REVOKE UPDATE, DELETE` grant becomes a Postgres trigger
> (`trg_custody_ledger_append_only`) because this deployment runs one database role.

---

## 5. Transaction State Machines

### 5.1 Pick Hedging Settlement (Full Lifecycle)

```
VENDOR CONFIRMS LOCK
        │
        ▼
┌──────────────┐    STK Push sent     ┌──────────────┐
│  DEPOSIT     │ ──────────────────▶  │  STK_SENT    │
│  REQUIRED    │                      │  (60s timer) │
└──────────────┘                      └──────┬───────┘
                                             │
                          ┌──────────────────┼──────────────────┐
                          ▼                  ▼                  ▼
                   ┌────────────┐    ┌──────────────┐   ┌──────────────┐
                   │ STK_ACCEPT │    │ STK_TIMEOUT  │   │ STK_REJECTED │
                   │ (PIN ok)   │    │ (no response)│   │ (wrong PIN)  │
                   └─────┬──────┘    └──────┬───────┘   └──────┬───────┘
                         │                  │                  │
                         ▼                  ▼                  ▼
                   ┌────────────┐    ┌──────────────┐   ┌──────────────┐
                   │ COMPLETED  │    │ RETRY (max 2)│   │ FAILED       │
                   │ Funds in   │    │ or FAILED    │   │ Pick seat    │
                   │ escrow     │    └──────────────┘   │ released     │
                   └─────┬──────┘                       └──────────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
     ┌──────────────┐      ┌──────────────┐
     │ DELIVERY OK  │      │ PROBLEM      │
     │ (vendor taps │      │ (vendor taps │
     │  RECEIVED)   │      │  PROBLEM)    │
     └──────┬───────┘      └──────┬───────┘
            │                     │
            ▼                     ▼
     ┌──────────────┐      ┌──────────────┐
     │ ESCROW       │      │ DISPUTE      │
     │ RELEASED     │      │ HOLD         │
     │ → Supplier   │      │ (frozen in   │
     │   M-Pesa     │      │  SUB-005)    │
     └──────┬───────┘      └──────┬───────┘
            │                     ├──→ RESOLVED: release to vendor (refund)
     ┌──────────────┐             ├──→ RESOLVED: release to supplier
     │ PLATFORM FEE │             └──→ ESCALATED: manual review
     │ DEDUCTED     │
     │ → SUB-006    │
     └──────────────┘
```

### 5.2 Chama Loan Disbursement

```
BORROWER APPLIES
        │
        ▼
┌──────────────┐   Peer votes    ┌──────────────┐
│ PENDING      │ ─────────────▶  │ APPROVED     │
│ PEER VOTE    │  (≥70% yes)     │ (quorum met) │
└──────────────┘                 └──────┬───────┘
                                        │
                                        ▼
                                 ┌──────────────┐
                                 │ DUAL APPROVE │  (if > KSh 10,000)
                                 │ (chair +     │
                                 │  treasurer)  │
                                 └──────┬───────┘
                                        │
                                        ▼
                                 ┌──────────────┐
                                 │ B2C SENT     │  (PSP → borrower M-Pesa)
                                 │ from CHAMA   │
                                 │ POOL sub     │
                                 └──────┬───────┘
                                        │
                              ┌─────────┴─────────┐
                              ▼                   ▼
                       ┌────────────┐      ┌────────────┐
                       │ COMPLETED  │      │ FAILED     │
                       │ Ledger     │      │ (invalid   │
                       │ debited    │      │  number)   │
                       └────────────┘      └────────────┘
```

> **v2.5:** the STK_* states collapse into `payment_intents.status =
> pending/completed/failed/expired` because the PSP owns the telco state machine.

---

## 6. Reconciliation Engine (Daily Cron)

This is the most important operational process. If your ledger drifts from PSP reality, you have a financial crisis.

```python
# Runs daily at 2 AM via pg_cron or Celery Beat
def daily_reconciliation():
    """
    Compare internal ledger balances against PSP sub-account balances.
    Flag any variance > KSh 100 for human review.
    """
    sub_accounts = [
        "ESCROW_PICK_HEDGING",
        "SACCO_SAVINGS",
        "SACCO_LENDING",
        "DISPUTE_HOLD",
        "PLATFORM_FEES"
    ]

    for sub in sub_accounts:
        # 1. Get PSP balance
        psp_balance = psp_client.get_wallet_balance(sub)["balance"]

        # 2. Calculate ledger balance
        ledger_result = db.query("""
            SELECT COALESCE(SUM(
                CASE direction
                    WHEN 'credit' THEN amount_ksh
                    WHEN 'debit' THEN -amount_ksh
                END
            ), 0)
            FROM custody_ledger
            WHERE psp_sub_account = %s
        """, [sub])
        ledger_balance = ledger_result[0]

        # 3. Calculate variance
        variance = psp_balance - ledger_balance

        # 4. Record reconciliation run
        ReconciliationRun.create(
            run_date=date.today(),
            psp_sub_account=sub,
            psp_statement_balance=psp_balance,
            ledger_balance=ledger_balance,
            variance_ksh=variance,
            status="matched" if abs(variance) <= 100 else "variance_found"
        )

        # 5. Alert if variance exceeds threshold
        if abs(variance) > 100:
            send_alert_to_ops(
                f"RECONCILIATION VARIANCE: {sub} "
                f"PSP={psp_balance} Ledger={ledger_balance} "
                f"Diff={variance}"
            )

        # 6. Check for orphan payments (STK completed but no ledger entry)
        orphans = db.query("""
            SELECT pi.id, pi.daraja_checkout_id, pi.amount_ksh
            FROM payment_intents pi
            LEFT JOIN custody_ledger cl
                ON cl.daraja_checkout_id = pi.daraja_checkout_id
            WHERE pi.status = 'completed'
              AND cl.id IS NULL
              AND pi.created_at < now() - INTERVAL '24 hours'
        """)

        for orphan in orphans:
            send_alert_to_ops(
                f"ORPHAN PAYMENT: checkout={orphan.daraja_checkout_id} "
                f"amount={orphan.amount_ksh} — callback likely missed"
            )
            # Trigger manual Daraja transaction status query
            daraja.query_transaction_status(orphan.daraja_checkout_id)
```

---

## 7. Dual-Approval Engine

```python
def request_disbursement(entity_type, entity_id, recipient_phone, amount_ksh, source_psp_sub):
    """
    Creates a disbursement record. If amount > threshold, requires two approvers.
    """
    DUAL_APPROVAL_THRESHOLD = 10000  # KSh

    disbursement = Disbursement.create(
        entity_type=entity_type,
        entity_id=entity_id,
        recipient_phone=recipient_phone,
        amount_ksh=amount_ksh,
        source_psp_sub=source_psp_sub,
        status="pending_approval" if amount_ksh > DUAL_APPROVAL_THRESHOLD else "approved"
    )

    if amount_ksh <= DUAL_APPROVAL_THRESHOLD:
        # Auto-approve small amounts, queue for B2C
        execute_b2c(disbursement)
    else:
        # Notify approvers
        notify_approvers(disbursement)

    return disbursement


def approve_disbursement(disbursement_id, approver_id):
    """
    Records an approval. Executes B2C only when both approvals are present.
    """
    disbursement = Disbursement.get(id=disbursement_id)

    if disbursement.approver_1 is None:
        disbursement.approver_1 = approver_id
        disbursement.approver_1_at = datetime.now()
        disbursement.save()
        return "First approval recorded. Awaiting second."

    elif disbursement.approver_2 is None and approver_id != disbursement.approver_1:
        disbursement.approver_2 = approver_id
        disbursement.approver_2_at = datetime.now()
        disbursement.status = "approved"
        disbursement.save()

        # Both approvals received — execute
        execute_b2c(disbursement)
        return "Fully approved. B2C queued."

    else:
        return "Cannot approve: already fully approved or self-approval attempted."


def execute_b2c(disbursement):
    """
    Sends B2C payment request to Daraja.
    """
    disbursement.status = "queued"
    disbursement.save()

    result = daraja_client.b2c_disburse(
        phone=disbursement.recipient_phone,
        amount=disbursement.amount_ksh,
        occasion=disbursement.entity_type,
        remarks=f"Ref:{disbursement.entity_id}"
    )

    disbursement.daraja_conversation_id = result.get("ConversationID")
    disbursement.daraja_originator_id = result.get("OriginatorConversationID")
    disbursement.save()
```

---

## 8. Compliance & AML Guardrails

```python
# Transaction limits (configurable per license tier)
LIMITS = {
    "stk_push_per_transaction": 150000,      # KSh 150K max per STK
    "stk_push_daily_per_vendor": 500000,     # KSh 500K daily cap
    "b2c_per_transaction": 250000,           # KSh 250K max per B2C
    "b2c_daily_per_vendor": 1000000,         # KSh 1M daily cap
    "chama_pool_max": 5000000,               # KSh 5M per chama pool
    "sacco_deposit_monthly_per_member": 200000,
    "sacco_loan_max": 3000000,               # KSh 3M per loan
}

def validate_transaction(vendor_id, amount_ksh, transaction_type):
    """
    Pre-flight checks before initiating any payment.
    """
    # 1. Per-transaction limit
    if amount_ksh > LIMITS[f"{transaction_type}_per_transaction"]:
        raise TransactionLimitExceeded("Amount exceeds per-transaction limit")

    # 2. Daily aggregate limit
    daily_total = db.query("""
        SELECT COALESCE(SUM(amount_ksh), 0)
        FROM payment_intents
        WHERE vendor_id = %s
          AND status IN ('completed', 'stk_accepted')
          AND created_at > CURRENT_DATE
    """, [vendor_id])

    if daily_total + amount_ksh > LIMITS[f"{transaction_type}_daily_per_vendor"]:
        raise TransactionLimitExceeded("Daily limit exceeded")

    # 3. KYC check (basic)
    vendor = Vendor.get(id=vendor_id)
    if not vendor.phone_verified:
        raise KYCRequired("Phone number not verified")

    # 4. Suspicious activity flag
    if vendor.flagged_for_review:
        log_suspicious_activity(vendor_id, amount_ksh, transaction_type)
        raise TransactionBlocked("Account under review")

    return True
```

---

## 9. Admin Panel: Finance Dashboard

```
┌─────────────────────────────────────────────────────────┐
│ 💰 CUSTODY DASHBOARD                          2026-06-15│
├─────────────────────────────────────────────────────────┤
│ PSP SUB-ACCOUNT BALANCES (Live)                         │
│ ┌───────────────────────┬───────────┬──────────┐        │
│ │ Account               │ Balance   │ Ledger Δ │        │
│ ├───────────────────────┼───────────┼──────────┤        │
│ │ Escrow Pick Hedging   │ 1,247,000 │    ✅ 0  │        │
│ │ Chama Pools (total)   │   834,500 │    ✅ 0  │        │
│ │ Sacco Savings         │ 3,412,000 │    ⚠️ 50 │        │
│ │ Sacco Lending Pool    │ 2,100,000 │    ✅ 0  │        │
│ │ Dispute Hold          │    45,000 │    ✅ 0  │        │
│ │ Platform Fees         │   187,300 │    ✅ 0  │        │
│ └───────────────────────┴───────────┴──────────┘        │
├─────────────────────────────────────────────────────────┤
│ PENDING DISBURSEMENTS (Awaiting Approval)               │
│ ┌──────────────────────────────────────────────┐        │
│ │ Supplier: Mama Njoroge · KSh 78,000          │        │
│ │ Pick #42 tomatoes · [APPROVE 1] [APPROVE 2]  │        │
│ │                                              │        │
│ │ Chama Loan: Brian · KSh 15,000               │        │
│ │ Gikomba Chama A · [APPROVE 1] [APPROVE 2]    │        │
│ └──────────────────────────────────────────────┘        │
├─────────────────────────────────────────────────────────┤
│ TODAY'S RECONCILIATION                                  │
│ Last run: 02:00 AM · Status: 5/6 matched · 1 variance  │
│ [VIEW VARIANCE REPORT] [RUN MANUAL RECON]               │
└─────────────────────────────────────────────────────────┘
```

> **v2.5:** the dashboard reads from `GET /api/payments/custody/balances`,
> `GET /api/payments/disbursements?status=pending_approval` and
> `GET /api/payments/reconciliation`; a UI page is the next step.

---

## 10. Build Sequence

| Phase | What | Duration | Dependencies | Status (v2.5) |
|---|---|---|---|---|
| **0** | PSP sandbox account + API keys | 1 week | Business registration docs | Mock PSP as default provider; keys via `PSP_API_KEY` / `PSP_API_SECRET` |
| **1** | Collection + webhook handler + `payment_intents` | 2 weeks | Phase 0 | ✅ |
| **2** | `custody_ledger` + PSP sub-account routing | 1 week | Phase 1 | ✅ (append-only trigger included) |
| **3** | Pick hedging escrow flow (lock → deliver → release/refund) | 2 weeks | Phase 2 | ✅ (pay / settle / dispute endpoints) |
| **4** | Disbursement + dual-approval engine | 2 weeks | Phase 2 | ✅ |
| **5** | Chama pool custody (deposit → lend → repay → dividend) | 2 weeks | Phase 3 + 4 | ✅ |
| **6** | Daily reconciliation cron + orphan detection | 1 week | Phase 2 | ✅ |
| **7** | Sacco savings + lending flows | 3 weeks | Phase 5 + SASRA license | ⏸ Layer 3 |
| **8** | Admin finance dashboard (UI) | 2 weeks | Phase 6 | ⏸ API only for now |
| **9** | Compliance limits + AML flags + audit export | 1 week | Phase 7 | Partial — per-transaction and daily caps live; audit export via `GET /api/governance/ops/audit` |

---

# Iteration 2 — Payment Architecture Without Daraja (PSP-as-Abstraction Model) — **CHOSEN**

## 0. Why This Is Actually Better

Cutting Daraja removes the single most painful integration in Kenyan fintech. You no longer deal with:

- OAuth token refresh every 60 minutes
- Async callback delays and lost webhooks
- Safaricom sandbox instability
- Paybill/Till number procurement and CBK approval
- Separate B2C operator credentials
- Transaction status polling for stuck payments
- M-Pesa-specific error codes (1032, 1037, 2001, etc.)

**The PSP becomes your payment abstraction layer.** They maintain the Daraja integration. You maintain a single clean REST API that works across M-Pesa, Airtel Money, T-Kash, bank transfers, and cards — without changing a line of your code.

```
BEFORE (Daraja Direct)                AFTER (PSP Abstraction)
──────────────────────                ───────────────────────
Your App                              Your App
   │                                     │
   ├── Daraja STK Push                   ├── PSP: Collect
   ├── Daraja C2B                        ├── PSP: Disburse
   ├── Daraja B2C                        ├── PSP: Refund
   ├── Daraja B2B                        └── PSP: Webhook
   ├── Daraja Transaction Status
   ├── Daraja Account Balance            That's it. 4 endpoints.
   ├── Daraja Reversal
   └── Daraja OAuth Token Mgmt
       (8 endpoints + token lifecycle)
```

## 1. PSP Selection (No Daraja Required)

| PSP | M-Pesa | Airtel | T-Kash | Bank | Card | Escrow | API Quality | Fees |
|---|---|---|---|---|---|---|---|---|
| **IntaSend** | ✅ | ✅ | ✅ | ✅ | ✅ | Native | Excellent | 1.5% in, 1% out |
| **Flutterwave** | ✅ | ✅ | ✅ | ✅ | ✅ | Manual | Good | 1.4% in, varies out |
| **Paystack** | ✅ | ❌ | ❌ | ✅ | ✅ | Manual | Excellent | 1.5% in, flat out |
| **Kopokopo** | ✅ | ❌ | ❌ | ❌ | ❌ | Sub-accounts | Good | 1.5% in |
| **Africa's Talking** | ✅ | ✅ | ✅ | ❌ | ❌ | None | Good | 1.5% in |

**Recommendation:** **IntaSend** for v1 (best escrow primitives, multi-telco, clean docs). **Flutterwave** as fallback if you need card payments later.

You sign one contract with IntaSend. They handle Safaricom, Airtel, and Telkom relationships. You never touch a telco API.

## 2. The Four Endpoints You Actually Use

### 2.1 Collect (Replaces STK Push + C2B)

```python
class PaymentClient:
    def __init__(self, api_key, api_secret):
        self.api_key = api_key
        self.api_secret = api_secret
        self.base_url = "https://payment.intasend.com/api/v1"
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

    def collect(self, phone, amount, provider, reference, callback_url):
        """
        Replaces Daraja STK Push.
        provider: 'MPESA' | 'AIRTEL' | 'TKASH' | 'CARD' | 'BANK'

        The PSP handles:
        - Telco API authentication
        - STK push triggering
        - Callback retries
        - Timeout handling

        You just get a clean webhook when it succeeds or fails.
        """
        payload = {
            "public_key": self.api_key,
            "host": "https://yourdomain.com",
            "amount": amount,
            "currency": "KES",
            "phone_number": phone,
            "provider": provider,          # Multi-telco from one call
            "account": reference,          # Your internal reference
            "narrative": f"Pick hedge deposit",
            "redirect_url": callback_url,
            "api_ref": reference           # Your tracking ID
        }

        resp = requests.post(
            f"{self.base_url}/checkout/mpesa-pay/",
            json=payload,
            headers=self.headers
        )
        data = resp.json()

        return {
            "payment_id": data.get("id"),       # PSP's tracking ID
            "status": data.get("state"),         # 'PENDING' | 'COMPLETE' | 'FAILED'
            "redirect_url": data.get("url")      # For card payments (web redirect)
        }
```

**Key difference from Daraja:** You don't manage tokens. You don't poll for status. You don't handle timeout retries. The PSP does all of that and sends you one webhook when the transaction reaches a terminal state.

### 2.2 Disburse (Replaces B2C + B2B)

```python
    def disburse(self, phone, amount, provider, reference, narrative):
        """
        Replaces Daraja B2C and B2B.
        Sends money FROM your PSP wallet TO a vendor/supplier phone or bank.
        """
        payload = {
            "account": reference,
            "amount": amount,
            "currency": "KES",
            "provider": provider,
            "phone_number": phone,
            "narrative": narrative,
            "requires_approval": amount > 10000  # PSP enforces dual approval
        }

        resp = requests.post(
            f"{self.base_url}/payouts/mobile-money/",
            json=payload,
            headers=self.headers
        )
        data = resp.json()

        return {
            "payout_id": data.get("id"),
            "status": data.get("state"),     # 'PENDING' | 'COMPLETE' | 'FAILED'
            "requires_approval": data.get("requires_approval")
        }
```

### 2.3 Refund (Replaces Daraja Reversal)

```python
    def refund(self, original_payment_id, amount, reason):
        """
        Replaces Daraja Reversal API.
        Returns funds to the original payer.
        """
        payload = {
            "amount": amount,
            "narrative": reason
        }

        resp = requests.post(
            f"{self.base_url}/transactions/{original_payment_id}/refund/",
            json=payload,
            headers=self.headers
        )
        return resp.json()
```

### 2.4 Webhook (Replaces Daraja Callbacks)

```python
    # Your server receives ONE webhook per transaction lifecycle event.
    # No polling. No status queries. No orphan detection needed.
```

## 3. Webhook Handler (The Only Callback You Need)

```python
from flask import Flask, request, jsonify
import hmac, hashlib

app = Flask(__name__)
PSP_WEBHOOK_SECRET = "your_webhook_secret"

@app.route("/api/v1/payments/webhook", methods=["POST"])
def psp_webhook():
    """
    Single webhook endpoint for ALL payment events.
    Replaces Daraja STK callback + C2B validate + C2B confirm + B2C result.

    The PSP signs every webhook with HMAC-SHA256. Verify before processing.
    """
    # 1. Verify webhook signature
    signature = request.headers.get("X-Webhook-Signature")
    payload = request.get_data()
    expected = hmac.new(
        PSP_WEBHOOK_SECRET.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(signature, expected):
        return jsonify({"error": "Invalid signature"}), 401

    # 2. Parse event
    event = request.json
    event_type = event.get("type")      # 'payment.completed', 'payment.failed', 'payout.completed'
    payment_id = event.get("id")        # PSP's transaction ID
    api_ref = event.get("api_ref")      # Your internal reference
    amount = event.get("amount")
    phone = event.get("phone_number")
    provider = event.get("provider")    # 'MPESA', 'AIRTEL', etc.
    mpesa_receipt = event.get("mpesa_receipt")  # If available
    failure_reason = event.get("failure_reason")

    # 3. Idempotency check
    if is_already_processed(payment_id):
        return jsonify({"status": "already_processed"}), 200

    # 4. Route by event type
    if event_type == "payment.completed":
        process_collection_success(
            psp_payment_id=payment_id,
            api_ref=api_ref,
            amount_ksh=amount,
            phone=phone,
            provider=provider,
            mpesa_receipt=mpesa_receipt
        )

    elif event_type == "payment.failed":
        process_collection_failure(
            psp_payment_id=payment_id,
            api_ref=api_ref,
            failure_reason=failure_reason
        )

    elif event_type == "payout.completed":
        process_disbursement_success(
            psp_payout_id=payment_id,
            api_ref=api_ref,
            amount_ksh=amount
        )

    elif event_type == "payout.failed":
        process_disbursement_failure(
            psp_payout_id=payment_id,
            api_ref=api_ref,
            failure_reason=failure_reason
        )

    # 5. ALWAYS return 200 to prevent PSP retries
    return jsonify({"status": "received"}), 200


def process_collection_success(psp_payment_id, api_ref, amount_ksh, phone, provider, mpesa_receipt):
    """
    Atomic: update payment intent + write ledger + route to PSP sub-account.
    """
    with db.transaction():
        # Find the payment intent by your internal reference
        payment = PaymentIntent.select().where(
            PaymentIntent.psp_api_ref == api_ref,
            PaymentIntent.status == "pending"
        ).first()

        if not payment:
            log_error(f"Orphan webhook: {api_ref}")
            return

        # Update payment status
        payment.status = "completed"
        payment.psp_payment_id = psp_payment_id
        payment.mpesa_receipt = mpesa_receipt
        payment.provider = provider
        payment.completed_at = datetime.now()
        payment.save()

        # Write append-only ledger
        LedgerEntry.create(
            vendor_id=payment.vendor_id,
            psp_sub_account=payment.target_psp_sub,
            transaction_type="collection_in",
            amount_ksh=amount_ksh,
            direction="credit",
            running_balance_ksh=calculate_running_balance(payment.target_psp_sub),
            psp_reference=psp_payment_id,
            mpesa_receipt=mpesa_receipt,
            entity_type=payment.entity_type,
            entity_id=payment.entity_id
        )

        # Trigger downstream business logic
        trigger_post_payment_action(payment)
```

> **v2.5:** implemented in `routes/payments.py::psp_webhook` +
> `services/payments.py::process_webhook_event` — same shape: signature check,
> idempotency by intent state, atomic intent+ledger transaction, downstream
> hooks per `entity_type`, always 200.

## 4. Revised Database Schema (No Daraja Fields)

```sql
-- ============================================================
-- PAYMENT INTENTS (Simplified — no Daraja-specific columns)
-- ============================================================
CREATE TABLE payment_intents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id           UUID REFERENCES vendors(id) NOT NULL,
    entity_type         TEXT NOT NULL
                        CHECK (entity_type IN (
                            'pick_deposit',
                            'pick_full_payment',
                            'chama_deposit',
                            'chama_loan_repayment',
                            'sacco_savings',
                            'sacco_loan_repayment',
                            'pool_ride_share'
                        )),
    entity_id           UUID NOT NULL,
    amount_ksh          INT NOT NULL,
    provider            TEXT NOT NULL DEFAULT 'MPESA'
                        CHECK (provider IN ('MPESA', 'AIRTEL', 'TKASH', 'CARD', 'BANK')),
    phone               TEXT NOT NULL,
    target_psp_sub      TEXT NOT NULL,
    psp_api_ref         TEXT UNIQUE NOT NULL,    -- Your reference sent to PSP
    psp_payment_id      TEXT,                    -- PSP's internal ID (from webhook)
    mpesa_receipt       TEXT,                    -- Telco receipt if available
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                            'pending',          -- Created, sent to PSP
                            'completed',        -- PSP confirmed success
                            'failed',           -- PSP confirmed failure
                            'refunded'          -- PSP confirmed refund
                        )),
    failure_reason      TEXT,
    created_at          TIMESTAMPTZ DEFAULT now(),
    completed_at        TIMESTAMPTZ
);

-- ============================================================
-- CUSTODY LEDGER (Unchanged — still append-only)
-- ============================================================
CREATE TABLE custody_ledger (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ledger_date         DATE NOT NULL DEFAULT CURRENT_DATE,
    vendor_id           UUID REFERENCES vendors(id),
    psp_sub_account     TEXT NOT NULL,
    transaction_type    TEXT NOT NULL,
    amount_ksh          INT NOT NULL,
    direction           TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
    running_balance_ksh INT NOT NULL,
    psp_reference       TEXT NOT NULL,           -- PSP payment/payout ID
    mpesa_receipt       TEXT,
    provider            TEXT,                    -- 'MPESA', 'AIRTEL', etc.
    entity_type         TEXT,
    entity_id           UUID,
    approved_by         UUID,
    approved_by_2       UUID,
    reversal_of         UUID REFERENCES custody_ledger(id),
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT now()
);

REVOKE UPDATE, DELETE ON custody_ledger FROM app_role;

-- ============================================================
-- DISBURSEMENTS (Simplified)
-- ============================================================
CREATE TABLE disbursements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type         TEXT NOT NULL,
    entity_id           UUID NOT NULL,
    recipient_phone     TEXT NOT NULL,
    recipient_provider  TEXT NOT NULL DEFAULT 'MPESA',
    amount_ksh          INT NOT NULL,
    source_psp_sub      TEXT NOT NULL,
    psp_api_ref         TEXT UNIQUE NOT NULL,
    psp_payout_id       TEXT,                    -- From PSP webhook
    status              TEXT NOT NULL DEFAULT 'pending_approval'
                        CHECK (status IN (
                            'pending_approval',
                            'approved',
                            'queued',
                            'completed',
                            'failed',
                            'reversed'
                        )),
    approver_1          UUID,
    approver_1_at       TIMESTAMPTZ,
    approver_2          UUID,
    approver_2_at       TIMESTAMPTZ,
    failure_reason      TEXT,
    created_at          TIMESTAMPTZ DEFAULT now(),
    completed_at        TIMESTAMPTZ
);

-- ============================================================
-- RECONCILIATION (Simplified — reconcile with PSP, not Safaricom)
-- ============================================================
CREATE TABLE reconciliation_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date            DATE NOT NULL,
    psp_sub_account     TEXT NOT NULL,
    psp_reported_balance INT NOT NULL,           -- From PSP dashboard/API
    ledger_balance      INT NOT NULL,
    variance_ksh        INT NOT NULL,
    status              TEXT DEFAULT 'pending'
                        CHECK (status IN ('pending', 'matched', 'variance_found', 'resolved')),
    variance_explanation TEXT,
    resolved_by         UUID,
    created_at          TIMESTAMPTZ DEFAULT now()
);
```

> **v2.5:** matches `alembic/versions/0006_payments_chamas.py` (plus
> `expired` on intents for the TTL job, `intent_id` on the ledger to group
> entries of one logical event, and `dispute_holds`).

## 5. Transaction Flow (Simplified)

### 5.1 Pick Hedging Collection

```
VENDOR TAPS [CONFIRM] ON PICK
        │
        ▼
┌──────────────────┐
│ Create Payment   │  Generate UUID reference
│ Intent (pending) │  Store in DB
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ PSP Collect API  │  ONE call. PSP handles STK push,
│ (provider=MPESA) │  Airtel prompt, or card redirect
└────────┬─────────┘  based on vendor's phone/provider
         │
         ▼
┌──────────────────┐
│ VENDOR SEES      │  M-Pesa PIN prompt on phone
│ PAYMENT PROMPT   │  (or Airtel Money prompt)
└────────┬─────────┘
         │
    ┌────┴────┐
    ▼         ▼
 SUCCESS    FAILURE
    │         │
    ▼         ▼
┌────────┐ ┌────────┐
│ PSP    │ │ PSP    │
│ sends  │ │ sends  │
│ webhook│ │ webhook│
└───┬────┘ └───┬────┘
    │          │
    ▼          ▼
┌────────┐ ┌────────┐
│ Ledger │ │ Mark   │
│ credit │ │ failed │
│ + lock │ │ + retry│
│ escrow │ │ or free│
└────────┘ └────────┘
```

**No token refresh. No polling. No timeout handling. No status queries.** The PSP does all of that.

### 5.2 Multi-Telco Support (Free Bonus)

Because you're not on Daraja, supporting Airtel Money and T-Kash costs you **zero additional engineering**:

```python
def initiate_collection(vendor_id, amount_ksh, entity_type, entity_id):
    vendor = Vendor.get(id=vendor_id)

    # Vendor chose their preferred payment method at onboarding
    # or the app auto-detects from phone number prefix
    provider = detect_provider(vendor.phone)
    # '254712...' → 'MPESA'
    # '254733...' → 'AIRTEL'
    # '254770...' → 'TKASH'

    api_ref = f"{entity_type}-{entity_id}-{vendor_id}"

    result = psp_client.collect(
        phone=vendor.phone,
        amount=amount_ksh,
        provider=provider,
        reference=api_ref,
        callback_url="https://yourdomain.com/api/v1/payments/webhook"
    )

    PaymentIntent.create(
        vendor_id=vendor_id,
        entity_type=entity_type,
        entity_id=entity_id,
        amount_ksh=amount_ksh,
        provider=provider,
        phone=vendor.phone,
        target_psp_sub=route_to_sub(entity_type),
        psp_api_ref=api_ref,
        status="pending"
    )

    return result
```

**With Daraja, you'd need separate integrations for each telco.** With the PSP abstraction, it's one line change.

> **v2.5:** `detect_provider()` in `services/payments.py` maps `25471x/25472x/25475x`
> → MPESA, `254733/254738/254739` → AIRTEL, `25477x` → TKASH, else MPESA.

## 6. PSP Sub-Account Architecture (Unchanged)

The custody model stays identical. The PSP still holds segregated sub-accounts:

```
PSP Master Wallet: YOUR_COOP_SACCO_LTD
├── SUB-001: ESCROW_PICK_HEDGING
├── SUB-002: CHAMA_POOL_{chama_id}     (one per active chama)
├── SUB-003: SACCO_SAVINGS
├── SUB-004: SACCO_LENDING
├── SUB-005: DISPUTE_HOLD
├── SUB-006: PLATFORM_FEES
└── SUB-007: NETWORK_BENEFIT_POOL
```

The difference is how you move money between sub-accounts:

```python
def lock_escrow(pick_id, amount_ksh):
    """
    Move funds from collection pool to escrow sub-account.
    This is an internal PSP transfer — no M-Pesa involvement.
    """
    psp_client.internal_transfer(
        from_wallet="COLLECTION_POOL",
        to_wallet=f"ESCROW_PICK_HEDGING",
        amount=amount_ksh,
        reference=f"LOCK-{pick_id}"
    )

def release_escrow(pick_id, supplier_phone, amount_ksh):
    """
    Release from escrow to supplier's M-Pesa/Airtel/Bank.
    """
    # 1. Internal transfer: escrow → disbursement pool
    psp_client.internal_transfer(
        from_wallet="ESCROW_PICK_HEDGING",
        to_wallet="DISBURSEMENT_POOL",
        amount=amount_ksh,
        reference=f"RELEASE-{pick_id}"
    )

    # 2. Disburse to supplier
    psp_client.disburse(
        phone=supplier_phone,
        amount=amount_ksh,
        provider="MPESA",  # Supplier's preferred channel
        reference=f"SUPPLIER-{pick_id}",
        narrative=f"Pick settlement #{pick_id}"
    )

    # 3. Deduct platform fee
    fee = int(amount_ksh * 0.04)  # 4% facilitation
    psp_client.internal_transfer(
        from_wallet="DISBURSEMENT_POOL",
        to_wallet="PLATFORM_FEES",
        amount=fee,
        reference=f"FEE-{pick_id}"
    )
```

> **v2.5:** collections land directly in the target sub-account (the intent's
> `target_psp_sub`), so the separate COLLECTION_POOL hop is unnecessary; the
> fee still moves `ESCROW_PICK_HEDGING → PLATFORM_FEES` via
> `internal_transfer` at settlement.

## 7. Reconciliation (Simplified)

You reconcile with **one PSP**, not with Safaricom + Airtel + Telkom separately.

```python
def daily_reconciliation():
    """
    Compare your ledger against PSP's reported balances.
    One API call per sub-account. No telco-specific logic.
    """
    sub_accounts = psp_client.list_wallets()

    for wallet in sub_accounts:
        psp_balance = wallet["balance"]
        wallet_id = wallet["id"]

        ledger_balance = db.query("""
            SELECT COALESCE(SUM(
                CASE direction
                    WHEN 'credit' THEN amount_ksh
                    WHEN 'debit' THEN -amount_ksh
                END
            ), 0)
            FROM custody_ledger
            WHERE psp_sub_account = %s
        """, [wallet_id])

        variance = psp_balance - ledger_balance

        ReconciliationRun.create(
            run_date=date.today(),
            psp_sub_account=wallet_id,
            psp_reported_balance=psp_balance,
            ledger_balance=ledger_balance,
            variance_ksh=variance,
            status="matched" if abs(variance) <= 100 else "variance_found"
        )

        if abs(variance) > 100:
            alert_ops(f"VARIANCE: {wallet_id} = {variance} KSh")
```

**No orphan detection needed.** The PSP guarantees webhook delivery with retries. If a webhook is truly lost, the PSP's dashboard will show a balance mismatch that your daily reconciliation catches.

> **v2.5:** `services/reconciliation.py` keeps the orphan-intent check as a
> belt-and-braces alert even with the mock provider.

## 8. What You Lose vs. What You Gain

| Dimension | Daraja Direct | PSP Abstraction |
|---|---|---|
| **Telco coverage** | M-Pesa only | M-Pesa + Airtel + T-Kash + Bank + Card |
| **Integration endpoints** | 8+ | 4 |
| **Token management** | Manual (60-min refresh) | None (PSP handles) |
| **Callback reliability** | You handle retries | PSP handles retries |
| **Orphan detection** | Required | Not needed |
| **Transaction status polling** | Required for stuck payments | Not needed |
| **Sandbox quality** | Unreliable | Reliable |
| **Fees** | Safaricom direct rates (~1-2%) | PSP markup (~1.5-2.5%) |
| **Settlement speed** | T+0 to T+1 | T+0 to T+1 |
| **Control** | Full | Delegated |
| **Compliance burden** | You hold the Till/Paybill | PSP holds the Till/Paybill |
| **Time to launch** | 4-8 weeks (including CBK approval for Till) | 1-2 weeks (PSP onboarding) |

**The trade-off:** You pay ~0.5% more in fees. You gain 6 weeks of development time, multi-telco support, and zero Daraja maintenance headaches. For a platform at your stage, that trade is overwhelmingly in your favor.

## 9. When to Reconsider Daraja Direct

Move to direct Daraja integration only when:

1. **Monthly transaction volume exceeds KSh 50M** — the 0.5% PSP markup starts costing more than a dedicated payments engineer's salary.
2. **You need sub-second settlement** — PSP adds ~500ms latency per transaction.
3. **You want your own Paybill number** — for brand visibility ("Pay to 123456" instead of "Pay to IntaSend").
4. **Regulatory requirement** — if SASRA or CBK requires direct telco integration for your license tier.

Until then, the PSP abstraction is the correct architectural choice.

## 10. Revised Build Sequence

| Phase | What | Duration | Status (v2.5) |
|---|---|---|---|
| **0** | PSP sandbox account + API keys | 2 days | ✅ (mock provider; IntaSend stub wired to `PSP_PROVIDER=intasend`) |
| **1** | Collect API + webhook handler + `payment_intents` | 1 week | ✅ |
| **2** | `custody_ledger` + PSP sub-account routing | 1 week | ✅ |
| **3** | Pick hedging escrow (lock → deliver → release) | 1.5 weeks | ✅ (+ dispute/refund) |
| **4** | Disburse API + dual-approval | 1 week | ✅ |
| **5** | Chama pool custody | 1.5 weeks | ✅ |
| **6** | Daily reconciliation | 3 days | ✅ |
| **7** | Sacco savings + lending | 2 weeks | ⏸ Layer 3 |
| **8** | Admin finance dashboard | 1.5 weeks | ⏸ API only |

**Total: ~10 weeks** (down from 17 with Daraja). The 7-week savings comes from eliminating token management, callback retry logic, orphan detection, transaction status polling, and multi-telco integration.

---

## 11. The One Rule That Prevents Catastrophe

> **Never write a ledger entry until you have a confirmed PSP/Daraja reference number.**

If the callback is delayed, if the STK times out, if the PSP is down — your ledger stays at "pending." You never assume money arrived. You never credit a vendor's balance on hope. The M-Pesa receipt number is the only proof that matters.

Everything else is engineering detail. That rule is survival.

> **v2.5 enforcement:** `services/custody.py::write_ledger_entry` requires a
> non-empty `psp_reference`; every ledger row's `psp_reference` is a PSP
> payment/payout/transfer ID (mock IDs included), and the daily reconciliation
> fails loudly if the ledger and the PSP's wallets disagree by more than
> `RECONCILIATION_VARIANCE_TOLERANCE_KSH`.
