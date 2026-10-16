# Backend API Specification - Business Marketplace & Financial Integration

## Overview

This document specifies the backend API endpoints required for the new Byway features:
1. Business Marketplace
2. Identity Verification System
3. Consolidation & Logistics
4. Financial Services Integration

---

## 🔧 Base Configuration

### Environment Variables
```bash
# Database
DATABASE_URL=postgresql+asyncpg://user:password@host:port/database

# File Storage
STORAGE_PROVIDER=local|s3|gcs
STORAGE_BUCKET=byway-documents
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret

# Payment Gateways
MPESA_CONSUMER_KEY=your_key
MPESA_CONSUMER_SECRET=your_secret
MPESA_BUSINESS_SHORT_CODE=123456
MPESA_PASS_KEY=your_pass_key
MPESA_CALLBACK_URL=https://api.byway.co.ke/mpesa/callback

EQUITY_BANK_API_KEY=your_key
EQUITY_BANK_API_SECRET=your_secret
EQUITY_BANK_BASE_URL=https://api.equitybank.co.ke

# Other Banks
KCB_API_KEY=your_key
COOP_BANK_API_KEY=your_key

# Verification Services
VERIFICATION_API_KEY=your_key
CRB_API_KEY=your_key
KRA_API_KEY=your_key

# File Upload
MAX_FILE_SIZE_MB=10
ALLOWED_FILE_TYPES=pdf,jpg,jpeg,png

# Security
JWT_SECRET=your_jwt_secret
ENCRYPTION_KEY=your_encryption_key
```

---

## 📁 Database Models

### 1. User Verification Model

```python
# models/verification.py
from sqlalchemy import Column, String, DateTime, Boolean, Enum, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import ARRAY
from database import Base
import enum

class VerificationStatus(enum.Enum):
    PENDING = "pending"
    IN_REVIEW = "in_review"
    VERIFIED = "verified"
    REJECTED = "rejected"
    EXPIRED = "expired"

class VerificationLevel(enum.Enum):
    BASIC = "basic"           # ID only
    BUSINESS = "business"     # Business registration
    FINANCIAL = "financial"   # Bank statements, tax
    PREMIUM = "premium"       # All + credit check + address verification

class DocumentType(enum.Enum):
    NATIONAL_ID = "national_id"
    PASSPORT = "passport"
    KRA_PIN = "kra_pin"
    BUSINESS_REGISTRATION = "business_registration"
    CERTIFICATE_OF_INCORPORATION = "certificate_of_incorporation"
    BUSINESS_LICENSE = "business_license"
    TAX_COMPLIANCE = "tax_compliance"
    BANK_STATEMENT = "bank_statement"
    UTILITY_BILL = "utility_bill"
    TITLE_DEED = "title_deed"
    LEASE_AGREEMENT = "lease_agreement"
    OTHER = "other"

class UserVerification(Base):
    __tablename__ = "user_verifications"
    
    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("vendors.id"), index=True)
    verification_level = Column(Enum(VerificationLevel), default=VerificationLevel.BASIC)
    status = Column(Enum(VerificationStatus), default=VerificationStatus.PENDING)
    
    # ID Information
    id_number = Column(String, unique=True)
    id_type = Column(Enum(DocumentType))
    id_issue_date = Column(DateTime)
    id_expiry_date = Column(DateTime)
    
    # Business Information (if applicable)
    business_name = Column(String)
    business_registration_number = Column(String)
    business_type = Column(String)  # sole_proprietor, partnership, company, etc.
    kra_pin = Column(String)
    
    # Verification Details
    verified_by = Column(String)  # Admin user ID
    verified_at = Column(DateTime)
    verification_notes = Column(String)
    rejection_reason = Column(String)
    
    # Expiry
    expires_at = Column(DateTime)
    
    # Metadata
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())


class VerificationDocument(Base):
    __tablename__ = "verification_documents"
    
    id = Column(String, primary_key=True, index=True)
    verification_id = Column(String, ForeignKey("user_verifications.id"), index=True)
    document_type = Column(Enum(DocumentType))
    file_name = Column(String)
    file_path = Column(String)  # Encrypted path
    file_size = Column(Integer)  # bytes
    file_hash = Column(String)  # SHA-256 hash
    mime_type = Column(String)
    
    # Verification Status
    verified = Column(Boolean, default=False)
    verified_by = Column(String)
    verified_at = Column(DateTime)
    verification_notes = Column(String)
    
    # Metadata
    uploaded_at = Column(DateTime, server_default=func.now())
    
    # Relationship
    verification = relationship("UserVerification", back_populates="documents")


class VerificationAuditLog(Base):
    __tablename__ = "verification_audit_logs"
    
    id = Column(String, primary_key=True, index=True)
    verification_id = Column(String, ForeignKey("user_verifications.id"))
    action = Column(String)  # uploaded, reviewed, approved, rejected, etc.
    performed_by = Column(String)  # User ID or system
    details = Column(JSON)
    ip_address = Column(String)
    user_agent = Column(String)
    created_at = Column(DateTime, server_default=func.now())
```

---

### 2. Business Listing Model

```python
# models/business_listing.py
from sqlalchemy import Column, String, DateTime, Boolean, Enum, Float, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import ARRAY
from database import Base
import enum

class BusinessType(enum.Enum):
    SHOP = "shop"
    COMPANY = "company"
    FRANCHISE = "franchise"
    EQUIPMENT = "equipment"
    ONLINE_BUSINESS = "online_business"
    SERVICE_BUSINESS = "service_business"
    OTHER = "other"

class BusinessCategory(enum.Enum):
    RETAIL = "retail"
    WHOLESALE = "wholesale"
    MANUFACTURING = "manufacturing"
    AGRICULTURE = "agriculture"
    SERVICES = "services"
    FOOD_BEVERAGE = "food_beverage"
    TRANSPORT = "transport"
    REAL_ESTATE = "real_estate"
    TECHNOLOGY = "technology"
    OTHER = "other"

class NegotiationType(enum.Enum):
    FIXED = "fixed"
    NEGOTIABLE = "negotiable"
    AUCTION = "auction"

class ListingStatus(enum.Enum):
    DRAFT = "draft"
    PENDING_VERIFICATION = "pending_verification"
    LISTED = "listed"
    SOLD = "sold"
    EXPIRED = "expired"
    WITHDRAWN = "withdrawn"
    SUSPENDED = "suspended"


class BusinessListing(Base):
    __tablename__ = "business_listings"
    
    id = Column(String, primary_key=True, index=True)
    seller_id = Column(String, ForeignKey("vendors.id"), index=True)
    
    # Business Details
    business_type = Column(Enum(BusinessType))
    category = Column(Enum(BusinessCategory))
    sub_category = Column(String)
    name = Column(String, index=True)
    description = Column(String)
    tagline = Column(String)
    
    # Location
    address = Column(String)
    city = Column(String, index=True)
    county = Column(String, index=True)
    country = Column(String, default="Kenya")
    coordinates = Column(JSON)  # { lat: float, lng: float }
    
    # Business Metrics
    years_in_operation = Column(Integer)
    employees = Column(Integer)
    size_sqft = Column(Integer)  # Size in square feet
    size_sqm = Column(Float)  # Size in square meters
    
    # Financials (verified if provided)
    annual_revenue = Column(Float)
    annual_profit = Column(Float)
    monthly_revenue = Column(Float)
    monthly_profit = Column(Float)
    financials_verified = Column(Boolean, default=False)
    
    # Pricing
    asking_price = Column(Float)
    price_negotiable = Column(Boolean, default=True)
    negotiation_type = Column(Enum(NegotiationType), default=NegotiationType.NEGOTIABLE)
    price_justification = Column(String)
    
    # Assets
    assets_included = Column(ARRAY(String))  # Equipment, inventory, property, etc.
    assets_description = Column(String)
    
    # Liabilities
    liabilities = Column(ARRAY(String))  # Loans, leases, etc.
    liabilities_description = Column(String)
    
    # Reason for Sale
    reason_for_sale = Column(String)
    urgency = Column(String)  # low, medium, high, urgent
    
    # Verification
    verification_id = Column(String, ForeignKey("user_verifications.id"))
    verification_status = Column(Enum(VerificationStatus))
    verification_badge = Column(Boolean, default=False)
    
    # Status
    status = Column(Enum(ListingStatus), default=ListingStatus.DRAFT)
    
    # Visibility
    is_public = Column(Boolean, default=True)
    is_featured = Column(Boolean, default=False)
    featured_until = Column(DateTime)
    
    # Images
    images = Column(ARRAY(String))  # File paths
    cover_image = Column(String)
    
    # Documents
    documents = Column(ARRAY(String))  # File paths
    
    # SEO
    slug = Column(String, unique=True, index=True)
    meta_title = Column(String)
    meta_description = Column(String)
    
    # Engagement
    view_count = Column(Integer, default=0)
    inquiry_count = Column(Integer, default=0)
    favorite_count = Column(Integer, default=0)
    
    # Dates
    listed_at = Column(DateTime)
    sold_at = Column(DateTime)
    expires_at = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    
    # Relationships
    seller = relationship("Vendor", back_populates="business_listings")
    verification = relationship("UserVerification")
    inquiries = relationship("BusinessInquiry", back_populates="listing")
    favorites = relationship("BusinessFavorite", back_populates="listing")


class BusinessInquiry(Base):
    __tablename__ = "business_inquiries"
    
    id = Column(String, primary_key=True, index=True)
    listing_id = Column(String, ForeignKey("business_listings.id"), index=True)
    buyer_id = Column(String, ForeignKey("vendors.id"), index=True)
    seller_id = Column(String, ForeignKey("vendors.id"), index=True)
    
    message = Column(String)
    phone = Column(String)
    email = Column(String)
    
    # Offer Details (if applicable)
    offer_price = Column(Float)
    offer_notes = Column(String)
    
    status = Column(String, default="pending")  # pending, viewed, responded, closed
    
    read_by_seller = Column(Boolean, default=False)
    read_at = Column(DateTime)
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    
    # Relationships
    listing = relationship("BusinessListing")
    buyer = relationship("Vendor", foreign_keys=[buyer_id])
    seller = relationship("Vendor", foreign_keys=[seller_id])


class BusinessFavorite(Base):
    __tablename__ = "business_favorites"
    
    id = Column(String, primary_key=True, index=True)
    listing_id = Column(String, ForeignKey("business_listings.id"), index=True)
    user_id = Column(String, ForeignKey("vendors.id"), index=True)
    
    created_at = Column(DateTime, server_default=func.now())
    
    # Relationships
    listing = relationship("BusinessListing")
    user = relationship("Vendor")
```

---

### 3. Consolidation & Logistics Models

```python
# models/consolidation.py
from sqlalchemy import Column, String, DateTime, Boolean, Enum, Float, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import ARRAY
from database import Base
import enum

class ConsolidationStatus(enum.Enum):
    PENDING = "pending"
    MATCHED = "matched"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    IN_PROGRESS = "in_progress"
    FULFILLED = "fulfilled"
    CANCELLED = "cancelled"

class StopType(enum.Enum):
    PARCEL_STOP = "parcel_stop"
    BUYER = "buyer"
    SUPPLIER = "supplier"
    WAREHOUSE = "warehouse"


class ConsolidationRequest(Base):
    __tablename__ = "consolidation_requests"
    
    id = Column(String, primary_key=True, index=True)
    buyer_id = Column(String, ForeignKey("vendors.id"), index=True)
    
    # Request Details
    preferred_parcel_stop_id = Column(String, ForeignKey("parcel_stops.id"))
    preferred_date = Column(DateTime)
    notes = Column(String)
    
    # Status
    status = Column(Enum(ConsolidationStatus), default=ConsolidationStatus.PENDING)
    
    # Matching
    matched_at = Column(DateTime)
    matched_by = Column(String)  # System or admin
    
    # Fulfillment
    fulfilled_at = Column(DateTime)
    fulfillment_notes = Column(String)
    
    # Dates
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    
    # Relationships
    buyer = relationship("Vendor", foreign_keys=[buyer_id])
    parcel_stop = relationship("ParcelStop")
    items = relationship("ConsolidationItem", back_populates="request")


class ConsolidationItem(Base):
    __tablename__ = "consolidation_items"
    
    id = Column(String, primary_key=True, index=True)
    request_id = Column(String, ForeignKey("consolidation_requests.id"), index=True)
    order_id = Column(String, ForeignKey("orders.id"), index=True)
    supplier_id = Column(String, ForeignKey("vendors.id"), index=True)
    
    # Item Details
    description = Column(String)
    quantity = Column(Integer)
    weight = Column(Float)  # kg
    volume = Column(Float)  # cubic meters
    
    # Status
    ready_for_pickup = Column(Boolean, default=False)
    picked_up = Column(Boolean, default=False)
    picked_up_at = Column(DateTime)
    picked_up_by = Column(String)
    
    # Photos
    pickup_photo = Column(String)  # File path
    handover_photo = Column(String)  # File path
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    
    # Relationships
    request = relationship("ConsolidationRequest")
    order = relationship("Order")
    supplier = relationship("Vendor")


class ConsolidationRun(Base):
    __tablename__ = "consolidation_runs"
    
    id = Column(String, primary_key=True, index=True)
    supplier_id = Column(String, ForeignKey("vendors.id"), index=True)
    driver_id = Column(String, ForeignKey("vendors.id"))
    vehicle_id = Column(String, ForeignKey("vehicles.id"))
    
    # Run Details
    name = Column(String)
    description = Column(String)
    
    # Route
    route = Column(JSON)  # [{ stop_id, stop_type, sequence, arrival, departure }]
    
    # Status
    status = Column(String, default="planned")  # planned, in_progress, completed, cancelled
    
    # Dates
    start_date = Column(DateTime)
    end_date = Column(DateTime)
    actual_start = Column(DateTime)
    actual_end = Column(DateTime)
    
    # Documents
    manifest_url = Column(String)  # PDF manifest
    
    # Tracking
    tracking_number = Column(String, unique=True)
    
    # Photos
    start_photo = Column(String)
    end_photo = Column(String)
    
    # Financials
    total_value = Column(Float)
    delivery_fee = Column(Float)
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    
    # Relationships
    supplier = relationship("Vendor", foreign_keys=[supplier_id])
    driver = relationship("Vendor", foreign_keys=[driver_id])
    vehicle = relationship("Vehicle")
    stops = relationship("ConsolidationStop", back_populates="run")
    items = relationship("ConsolidationItem", back_populates="run")


class ConsolidationStop(Base):
    __tablename__ = "consolidation_stops"
    
    id = Column(String, primary_key=True, index=True)
    run_id = Column(String, ForeignKey("consolidation_runs.id"), index=True)
    stop_id = Column(String, ForeignKey("parcel_stops.id"), index=True)
    stop_type = Column(Enum(StopType))
    sequence = Column(Integer)
    
    # Timing
    scheduled_arrival = Column(DateTime)
    scheduled_departure = Column(DateTime)
    actual_arrival = Column(DateTime)
    actual_departure = Column(DateTime)
    
    # Items
    items = Column(ARRAY(String))  # ConsolidationItem IDs
    
    # Verification
    photo_url = Column(String)  # Photo uploaded at stop
    verified = Column(Boolean, default=False)
    verified_by = Column(String)
    verified_at = Column(DateTime)
    verification_notes = Column(String)
    
    # Signatures
    signature_url = Column(String)
    signed_by = Column(String)
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    
    # Relationships
    run = relationship("ConsolidationRun")
    stop = relationship("ParcelStop")


class ParcelStop(Base):
    __tablename__ = "parcel_stops"
    
    id = Column(String, primary_key=True, index=True)
    
    # Stop Details
    name = Column(String, index=True)
    partner_name = Column(String)  # Logistics company name
    partner_code = Column(String)  # Partner's internal code
    
    # Location
    address = Column(String)
    city = Column(String, index=True)
    county = Column(String, index=True)
    coordinates = Column(JSON)  # { lat: float, lng: float }
    
    # Contact
    contact_person = Column(String)
    phone = Column(String)
    email = Column(String)
    
    # Operations
    operating_hours = Column(String)
    is_active = Column(Boolean, default=True)
    
    # Capacity
    storage_capacity = Column(Integer)  # Max items
    max_weight = Column(Float)  # Max weight in kg
    max_volume = Column(Float)  # Max volume in cubic meters
    
    # Verification
    verified = Column(Boolean, default=False)
    verified_at = Column(DateTime)
    verification_notes = Column(String)
    
    # Ratings
    rating = Column(Float, default=0)
    review_count = Column(Integer, default=0)
    
    # Requirements
    photo_required = Column(Boolean, default=True)
    id_verification_required = Column(Boolean, default=True)
    
    # Financials
    handling_fee = Column(Float, default=0)
    storage_fee_per_day = Column(Float, default=0)
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    
    # Relationships
    consolidation_runs = relationship("ConsolidationRun", secondary="consolidation_stops")
    consolidation_requests = relationship("ConsolidationRequest")


class Vehicle(Base):
    __tablename__ = "vehicles"
    
    id = Column(String, primary_key=True, index=True)
    owner_id = Column(String, ForeignKey("vendors.id"), index=True)
    
    # Vehicle Details
    registration_number = Column(String, unique=True)
    make = Column(String)
    model = Column(String)
    year = Column(Integer)
    color = Column(String)
    
    # Capacity
    capacity_weight = Column(Float)  # Max weight in kg
    capacity_volume = Column(Float)  # Max volume in cubic meters
    
    # Type
    type = Column(String)  # truck, van, pickup, motorcycle, bicycle
    
    # Status
    is_active = Column(Boolean, default=True)
    is_verified = Column(Boolean, default=False)
    
    # Documents
    logbook_url = Column(String)
    insurance_url = Column(String)
    inspection_url = Column(String)
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    
    # Relationships
    owner = relationship("Vendor")
    consolidation_runs = relationship("ConsolidationRun")
```

---

### 4. Financial Models

```python
# models/financial.py
from sqlalchemy import Column, String, DateTime, Boolean, Enum, Float, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import ARRAY
from database import Base
import enum

class PaymentMethodType(enum.Enum):
    MPESA = "mpesa"
    BANK_TRANSFER = "bank_transfer"
    CARD = "card"
    CASH = "cash"
    ESCROW = "escrow"
    MOBILE_MONEY = "mobile_money"

class PaymentStatus(enum.Enum):
    PENDING = "pending"
    INITIATED = "initiated"
    CONFIRMED = "confirmed"
    FAILED = "failed"
    REFUNDED = "refunded"
    DISPUTED = "disputed"
    REVERSED = "reversed"

class BankName(enum.Enum):
    EQUITY = "equity"
    KCB = "kcb"
    COOPERATIVE = "cooperative"
    NCBA = "ncba"
    STANDARD_CHARTERED = "standard_chartered"
    STANBIC = "stanbic"
    DIAMOND_TRUST = "diamond_trust"
    FAMILY = "family"
    IANDM = "i_and_m"
    SIDIAN = "sidian"
    OTHER = "other"

class MobileMoneyProvider(enum.Enum):
    MPESA = "mpesa"
    AIRTEL_MONEY = "airtel_money"
    TKASH = "tkash"
    FAIBA_MONEY = "faiba_money"


class PaymentMethod(Base):
    __tablename__ = "payment_methods"
    
    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("vendors.id"), index=True)
    
    # Method Type
    method_type = Column(Enum(PaymentMethodType))
    
    # Details based on type
    details = Column(JSON)  # Flexible field for different method types
    
    # For M-Pesa
    mpesa_phone = Column(String)
    mpesa_account_type = Column(String)  # personal or business
    
    # For Bank
    bank_name = Column(Enum(BankName))
    bank_account_number = Column(String)
    bank_account_name = Column(String)
    bank_branch = Column(String)
    bank_sort_code = Column(String)
    
    # For Card
    card_type = Column(String)  # visa, mastercard, etc.
    card_last_four = Column(String)
    card_expiry = Column(String)
    card_holder_name = Column(String)
    
    # For Mobile Money (non-M-Pesa)
    mobile_provider = Column(Enum(MobileMoneyProvider))
    mobile_phone = Column(String)
    
    # Verification
    is_verified = Column(Boolean, default=False)
    verified_at = Column(DateTime)
    verification_notes = Column(String)
    
    # Status
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    
    # Relationships
    user = relationship("Vendor")
    transactions = relationship("Transaction", back_populates="payment_method")


class Transaction(Base):
    __tablename__ = "transactions"
    
    id = Column(String, primary_key=True, index=True)
    
    # Related Entities
    order_id = Column(String, ForeignKey("orders.id"), index=True)
    business_listing_id = Column(String, ForeignKey("business_listings.id"), index=True)
    buyer_id = Column(String, ForeignKey("vendors.id"), index=True)
    seller_id = Column(String, ForeignKey("vendors.id"), index=True)
    
    # Amount
    amount = Column(Float)
    currency = Column(String, default="KES")
    
    # Payment Method
    payment_method_id = Column(String, ForeignKey("payment_methods.id"), index=True)
    payment_gateway = Column(String)  # mpesa, equity, kcb, card, escrow, cash
    
    # External References
    transaction_reference = Column(String)  # From payment provider
    gateway_reference = Column(String)  # From payment gateway
    
    # Status
    status = Column(Enum(PaymentStatus), default=PaymentStatus.PENDING)
    
    # For Escrow
    escrow_held_until = Column(DateTime)
    escrow_release_conditions = Column(JSON)
    escrow_released_at = Column(DateTime)
    escrow_released_by = Column(String)
    
    # For Financing
    financing_provider = Column(String)
    financing_amount = Column(Float)
    financing_approved = Column(Boolean, default=False)
    
    # Fees
    byway_commission = Column(Float, default=0)
    payment_gateway_fee = Column(Float, default=0)
    total_fees = Column(Float, default=0)
    net_amount = Column(Float)  # amount - total_fees
    
    # Dates
    initiated_at = Column(DateTime)
    confirmed_at = Column(DateTime)
    failed_at = Column(DateTime)
    refunded_at = Column(DateTime)
    disputed_at = Column(DateTime)
    resolved_at = Column(DateTime)
    
    # Notes
    failure_reason = Column(String)
    dispute_reason = Column(String)
    resolution_notes = Column(String)
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    
    # Relationships
    order = relationship("Order")
    business_listing = relationship("BusinessListing")
    buyer = relationship("Vendor", foreign_keys=[buyer_id])
    seller = relationship("Vendor", foreign_keys=[seller_id])
    payment_method = relationship("PaymentMethod")
    refunds = relationship("Refund", back_populates="transaction")


class Refund(Base):
    __tablename__ = "refunds"
    
    id = Column(String, primary_key=True, index=True)
    transaction_id = Column(String, ForeignKey("transactions.id"), index=True)
    
    # Refund Details
    amount = Column(Float)
    reason = Column(String)
    requested_by = Column(String)  # User ID
    approved_by = Column(String)  # Admin ID
    
    # Status
    status = Column(String, default="pending")  # pending, approved, processing, completed, rejected
    
    # Dates
    requested_at = Column(DateTime, server_default=func.now())
    approved_at = Column(DateTime)
    processed_at = Column(DateTime)
    completed_at = Column(DateTime)
    
    # External Reference
    gateway_refund_reference = Column(String)
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    
    # Relationships
    transaction = relationship("Transaction")


class EscrowAccount(Base):
    __tablename__ = "escrow_accounts"
    
    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("vendors.id"), index=True)
    
    # Account Details
    account_number = Column(String, unique=True)
    balance = Column(Float, default=0)
    currency = Column(String, default="KES")
    
    # Status
    status = Column(String, default="active")  # active, suspended, closed
    
    # Dates
    opened_at = Column(DateTime, server_default=func.now())
    closed_at = Column(DateTime)
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    
    # Relationships
    user = relationship("Vendor")
    transactions = relationship("Transaction")


class FinancingOption(Base):
    __tablename__ = "financing_options"
    
    id = Column(String, primary_key=True, index=True)
    provider = Column(String)  # Bank or financial institution
    provider_type = Column(String)  # bank, mfs, chama, other
    
    # Terms
    name = Column(String)
    description = Column(String)
    min_amount = Column(Float)
    max_amount = Column(Float)
    interest_rate = Column(Float)  # Percentage
    repayment_period_min = Column(Integer)  # Months
    repayment_period_max = Column(Integer)  # Months
    processing_fee = Column(Float)  # Percentage
    
    # Requirements
    requirements = Column(ARRAY(String))
    required_documents = Column(ARRAY(String))
    min_credit_score = Column(Integer)
    
    # Status
    is_active = Column(Boolean, default=True)
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())


class FinancingApplication(Base):
    __tablename__ = "financing_applications"
    
    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("vendors.id"), index=True)
    transaction_id = Column(String, ForeignKey("transactions.id"), index=True)
    financing_option_id = Column(String, ForeignKey("financing_options.id"), index=True)
    
    # Application Details
    amount = Column(Float)
    purpose = Column(String)
    
    # Status
    status = Column(String, default="pending")  # pending, reviewing, approved, rejected, disbursed
    
    # Review
    reviewed_by = Column(String)
    reviewed_at = Column(DateTime)
    approval_notes = Column(String)
    rejection_reason = Column(String)
    
    # Approval
    approved_amount = Column(Float)
    approved_interest_rate = Column(Float)
    approved_repayment_period = Column(Integer)
    
    # Disbursement
    disbursed_at = Column(DateTime)
    disbursed_amount = Column(Float)
    
    # Repayment
    repayment_schedule = Column(JSON)
    first_payment_date = Column(DateTime)
    last_payment_date = Column(DateTime)
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    
    # Relationships
    user = relationship("Vendor")
    transaction = relationship("Transaction")
    financing_option = relationship("FinancingOption")
```

---

## 🔌 API Endpoints

### 1. Verification API

#### Document Upload
```
POST /api/v1/verification/documents/upload
Headers:
  Authorization: Bearer <token>
  Content-Type: multipart/form-data

Request:
  verification_id: string (optional, for adding to existing verification)
  document_type: string (required) - enum: national_id, passport, kra_pin, etc.
  file: file (required)
  
Response:
  {
    "success": true,
    "document_id": "string",
    "file_name": "string",
    "file_size": 12345,
    "file_hash": "sha256_hash",
    "document_type": "national_id",
    "status": "uploaded",
    "verification_id": "string",
    "message": "Document uploaded successfully"
  }
```

#### Start Verification
```
POST /api/v1/verification/start
Headers:
  Authorization: Bearer <token>

Request:
  {
    "verification_level": "basic|business|financial|premium",
    "id_number": "string",
    "id_type": "national_id|passport",
    "business_name": "string",  // optional for business verification
    "business_registration_number": "string",  // optional
    "kra_pin": "string"  // optional
  }

Response:
  {
    "success": true,
    "verification_id": "string",
    "status": "pending",
    "verification_level": "basic",
    "required_documents": ["national_id", "kra_pin", "passport_photo"],
    "upload_url": "/api/v1/verification/documents/upload?verification_id=...",
    "message": "Verification started. Please upload required documents."
  }
```

#### Get Verification Status
```
GET /api/v1/verification/{verification_id}
Headers:
  Authorization: Bearer <token>

Response:
  {
    "id": "string",
    "user_id": "string",
    "verification_level": "basic",
    "status": "in_review",
    "id_number": "string",
    "id_type": "national_id",
    "business_name": "string",
    "documents": [
      {
        "id": "string",
        "document_type": "national_id",
        "file_name": "id_front.jpg",
        "file_size": 12345,
        "verified": true,
        "verification_notes": "ID matches user photo"
      }
    ],
    "verified_by": "admin_id",
    "verified_at": "2026-10-16T10:00:00Z",
    "rejection_reason": null,
    "expires_at": "2027-10-16T10:00:00Z",
    "created_at": "2026-10-16T09:00:00Z",
    "updated_at": "2026-10-16T10:00:00Z"
  }
```

#### List Verifications (Admin)
```
GET /api/v1/verification/admin
Headers:
  Authorization: Bearer <admin_token>

Query Parameters:
  status: pending|in_review|verified|rejected|expired
  verification_level: basic|business|financial|premium
  user_id: string
  limit: number (default: 50)
  offset: number (default: 0)

Response:
  {
    "total": 100,
    "limit": 50,
    "offset": 0,
    "verifications": [
      {
        "id": "string",
        "user_id": "string",
        "user_name": "string",
        "user_phone": "string",
        "verification_level": "basic",
        "status": "pending",
        "documents_count": 2,
        "verified_documents": 0,
        "created_at": "2026-10-16T09:00:00Z"
      }
    ]
  }
```

#### Review Verification (Admin)
```
POST /api/v1/verification/{verification_id}/review
Headers:
  Authorization: Bearer <admin_token>

Request:
  {
    "action": "approve|reject",
    "verification_notes": "string",
    "rejection_reason": "string"  // required if rejecting
  }

Response:
  {
    "success": true,
    "verification_id": "string",
    "status": "verified",
    "verified_by": "admin_id",
    "verified_at": "2026-10-16T10:00:00Z",
    "message": "Verification approved"
  }
```

---

### 2. Business Marketplace API

#### Create Business Listing
```
POST /api/v1/business/listings
Headers:
  Authorization: Bearer <token>

Request:
  {
    "business_type": "shop|company|franchise|equipment|other",
    "category": "retail|wholesale|manufacturing|other",
    "name": "string",
    "description": "string",
    "tagline": "string",
    "address": "string",
    "city": "string",
    "county": "string",
    "coordinates": {"lat": -1.2921, "lng": 36.8219},
    "years_in_operation": 5,
    "employees": 10,
    "size_sqft": 500,
    "annual_revenue": 5000000,
    "annual_profit": 1000000,
    "asking_price": 2500000,
    "price_negotiable": true,
    "negotiation_type": "negotiable",
    "assets_included": ["equipment", "inventory", "furniture"],
    "reason_for_sale": "string",
    "urgency": "medium",
    "images": ["file_id_1", "file_id_2"],
    "documents": ["file_id_1", "file_id_2"]
  }

Response:
  {
    "success": true,
    "listing_id": "string",
    "status": "pending_verification",
    "verification_required": true,
    "message": "Listing created. Awaiting verification."
  }
```

#### Get Business Listing
```
GET /api/v1/business/listings/{listing_id}

Response:
  {
    "id": "string",
    "seller_id": "string",
    "seller": {
      "id": "string",
      "name": "string",
      "phone": "string",
      "verification_status": "verified",
      "verification_badge": true,
      "rating": 4.5,
      "review_count": 25
    },
    "business_type": "shop",
    "category": "retail",
    "name": "string",
    "description": "string",
    "tagline": "string",
    "address": "string",
    "city": "Nairobi",
    "county": "Nairobi",
    "coordinates": {"lat": -1.2921, "lng": 36.8219},
    "years_in_operation": 5,
    "employees": 10,
    "size_sqft": 500,
    "annual_revenue": 5000000,
    "annual_profit": 1000000,
    "financials_verified": false,
    "asking_price": 2500000,
    "price_negotiable": true,
    "negotiation_type": "negotiable",
    "assets_included": ["equipment", "inventory", "furniture"],
    "assets_description": "string",
    "liabilities": [],
    "liabilities_description": "string",
    "reason_for_sale": "string",
    "urgency": "medium",
    "verification_status": "verified",
    "verification_badge": true,
    "status": "listed",
    "is_public": true,
    "is_featured": false,
    "images": [
      {"id": "string", "url": "string", "is_primary": true}
    ],
    "documents": [
      {"id": "string", "name": "string", "type": "business_license"}
    ],
    "view_count": 150,
    "inquiry_count": 15,
    "favorite_count": 8,
    "listed_at": "2026-10-16T09:00:00Z",
    "created_at": "2026-10-16T09:00:00Z",
    "updated_at": "2026-10-16T09:00:00Z"
  }
```

#### List Business Listings
```
GET /api/v1/business/listings

Query Parameters:
  business_type: shop|company|franchise|equipment|other
  category: retail|wholesale|manufacturing|other
  city: string
  county: string
  min_price: number
  max_price: number
  min_revenue: number
  max_revenue: number
  years_in_operation_min: number
  years_in_operation_max: number
  verification_badge: true|false
  search: string
  sort_by: price|revenue|date|views
  sort_order: asc|desc
  limit: number (default: 20)
  offset: number (default: 0)

Response:
  {
    "total": 100,
    "limit": 20,
    "offset": 0,
    "listings": [
      {
        "id": "string",
        "seller": {
          "id": "string",
          "name": "string",
          "verification_badge": true
        },
        "business_type": "shop",
        "category": "retail",
        "name": "string",
        "tagline": "string",
        "city": "Nairobi",
        "county": "Nairobi",
        "asking_price": 2500000,
        "annual_revenue": 5000000,
        "years_in_operation": 5,
        "verification_badge": true,
        "status": "listed",
        "images": [{"url": "string"}],
        "view_count": 150,
        "created_at": "2026-10-16T09:00:00Z"
      }
    ]
  }
```

#### Create Inquiry
```
POST /api/v1/business/listings/{listing_id}/inquiries
Headers:
  Authorization: Bearer <token>

Request:
  {
    "message": "string",
    "phone": "string",
    "email": "string",
    "offer_price": 2000000,  // optional
    "offer_notes": "string"  // optional
  }

Response:
  {
    "success": true,
    "inquiry_id": "string",
    "message": "Inquiry sent successfully"
  }
```

#### Get Inquiries (Seller)
```
GET /api/v1/business/listings/{listing_id}/inquiries
Headers:
  Authorization: Bearer <token>

Response:
  {
    "total": 15,
    "inquiries": [
      {
        "id": "string",
        "buyer_id": "string",
        "buyer": {
          "id": "string",
          "name": "string",
          "phone": "string",
          "verification_status": "verified"
        },
        "message": "string",
        "phone": "string",
        "email": "string",
        "offer_price": 2000000,
        "offer_notes": "string",
        "status": "pending",
        "read": false,
        "created_at": "2026-10-16T10:00:00Z"
      }
    ]
  }
```

#### Add to Favorites
```
POST /api/v1/business/listings/{listing_id}/favorites
Headers:
  Authorization: Bearer <token>

Response:
  {
    "success": true,
    "is_favorite": true,
    "favorites_count": 8,
    "message": "Added to favorites"
  }
```

---

### 3. Consolidation API

#### Create Consolidation Request
```
POST /api/v1/consolidation/requests
Headers:
  Authorization: Bearer <token>

Request:
  {
    "order_ids": ["order_id_1", "order_id_2"],
    "preferred_parcel_stop_id": "string",
    "preferred_date": "2026-10-20",
    "notes": "string"
  }

Response:
  {
    "success": true,
    "request_id": "string",
    "status": "pending",
    "message": "Consolidation request created. Waiting for matching."
  }
```

#### Get Consolidation Request
```
GET /api/v1/consolidation/requests/{request_id}
Headers:
  Authorization: Bearer <token>

Response:
  {
    "id": "string",
    "buyer_id": "string",
    "buyer": {
      "id": "string",
      "name": "string",
      "phone": "string"
    },
    "preferred_parcel_stop_id": "string",
    "preferred_parcel_stop": {
      "id": "string",
      "name": "string",
      "address": "string",
      "city": "string"
    },
    "preferred_date": "2026-10-20",
    "notes": "string",
    "status": "matched",
    "items": [
      {
        "id": "string",
        "order_id": "string",
        "supplier_id": "string",
        "supplier": {
          "id": "string",
          "name": "string"
        },
        "description": "string",
        "quantity": 10,
        "weight": 50,
        "volume": 0.5,
        "ready_for_pickup": true
      }
    ],
    "matched_at": "2026-10-16T10:00:00Z",
    "created_at": "2026-10-16T09:00:00Z",
    "updated_at": "2026-10-16T10:00:00Z"
  }
```

#### List Consolidation Requests (Buyer)
```
GET /api/v1/consolidation/requests
Headers:
  Authorization: Bearer <token>

Query Parameters:
  status: pending|matched|accepted|rejected|fulfilled|cancelled
  limit: number (default: 20)
  offset: number (default: 0)

Response:
  {
    "total": 10,
    "requests": [
      {
        "id": "string",
        "preferred_parcel_stop": {"name": "string", "city": "string"},
        "preferred_date": "2026-10-20",
        "status": "matched",
        "items_count": 3,
        "created_at": "2026-10-16T09:00:00Z"
      }
    ]
  }
```

#### Accept Consolidation Request (Supplier)
```
POST /api/v1/consolidation/requests/{request_id}/accept
Headers:
  Authorization: Bearer <token>

Request:
  {
    "run_id": "string"  // Optional: existing run to add to
  }

Response:
  {
    "success": true,
    "request_id": "string",
    "status": "accepted",
    "run_id": "string",
    "message": "Consolidation request accepted"
  }
```

#### Create Consolidation Run
```
POST /api/v1/consolidation/runs
Headers:
  Authorization: Bearer <token>

Request:
  {
    "name": "string",
    "description": "string",
    "vehicle_id": "string",
    "driver_id": "string",
    "start_date": "2026-10-20T08:00:00Z",
    "end_date": "2026-10-20T18:00:00Z",
    "route": [
      {
        "stop_id": "string",
        "stop_type": "parcel_stop|buyer|supplier",
        "sequence": 1,
        "scheduled_arrival": "2026-10-20T10:00:00Z",
        "scheduled_departure": "2026-10-20T11:00:00Z"
      }
    ]
  }

Response:
  {
    "success": true,
    "run_id": "string",
    "tracking_number": "BYW-20261020-001",
    "manifest_url": "string",
    "status": "planned",
    "message": "Consolidation run created"
  }
```

#### Get Consolidation Run
```
GET /api/v1/consolidation/runs/{run_id}
Headers:
  Authorization: Bearer <token>

Response:
  {
    "id": "string",
    "supplier_id": "string",
    "supplier": {"id": "string", "name": "string"},
    "driver_id": "string",
    "driver": {"id": "string", "name": "string", "phone": "string"},
    "vehicle_id": "string",
    "vehicle": {"id": "string", "registration": "string", "type": "truck"},
    "name": "string",
    "description": "string",
    "status": "planned",
    "start_date": "2026-10-20T08:00:00Z",
    "end_date": "2026-10-20T18:00:00Z",
    "actual_start": "2026-10-20T08:15:00Z",
    "actual_end": null,
    "tracking_number": "BYW-20261020-001",
    "manifest_url": "string",
    "route": [
      {
        "id": "string",
        "stop_id": "string",
        "stop_type": "parcel_stop",
        "sequence": 1,
        "stop": {"name": "string", "address": "string"},
        "scheduled_arrival": "2026-10-20T10:00:00Z",
        "scheduled_departure": "2026-10-20T11:00:00Z",
        "actual_arrival": null,
        "actual_departure": null,
        "photo_url": null,
        "verified": false,
        "items_count": 5
      }
    ],
    "items": [
      {
        "id": "string",
        "order_id": "string",
        "description": "string",
        "quantity": 10,
        "weight": 50,
        "volume": 0.5,
        "picked_up": false,
        "picked_up_at": null,
        "picked_up_by": null,
        "pickup_photo": null,
        "handover_photo": null
      }
    ],
    "total_value": 50000,
    "delivery_fee": 2000,
    "created_at": "2026-10-16T09:00:00Z",
    "updated_at": "2026-10-16T09:00:00Z"
  }
```

#### Upload Stop Photo
```
POST /api/v1/consolidation/runs/{run_id}/stops/{stop_id}/photo
Headers:
  Authorization: Bearer <token>
  Content-Type: multipart/form-data

Request:
  file: file (required)
  
Response:
  {
    "success": true,
    "photo_url": "string",
    "stop_id": "string",
    "verified": false,
    "message": "Photo uploaded. Awaiting verification."
  }
```

#### Verify Stop
```
POST /api/v1/consolidation/runs/{run_id}/stops/{stop_id}/verify
Headers:
  Authorization: Bearer <token>

Request:
  {
    "verified": true,
    "notes": "string"
  }

Response:
  {
    "success": true,
    "stop_id": "string",
    "verified": true,
    "verified_by": "driver_id",
    "verified_at": "2026-10-20T10:00:00Z",
    "message": "Stop verified"
  }
```

#### List Parcel Stops
```
GET /api/v1/consolidation/parcel-stops

Query Parameters:
  city: string
  county: string
  verified: true|false
  limit: number (default: 50)
  offset: number (default: 0)

Response:
  {
    "total": 50,
    "parcel_stops": [
      {
        "id": "string",
        "name": "string",
        "partner_name": "Sendy",
        "address": "string",
        "city": "Nairobi",
        "county": "Nairobi",
        "coordinates": {"lat": -1.2921, "lng": 36.8219},
        "contact_person": "string",
        "phone": "string",
        "operating_hours": "08:00-18:00",
        "is_active": true,
        "verified": true,
        "rating": 4.5,
        "review_count": 25,
        "storage_capacity": 100,
        "handling_fee": 50
      }
    ]
  }
```

---

### 4. Payment API

#### List Payment Methods
```
GET /api/v1/payments/methods
Headers:
  Authorization: Bearer <token>

Response:
  {
    "payment_methods": [
      {
        "id": "string",
        "method_type": "mpesa",
        "details": {
          "phone": "254712345678",
          "account_type": "personal"
        },
        "is_verified": true,
        "is_active": true,
        "is_default": true,
        "created_at": "2026-10-16T09:00:00Z"
      },
      {
        "id": "string",
        "method_type": "bank_transfer",
        "details": {
          "bank_name": "equity",
          "account_number": "1234567890",
          "account_name": "John Doe",
          "branch": "Nairobi West"
        },
        "is_verified": true,
        "is_active": true,
        "is_default": false,
        "created_at": "2026-10-16T09:00:00Z"
      }
    ]
  }
```

#### Add Payment Method
```
POST /api/v1/payments/methods
Headers:
  Authorization: Bearer <token>

Request (M-Pesa):
  {
    "method_type": "mpesa",
    "mpesa_phone": "254712345678",
    "mpesa_account_type": "personal",
    "is_default": false
  }

Request (Bank):
  {
    "method_type": "bank_transfer",
    "bank_name": "equity",
    "bank_account_number": "1234567890",
    "bank_account_name": "John Doe",
    "bank_branch": "Nairobi West",
    "is_default": false
  }

Response:
  {
    "success": true,
    "payment_method_id": "string",
    "message": "Payment method added successfully"
  }
```

#### Initiate M-Pesa Payment (STK Push)
```
POST /api/v1/payments/mpesa/stk-push
Headers:
  Authorization: Bearer <token>

Request:
  {
    "payment_method_id": "string",
    "amount": 1000,
    "account_reference": "order_id_or_invoice_id",
    "description": "Payment for Order #12345",
    "callback_url": "https://yourapp.com/mpesa/callback"
  }

Response:
  {
    "success": true,
    "request_id": "string",
    "merchant_request_id": "string",
    "checkout_request_id": "string",
    "response_code": "0",
    "response_description": "Success. Request accepted for processing",
    "customer_message": "Success. Request accepted for processing",
    "phone_number": "254712345678",
    "amount": 1000,
    "account_reference": "order_id_or_invoice_id",
    "status": "initiated",
    "message": "STK Push initiated. Waiting for user confirmation."
  }
```

#### M-Pesa Callback Handler
```
POST /api/v1/payments/mpesa/callback
Headers:
  Content-Type: application/json

Request (from M-Pesa):
  {
    "Body": {
      "stkCallback": {
        "MerchantRequestID": "string",
        "CheckoutRequestID": "string",
        "ResultCode": 0,
        "ResultDesc": "Success",
        "CallbackMetadata": {
          "Item": [
            {"Name": "Amount", "Value": 1000},
            {"Name": "MpesaReceiptNumber", "Value": "NGK8376376"},
            {"Name": "Balance", "Value": 5000},
            {"Name": "TransactionDate", "Value": 1660891234567},
            {"Name": "PhoneNumber", "Value": 254712345678}
          ]
        }
      }
    }
  }

Response:
  {
    "ResultCode": 0,
    "ResultDesc": "Accepted"
  }
```

#### Verify M-Pesa Payment
```
POST /api/v1/payments/mpesa/verify
Headers:
  Authorization: Bearer <token>

Request:
  {
    "transaction_reference": "NGK8376376",
    "phone": "254712345678",
    "amount": 1000,
    "order_id": "string"
  }

Response:
  {
    "success": true,
    "transaction_id": "string",
    "status": "confirmed",
    "amount": 1000,
    "phone": "254712345678",
    "receipt_number": "NGK8376376",
    "transaction_date": "2026-10-16T10:00:00Z",
    "balance": 5000,
    "message": "Payment verified successfully"
  }
```

#### Initiate Equity Bank Payment
```
POST /api/v1/payments/equity/transfer
Headers:
  Authorization: Bearer <token>

Request:
  {
    "payment_method_id": "string",
    "amount": 1000,
    "reference": "order_id_or_invoice_id",
    "description": "Payment for Order #12345",
    "callback_url": "https://yourapp.com/equity/callback"
  }

Response:
  {
    "success": true,
    "transaction_id": "string",
    "reference": "order_id_or_invoice_id",
    "status": "initiated",
    "amount": 1000,
    "message": "Equity Bank transfer initiated"
  }
```

#### Verify Equity Bank Payment
```
POST /api/v1/payments/equity/verify
Headers:
  Authorization: Bearer <token>

Request:
  {
    "transaction_reference": "string",
    "amount": 1000,
    "order_id": "string"
  }

Response:
  {
    "success": true,
    "transaction_id": "string",
    "status": "confirmed",
    "amount": 1000,
    "reference": "string",
    "transaction_date": "2026-10-16T10:00:00Z",
    "message": "Payment verified successfully"
  }
```

#### Create Transaction
```
POST /api/v1/payments/transactions
Headers:
  Authorization: Bearer <token>

Request:
  {
    "order_id": "string",
    "business_listing_id": "string",  // optional
    "amount": 1000,
    "payment_method_id": "string",
    "payment_gateway": "mpesa|equity|kcb|card|escrow|cash",
    "transaction_reference": "string",
    "gateway_reference": "string",
    "currency": "KES",
    "description": "string",
    "escrow": {
      "held_until": "2026-10-20T10:00:00Z",
      "release_conditions": ["delivery_confirmed"]
    },
    "financing": {
      "provider": "equity",
      "amount": 1000,
      "approved": true
    }
  }

Response:
  {
    "success": true,
    "transaction_id": "string",
    "status": "confirmed",
    "amount": 1000,
    "net_amount": 980,  // after fees
    "byway_commission": 20,
    "message": "Transaction created successfully"
  }
```

#### Get Transaction
```
GET /api/v1/payments/transactions/{transaction_id}
Headers:
  Authorization: Bearer <token>

Response:
  {
    "id": "string",
    "order_id": "string",
    "business_listing_id": "string",
    "buyer_id": "string",
    "seller_id": "string",
    "amount": 1000,
    "currency": "KES",
    "payment_method_id": "string",
    "payment_gateway": "mpesa",
    "transaction_reference": "NGK8376376",
    "gateway_reference": "string",
    "status": "confirmed",
    "escrow": {
      "held_until": "2026-10-20T10:00:00Z",
      "release_conditions": ["delivery_confirmed"],
      "released_at": null,
      "released_by": null
    },
    "byway_commission": 20,
    "payment_gateway_fee": 0,
    "total_fees": 20,
    "net_amount": 980,
    "initiated_at": "2026-10-16T09:00:00Z",
    "confirmed_at": "2026-10-16T10:00:00Z",
    "created_at": "2026-10-16T09:00:00Z",
    "updated_at": "2026-10-16T10:00:00Z"
  }
```

#### List Transactions
```
GET /api/v1/payments/transactions
Headers:
  Authorization: Bearer <token>

Query Parameters:
  type: order|business|consolidation
  status: pending|initiated|confirmed|failed|refunded|disputed
  date_from: string
  date_to: string
  limit: number (default: 20)
  offset: number (default: 0)

Response:
  {
    "total": 100,
    "transactions": [
      {
        "id": "string",
        "order_id": "string",
        "amount": 1000,
        "payment_gateway": "mpesa",
        "status": "confirmed",
        "confirmed_at": "2026-10-16T10:00:00Z",
        "created_at": "2026-10-16T09:00:00Z"
      }
    ]
  }
```

#### Request Refund
```
POST /api/v1/payments/transactions/{transaction_id}/refund
Headers:
  Authorization: Bearer <token>

Request:
  {
    "amount": 1000,
    "reason": "string"
  }

Response:
  {
    "success": true,
    "refund_id": "string",
    "status": "pending",
    "message": "Refund request submitted for review"
  }
```

#### Release Escrow
```
POST /api/v1/payments/transactions/{transaction_id}/escrow/release
Headers:
  Authorization: Bearer <token>

Request:
  {
    "release_conditions_met": ["delivery_confirmed"],
    "notes": "string"
  }

Response:
  {
    "success": true,
    "transaction_id": "string",
    "escrow_released": true,
    "released_at": "2026-10-20T10:00:00Z",
    "released_by": "admin_id",
    "message": "Escrow released successfully"
  }
```

---

## 🔐 Authentication & Authorization

All endpoints require authentication via JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

### Roles & Permissions

| Role | Permissions |
|------|-------------|
| vendor | Create/read own listings, inquiries, payment methods, transactions |
| buyer | Create inquiries, add favorites, create consolidation requests |
| supplier | Accept consolidation requests, create runs, upload photos |
| driver | View assigned runs, upload stop photos |
| parcel_stop | View incoming shipments, verify receipt |
| admin | View all, verify documents, manage parcel stops |
| system | Internal system operations |

### Rate Limiting
- 100 requests per minute per user
- 10 requests per second burst
- Different limits for different endpoints
- Admin endpoints have higher limits

---

## 📊 Webhooks

### M-Pesa Webhook
```
POST /api/v1/webhooks/mpesa
Content-Type: application/json

Payload: See M-Pesa callback handler
```

### Equity Bank Webhook
```
POST /api/v1/webhooks/equity
Content-Type: application/json

Payload: Transaction status updates from Equity Bank
```

### Consolidation Webhook
```
POST /api/v1/webhooks/consolidation
Content-Type: application/json

Payload: Status updates from logistics partners
```

---

## 🚀 Implementation Notes

### Dependencies
```python
# FastAPI
fastapi
uvicorn
python-jose
passlib
python-multipart

# Database
sqlalchemy
asyncpg
alembic

# File Storage
boto3  # for AWS S3
google-cloud-storage  # for GCS
python-magic  # for file type detection

# Payment Gateways
requests
python-daraja  # M-Pesa

# Security
cryptography
bcrypt

# Validation
pydantic
email-validator

# Utilities
python-dateutil
pytz
```

### Database Migrations
Run migrations with Alembic:
```bash
alembic revision --autogenerate -m "Add verification tables"
alembic upgrade head
```

### Environment Setup
```bash
# Copy example env file
cp .env.example .env

# Edit .env with your configuration
nano .env

# Install dependencies
pip install -r requirements.txt

# Run migrations
alembic upgrade head

# Start server
uvicorn main:app --reload --port 8000
```

---

## 🧪 Testing

### Test Endpoints
```bash
# Run tests
pytest tests/

# Run specific test
pytest tests/test_verification.py

# Run with coverage
pytest --cov=app tests/
```

### Test Data
```python
# tests/conftest.py
import pytest
from fastapi.testclient import TestClient
from main import app
from database import Base, engine

@pytest.fixture
def client():
    return TestClient(app)

@pytest.fixture
def db_session():
    # Create test database
    Base.metadata.create_all(bind=engine)
    yield
    # Cleanup
    Base.metadata.drop_all(bind=engine)
```

---

## 📝 API Versioning

All endpoints are versioned with `/api/v1/` prefix.

### Versioning Strategy
- **Major Version (v1, v2)**: Breaking changes
- **Minor Version (v1.1, v1.2)**: Backward-compatible additions
- **Patch Version (v1.1.1)**: Bug fixes only

### Deprecation Policy
- Deprecated endpoints marked with `X-Deprecation-Warning` header
- 6 months notice before removal
- Documentation updated with deprecation notices

---

## 🎯 Next Steps

1. **Review API specifications** - Ensure all endpoints meet requirements
2. **Implement database models** - Create all tables with proper relationships
3. **Implement endpoints** - Start with Verification API (foundation)
4. **Add authentication** - JWT token validation middleware
5. **Add validation** - Pydantic models for request/response validation
6. **Add error handling** - Consistent error responses
7. **Add logging** - Track all API calls and errors
8. **Add monitoring** - Track performance and usage
9. **Write tests** - Unit and integration tests
10. **Document** - Update API documentation

---

## 📞 Support

For questions or issues with API implementation:
1. Review this specification
2. Check existing code for patterns
3. Refer to FastAPI documentation
4. Ask for clarification on specific endpoints

---

*Document created: 2026-10-16*
*Version: 1.0*
*Status: Specification Complete*
