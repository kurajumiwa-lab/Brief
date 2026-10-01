# Halal Trade & Islamic Finance in the Merchant Guild (v2.6)

> Status: **brief + backend implementation.** The financial engine items
> (Qard Hasan chamas, Musharakah profit remittance, Murabaha advances,
> vendor `finance_mode`) are built and tested in the backend (v2.6). The
> branding, social-layer and Layer-3 Sacco items are forward design — see
> "Status in this repository" at the end.

Integrating **Halal trade and Islamic finance principles** into the guild
platform is a massive competitive advantage.

In East Africa, the wholesale, logistics, and import corridors (Eastleigh,
Mombasa Old Town, Kariakoo in Dar es Salaam, Owino/Kisenyi in Kampala, and
Bakara Market in Mogadishu) are heavily driven by Muslim merchants.
Traditional fintechs alienate these traders by forcing **interest (*Riba*)**,
speculative fees, and conventional banking products down their throats.

By designing the platform to be **natively Halal-compliant (or
Sharia-toggleable)**, it unlocks the most liquid, tightly-knit trading
networks in the region without alienating non-Muslim traders.

---

## 1. Why "MADAL" is the Ultimate Brand for Halal Trade

- **Culturally Organic, Not Overly Religious:** The word **MADAL** (the
  assembly / trade forum) comes from Somali merchant tradition. It carries
  natural respect in Islamic commercial hubs without needing an explicitly
  religious label (like *Takaful* or *HalalPay*), which might create friction
  in non-Muslim areas like Central Kenya or Western Uganda.
- **Universal Ethical Appeal:** In Islamic jurisprudence (*Fiqh al-Mu'amalat*),
  trade must be transparent, asset-backed, free of interest (*Riba*), free of
  excessive uncertainty (*Gharar*), and free of gambling (*Maysir*).
  **The zero-AI, transparent, asset-backed physical trade model is already 90%
  Halal by design.**

---

## 2. The Financial Engine for Halal Compliance

Traditional Saccos and micro-lenders charge fixed interest (e.g. "borrow
KSh 5,000, repay KSh 5,250 with 5% interest"). In Islam, this is **Riba** and
strictly forbidden.

The engine therefore replaces conventional lending with three established
Islamic finance structures — built with zero AI, pure arithmetic:

| # | structure | product |
|---|---|---|
| 1 | **MURABAHA** (cost-plus) | Inventory financing — the Sacco buys the physical stock and resells at a fixed, disclosed markup |
| 2 | **QARD HASAN** (benevolent loan) | Interest-free peer emergency loans in chamas (flat admin fee only) |
| 3 | **BAY' AL-SALAM** (forward sale) | Advance payment for future delivery of physical goods — the Pick Hedging Engine |

### A. Pick Hedging as *Bay' al-Salam* (Valid Forward Sale)

- **The Rule:** Conventional commodity futures/hedging are often deemed
  non-Halal because they involve pure paper speculation without physical
  asset delivery.
- **The Madal Way:** In *Bay' al-Salam*, a buyer pays in advance for a
  clearly defined physical commodity (e.g. 2 crates of tomatoes, Grade 1,
  delivered Monday 7 AM). Because the platform guarantees **actual physical
  fulfillment and settlement**, it meets the exact requirements of *Salam*
  commerce. The v2.5 lock-escrow flow (pick paid into escrow, supplier paid
  on delivery) already implements this structure; no engine change was
  required.

### B. Inventory Financing via *Murabaha* (Cost-Plus Trade Credit)

Instead of lending money with interest, the Sacco provides **stock
advances**:

1. Vendor needs KSh 10,000 worth of cooking oil.
2. The Sacco buys the oil directly from the wholesaler for KSh 10,000.
3. The Sacco sells the oil to the vendor for **KSh 10,600**, payable in 30
   days.
4. The vendor knows the exact cost, the exact profit margin, and there is no
   compounding penalty interest if delayed. **This is 100% Halal.**

Implementation (v2.6): `murabaha_contracts` records the fixed cost + fixed
markup at signing (the Sharia requirement: both known before the contract
exists). The vendor repays the full `total_selling_ksh` by the due date via
PSP collection into the `SACCO_ADVANCES` sub-account. A late payment is a
**default**, not a penalty rate — there is no growing interest, by design.
Market-ops staff (the Sacco window) approve or decline each request.

### C. Digital Table Banking via *Qard Hasan* (Zero-Interest Chamas)

For peer-to-peer chamas within Muslim merchant circles:

- Members contribute weekly savings to the pool.
- A member borrows KSh 10,000 and repays **exactly KSh 10,000**.
- A tiny flat administrative fee (e.g. KSh 50 to cover PSP network charges)
  is permitted, but zero interest is earned by lenders.
- Profit is made through **Musharakah (Joint Venture)**: the chama co-buys a
  truck of onions, sells them together, and splits the realized profit based
  on capital contributed.

Implementation (v2.6): chamas carry a `model_type` — `qard_hasan`,
`musharakah_trade` (or `murabaha_credit`) pools lend at cost:
`interest_ksh = 0`, the flat admin fee is **netted from the payout**
(borrower receives `amount − fee`, repays the full principal — a disclosed
cost recovery, never interest), and dividends come from **fees + remitted
profits, never interest**. Members remit realised joint-venture profit to the
pool with `POST /api/chamas/{id}/profit` (a real PSP collection, so the
custody ledger stays reconcilable).

**Gating:** a vendor with `finance_mode = 'halal_sharia'` cannot join an
interest-bearing chama or apply for an interest loan (Riba block, enforced at
join and at loan application). A conventional vendor may join any chama —
zero-interest structures are permissible to everyone.

---

## 3. The Social Layer: Halal-Friendly "After-Hours Tables"

In earlier design, after-hours tables mentioned drinks and pubs. For Halal
traders, walking into a bar is a deal-breaker.

In Islamic merchant culture, **business happens over Chai, Kahwa (spiced
coffee), Camel Milk, Sheesha/Hisha, and evening Choma at specialized halal
lounges or tea spots.**

### Multi-Vibe Pin Filter

The after-hours pins map must feature **Vibe Tags**:

```
┌──────────────────────────────────────────────────────────┐
│  AFTER-HOURS PINS                              Nairobi   │
├──────────────────────────────────────────────────────────┤
│  Filters: [☕ Chai & Kahwa]  [🍽️ Halal Dining]           │
│           [🎱 Pool & Games]   [🍺 Drinks/Pubs]           │
├──────────────────────────────────────────────────────────┤
│  📍 AL-YUSRA RESTAURANT, BANDA ST · 5:30 PM              │
│     "Spices & Rice Importers: Kahwa & Deal Talk"         │
│     Vibe: ☕ Halal / Alcohol-Free                          │
│     Host: Farhan A. (Biashara Score: 138)                │
│     Seats: [🟢 3 / 6 Filled]  [TAKE A SEAT]              │
│                                                          │
│  📍 CHAI KHANA, EASTLEIGH 12TH ST · 8:00 PM              │
│     "Textile & Garment Traders: Somali Tea"              │
│     Vibe: ☕ Halal / Alcohol-Free                          │
│     Host: Hassan M. (Biashara Score: 110)                │
│     Seats: [🟡 5 / 6 Filled]  [TAKE A SEAT]              │
│                                                          │
│  📍 PARKLANDS SPORTS CLUB · SAT 9:00 AM                  │
│     "Hardware Wholesalers: 8-Ball Pool"                  │
│     Vibe: 🎱 Sports & Games                               │
│     Host: Dennis K. (Biashara Score: 92)                 │
│     Seats: [🔴 3 / 4 Filled]  [TAKE A SEAT]              │
└──────────────────────────────────────────────────────────┘
```

### The Chai Culture (Eastleigh / Kariakoo / Old Town)

In East Africa's Somali and Swahili markets, evening tea sessions
(*Fadhi / Baraza la Chai*) are where:

- Exchange rates are discussed.
- Wholesalers agree on container sharing from Dubai or Guangzhou.
- Disputes between traders are mediated by respected elder merchants.

The platform gives these traditional tea sessions a digital reservation tool:
**Drop a Chai Pin, cap the seats at 6, and talk business.**

---

## 4. Schema (implemented in migration `0007_halal_finance.py`)

To support both conventional and Islamic finance within the same
architecture, a `finance_mode` toggle exists at the vendor level and a
`model_type` at the chama level:

```sql
-- Vendor preference (default 'conventional')
ALTER TABLE vendors ADD COLUMN finance_mode TEXT
    CHECK (finance_mode IN ('conventional', 'halal_sharia'));

-- Chama financial structure (default 'conventional_interest')
ALTER TABLE chamas ADD COLUMN model_type TEXT
    CHECK (model_type IN (
        'conventional_interest',  -- standard interest + dividend
        'qard_hasan',             -- zero-interest peer loans (+ flat fee)
        'musharakah_trade',       -- zero-interest + joint-venture profit remittance
        'murabaha_credit'         -- cost-plus advances funded from the pool
    ));

-- Zero-interest loans carry the flat admin fee (netted from the payout)
ALTER TABLE chama_loans ADD COLUMN fee_ksh INT DEFAULT 0;

-- Murabaha (cost-plus) contract ledger (asset-backed stock advance)
CREATE TABLE murabaha_contracts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id           UUID REFERENCES vendors(id),
    supplier_vendor_id  UUID REFERENCES vendors(id),   -- wholesaler in-network
    product             TEXT NOT NULL,
    quantity            INT NOT NULL CHECK (quantity > 0),
    cost_price_ksh      INT NOT NULL CHECK (cost_price_ksh > 0),
    markup_ksh          INT NOT NULL CHECK (markup_ksh >= 0),
    total_selling_ksh   INT NOT NULL CHECK (total_selling_ksh = cost_price_ksh + markup_ksh),
    payment_due_date    TIMESTAMPTZ NOT NULL,
    status              TEXT DEFAULT 'pending_approval'
                        CHECK (status IN ('pending_approval','active','declined','settled','defaulted')),
    repayment_intent_id UUID REFERENCES payment_intents(id),
    approved_by_vendor_id UUID REFERENCES vendors(id),
    approved_at         TIMESTAMPTZ,
    settled_at          TIMESTAMPTZ,
    failure_reason      TEXT,
    created_at          TIMESTAMPTZ DEFAULT now()
);
```

Payment intents gained two collection entity types: `murabaha_repayment`
(→ `SACCO_ADVANCES` wallet, `collection_in`) and `musharakah_profit` (→
`CHAMA_<id>` wallet, `chama_pool_in`). Biashara Score events gained
`murabaha_settled` (+5) and `murabaha_defaulted` (−15).

---

## 5. Regulatory Alignment in Kenya (Islamic Saccos)

Kenya's regulatory framework under the **Cooperative Societies Act (Cap 490)**
and **SASRA** already recognizes and regulates **Islamic Saccos** (e.g.
*Taqwa Sacco*, *Crescent Sacco*).

When the Layer-3 Sacco is registered, it can be structured with a **Dual-Window
Model**:

1. **Conventional Window:** for vendors who want standard interest-bearing
   table banking and savings dividends.
2. **Sharia Window:** audited by a Sharia Advisory Board (comprising local
   Islamic scholars and commercial elders) using *Murabaha*, *Mudarabah*, and
   *Qard Hasan*.

---

## 6. The Pitch to Muslim Merchants (Eastleigh, Kariakoo, Bakara)

> **"This is the first digital merchant guild built on pure trade, not usury
> (*Riba*). We don't lend you money to trap you in interest. We use collective
> buying power to drop supplier prices (*Bay' al-Salam*), we advance inventory
> through transparent cost-plus contracts (*Murabaha*), and our after-hours
> tables happen over Chai and brotherhood. Your money stays clean; your margin
> stays high."**

This positions the platform as the only one in East Africa that can seamlessly
unite the open-air mama mbogas in Kawangware with the multi-million-shilling
Somali textile importers in Eastleigh on a single, trusted infrastructure.

---

## Status in this repository

| item | status |
|---|---|
| `vendors.finance_mode` + Riba gating (join / loan) | ✅ v2.6 — `models/vendor.py`, `services/chamas.py`, `PUT /api/vendors/me` |
| `chamas.model_type` (4 structures) | ✅ v2.6 — `models/chamas.py`, `POST /api/chamas` |
| Qard Hasan zero-interest loans + flat fee netted from payout | ✅ v2.6 — `services/chamas.py` (`HALAL_POOL_MODELS`) |
| Fee-vs-interest switch in dividends | ✅ v2.6 — `pool_distributable()` in `services/chamas.py` |
| Musharakah profit remittance → pool → dividends | ✅ v2.6 — `POST /api/chamas/{id}/profit` |
| Murabaha contracts + staff desk + PSP repayment + default worker | ✅ v2.6 — `models/halal.py`, `services/halal.py`, `routes/murabaha.py`, migration 0007 |
| Bay' al-Salam mapping (pick hedging) | ✅ already satisfied by the v2.5 lock-escrow flow (physical goods, escrow, settle-on-delivery) |
| MADAL branding / naming | ⏳ branding layer, out of backend scope |
| After-hours Vibe-Tag pins (chai tables, seat caps) | ⏳ social feature — no pins model exists yet in the backend |
| Sacco's physical purchase from the supplier (murabaha buy side) | ⏳ Layer-3 Sacco operations; only the vendor-side cash flow is on-platform |
| Dual-Window Sacco registration + Sharia Advisory Board audit | ⏳ Layer 3 / regulatory |

Tests: `backend/tests/test_v26_halal_finance.py` (8 E2E tests over the real
API + mock PSP, incl. the full murabaha cycle and the qard fee→dividend
math).
